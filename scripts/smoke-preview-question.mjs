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
  const { parcelSummary, parcelZoning } = await import('../parcel/service.js');
  const bbox = '-72.931,41.306,-72.923,41.311';
  const map = await browseParcels(bbox);
  const sample = map.features[0]?.properties;
  const zoning = sample ? await parcelZoning(String(sample.parcel_id), String(sample.objectid)) : null;
  const examples = await Promise.allSettled(['11236', '12846', '10386'].map(async (pid) => {
    const { parcel } = await parcelSummary(pid);
    return { pid, category: parcel.recorded_use.category, code: parcel.recorded_use.published_code };
  }));
  console.log(JSON.stringify({ event: 'preview_parcel_use', polygons: map.features.length,
    classified: map.features.filter((feature) => feature.properties.recorded_use.category !== 'unclassified').length,
    zoning_status: zoning?.status, zoning_codes: zoning?.district_codes,
    examples: examples.map((item) => item.status === 'fulfilled' ? item.value : item.reason?.message) }));
} catch (error) {
  console.warn(JSON.stringify({ event: 'preview_parcel_use_failed', name: error?.name,
    message: error?.message }));
}
