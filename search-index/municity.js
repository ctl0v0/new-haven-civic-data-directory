import { createHash } from "node:crypto";
import { fetchJson, SourceError } from "../parcel/http.js";
import { municipalPermitTypes } from "../parcel/permit-types.js";

const VENDOR = "https://services5.municity5.com/M5Services/M5Service.svc/GetM5Data";
export const RECENT_PERMIT_WINDOWS = Object.freeze([30, 90].map((days) => ({
  days, scope_key: `permit-window:${days}`,
})));
export const RECENT_PERMIT_SCOPES = RECENT_PERMIT_WINDOWS.map((window) => window.scope_key);

export function recentPermitRun(rows, from, to) {
  if (!from || !to) return null;
  const day = (value) => value instanceof Date ? value.toISOString().slice(0, 10)
    : String(value ?? "").slice(0, 10);
  return rows.filter((row) => row.source_id === "municity" &&
    RECENT_PERMIT_SCOPES.includes(row.scope_key) && row.status === "complete" &&
    row.coverage_date_from && row.coverage_date_to &&
    from >= day(row.coverage_date_from) && to <= day(row.coverage_date_to))
    .sort((a, b) => Number(a.latest_attempt_status === "failed") -
      Number(b.latest_attempt_status === "failed") ||
      Date.parse(b.finished_at) - Date.parse(a.finished_at))[0] ?? null;
}
// The municipal service returns more than 2,000 rows when requested. Ten
// thousand has been checked against its public permit search. A response that
// fills this request is still not an established full enumeration.
const LIMIT = 10000;
const INDEX_FIELDS = ["Permit_ID", "Application_ID", "PermitNo", "PermitType",
  "PermStatus", "PermitDate", "Parcel_ID", "PrintKey", "PrintKey_Parcel",
  "LegalAddress"];
const municipalUrl = (searchfield, value, numrecs = LIMIT, fieldtype = "text") => {
  const url = new URL(VENDOR);
  for (const [key, fieldValue] of Object.entries({ Customer: "NewHavenCityCT",
    entity: "Permit", entity_id: "", fieldtype, mapid: "", mapobject: "",
    module: "", numrecs: String(numrecs), operator: "=", pid: "",
    searchfield, section: "", value })) url.searchParams.set(key, fieldValue);
  return url;
};
const vendorOptions = { headers: { SourceId: "2" }, timeout: 60000,
  maxBytes: 75_000_000 };

async function municipalSearch(searchfield, value, numrecs, get, fieldtype = "text") {
  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      data = await get(municipalUrl(searchfield, value, numrecs, fieldtype), vendorOptions);
      break;
    } catch (error) {
      if (error?.upstreamStatus !== 429 || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 45_000));
    }
  }
  const rows = data.rows === "" && Number(data.total) === 0 ? [] : data.rows;
  const total = Number(data.total);
  if (!Array.isArray(rows) || !Number.isSafeInteger(total) || total < rows.length)
    throw new SourceError("Municipal permit search did not establish its row list and total count");
  return { rows, total };
}

function normalizedPermitRows(rows, types) {
  const names = types == null ? null : new Set((Array.isArray(types) ? types : [types])
    .map((name) => String(name).trim().toUpperCase()));
  const filtered = names ? rows.filter((row) =>
    names.has(String(row.PermitType ?? "").trim().toUpperCase())) : rows;
  const byId = new Map();
  const present = (value) => value != null && String(value).trim() !== "";
  for (const row of filtered) {
    const id = String(row.Permit_ID ?? "");
    if (!/^\d+$/.test(id))
      throw new SourceError("Municipal permit row lacks a published numeric Permit_ID");
    const existing = byId.get(id) ?? {};
    for (const field of INDEX_FIELDS) {
      const value = row[field];
      if (!present(value)) continue;
      if (present(existing[field]) && JSON.stringify(existing[field]) !== JSON.stringify(value))
        throw new SourceError(`Municipal permit ${id} has conflicting published ${field} values`);
      existing[field] = value;
    }
    byId.set(id, existing);
  }
  return { duplicate_rows: filtered.length - byId.size,
    rows: [...byId].map(([id, fields]) => ({
      record_id: id,
      source_url: `https://www.municityconnect.com/#/app/NewHavenCityCT/entity/Permit/${id}`,
      published_type: fields.PermitType ?? null,
      published_status: fields.PermStatus ?? null,
      event_date: municipalDate(fields.PermitDate),
      fields: Object.fromEntries(INDEX_FIELDS.filter((field) => field in fields)
        .map((field) => [field, fields[field]])),
    })) };
}

