import { indexQuery } from "./db.js";

// The publisher's inventory is checked before filtering; only permits with one
// exact City parcel survive activation. Grouped gap counts carry no record IDs,
// addresses, unverified joins or source payloads.
export async function retainParcelPermits(runId, { query = indexQuery } = {}) {
  const [run] = await query(`WITH links AS (
    SELECT record_id, count(DISTINCT (city_parcel_id, city_objectid)) AS parcels,
      bool_and(join_status = 'exact') AS exact
    FROM search_record_parcels WHERE run_id = $1 AND source_id = 'municity' GROUP BY record_id
  ), classified AS MATERIALIZED (
    SELECT r.record_id, upper(trim(r.published_type)) AS permit_type,
      upper(trim(r.published_status)) AS permit_status, r.event_date AS permit_date,
      CASE WHEN l.parcels = 1 AND l.exact THEN 'exact'
        WHEN l.record_id IS NULL THEN 'unlinked' ELSE 'ambiguous' END AS link_status,
      nullif(trim(r.fields->>'PrintKey'), '') IS NULL AS missing_print_key,
      nullif(trim(r.fields->>'Parcel_ID'), '') IS NOT NULL AS has_vendor_id
    FROM search_records r LEFT JOIN links l ON l.record_id = r.record_id
    WHERE r.run_id = $1 AND r.source_id = 'municity'
  ), counts AS (
    SELECT count(*) FILTER (WHERE link_status = 'exact')::int AS indexed_count,
      count(*) FILTER (WHERE link_status = 'ambiguous')::int AS ambiguous_count,
      count(*) FILTER (WHERE link_status = 'unlinked')::int AS unlinked_count,
      count(*) FILTER (WHERE link_status = 'unlinked' AND missing_print_key)::int AS missing_print_key,
      count(*) FILTER (WHERE link_status = 'unlinked' AND NOT missing_print_key)::int AS unmatched_print_key,
      count(*) FILTER (WHERE link_status = 'unlinked' AND has_vendor_id)::int AS unlinked_with_vendor_parcel_id
    FROM classified
  ), gaps AS (
    SELECT permit_type, permit_status, permit_date,
      count(*) FILTER (WHERE link_status = 'ambiguous')::int AS ambiguous_count,
      count(*) FILTER (WHERE link_status = 'unlinked')::int AS unlinked_count
    FROM classified WHERE link_status <> 'exact' GROUP BY permit_type, permit_status, permit_date
  ), drop_links AS (
    DELETE FROM search_record_parcels l USING classified c
    WHERE l.run_id = $1 AND l.source_id = 'municity' AND l.record_id = c.record_id
      AND c.link_status <> 'exact' RETURNING l.record_id
  ), drop_permits AS (
    DELETE FROM search_records r USING classified c
    WHERE r.run_id = $1 AND r.source_id = 'municity' AND r.record_id = c.record_id
      AND c.link_status <> 'exact' AND (SELECT count(*) FROM drop_links) >= 0
    RETURNING r.record_id
  ) UPDATE search_source_runs s SET linked_count = counts.indexed_count,
    ambiguous_count = counts.ambiguous_count, unlinked_count = counts.unlinked_count,
    metadata = metadata || jsonb_build_object('parcel_only', true, 'indexed_count', counts.indexed_count,
      'parcel_link_summary', to_jsonb(counts),
      'permit_link_gaps', coalesce((SELECT jsonb_agg(to_jsonb(gaps)) FROM gaps), '[]'::jsonb))
  FROM counts WHERE s.id = $1 AND s.source_id = 'municity'
    AND (SELECT count(*) FROM drop_permits) = counts.unlinked_count + counts.ambiguous_count
  RETURNING s.linked_count AS linked, s.unlinked_count AS unlinked, s.ambiguous_count AS ambiguous`,
  [runId], { write: true });
  if (!run) throw new Error("Could not reconcile retained parcel permits with the source inventory");
  return run;
}

export function filteredPermitLinkGaps(metadata, { types, status, from, to }) {
  if (!metadata?.parcel_only || !Array.isArray(metadata.permit_link_gaps)) return null;
  const result = { unlinked_count: 0, ambiguous_count: 0 };
  for (const row of metadata.permit_link_gaps) {
    if (types?.length && !types.includes(row.permit_type)) continue;
    if (status && row.permit_status !== status.trim().toUpperCase()) continue;
    if (from && (!row.permit_date || row.permit_date < from)) continue;
    if (to && (!row.permit_date || row.permit_date > to)) continue;
    result.unlinked_count += row.unlinked_count;
    result.ambiguous_count += row.ambiguous_count;
  }
  return result;
}
