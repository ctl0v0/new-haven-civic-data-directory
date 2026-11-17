import { fetchJson } from "./http.js";

export const MASTER = "https://data.ct.gov/resource/n7gp-d28j.json";
export const PRINCIPALS = "https://data.ct.gov/resource/ka36-64k6.json";
export const AGENTS = "https://data.ct.gov/resource/qh2m-n44y.json";

const clean = (value) => String(value ?? "").trim();
export const legalName = (value) => clean(value).toUpperCase()
  .replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
export const street = (value) => clean(value).toUpperCase()
  .replace(/[^A-Z0-9 ]/g, " ").replace(/\b(?:ROAD|RD)\b/g, "ROAD")
  .replace(/\b(?:STREET|ST)\b/g, "STREET")
  .replace(/\b(?:AVENUE|AVE)\b/g, "AVENUE")
  .replace(/\b(?:DRIVE|DR)\b/g, "DRIVE")
  .replace(/\b(?:UNIT|APT|APARTMENT|STE|SUITE)\b/g, "")
  .replace(/\s+/g, " ").trim();
const soql = (value) => clean(value).replaceAll("'", "''");
const zip5 = (value) => clean(value).match(/^\d{5}/)?.[0] ?? "";

export function officialOwnerMatch(city, state) {
  if (!legalName(city.owner_name_1).endsWith(" LLC") ||
      clean(state.business_type).toUpperCase() !== "LLC") return false;
  return legalName(city.owner_name_1) === legalName(state.name) &&
    Boolean(street(city.mail_address)) &&
    street(city.mail_address) === street(state.billingstreet) &&
    clean(city.mail_city).toUpperCase() === clean(state.billingcity).toUpperCase() &&
    clean(city.mail_state).toUpperCase() === "CT" &&
    Boolean(zip5(city.mail_zip)) &&
    zip5(city.mail_zip) === zip5(state.billingpostalcode);
}

async function masterRows(parameters, timeout = 10000) {
  const url = `${MASTER}?${new URLSearchParams(parameters)}`;
  const rows = await fetchJson(url, { timeout, maxBytes: 250000 });
  if (!Array.isArray(rows)) throw Error("Registry returned no row list");
  return rows;
}

export async function findOfficialOwnerEntity(city) {
  const name = clean(city.owner_name_1).replace(/\s+/g, " ");
  if (!legalName(name).endsWith(" LLC"))
    return { entity: null, reason: "The City parcel owner is not recorded as an LLC." };
  if (!street(city.mail_address) || !clean(city.mail_city) || !zip5(city.mail_zip) ||
      clean(city.mail_state).toUpperCase() !== "CT")
    return { entity: null, reason: "The City parcel lacks a complete Connecticut owner mailing address for the registry join." };

  // Query literal legal-name variants. Broad registry text search is too slow
  // to serve a parcel request reliably, and the mailing fields still must match.
  const variants = [name, name.replace(/\s+LLC\.?$/i, ", LLC")];
  const where = [...new Set(variants)].map((item) => `name = '${soql(item)}'`).join(" OR ");
  const rows = await masterRows({ $where: where, $limit: "51" });
  if (rows.length >= 51)
    return { entity: null, reason: "The State registry search exceeded the 50-row review limit; no entity was linked." };
  const matches = rows.filter((row) => officialOwnerMatch(city, row));
  if (matches.length !== 1)
    return { entity: null, reason: matches.length
      ? "More than one State entity matches the City owner and mailing address."
      : "No State entity matches both the City owner name and mailing address." };
  return { entity: matches[0], reason: null };
}

export async function entityChildren(dataset, field, id) {
  const rows = await fetchJson(`${dataset}?${new URLSearchParams({
    $where: `${field} = '${soql(id)}'`, $limit: "51",
  })}`, { timeout: 10000, maxBytes: 250000 });
  if (!Array.isArray(rows)) throw Error("Registry returned no row list");
  return { rows: rows.slice(0, 50), truncated: rows.length > 50 };
}
