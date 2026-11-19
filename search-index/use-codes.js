import { LAYERS } from "../parcel/config.js";
import { fetchJson } from "../parcel/http.js";
import { indexQuery } from "./db.js";
import { reviewedUseCodeValues } from "../parcel/data-context.js";

export async function auditCityUseCodes({ query = indexQuery,
  metadata = fetchJson } = {}) {
  const info = await metadata(`${LAYERS.parcels}?f=pjson`, { timeout: 10000 });
  const field = info.fields?.find((item) => item.name === "use_code");
  if (!field) throw Error("Official City parcel layer no longer publishes use_code");
  const published = new Map((field.domain?.codedValues ?? []).map((row) =>
    [String(row.code).trim().toUpperCase(), String(row.name ?? "").trim()]));
  const rows = await query(`SELECT upper(trim(fields->>'use_code')) AS code,
    count(*)::integer AS parcel_count FROM search_records
    WHERE source_id = 'parcels' AND run_id =
      (SELECT run_id FROM search_active_runs WHERE source_id = 'parcels' AND scope_key = 'all')
      AND nullif(trim(fields->>'use_code'), '') IS NOT NULL
    GROUP BY upper(trim(fields->>'use_code')) ORDER BY code`);
  const unlinkedFeatures = await query(`SELECT p.record_id AS objectid,
    p.fields->>'parcel_id' AS parcel_id, p.fields->>'mblu' AS mblu,
    p.fields->>'use_code' AS use_code,
    p.fields->>'property_address' AS property_address, p.source_url
    FROM search_records p
    LEFT JOIN search_record_parcels j ON j.run_id = p.run_id AND
      j.source_id = p.source_id AND j.record_id = p.record_id AND
      j.join_status = 'exact'
    WHERE p.source_id = 'parcels' AND p.run_id =
      (SELECT run_id FROM search_active_runs WHERE source_id = 'parcels' AND scope_key = 'all')
      AND j.record_id IS NULL ORDER BY p.record_id`);
  const reviewed = reviewedUseCodeValues();
  return { source_url: LAYERS.parcels, field: "use_code",
    official_domain_published: published.size > 0,
    reviewed_dictionary_ready: reviewed !== null,
    codes: rows.map((row) => ({ code: row.code,
      parcel_count: Number(row.parcel_count),
      published_label: published.get(row.code) ?? null,
      reviewed: reviewed?.has(row.code) ?? false })),
    unreviewed_codes: rows.filter((row) => !reviewed?.has(row.code)).length,
    unlinked_features: unlinkedFeatures,
    checked_at: new Date().toISOString() };
}
