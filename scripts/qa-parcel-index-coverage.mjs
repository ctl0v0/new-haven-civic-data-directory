import { LAYERS } from '../parcel/config.js';
import { arcgis } from '../parcel/http.js';
import { getSearchCoverage } from '../search-index/coverage.js';
import { indexQuery } from '../search-index/db.js';

const log = (section, data) => console.log(JSON.stringify({ event: 'qa_parcel_index_coverage', section, data }));
const time = new Date().toISOString();
const sum = (items, field) => items.reduce((total, item) => total + Number(item[field] ?? 0), 0);
const check = async (section, run) => {
  try { log(section, await run()); }
  catch (error) { log(section, { error: error.name, code: error.code, status: error.upstreamStatus }); }
};
const coverage = await getSearchCoverage();
log('run', { time, index_status: coverage.index_status });
if (coverage.index_status !== 'connected') throw new Error('Read-only coverage unavailable');
const types = coverage.municipal_permit_types.filter((type) => type.in_catalog);
const bySource = new Map(coverage.sources.filter(({ index_source_id }) => index_source_id).map((row) => [row.index_source_id, row]));
log('permit_catalog', coverage.municipal_permit_catalog);
for (const row of coverage.municipal_recent_permits) log('recent_window', row);
log('historical_permits', { sourceRows: sum(types, 'returned_count'), retainedLinks: sum(types, 'linked_count'),
  unlinked: sum(types, 'unlinked_count'), ambiguous: sum(types, 'ambiguous_count'), stale: types.filter((r) => r.indexed && !r.fresh).length,
  topLinkGaps: [...types].sort((a,b) => (b.unlinked_count ?? 0) - (a.unlinked_count ?? 0)).slice(0, 8)
    .map((r) => [r.permit_type, r.unlinked_count, r.returned_count]) });
for (const r of types.filter((r) => !r.indexed || ['failed', 'blocked'].includes(r.latest_attempt_status)))
  log('historical_type_gap', { name: r.permit_type, indexed: r.indexed, latest: r.latest_attempt_status,
    reason: r.latest_attempt_warning?.slice(0, 160) });
for (const [source, row] of bySource) log('index_source', { source, indexed: row.indexed, latest: row.latest_attempt_status,
  runId: row.active_run_id, sourceRows: row.source_count, scanned: row.returned_count, linked: row.linked_count,
  ambiguous: row.ambiguous_count, unlinked: row.unlinked_count, checked: row.last_successful_refresh, fresh: row.fresh,
  complete: row.complete, ...(source === 'municipal-business-licenses' ? { licenseInventory: row.license_inventory } : {}) });
log('live_and_gap_modes', coverage.sources.filter((s) => !s.index_source_id && s.search_mode !== 'excluded_from_search')
  .map(({ source_id, search_mode }) => [source_id, search_mode]));