export class MunicipalPermitCapError extends SourceError {
  constructor(permitType, publishedTotal) {
    super(`Municipal permit type ${permitType} reached the validated ${LIMIT.toLocaleString("en-US")}-row request bound (${publishedTotal} rows returned)`);
    this.code = "MUNICIPAL_TYPE_CAP";
  }
}

export function municipalTypeShard(type) {
  return createHash("sha256").update(type.toUpperCase()).digest()[0] % 24;
}

export function municipalPermitCatalogRows(listed) {
  const entries = listed?.groups?.flatMap((group) => group.types?.map((type) => ({
    name: type.name, group: group.name, permit_type_id: type.permit_type_id,
    deleted_as_published: type.deleted_as_published,
  })) ?? []) ?? [];
  const names = entries.map((entry) => String(entry.name ?? "").trim());
  if (listed?.partial || !Number.isSafeInteger(listed?.catalog_rows_returned) ||
      entries.length !== listed.catalog_rows_returned ||
      names.length !== listed.distinct_type_names ||
      names.some((name) => !name) ||
      new Set(names.map((name) => name.toUpperCase())).size !== names.length)
    throw new SourceError("Municipal permit type catalog is incomplete or repeats a type");
  return entries.map((entry) => ({
    record_id: entry.name, source_url: listed.source_url,
    published_type: entry.name, fields: entry,
  }));
}

export function sameMunicipalPermitRows(first, second) {
  if (first.length !== second.length) return false;
  // The municipal search returns the same published IDs in varying row order.
  const byPublishedId = (a, b) => a.record_id.localeCompare(b.record_id);
  const canonical = (rows) => rows.map((row) => ({ ...row,
    fields: Object.fromEntries(Object.entries(row.fields ?? {})
      .sort(([a], [b]) => a.localeCompare(b))) })).toSorted(byPublishedId);
  return JSON.stringify(canonical(first)) === JSON.stringify(canonical(second));
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
  const { rows, total: publishedTotal } = await municipalSearch("PermitType", type, LIMIT, get);
  const boundReached = rows.length >= LIMIT || publishedTotal > rows.length;
  if (boundReached) throw new MunicipalPermitCapError(type, publishedTotal);
  if (rows.some((row) => !String(row?.PermitType ?? "").trim()))
    throw new SourceError("Municipal permit search returned a row without a published type");
  return { type, vendor_count: rows.length, ...normalizedPermitRows(rows, type) };
}

// This is a capability probe, not a claim that the vendor supports date
// enumeration. Importers must validate the published total for every day.
export async function municipalDateSearchFormat(type = "Electrical Permit", { get = fetchJson } = {}) {
  const sample = await municipalSearch("PermitType", type, 50, get);
  const dated = sample.rows.find((row) => /^\d+$/.test(String(row.Permit_ID ?? "")) &&
    municipalDate(row.PermitDate));
  if (!dated) throw new SourceError("Municipal date-search probe found no dated permit row");
  const date = municipalDate(dated.PermitDate);
  const encodings = ["us", "us_short", "iso"];
  const formats = ["text", "date", "datetime"].flatMap((fieldtype) =>
    encodings.map((encoding) => ({ fieldtype, encoding })));
  const attempts = [];
  for (const format of formats) {
    const value = municipalDateValue(date, format.encoding);
    try {
      let result = await municipalSearch("PermitDate", value, 100, get, format.fieldtype);
      if (result.total > 100 && result.total < LIMIT)
        result = await municipalSearch("PermitDate", value, LIMIT, get, format.fieldtype);
      const exact = result.total === result.rows.length && result.rows.length < LIMIT &&
        result.rows.every((row) => municipalDate(row.PermitDate) === date);
      const reproduced = result.rows.some((row) => String(row.Permit_ID) === String(dated.Permit_ID));
      attempts.push({ fieldtype: format.fieldtype, encoding: format.encoding,
        total: result.total, returned: result.rows.length, exact, reproduced });
      if (exact && reproduced) {
        console.log(JSON.stringify({ event: "municipal_date_search_probe",
          result: "verified", sample_date: date,
          sample_value: String(dated.PermitDate), format, attempts }));
        return format;
      }
    } catch (error) {
      attempts.push({ fieldtype: format.fieldtype, encoding: format.encoding,
        error: error instanceof SourceError ? error.message : "request failed" });
    }
  }
  console.log(JSON.stringify({ event: "municipal_date_search_probe",
    result: "unverified", sample_date: date,
    sample_value: String(dated.PermitDate), attempts }));
  throw new SourceError("Municipal PermitDate search did not reproduce a known official permit; recent window is unverified");
}

