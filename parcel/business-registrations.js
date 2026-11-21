import { normalizeAddress } from "./street-address.js";

export const REGISTRATION_SOURCE = "ct-business-registrations";
export const REGISTRATION_DATASET = "n7gp-d28j";
export const REGISTRATION_URL = `https://data.ct.gov/d/${REGISTRATION_DATASET}`;
export const REGISTRATION_API = `https://data.ct.gov/resource/${REGISTRATION_DATASET}.json`;
export const REGISTRATION_DATE = "date_registration";
export const REGISTRATION_FIELDS = Object.freeze([
  "id", "name", "accountnumber", "business_type", "status", "sub_status", REGISTRATION_DATE,
  "billingstreet", "billing_unit", "billingcity", "billingstate", "billingpostalcode", "naics_code",
]);
export const REGISTRATION_WHERE = "upper(billingcity)='NEW HAVEN' AND upper(billingstate)='CT'";

export function validBusinessRegistration(row) {
  return /^[a-z0-9]{15,18}$/i.test(String(row.id ?? "")) && String(row.name ?? "").trim() &&
    String(row.billingcity ?? "").trim().toUpperCase() === "NEW HAVEN" &&
    String(row.billingstate ?? "").trim().toUpperCase() === "CT";
}

export function businessAddress(value) {
  const street = String(value ?? "").trim();
  const suite = street.match(/(?:[\s,]+(?:suite|ste\.?|unit|apt\.?|apartment)\s+|\s*#\s*)([a-z0-9][a-z0-9 -]{0,24})$/i);
  const address = normalizeAddress(suite ? street.slice(0, suite.index) : street);
  return { address, unit: normalizeBusinessUnit(suite?.[1]), street: suite ? street.slice(0, suite.index).trim() : street };
}

export function normalizeBusinessUnit(value) {
  return String(value ?? "").trim().toUpperCase()
    .replace(/^(?:(?:SUITE|STE\.?|UNIT|APT\.?|APARTMENT)\s+|#\s*)/, "").trim();
}

export function registrationUnit(row) {
  const inline = businessAddress(row.billingstreet).unit;
  const separate = normalizeBusinessUnit(row.billing_unit);
  return inline && separate && inline !== separate ? null : inline || separate;
}

export function registrationDate(row) {
  const value = String(row[REGISTRATION_DATE] ?? "").match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/)?.[1];
  if (!value || value === "0001-01-01") return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

export function registrationUrl(id) {
  return `${REGISTRATION_API}?${new URLSearchParams({ id })}`;
}
