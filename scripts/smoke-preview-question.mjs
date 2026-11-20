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
  const { arcgis, fetchJson } = await import('../parcel/http.js');
  const { LAYERS } = await import('../parcel/config.js');
  const sampleIds = ['10386', '11236', '12846', '13791', '24641'];
  const ct = new URL('https://data.ct.gov/resource/rny9-6ak2.json');
  ct.searchParams.set('$select', 'pid,state_use,state_use_description');
  ct.searchParams.set('$where', `upper(property_city) = 'NEW HAVEN' AND pid IN (${sampleIds.map((pid) => `'${pid}'`).join(',')})`);
  ct.searchParams.set('$limit', '50');
  const [city, state] = await Promise.allSettled([
    arcgis(LAYERS.parcels, { where: `parcel_id IN (${sampleIds.join(',')})`,
      outFields: 'parcel_id,use_code', returnGeometry: 'false' }),
    fetchJson(ct, { timeout: 10000 }),
  ]);
  console.log(JSON.stringify({ event: 'preview_use_code_crosswalk_sample',
    city: city.status === 'fulfilled' ? city.value.features?.map((feature) => feature.attributes) : city.reason?.message,
    state: state.status === 'fulfilled' ? state.value : state.reason?.message }));
} catch (error) {
  console.warn(JSON.stringify({ event: 'preview_use_code_crosswalk_failed', name: error?.name }));
}
