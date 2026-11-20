import { normalizeAddress } from "../parcel/resolve.js";
import { indexQuery } from "./db.js";
import { beginRun, failRun, finishRun, insertRecords, setRunInventory } from "./import.js";
import { MUNICIPAL_LICENSE_SOURCE } from "./municipal-licenses.js";
import { scanCityLicenseParcels } from "./scan-city-licenses.js";

const write = (sql, values = []) => indexQuery(sql, values, { write: true });
const batchSize = 80;
const parcelInventory = `WITH parcels AS MATERIALIZED (
  SELECT record_id::bigint AS objectid, nullif(fields->>'parcel_id', '')::bigint AS parcel_id,
    nullif(trim(regexp_replace(upper(replace(fields->>'mblu', '/', ' ')),
      '[[:space:]]+', ' ', 'g')), '') AS mblu,
    coalesce(fields->>'units_commercial', '') ~ '^[1-9][0-9]*([.]0+)?$' AS commercial_units
  FROM search_records WHERE source_id = 'parcels' AND run_id = $1
), city_keys AS (
  SELECT *, count(*) OVER (PARTITION BY mblu) AS key_count FROM parcels
), eligible AS MATERIALIZED (
  SELECT objectid, parcel_id, mblu, commercial_units FROM city_keys
  WHERE parcel_id > 0 AND mblu IS NOT NULL AND key_count = 1
)`;

export async function importMunicipalBusinessLicenses() {
  const baselines = await write(`SELECT a.source_id, a.run_id, r.metadata
    FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
    WHERE a.scope_key = 'all' AND ((a.source_id IN ('parcels', 'addresses') AND r.status = 'complete')
      OR a.source_id = $1)`, [MUNICIPAL_LICENSE_SOURCE]);
  const active = Object.fromEntries(baselines.map((row) => [row.source_id, row]));
  if (!active.parcels || !active.addresses)
    throw new Error("The official City parcel and address baselines are required for the license sweep");
  const previous = active[MUNICIPAL_LICENSE_SOURCE];
  if (Date.parse(previous?.metadata?.rate_limited_until) > Date.now())
    return { status: "partial", reused: true, run_id: Number(previous.run_id),
      rate_limited_until: previous.metadata.rate_limited_until };

  const [inventory] = await write(`${parcelInventory}, checks AS MATERIALIZED (
    SELECT p.*, c.outcome, c.next_check_at
    FROM eligible p LEFT JOIN search_city_license_checks c ON c.city_objectid = p.objectid
      AND c.city_parcel_id = p.parcel_id AND c.mblu = p.mblu
  ), due AS (
    SELECT objectid::text AS objectid, parcel_id::text AS parcel_id, mblu, outcome,
      row_number() OVER (ORDER BY next_check_at NULLS FIRST, commercial_units DESC, objectid) AS order_key
    FROM checks
    WHERE next_check_at IS NULL OR next_check_at <= now()
    ORDER BY next_check_at NULLS FIRST, commercial_units DESC, checks.objectid LIMIT $2
  )
  SELECT (SELECT count(*)::int FROM parcels) AS city_parcel_features, count(*)::int AS eligible_parcels,
    count(*) FILTER (WHERE outcome IS NOT NULL)::int AS previously_attempted,
    count(*) FILTER (WHERE outcome IN ('confirmed', 'category_missing', 'category_capped', 'row_conflict'))::int AS previously_checked,
    count(*) FILTER (WHERE outcome = 'confirmed')::int AS previously_confirmed,
    count(*) FILTER (WHERE outcome = 'category_missing')::int AS previously_omitted,
    (SELECT coalesce(jsonb_agg(to_jsonb(due) - 'order_key' ORDER BY order_key), '[]'::jsonb) FROM due) AS due
  FROM checks`, [active.parcels.run_id, batchSize]);
  if (!inventory?.eligible_parcels)
    throw new Error("The City parcel inventory has no unique published MBLUs");
  if (!inventory.due.length && previous)
    return { status: "partial", reused: true, run_id: Number(previous.run_id),
      eligible_parcels: inventory.eligible_parcels, attempted_parcels: inventory.previously_attempted };

  const runId = await beginRun(MUNICIPAL_LICENSE_SOURCE);
  try {
    const { updates, rate_limited_until } = await scanCityLicenseParcels(inventory.due);
    const history = previous ? await write(`${parcelInventory}
      SELECT DISTINCT r.record_id, r.source_url, r.published_type, r.published_status,
        r.event_date, r.fields, p.parcel_id::text AS parcel_id, p.objectid::text AS objectid
      FROM search_records r JOIN search_record_parcels j USING (run_id, source_id, record_id)
      JOIN eligible p ON p.objectid = j.city_objectid AND p.parcel_id = j.city_parcel_id
        AND p.mblu = r.fields->>'VerifiedParcelPrintKey'
      WHERE r.run_id = $2 AND r.source_id = $3 AND j.join_status = 'exact'`,
    [active.parcels.run_id, previous.run_id, MUNICIPAL_LICENSE_SOURCE]) : [];
    const { records, conflicts } = reconcileCityLicenses(history, updates);
    const unknownDates = records.filter(({ record }) => !record.event_date).length;
    await setRunInventory(runId, records.length);
    for (let offset = 0; offset < records.length; offset += 200) {
      const batch = records.slice(offset, offset + 200);
      await insertRecords(runId, MUNICIPAL_LICENSE_SOURCE, batch.map(({ record }) => record));
      await write(`INSERT INTO search_record_parcels
        (run_id, source_id, record_id, city_parcel_id, city_objectid, match_method)
        SELECT $1, $2, t.record_id, t.parcel_id, t.objectid, 'municipal-license-parcel-key-exact'
        FROM jsonb_to_recordset($3::jsonb) AS t(record_id text, parcel_id bigint, objectid bigint)`,
      [runId, MUNICIPAL_LICENSE_SOURCE, JSON.stringify(batch.map(({ record, parcel }) => ({
        record_id: record.record_id, parcel_id: parcel.parcel_id, objectid: parcel.objectid,
      })))]);
    }
    const addressLinks = await linkLicenseAddresses(runId, active.addresses.run_id);
    const count = (outcome, filter) => Number(outcome != null && filter(outcome));
    const change = (filter) => updates.reduce((sum, { outcome, parcel }) =>
      sum + count(outcome, filter) - count(parcel.outcome, filter), 0);
    const checked = (outcome) => ["confirmed", "category_missing", "category_capped", "row_conflict"].includes(outcome);
    const cumulativeChecked = inventory.previously_checked + change(checked);
    const metadata = {
      method: "citywide_municipal_parcel_sweep", city_parcel_features: inventory.city_parcel_features,
      eligible_parcels: inventory.eligible_parcels,
      attempted_parcels: inventory.previously_attempted + change(() => true),
      checked_parcels: cumulativeChecked,
      confirmed_license_lists: inventory.previously_confirmed + change((o) => o === "confirmed"),
      omitted_license_categories: inventory.previously_omitted + change((o) => o === "category_missing"),
      attempted_this_run: updates.length, checked_this_run: updates.filter((check) => checked(check.outcome)).length,
      parcels_with_records: new Set(records.map(({ parcel }) => parcel.objectid)).size,
      records_with_verified_address: addressLinks,
      named_licenses_without_issue_date: unknownDates, conflicting_license_ids: conflicts,
      rate_limited_until,
    };
    const result = await finishRun(runId, MUNICIPAL_LICENSE_SOURCE, records.length, {
      partial: true,
      sourceWarning: `Checked ${cumulativeChecked} of ${inventory.eligible_parcels} City parcels with unique MBLUs; coverage advances in batches`,
      metadata, previousRunId: previous?.run_id ?? null,
      licenseChecks: updates.map(({ parcel, outcome, last_checked_at, next_check_at }) => ({
        city_objectid: parcel.objectid, city_parcel_id: parcel.parcel_id,
        mblu: parcel.mblu, outcome, last_checked_at, next_check_at,
      })),
    });
    return { ...result, status: "partial", ...metadata };
  } catch (error) {
    await failRun(runId, error);
    throw error;
  }
}

