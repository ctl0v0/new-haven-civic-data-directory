import { fetchJson, SourceError } from "../parcel/http.js";
import { municipalPermitTypes } from "../parcel/permit-types.js";

const VENDOR = "https://services5.municity5.com/M5Services/M5Service.svc/GetM5Data";
const LIMIT = 2000;

export function sameMunicipalPermitRows(first, second) {
  if (first.length !== second.length) return false;
  // The municipal search returns the same published IDs in varying row order.
  const byPublishedId = (a, b) => a.record_id.localeCompare(b.record_id);
  return JSON.stringify(first.toSorted(byPublishedId)) ===
    JSON.stringify(second.toSorted(byPublishedId));
}

export function municipalDate(value) {
  const raw = String(value ?? "");
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/);
  if (iso) return iso[1];
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/);
  if (!us) return null;
  const date = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const parsed = Date.parse(`${date}T00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date ? date : null;
}

export async function municipalPermitTypeRows(permitType, { get = fetchJson,
  catalog = municipalPermitTypes } = {}) {
  const type = String(permitType ?? "").trim();
  if (!type || type.length > 100 || /[\x00-\x1f]/.test(type))
    throw new SourceError("Invalid municipal permit type", 400);
  const listed = await catalog();
  if (!listed.groups?.some((group) => group.types?.some((item) => item.name === type)))
    throw new SourceError("Permit type is absent from the official municipal catalog", 404);
  const url = new URL(VENDOR);
  for (const [key, value] of Object.entries({ Customer: "NewHavenCityCT",
    entity: "Permit", entity_id: "", fieldtype: "text", mapid: "", mapobject: "",
    module: "", numrecs: String(LIMIT), operator: "=", pid: "",
    searchfield: "PermitType", section: "", value: type }))
    url.searchParams.set(key, value);
  const data = await get(url, { headers: { SourceId: "2" }, timeout: 25000,
    maxBytes: 35_000_000 });
  const rows = data.rows === "" && Number(data.total) === 0 ? [] : data.rows;
  if (!Array.isArray(rows)) throw new SourceError("Municipal permit type search returned no row list");
  const publishedTotal = Number(data.total);
  if (!Number.isSafeInteger(publishedTotal) || publishedTotal < rows.length)
    throw new SourceError("Municipal permit type search did not establish a total count");
  const boundReached = rows.length >= LIMIT || publishedTotal > rows.length;
  if (boundReached) throw new SourceError("Municipal permit type reached the unpageable 2,000-row bound");
  if (rows.some((row) => !String(row?.PermitType ?? "").trim()))
    throw new SourceError("Municipal permit search returned a row without a published type");
  const filtered = rows.filter((row) => String(row.PermitType ?? "").trim().toUpperCase() === type.toUpperCase());
  const ids = filtered.map((row) => String(row.Permit_ID ?? ""));
  if (ids.some((id) => !/^\d+$/.test(id)) || new Set(ids).size !== ids.length)
    throw new SourceError("Municipal permit type rows lack unique published Permit_ID values");
  return { type, vendor_count: rows.length, rows: filtered.map((row) => ({
    record_id: String(row.Permit_ID),
    source_url: `https://www.municityconnect.com/#/app/NewHavenCityCT/entity/Permit/${row.Permit_ID}`,
    published_type: row.PermitType ?? null,
    published_status: row.PermStatus ?? null,
    event_date: municipalDate(row.PermitDate),
    fields: Object.fromEntries(["Permit_ID", "Application_ID", "PermitNo", "PermitType",
      "PermStatus", "PermitDate", "PrintKey", "LegalAddress"].filter((field) =>
      row[field] != null).map((field) => [field, row[field]])),
  })) };
}