function municipalDateValue(date, encoding) {
  if (encoding === "iso") return date;
  const month = encoding === "us_short" ? String(Number(date.slice(5, 7))) : date.slice(5, 7);
  const day = encoding === "us_short" ? String(Number(date.slice(8, 10))) : date.slice(8, 10);
  return `${month}/${day}/${date.slice(0, 4)}`;
}

export async function municipalPermitDateRows(date, types, format, { get = fetchJson } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !["us", "us_short", "iso"].includes(format?.encoding) ||
      !["text", "date", "datetime"].includes(format?.fieldtype))
    throw new SourceError("Invalid municipal date search", 400);
  const value = municipalDateValue(date, format.encoding);
  const { rows, total } = await municipalSearch("PermitDate", value, LIMIT, get, format.fieldtype);
  if (rows.length >= LIMIT || total !== rows.length)
    throw new MunicipalPermitCapError(`PermitDate ${date}`, total);
  if (rows.some((row) => municipalDate(row.PermitDate) !== date ||
      !String(row.PermitType ?? "").trim() || !/^\d+$/.test(String(row.Permit_ID ?? ""))))
    throw new SourceError("Municipal PermitDate query returned an unverified row or date");
  const observedTypes = new Map();
  for (const row of rows) {
    const name = String(row.PermitType).trim();
    observedTypes.set(name, (observedTypes.get(name) ?? 0) + 1);
  }
  return { date, vendor_count: total,
    observed_types: Object.fromEntries([...observedTypes].sort(([a], [b]) => a.localeCompare(b))),
    ...normalizedPermitRows(rows, types) };
}

export async function verifiedMunicipalPermitDays({ from, to }, format,
  { dateRows = municipalPermitDateRows } = {}) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const length = (Date.parse(`${to}T00:00:00Z`) - start) / 86_400_000 + 1;
  if (!Number.isInteger(length) || length < 1 || length > 90)
    throw new Error("Invalid municipal permit date window");
  const days = Array.from({ length }, (_, offset) =>
    new Date(start + offset * 86_400_000).toISOString().slice(0, 10));
  const inventory = new Map();
  const records = new Map();
  let sourceCount = 0;
  for (const day of days) {
    const result = await checkedPermitDay(day, format, dateRows);
    inventory.set(day, result);
    sourceCount += result.vendor_count;
    for (const row of result.rows) {
      if (records.has(row.record_id)) throw new Error(`Permit ${row.record_id} appeared on multiple dates through ${day}`);
      records.set(row.record_id, row);
    }
  }
  for (const day of days) {
    const first = inventory.get(day);
    const second = await checkedPermitDay(day, format, dateRows);
    if (first.vendor_count !== second.vendor_count || !sameMunicipalPermitRows(first.rows, second.rows))
      throw new Error(`Municipal PermitDate ${day} changed during verification`);
  }
  return { rows: [...records.values()], sourceCount, datesChecked: days.length };
}

async function checkedPermitDay(day, format, dateRows) {
  try {
    const result = await dateRows(day, null, format);
    if (result.vendor_count !== result.rows.length + result.duplicate_rows ||
        result.rows.some((row) => row.event_date !== day))
      throw new Error("Returned IDs and dates did not reconcile with the published count");
    return result;
  } catch (cause) {
    const error = new Error(`Municipal PermitDate ${day}: ${cause.message}`, { cause });
    if (cause.code) error.code = cause.code;
    throw error;
  }
}

export async function municipalParentPrintKey(parcelId, { get = fetchJson } = {}) {
  if (!/^\d{1,12}$/.test(String(parcelId ?? ""))) return null;
  const url = new URL(VENDOR);
  for (const [key, value] of Object.entries({ Customer: "NewHavenCityCT",
    entity: "Parcel", entity_id: "", fieldtype: "text", mapid: "", mapobject: "",
    module: "", numrecs: "5", operator: "=", pid: "", searchfield: "Parcel_ID",
    section: "", value: String(parcelId) })) url.searchParams.set(key, value);
  const data = await get(url, { headers: { SourceId: "2" }, timeout: 10000,
    maxBytes: 10_000_000 });
  if (Number(data.total) !== 1 || !Array.isArray(data.rows) || data.rows.length !== 1 ||
      String(data.rows[0].Parcel_ID) !== String(parcelId)) return null;
  return String(data.rows[0].PrintKey ?? "").trim() || null;
}
