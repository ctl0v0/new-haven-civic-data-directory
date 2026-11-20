import { municipalDate, municipalDateValue, municipalSearch, municipalWorkChildren } from "./municity.js";

export const MUNICIPAL_LICENSE_SOURCE = "municipal-business-licenses";
export const MUNICIPAL_LICENSE_FIELDS = Object.freeze([
  "License_ID", "LicenseNumber", "LicenseType", "BusinessName", "Status",
  "IssueDate", "ExpirationDate", "Parcel_ID", "PrintKey", "LegalAddress", "Addr1",
]);
const WEB = "https://www.municityconnect.com/#/app/NewHavenCityCT/entity";
const MAX_ROWS = 10000;
const text = (value) => String(value ?? "").trim();
const id = (value) => /^[1-9]\d{0,11}$/.test(text(value)) ? text(value) : null;
const formats = [
  { fieldtype: "text", encoding: "us" }, { fieldtype: "text", encoding: "iso" },
  { fieldtype: "date", encoding: "us" }, { fieldtype: "datetime", encoding: "us" },
  { fieldtype: "date", encoding: "iso" }, { fieldtype: "text", encoding: "us_short" },
];
const blocked = (message) => Object.assign(new Error(message), { code: "MUNICIPAL_LICENSE_UNVERIFIED" });

// Reproduce a known city-issued license from the City's own parcel children.
// An empty date result is meaningful only after this check passes.
export async function verifyMunicipalLicenseDate({ search = municipalSearch, children = municipalWorkChildren,
  anchors = ["10386", "12846", "11236"] } = {}) {
  let samples = [];
  for (const anchor of anchors) {
    try {
      const result = await children("Parcel", anchor);
      samples = (Array.isArray(result.License) ? result.License : []).filter((row) =>
        id(row?.License_ID) && municipalDate(row.IssueDate)).slice(0, 2);
      if (samples.length) break;
    } catch { /* Another official parcel may provide the known record. */ }
  }
  if (!samples.length) {
    for (const type of ["Health - Food Service Establishment", "LCI - Residential License"]) {
      try {
        const result = await search("LicenseType", type, 30, undefined, "text", "License");
        samples = result.rows.filter((row) => id(row?.License_ID) && municipalDate(row.IssueDate)).slice(0, 2);
        if (samples.length) break;
      } catch { /* The source may expose parcel children only. */ }
    }
  }
  const attempts = [];
  for (const sample of samples) {
    const date = municipalDate(sample.IssueDate);
    for (const format of formats) {
      try {
        const result = await readLicenseDay(date, format, search);
        const reproduced = result.some((row) => id(row.License_ID) === id(sample.License_ID));
        attempts.push({ date, ...format, reproduced, returned: result.length });
        if (reproduced) return { format, attempts };
      } catch (error) { attempts.push({ date, ...format, warning: String(error.message).slice(0, 100) }); }
    }
  }
  console.log(JSON.stringify({ event: "municipal_license_issue_date_probe", samples: samples.length, attempts }));
  throw blocked("The City license IssueDate search did not reproduce a known published license");
}

export async function readLicenseDay(date, format, search = municipalSearch) {
  const result = await search("IssueDate", municipalDateValue(date, format.encoding), MAX_ROWS,
    undefined, format.fieldtype, "License");
  if (result.total !== result.rows.length || result.total >= MAX_ROWS ||
      result.rows.some((row) => !id(row?.License_ID) || municipalDate(row.IssueDate) !== date))
    throw blocked("The City license date response did not reconcile with the requested date and inventory");
  return result.rows;
}

export function normalizedBusinessLicenses(rows) {
  const byId = new Map();
  for (const row of rows) {
    const recordId = id(row.License_ID);
    if (!recordId || !municipalDate(row.IssueDate)) throw blocked("A City license lacked its published ID or issue date");
    const existing = byId.get(recordId) ?? {};
    for (const field of [...MUNICIPAL_LICENSE_FIELDS, "Deleted"]) {
      const value = row[field];
      if (!text(value)) continue;
      if (text(existing[field]) && text(existing[field]) !== text(value))
        throw blocked("The City returned conflicting fields for the same license ID");
      existing[field] = value;
    }
    byId.set(recordId, existing);
  }
  return [...byId].filter(([, row]) => text(row.BusinessName) &&
    ![true, 1, "true", "1"].includes(row.Deleted)).map(([record_id, row]) => {
    const { Deleted, ...fields } = row;
    return { record_id, fields,
      source_url: `${WEB}/Parcel/${id(row.Parcel_ID)}`,
      event_date: municipalDate(row.IssueDate),
      published_type: text(row.LicenseType) || null, published_status: text(row.Status) || null };
  });
}
