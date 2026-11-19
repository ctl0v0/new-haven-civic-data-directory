import { createHash } from "node:crypto";
import { fetchJson, SourceError } from "../parcel/http.js";
import { municipalPermitTypes } from "../parcel/permit-types.js";

const VENDOR = "https://services5.municity5.com/M5Services/M5Service.svc/GetM5Data";
// The municipal service returns more than 2,000 rows when requested. Ten
// thousand has been checked against its public permit search. A response that
// fills this request is still not an established full enumeration.
const LIMIT = 10000;
const INDEX_FIELDS = ["Permit_ID", "Application_ID", "PermitNo", "PermitType",
  "PermStatus", "PermitDate", "PrintKey", "LegalAddress"];

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
  const url = new URL(VENDOR);
  for (const [key, value] of Object.entries({ Customer: "NewHavenCityCT",
    entity: "Permit", entity_id: "", fieldtype: "text", mapid: "", mapobject: "",
    module: "", numrecs: String(LIMIT), operator: "=", pid: "",
    searchfield: "PermitType", section: "", value: type }))
    url.searchParams.set(key, value);
  const data = await get(url, { headers: { SourceId: "2" }, timeout: 60000,
    maxBytes: 75_000_000 });
  const rows = data.rows === "" && Number(data.total) === 0 ? [] : data.rows;
  if (!Array.isArray(rows)) throw new SourceError("Municipal permit type search returned no row list");
  const publishedTotal = Number(data.total);
  if (!Number.isSafeInteger(publishedTotal) || publishedTotal < rows.length)
    throw new SourceError("Municipal permit type search did not establish a total count");
  const boundReached = rows.length >= LIMIT || publishedTotal > rows.length;
  if (boundReached) throw new MunicipalPermitCapError(type, publishedTotal);
  if (rows.some((row) => !String(row?.PermitType ?? "").trim()))
    throw new SourceError("Municipal permit search returned a row without a published type");
  const filtered = rows.filter((row) => String(row.PermitType ?? "").trim().toUpperCase() === type.toUpperCase());
  const byId = new Map();
  const present = (value) => value != null && String(value).trim() !== "";
  for (const row of filtered) {
    const id = String(row.Permit_ID ?? "");
    if (!/^\d+$/.test(id))
      throw new SourceError("Municipal permit type row lacks a published numeric Permit_ID");
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
  return { type, vendor_count: rows.length,
    duplicate_rows: filtered.length - byId.size,
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