await Promise.all([
  check('official_current_counts', async () => Object.fromEntries(await Promise.all(['parcels','zoning','addresses'].map(async (key) => {
    try { const result = await arcgis(LAYERS[key], { where: '1=1', returnCountOnly: 'true' }); return [key, result.count]; }
    catch (e) { return [key, { error: e.name, status: e.upstreamStatus }]; }
  })))),
  check('parcel_inventory', async () => (await indexQuery(`SELECT count(*)::int AS features,
    count(*) FILTER (WHERE geometry IS NOT NULL)::int AS shapes,
    count(*) FILTER (WHERE nullif(trim(fields->>'parcel_id'),'') IS NOT NULL)::int AS with_pid,
    count(DISTINCT nullif(trim(fields->>'parcel_id'),''))::int AS unique_pids,
    count(*) FILTER (WHERE nullif(trim(fields->>'mblu'),'') IS NOT NULL)::int AS with_mblu,
    count(DISTINCT nullif(trim(fields->>'mblu'),''))::int AS unique_mblu
    FROM search_records WHERE source_id = 'parcels' AND run_id = $1`, [bySource.get('parcels').active_run_id]))[0]),
  check('parcel_associations', async () => indexQuery(`WITH pairs AS (
      SELECT j.source_id, j.city_parcel_id, j.city_objectid,
        count(DISTINCT j.record_id) AS features,
        count(DISTINCT CASE WHEN j.source_id='zoning' THEN nullif(trim(r.fields->>'zone_code'),'') END) AS zone_codes
      FROM search_record_parcels j
      JOIN search_active_runs a ON a.source_id = j.source_id AND a.run_id = j.run_id AND a.scope_key = 'all'
      JOIN search_records r ON r.run_id = j.run_id AND r.source_id = j.source_id AND r.record_id = j.record_id
      JOIN search_records p ON p.run_id = $1 AND p.source_id = 'parcels' AND p.record_id = j.city_objectid::text
        AND p.fields->>'parcel_id' = j.city_parcel_id::text
      WHERE j.join_status = 'exact' AND j.source_id = ANY($2::text[])
      GROUP BY j.source_id, j.city_parcel_id, j.city_objectid
    ) SELECT source_id, count(*)::int AS matched_parcels,
        count(*) FILTER (WHERE features > 1)::int AS multi_feature_parcels,
        count(*) FILTER (WHERE zone_codes > 0)::int AS parcels_with_zone_code,
        count(*) FILTER (WHERE zone_codes > 1)::int AS parcels_with_multiple_zone_codes
      FROM pairs GROUP BY source_id ORDER BY source_id`, [bySource.get('parcels').active_run_id,
    ['zoning','addresses','wards','neighborhoods','cmt','trash-pickup','school-attendance','municipal-business-licenses','ct-liquor-permits'] ])),
  check('distinct_retained_permits', async () => (await indexQuery(`SELECT
      count(DISTINCT r.record_id)::int AS unique_active_permit_ids,
      count(DISTINCT r.record_id) FILTER (WHERE a.scope_key LIKE 'permit-type:%')::int AS historical_type_permit_ids,
      count(DISTINCT r.record_id) FILTER (WHERE a.scope_key='permit-window:90')::int AS recent_90_permit_ids,
      count(DISTINCT (j.city_parcel_id,j.city_objectid))::int AS parcels_with_active_permits,
      min(r.event_date) AS earliest_date,
      max(r.event_date) AS most_recent_date
    FROM search_active_runs a JOIN search_records r USING (run_id,source_id)
    JOIN search_record_parcels j USING (run_id,source_id,record_id)
    JOIN search_records p ON p.run_id=$1 AND p.source_id='parcels' AND p.record_id=j.city_objectid::text
      AND p.fields->>'parcel_id'=j.city_parcel_id::text
    WHERE a.source_id='municity' AND j.join_status='exact'`, [bySource.get('parcels').active_run_id]))[0]),
  check('recent_permit_link_evidence', async () => indexQuery(`SELECT a.scope_key,
      rr.metadata->'parcel_link_summary' AS link_reasons,
      count(DISTINCT j.record_id) FILTER (WHERE j.join_status='exact')::int AS linked_permit_ids,
      count(DISTINCT (j.city_parcel_id,j.city_objectid)) FILTER (WHERE j.join_status='exact')::int AS linked_parcels
    FROM search_active_runs a JOIN search_source_runs rr ON rr.id=a.run_id
    LEFT JOIN search_record_parcels j ON j.run_id=a.run_id AND j.source_id=a.source_id
    WHERE a.source_id='municity' AND a.scope_key LIKE 'permit-window:%'
    GROUP BY a.scope_key, rr.metadata->'parcel_link_summary' ORDER BY a.scope_key`)),
  check('zoning_area_vs_boundary', async () => (await indexQuery(`WITH code_links AS (
    SELECT p.record_id AS parcel_oid, nullif(trim(z.fields->>'zone_code'),'') AS zone_code,
      ST_Relate(p.geometry,z.geometry,'2********') AS area_overlap
    FROM search_record_parcels j
    JOIN search_records z ON z.run_id=j.run_id AND z.source_id=j.source_id AND z.record_id=j.record_id
    JOIN search_records p ON p.run_id=$1 AND p.source_id='parcels' AND p.record_id=j.city_objectid::text
      AND p.fields->>'parcel_id'=j.city_parcel_id::text
    WHERE j.run_id=$2 AND j.source_id='zoning' AND j.join_status='exact'
  ), per_parcel AS (
    SELECT parcel_oid, count(DISTINCT zone_code) AS codes,
      count(DISTINCT zone_code) FILTER (WHERE area_overlap) AS area_codes,
      bool_or(area_overlap) AS has_area_overlap
    FROM code_links GROUP BY parcel_oid
  ) SELECT count(*)::int AS intersecting,
    count(*) FILTER (WHERE has_area_overlap)::int AS area_overlap_parcels,
    count(*) FILTER (WHERE codes > 1)::int AS multiple_intersecting_codes,
    count(*) FILTER (WHERE area_codes > 1)::int AS multiple_area_codes,
    count(*) FILTER (WHERE codes > 1 AND area_codes <= 1)::int AS multiple_codes_due_to_touch
    FROM per_parcel`, [bySource.get('parcels').active_run_id, bySource.get('zoning').active_run_id]))[0]),
  check('unique_address_links', async () => (await indexQuery(`WITH points AS (
      SELECT record_id, bool_or(join_status='exact') AS has_exact,
        bool_or(join_status='ambiguous') AS has_ambiguous
      FROM search_record_parcels WHERE source_id='addresses' AND run_id=$1 GROUP BY record_id
    ) SELECT count(*) FILTER(WHERE has_exact)::int AS exact_points,
      count(*) FILTER(WHERE has_ambiguous AND NOT has_exact)::int AS ambiguous_only_points,
      count(*) FILTER(WHERE has_exact AND has_ambiguous)::int AS points_with_both,
      count(*)::int AS linked_points FROM points`, [bySource.get('addresses').active_run_id]))[0]),
  check('activity_by_type', async () => indexQuery(`SELECT fields->>'permit_type' AS permit_type,
      fields->>'activity_kind' AS activity_kind,count(*)::int AS indexed_rows,
      count(*) FILTER (WHERE event_date IS NULL)::int AS missing_event_date
    FROM search_active_runs a JOIN search_records r USING(run_id,source_id)
    WHERE a.source_id='municity-permit-activity' AND a.scope_key='all'
    GROUP BY 1,2 ORDER BY 1,2`)),
]);
log('finished', { checked_at: new Date().toISOString() });
