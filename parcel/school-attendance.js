import { load } from "cheerio";
import { createHash } from "node:crypto";
import snapshot from "../data/nhps-attendance.json" with { type: "json" };
import { cached, fetchBounded, SourceError } from "./http.js";

export const NHPS_ATTENDANCE_URL =
  "https://www.newhavenmagnetschools.com/index.php/enrollment/find-schools-in-your-attendance-zone";
export const NHPS_SNAPSHOT_MAX_AGE_DAYS = 30;
const snapshotHashValid = createHash("sha256").update(JSON.stringify(snapshot.rows.map((row) =>
  Object.fromEntries(Object.keys(row).sort().map((key) => [key, row[key]]))))).digest("hex") === snapshot.sha256;

const SUFFIXES = new Map(Object.entries({
  STREET: "ST", ST: "ST", AVENUE: "AV", AVE: "AV", AV: "AV",
  ROAD: "RD", RD: "RD", TERRACE: "TER", TER: "TER",
  COURT: "CT", CT: "CT", LANE: "LA", LN: "LA", LA: "LA",
  BOULEVARD: "BLVD", BLVD: "BLVD", DRIVE: "DR", DR: "DR",
  PLACE: "PL", PL: "PL", CIRCLE: "CIR", CIR: "CIR",
  PARKWAY: "PKWY", PKWY: "PKWY", SQUARE: "SQ", SQ: "SQ",
  ALLEY: "ALY", ALY: "ALY", PLAZA: "PLZ", PLZ: "PLZ",
  EXTENSION: "EXT", EXT: "EXT",
}));

export function normalizeSchoolStreet(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ").trim().split(" ")
    .map((part) => SUFFIXES.get(part) ?? part).join(" ");
}

export function schoolAddress(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,6})\s+(.+)$/);
  if (!match) return null;
  const number = Number(match[1]);
  const street = normalizeSchoolStreet(match[2]);
  if (!Number.isSafeInteger(number) || !street) return null;
  return { number, street, address: `${number} ${street}` };
}

function rowRange(row) {
  const start = String(row.start ?? "").trim();
  const end = String(row.end ?? "").trim();
  if (!start && !end) return { first: 0, last: Infinity, parity: null };
  if (!/^\d+$/.test(start)) return null;
  const match = end.match(/^(\d+|End)(?:\s*\((O|E|O&E)\))?$/i);
  if (!match) return null;
  const first = Number(start);
  const last = /^end$/i.test(match[1]) ? Infinity : Number(match[1]);
  if (last < first) return null;
  return { first, last, parity: match[2]?.toUpperCase() ?? null };
}

export function schoolRowsForAddress(rows, address) {
  const matched = rows.filter((row) => {
    if (normalizeSchoolStreet(row.street_name) !== address.street) return false;
    const range = rowRange(row);
    return range && address.number >= range.first && address.number <= range.last &&
      (range.parity === null || range.parity === "O&E" ||
        (range.parity === "O" && address.number % 2 === 1) ||
        (range.parity === "E" && address.number % 2 === 0));
  });
  if (!matched.length) return { status: "not_linked", rows: [] };
  const schools = new Set(matched.map((row) =>
    `${row.k8_school}\u0000${row.high_school}`));
  if (schools.size !== 1) return { status: "ambiguous", rows: matched };
  return { status: "matched", rows: matched };
}

export function parseNhpsSearch(html) {
  const $ = load(html);
  const form = $(".joodb.database-list form#joodbForm");
  if (!form.length || !form.text().includes("K-8 SCHOOL"))
    throw new SourceError("NHPS attendance search table structure changed");
  const rows = [];
  form.find(".tr.odd, .tr.even").each((_, element) => {
    const cells = $(element).children(".td");
    if (cells.length !== 5)
      throw new SourceError("NHPS attendance row has an unexpected number of columns");
    const anchor = cells.eq(0).find("a.joodb_titlelink").first();
    const href = anchor.attr("href") ?? "";
    const id = href.match(/\/(\d+)-[^/]+$/)?.[1];
    if (!id) throw new SourceError("NHPS attendance row has no published identifier");
    const sourceUrl = new URL(href, NHPS_ATTENDANCE_URL);
    if (sourceUrl.origin !== new URL(NHPS_ATTENDANCE_URL).origin)
      throw new SourceError("NHPS attendance row link left the official source");
    const [street_name, start, end, k8_school, high_school] = cells.toArray()
      .map((cell) => $(cell).text().replace(/\s+/g, " ").trim());
    if (!street_name || !k8_school || !high_school || !rowRange({ start, end }))
      throw new SourceError("NHPS attendance row has incomplete school or range fields");
    rows.push({ id: Number(id), street_name, start, end, k8_school,
      high_school, source_url: sourceUrl.href });
  });
  const countText = form.text().match(/Results\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)/i);
  if (countText && (Number(countText[2]) !== rows.length || Number(countText[3]) > rows.length))
    throw new SourceError("NHPS attendance search returned more than one page");
  return rows;
}

export function snapshotIsCurrent(now = Date.now()) {
  const retrieved = Date.parse(snapshot.retrieved_at);
  return Number.isFinite(retrieved) && retrieved <= now &&
    now - retrieved <= NHPS_SNAPSHOT_MAX_AGE_DAYS * 86400_000 &&
    snapshot.row_count === snapshot.rows.length && snapshot.rows.length >= 800 &&
    snapshot.source_url === NHPS_ATTENDANCE_URL && snapshotHashValid;
}

export async function lookupNhpsStreet(street) {
  return cached(`nhps-attendance:${street}`, async () => {
    const form = new URLSearchParams({ option: "com_joodb", view: "catalog",
      format: "html", reset: "false", start: "0", search: street.slice(0, 40) });
    try {
      const html = await fetchBounded(NHPS_ATTENDANCE_URL, {
        method: "POST", body: form, accept: "text/html,application/xhtml+xml",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        timeout: 10000, maxBytes: 500_000,
      });
      return { rows: parseNhpsSearch(html), mode: "live", checked_at: new Date().toISOString() };
    } catch (error) {
      if (!snapshotIsCurrent())
        throw new SourceError(`NHPS live lookup failed (${error.message}); official snapshot is older than ${NHPS_SNAPSHOT_MAX_AGE_DAYS} days`);
      return { rows: snapshot.rows.filter((row) => normalizeSchoolStreet(row.street_name) === street),
        mode: "official_snapshot", checked_at: new Date().toISOString(),
        snapshot_retrieved_at: snapshot.retrieved_at, snapshot_sha256: snapshot.sha256,
        warning: `NHPS live lookup failed (${error.message}); using the official NHPS export retrieved ${snapshot.retrieved_at.slice(0, 10)}.` };
    }
  }, 3600);
}
