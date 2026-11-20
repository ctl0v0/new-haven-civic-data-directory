import { recentCalendarDates, askIndexedParcels } from '../search-index/ask.js';
import { indexConfigured } from '../search-index/db.js';
import { searchIndexedParcels } from '../search-index/search.js';

// A private Preview build checks that the read-only index can answer the
// working example. Only counts and source-run state are written to build logs.
// A stale source remains visible as partial; it does not fail the site build.
const sourceSummary = (result) => ({
  item_count: result?.items?.length ?? 0,
  index_status: result?.coverage?.index_status ?? null,
  checks: result?.coverage?.source_checks?.map((check) => ({
    source_id: check.source_id, status: check.status,
    scope_key: check.scope_key ?? null, run_id: check.run_id ?? null,
    date_covered: check.date_covered ?? null,
  })) ?? [],
});
console.log(JSON.stringify({ event: 'preview_question_reader', configured: indexConfigured() }));
const window = recentCalendarDates(30);
try {
  const direct = await searchIndexedParcels({ requirements: [{ source_id: 'municity',
    permit_group: 'Electrical', event_date_from: window.from,
    event_date_to: window.to }], limit: 5 });
  console.log(JSON.stringify({ event: 'preview_question_index', ...sourceSummary(direct) }));
} catch (error) {
  console.warn(JSON.stringify({ event: 'preview_question_index_failed',
    code: error?.code ?? null, name: error?.name ?? null }));
}
try {
  const answer = await askIndexedParcels({ question:
    'Show parcels with electrical permits pulled in the past 30 days' });
  console.log(JSON.stringify({ event: 'preview_question_end_to_end',
    status: answer.status, ...sourceSummary(answer.search_result) }));
} catch (error) {
  console.warn(JSON.stringify({ event: 'preview_question_end_to_end_failed',
    code: error?.code ?? null, name: error?.name ?? null }));
}

// Read-only evidence check for the parcel use and zoning Preview.
try {
  const { browseParcels } = await import('../parcel/browse.js');
  const { parcelZoning } = await import('../parcel/service.js');
  const bbox = '-72.931,41.306,-72.923,41.311';
  const map = await browseParcels(bbox);
  const sample = map.features[0]?.properties;
  const zoning = sample ? await parcelZoning(String(sample.parcel_id), String(sample.objectid)) : null;
  console.log(JSON.stringify({ event: 'preview_parcel_use', polygons: map.features.length,
    classified: map.features.filter((feature) => feature.properties.recorded_use.category !== 'unclassified').length,
    zoning_status: zoning?.status, zoning_codes: zoning?.district_codes }));
} catch (error) {
  console.warn(JSON.stringify({ event: 'preview_parcel_use_failed', name: error?.name,
    message: error?.message }));
}

try {
  const { fetchJson } = await import('../parcel/http.js');
  const state = new URL('https://data.ct.gov/resource/rny9-6ak2.json');
  state.searchParams.set('$select', 'pid,state_use,state_use_description');
  state.searchParams.set('$where', "upper(property_city) = 'NEW HAVEN' AND pid IS NOT NULL AND state_use IS NOT NULL");
  state.searchParams.set('$limit', '50000');
  const [cityRows, stateRows] = await Promise.all([
    indexQuery(`SELECT fields->>'parcel_id' AS pid, fields->>'use_code' AS code
      FROM search_records WHERE source_id = 'parcels' AND run_id =
      (SELECT run_id FROM search_active_runs WHERE source_id = 'parcels' AND scope_key = 'all')`),
    fetchJson(state, { maxBytes: 8_000_000, timeout: 24000 }),
  ]);
  const stateByPid = new Map();
  for (const row of stateRows) {
    if (!stateByPid.has(row.pid)) stateByPid.set(row.pid, []);
    stateByPid.get(row.pid).push(row);
  }
  const byCode = new Map();
  for (const { pid, code } of cityRows) {
    if (!code?.trim()) continue;
    if (!byCode.has(code)) byCode.set(code, { code, city: 0, agrees: 0, conflicts: 0, labels: new Set() });
    const group = byCode.get(code);
    group.city++;
    const candidates = stateByPid.get(pid);
    if (!candidates) continue;
    if (candidates.length !== 1 || candidates[0].state_use?.trim() !== code.trim()) {
      group.conflicts++;
      continue;
    }
    group.agrees++;
    if (candidates[0].state_use_description?.trim()) group.labels.add(candidates[0].state_use_description.trim());
  }
  const summary = [...byCode.values()].sort((a,b) => b.agrees-a.agrees);
  console.log(JSON.stringify({ event: 'preview_city_use_crosswalk_size', city: cityRows.length, state: stateRows.length }));
  for (let i=0;i<summary.length;i+=30)
    console.log(JSON.stringify({ event: 'preview_city_use_crosswalk', rows: summary.slice(i,i+30)
      .map((group) => ({...group, labels:[...group.labels]})) }));
} catch (error) {
  console.warn(JSON.stringify({ event: 'preview_use_code_crosswalk_failed', name: error?.name, message: error?.message }));
}