export function reconcileCityLicenses(history, updates) {
  const replaced = new Set(updates.filter(({ outcome }) => outcome === "confirmed")
    .map(({ parcel }) => parcel.objectid));
  const records = new Map(history.filter(({ objectid }) => !replaced.has(objectid))
    .map(({ objectid, parcel_id, ...record }) => [record.record_id, { record, parcel: { objectid, parcel_id } }]));
  const conflicts = new Set(updates.flatMap(({ conflictingIds }) => conflictingIds));
  for (const { records: fresh, parcel } of updates) {
    for (const record of fresh) {
      const prior = records.get(record.record_id);
      if (prior && prior.parcel.objectid !== parcel.objectid) conflicts.add(record.record_id);
      records.set(record.record_id, { record, parcel });
    }
  }
  for (const id of conflicts) records.delete(id);
  for (const { record } of records.values())
    record.fields.NormalizedLegalAddress = normalizeAddress(record.fields.LegalAddress) || null;
  return { records: [...records.values()], conflicts: conflicts.size };
}

async function linkLicenseAddresses(runId, addressRunId) {
  const [row] = await write(`WITH matches AS (
    SELECT r.record_id, j.city_parcel_id, j.city_objectid, a.record_id::bigint AS city_address_objectid,
      ap.city_parcel_id AS address_parcel, ap.city_objectid AS address_object, ap.join_status
    FROM search_records r JOIN search_record_parcels j USING (run_id, source_id, record_id)
    JOIN search_records a ON a.run_id = $2 AND a.source_id = 'addresses'
      AND a.fields->>'normalized_address' = r.fields->>'NormalizedLegalAddress'
    LEFT JOIN search_record_parcels ap ON ap.run_id = a.run_id AND ap.source_id = a.source_id
      AND ap.record_id = a.record_id
    WHERE r.run_id = $1 AND r.source_id = $3
      AND length(r.fields->>'NormalizedLegalAddress') > 0
  ), verified AS (
    SELECT record_id FROM matches GROUP BY record_id
    HAVING bool_and(coalesce(join_status = 'exact' AND address_parcel = city_parcel_id
      AND address_object = city_objectid, false))
  ), inserted AS (
    INSERT INTO search_record_parcels
      (run_id, source_id, record_id, city_parcel_id, city_objectid, city_address_objectid, match_method)
    SELECT DISTINCT $1::bigint, $3::text, m.record_id, m.city_parcel_id, m.city_objectid,
      m.city_address_objectid, 'municipal-license-city-address-point-exact'
    FROM matches m JOIN verified v USING (record_id) RETURNING record_id
  ) SELECT count(DISTINCT record_id)::int AS records_with_address FROM inserted`,
  [runId, addressRunId, MUNICIPAL_LICENSE_SOURCE]);
  return row.records_with_address;
}
