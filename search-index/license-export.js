import { SourceError } from "../parcel/http.js";
import { indexConfigured, indexQuery } from "./db.js";
import { MUNICIPAL_LICENSE_SOURCE } from "./municipal-licenses.js";
import { STATE_ROSTERS } from "./socrata.js";

const sources = [MUNICIPAL_LICENSE_SOURCE, ...Object.keys(STATE_ROSTERS)];
const exportFields = {
  [MUNICIPAL_LICENSE_SOURCE]: { names: ["BusinessName"], number: "LicenseNumber",
    address: "LegalAddress", issue: "IssueDate", expires: "ExpirationDate" },
  "ct-liquor-permits": { names: ["dba", "backer"], expires: "expire_date" },
  "ct-child-care-licenses": { names: ["name"], expires: "expirationdate" },
  "ct-cannabis-retail": { names: ["dba", "business"] },
};
export const licenseExportColumns = [
  "source_id", "record_id", "name_as_published", "license_number", "license_type",
  "status_as_published", "published_site_address", "site_address_field", "issue_date",
  "effective_date", "expiration_as_published", "city_parcel_id", "city_objectid",
  "city_parcel_address", "official_record_url", "official_parcel_url",
];

export async function indexedLicenseExport({ query = indexQuery, configured = indexConfigured } = {}) {
  if (!configured()) throw new SourceError("The private parcel index is not connected.", 503);
  const rows = await query(`WITH active AS (
    SELECT s.source_id, r.id AS run_id, r.status, r.finished_at, r.returned_count,
      r.warning, r.metadata
    FROM unnest($1::text[]) s(source_id)
    LEFT JOIN search_active_runs a ON a.source_id = s.source_id AND a.scope_key = 'all'
    LEFT JOIN search_source_runs r ON r.id = a.run_id
  ), exact AS (
    SELECT j.source_id, j.run_id, j.record_id, min(j.city_parcel_id) AS city_parcel_id,
      min(j.city_objectid) AS city_objectid
    FROM search_record_parcels j JOIN active a USING (run_id, source_id)
    GROUP BY j.source_id, j.run_id, j.record_id
    HAVING count(DISTINCT (j.city_parcel_id, j.city_objectid)) = 1 AND bool_and(j.join_status = 'exact')
  ), linked_records AS (
    SELECT e.*, r.fields, r.published_type, r.published_status, r.event_date::text AS date,
      r.source_url, p.source_url AS parcel_url, p.fields->>'property_address' AS parcel_address
    FROM exact e JOIN search_records r USING (run_id, source_id, record_id)
    JOIN search_records p ON p.run_id = (SELECT run_id FROM search_active_runs
      WHERE source_id = 'parcels' AND scope_key = 'all')
      AND p.source_id = 'parcels' AND p.record_id = e.city_objectid::text
      AND p.fields->>'parcel_id' = e.city_parcel_id::text
  )
  SELECT a.source_id, a.run_id, a.status, a.finished_at, a.returned_count, a.warning,
    a.metadata, latest.status AS latest_status, latest.warning AS latest_warning,
    l.record_id, l.fields, l.published_type, l.published_status, l.date,
    l.city_parcel_id, l.city_objectid, l.parcel_address, l.source_url, l.parcel_url
  FROM active a LEFT JOIN linked_records l USING (run_id, source_id)
  LEFT JOIN LATERAL (SELECT status, warning FROM search_source_runs
    WHERE source_id = a.source_id AND scope_key = 'all'
    ORDER BY started_at DESC, id DESC LIMIT 1) latest ON true
  ORDER BY a.source_id, l.record_id`, [sources]);
  const coverage = new Map();
  const items = [];
  for (const row of rows) {
    const source = row.source_id;
    if (!coverage.has(source)) coverage.set(source, {
      source_id: source, active_run_id: row.run_id ?? null, checked_at: row.finished_at ?? null,
      run_status: row.status ?? "not_indexed", latest_status: row.latest_status ?? null,
      latest_warning: row.latest_warning ?? row.warning ?? null,
      indexed_records: row.returned_count ?? null, exported_records: 0,
      ...(source === MUNICIPAL_LICENSE_SOURCE ? { parcel_sweep: row.metadata ?? null } : {}),
    });
    if (!row.record_id) continue;
    coverage.get(source).exported_records++;
    const fields = row.fields ?? {};
    const map = exportFields[source];
    const state = STATE_ROSTERS[source];
    const site = map.address ?? state.site;
    items.push({
      source_id: source, record_id: row.record_id,
      name_as_published: map.names.map((key) => fields[key]).find((name) => String(name ?? "").trim()) ?? null,
      license_number: fields[map.number ?? state?.credential] ?? null,
      license_type: row.published_type, status_as_published: row.published_status,
      published_site_address: fields[site] ?? null, site_address_field: site,
      issue_date: map.issue ? row.date ?? null : null, effective_date: state?.event_date ? row.date ?? null : null,
      expiration_as_published: fields[map.expires] ?? null, city_parcel_id: row.city_parcel_id,
      city_objectid: row.city_objectid, city_parcel_address: row.parcel_address,
      official_record_url: row.source_url, official_parcel_url: row.parcel_url,
    });
  }
  return { items, coverage: [...coverage.values()],
    scope: "Active indexed licenses and State location credentials with one exact City parcel link." };
}

export function licenseCsv(items) {
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [licenseExportColumns.join(","), ...items.map((row) =>
    licenseExportColumns.map((key) => cell(row[key])).join(","))].join("\r\n") + "\r\n";
}
