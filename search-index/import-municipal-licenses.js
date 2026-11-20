import { recentCalendarDates } from "./ask.js";
import { indexQuery } from "./db.js";
import { beginRun, failRun, finishRun, insertRecords, setRunInventory } from "./import.js";
import { municipalParcelRow } from "./municity.js";
import { licensePrintKey, MUNICIPAL_LICENSE_SOURCE, normalizedBusinessLicenses, readLicenseDay,
  verifyMunicipalLicenseDate } from "./municipal-licenses.js";
import { scanNeighborhoodLicenses } from "./scan-neighborhood-licenses.js";

const write = (sql, values = []) => indexQuery(sql, values, { write: true });
const signature = (records) => JSON.stringify(records.sort((a, b) => a.record_id.localeCompare(b.record_id)));

export async function importMunicipalBusinessLicenses() {
  const range = recentCalendarDates(30);
  const runId = await beginRun(MUNICIPAL_LICENSE_SOURCE, "all", null, null, range);
  try {
    let inventory;
    try { inventory = await citywideLicenses(range); }
    catch (error) {
      if (error?.code !== "MUNICIPAL_LICENSE_UNVERIFIED") throw error;
      const [prior] = await write(`SELECT a.run_id FROM search_active_runs a JOIN search_source_runs r
        ON r.id = a.run_id WHERE a.source_id = $1 AND a.scope_key = 'all'
          AND r.metadata->>'method' = 'citywide_issue_date'`, [MUNICIPAL_LICENSE_SOURCE]);
      if (prior) throw error;
      const { retained, diagnostics } = await scanNeighborhoodLicenses(range);
      inventory = { retained, partial: true, sourceWarning:
        `Checked ${diagnostics.checked_parcels} of ${diagnostics.neighborhood_parcels} mapped East Rock parcels; citywide City license IssueDate enumeration is unverified`,
      metadata: { method: "municipal_parcel_children", ...diagnostics } };
    }
    return await publishLicenses(runId, range, inventory);
  } catch (error) {
    await failRun(runId, error);
    throw error;
  }
}

async function citywideLicenses(range) {
  const { format, attempts } = await verifyMunicipalLicenseDate();
  console.log(JSON.stringify({ event: "municipal_license_issue_date_probe", attempts }));
  const days = Array.from({ length: 30 }, (_, daysAgo) => new Date(
    Date.parse(`${range.from}T00:00:00Z`) + daysAgo * 86400_000).toISOString().slice(0, 10));
  const records = new Map();
  let publisherRows = 0;
  for (const date of days) {
    const first = await readLicenseDay(date, format);
    const second = await readLicenseDay(date, format);
    const normalized = normalizedBusinessLicenses(first);
    if (first.length !== second.length || signature(normalized) !== signature(normalizedBusinessLicenses(second)))
      throw new Error("The City license IssueDate inventory changed during verification");
    publisherRows += first.length;
    for (const record of normalized) {
      if (records.has(record.record_id)) throw new Error("One City license appeared on multiple issue dates");
      records.set(record.record_id, record);
    }
  }
  const [baseline] = await write(`SELECT r.id FROM search_active_runs a
    JOIN search_source_runs r ON r.id = a.run_id
    WHERE a.source_id = 'parcels' AND a.scope_key = 'all' AND r.status = 'complete'`);
  if (!baseline) throw new Error("The official City parcel baseline is absent");
  const parcels = await write(`SELECT fields->>'mblu' AS mblu, fields->>'parcel_id' AS parcel_id,
      fields->>'objectid' AS objectid FROM search_records
    WHERE run_id = $1 AND source_id = 'parcels' AND NULLIF(fields->>'mblu', '') IS NOT NULL`, [baseline.id]);
  const byKey = new Map();
  for (const parcel of parcels) {
    const mblu = licensePrintKey(parcel.mblu);
    byKey.set(mblu, byKey.has(mblu) ? null : parcel);
  }
  const parents = new Map();
  const retained = [];
  for (const record of records.values()) {
    const vendorId = String(record.fields.Parcel_ID ?? "").trim();
    if (!/^[1-9]\d{0,11}$/.test(vendorId)) continue;
    if (!parents.has(vendorId)) {
      try { parents.set(vendorId, await municipalParcelRow(vendorId)); }
      catch { parents.set(vendorId, null); }
    }
    const vendorKey = licensePrintKey(parents.get(vendorId)?.PrintKey);
    const licenseKey = licensePrintKey(record.fields.PrintKey);
    const parcel = byKey.get(vendorKey);
    if (!parcel?.parcel_id || !parcel.objectid || (licenseKey && licenseKey !== vendorKey)) continue;
    record.fields.VerifiedParcelPrintKey = vendorKey;
    retained.push({ record, parcel });
  }
  const missing = records.size - retained.length;
  if (records.size && !retained.length)
    throw new Error("No issued City business licenses could be verified against the official parcel inventory");
  return { retained, partial: missing > 0, sourceWarning: missing
    ? `${missing} named City licenses lacked a verified City parcel link` : null,
  metadata: { method: "citywide_issue_date", dates_checked: days.length, publisher_rows: publisherRows,
    named_licenses: records.size, excluded_without_parcel: missing } };
}

async function publishLicenses(runId, range, { retained, partial, sourceWarning, metadata }) {
  await setRunInventory(runId, retained.length);
  for (let offset = 0; offset < retained.length; offset += 200) {
    const batch = retained.slice(offset, offset + 200);
    await insertRecords(runId, MUNICIPAL_LICENSE_SOURCE, batch.map(({ record }) => record));
    await write(`INSERT INTO search_record_parcels
      (run_id, source_id, record_id, city_parcel_id, city_objectid, match_method)
      SELECT $1, $2, t.record_id, t.parcel_id, t.objectid, 'municipal-license-parcel-key-exact'
      FROM jsonb_to_recordset($3::jsonb) AS t(record_id text, parcel_id bigint, objectid bigint)`,
    [runId, MUNICIPAL_LICENSE_SOURCE, JSON.stringify(batch.map(({ record, parcel }) => ({
      record_id: record.record_id, parcel_id: parcel.parcel_id, objectid: parcel.objectid,
    })))]);
  }
  const result = await finishRun(runId, MUNICIPAL_LICENSE_SOURCE, retained.length, {
    partial, sourceWarning, metadata,
  });
  return { ...result, status: partial ? "partial" : "complete", issue_date_from: range.from,
    issue_date_to: range.to, ...metadata };
}
