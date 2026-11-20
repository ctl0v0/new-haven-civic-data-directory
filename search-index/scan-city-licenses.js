import { setTimeout as wait } from "node:timers/promises";
import { fetchJson } from "../parcel/http.js";
import { municipalParcelByPrintKey, municipalWorkChildren } from "./municity.js";
import { isNamedBusinessLicense, licensePrintKey, normalizedBusinessLicenses } from "./municipal-licenses.js";

const hour = 3600_000;
const retryHours = {
  confirmed: 30 * 24, category_missing: 7 * 24, category_capped: 24,
  row_conflict: 24, parcel_unverified: 7 * 24, upstream_error: 4,
};

function retryAfter(error, now) {
  const header = String(error.retryAfter ?? "").trim();
  const published = /^\d+$/.test(header) ? now + Number(header) * 1000 : Date.parse(header);
  return Math.max(now + 15 * 60_000, Number.isFinite(published) ? published : 0);
}

function classifyLicenses(rows, parcel, vendorId, observedAt) {
  const records = new Map();
  const conflictingIds = new Set();
  let incomplete = false;
  for (const raw of rows.slice(0, 500)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { incomplete = true; continue; }
    if (!isNamedBusinessLicense(raw)) continue;
    const id = String(raw.License_ID ?? "");
    if (!/^[1-9]\d{0,11}$/.test(id) ||
        (raw.Parcel_ID && String(raw.Parcel_ID) !== vendorId) ||
        (raw.PrintKey && licensePrintKey(raw.PrintKey) !== parcel.mblu)) {
      if (/^[1-9]\d{0,11}$/.test(id)) conflictingIds.add(id);
      incomplete = true;
      continue;
    }
    const [record] = normalizedBusinessLicenses([{ ...raw, Parcel_ID: vendorId }], { requireIssueDate: false });
    if (records.has(id) && JSON.stringify(records.get(id)) !== JSON.stringify(record)) {
      conflictingIds.add(id);
      incomplete = true;
    }
    records.set(id, record);
  }
  for (const id of conflictingIds) records.delete(id);
  for (const record of records.values()) {
    record.fields.VerifiedParcelPrintKey = parcel.mblu;
    record.fields.OfficialLicenseObservedAt = observedAt;
  }
  return { records: [...records.values()], conflictingIds: [...conflictingIds],
    outcome: incomplete ? "row_conflict" : rows.length >= 500 ? "category_capped" : "confirmed" };
}

export async function scanCityLicenseParcels(parcels, {
  lookup = municipalParcelByPrintKey, children = municipalWorkChildren, now = Date.now,
  get = fetchJson, requestSpacingMs = 700,
} = {}) {
  const updates = [];
  let nextRequest = 0, rateLimitedUntil = null, consecutiveFailures = 0;
  const pacedGet = async (...args) => {
    const delay = nextRequest - now();
    if (delay > 0) await wait(delay);
    nextRequest = now() + requestSpacingMs;
    return get(...args);
  };
  for (const parcel of parcels) {
    let result = { outcome: "parcel_unverified", records: [], conflictingIds: [] };
    const observedAt = new Date(now()).toISOString();
    try {
      const vendor = await lookup(parcel.mblu, { get: pacedGet });
      if (vendor) {
        const published = await children("Parcel", vendor.Parcel_ID, { get: pacedGet });
        result = Array.isArray(published?.License)
          ? classifyLicenses(published.License, parcel, String(vendor.Parcel_ID), observedAt)
          : { ...result, outcome: "category_missing" };
      }
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures++;
      const throttled = error?.upstreamStatus === 429;
      result.outcome = throttled ? "rate_limited" : "upstream_error";
      if (throttled) rateLimitedUntil = retryAfter(error, now());
    }
    const nextCheck = rateLimitedUntil ?? now() + retryHours[result.outcome] * hour;
    updates.push({ ...result, parcel, last_checked_at: observedAt, next_check_at: new Date(nextCheck).toISOString() });
    if (rateLimitedUntil || consecutiveFailures >= 5) break;
  }
  return { updates, rate_limited_until: rateLimitedUntil ? new Date(rateLimitedUntil).toISOString() : null };
}
