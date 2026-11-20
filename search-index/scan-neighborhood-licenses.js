import { indexQuery } from "./db.js";
import { municipalDate, municipalParcelByPrintKey, municipalWorkChildren } from "./municity.js";
import { isNamedBusinessLicense, licensePrintKey, normalizedBusinessLicenses } from "./municipal-licenses.js";

const NEIGHBORHOOD = "East Rock";
const PARCEL_LIMIT = 240;
const write = (sql, values = []) => indexQuery(sql, values, { write: true });

export async function scanNeighborhoodLicenses(range) {
  const runs = await write(`SELECT a.source_id, a.run_id FROM search_active_runs a
    JOIN search_source_runs r ON r.id = a.run_id WHERE a.scope_key = 'all'
      AND r.status = 'complete' AND r.finished_at >= now() - interval '48 hours'
      AND a.source_id IN ('parcels', 'neighborhoods')`);
  const ids = Object.fromEntries(runs.map((run) => [run.source_id, run.run_id]));
  if (!ids.parcels || !ids.neighborhoods)
    throw new Error("A current City parcel and neighborhood baseline is required");
  const parcels = await write(`WITH city_parcels AS MATERIALIZED (
    SELECT NULLIF(trim(regexp_replace(upper(replace(fields->>'mblu', '/', ' ')),
      '[[:space:]]+', ' ', 'g')), '') AS mblu,
      fields->>'parcel_id' AS parcel_id, fields->>'objectid' AS objectid,
      coalesce(fields->>'units_commercial', '') ~ '^[1-9][0-9]*(\.0+)?$' AS mapped_commercial_units
    FROM search_records WHERE run_id = $1 AND source_id = 'parcels'
  ), city_keys AS (
    SELECT *, count(*) OVER (PARTITION BY mblu) AS key_matches FROM city_parcels
  )
  SELECT p.*, count(*) OVER ()::int AS neighborhood_parcels FROM city_keys p
  WHERE EXISTS (
    SELECT 1 FROM search_record_parcels j JOIN search_records n USING (run_id, source_id, record_id)
    WHERE j.run_id = $2 AND j.source_id = 'neighborhoods' AND j.join_status = 'exact'
      AND j.city_parcel_id::text = p.parcel_id AND j.city_objectid::text = p.objectid
      AND upper($3) IN (upper(n.fields->>'neighborhood'), upper(n.fields->>'neighborhood_label'))
  ) ORDER BY p.mapped_commercial_units DESC, p.parcel_id::bigint, p.objectid::bigint LIMIT $4`,
  [ids.parcels, ids.neighborhoods, NEIGHBORHOOD, PARCEL_LIMIT]);
  if (!parcels.length) throw new Error("The East Rock neighborhood returned no City parcel inventory");
  const diagnostics = { neighborhood: NEIGHBORHOOD, neighborhood_parcels: parcels[0].neighborhood_parcels,
    selected_parcels: parcels.length, checked_parcels: 0, missing_vendor_parcel: 0,
    missing_license_category: 0, upstream_failures: 0, capped_license_categories: 0,
    named_licenses_seen: 0, named_licenses_without_issue_date: 0,
    named_licenses_issued_in_window: 0, conflicting_license_links: 0, published_date_fields: {} };
  const retained = new Map();
  const conflicts = new Set();
  for (let offset = 0; offset < parcels.length; offset += 4) {
    await Promise.all(parcels.slice(offset, offset + 4).map(async (parcel) => {
      if (!parcel.mblu || Number(parcel.key_matches) !== 1) {
        diagnostics.missing_vendor_parcel++;
        return;
      }
      let vendor, children;
      try {
        vendor = await municipalParcelByPrintKey(parcel.mblu);
        if (vendor) children = await municipalWorkChildren("Parcel", vendor.Parcel_ID);
      } catch (error) {
        diagnostics.upstream_failures++;
        if (error?.upstreamStatus === 429) await new Promise((resolve) => setTimeout(resolve, 1000));
        return;
      }
      if (!vendor) { diagnostics.missing_vendor_parcel++; return; }
      diagnostics.checked_parcels++;
      if (!Array.isArray(children?.License)) { diagnostics.missing_license_category++; return; }
      if (children.License.length >= 500) diagnostics.capped_license_categories++;
      for (const raw of children.License.slice(0, 500)) {
        if (!isNamedBusinessLicense(raw)) continue;
        diagnostics.named_licenses_seen++;
        for (const field of Object.keys(raw)) {
          if (/^(?:[A-Za-z_]*Date[A-Za-z_]*|Issued|Effective|Expires)$/.test(field) && municipalDate(raw[field]))
            diagnostics.published_date_fields[field] = (diagnostics.published_date_fields[field] ?? 0) + 1;
        }
        const date = municipalDate(raw.IssueDate);
        if (!date) { diagnostics.named_licenses_without_issue_date++; continue; }
        if (date < range.from || date > range.to) continue;
        diagnostics.named_licenses_issued_in_window++;
        if (!/^[1-9]\d{0,11}$/.test(String(raw.License_ID ?? "")) ||
            (raw.Parcel_ID && String(raw.Parcel_ID) !== String(vendor.Parcel_ID)) ||
            (raw.PrintKey && licensePrintKey(raw.PrintKey) !== parcel.mblu)) {
          diagnostics.conflicting_license_links++;
          continue;
        }
        const [record] = normalizedBusinessLicenses([{ ...raw, Parcel_ID: vendor.Parcel_ID }]);
        record.fields.VerifiedParcelPrintKey = parcel.mblu;
        const prior = retained.get(record.record_id);
        if (prior && (prior.parcel.objectid !== parcel.objectid ||
            JSON.stringify(prior.record) !== JSON.stringify(record))) {
          diagnostics.conflicting_license_links++;
          retained.delete(record.record_id);
          conflicts.add(record.record_id);
        }
        if (!conflicts.has(record.record_id)) retained.set(record.record_id, { record, parcel });
      }
    }));
  }
  if (!diagnostics.checked_parcels)
    throw new Error("None of the selected City parcels could be verified against the municipal license source");
  return { retained: [...retained.values()], diagnostics };
}
