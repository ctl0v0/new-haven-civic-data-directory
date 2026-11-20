import { recentCalendarDates, askIndexedParcels, questionPermitCatalog } from '../search-index/ask.js';
import { indexConfigured } from '../search-index/db.js';
import { askParcelData } from '../search-index/parcel-question.js';
import { queryParcelData } from '../search-index/parcel-query.js';
import { searchIndexedParcels } from '../search-index/search.js';
import { checkRecentPermitWindows } from './smoke-recent-permits.mjs';

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
  const report = await checkRecentPermitWindows();
  for (const item of report.windows)
    console.log(JSON.stringify({ event: 'preview_recent_permits', ...item }));
} catch (error) {
  console.warn(JSON.stringify({ event: 'preview_recent_permits_failed', message: error.message }));
}
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

try {
  const review = await askParcelData({ question: 'show me permits for plumbing in the last 30 days', plan_only: true });
  const permit = review.plan?.requirements[0];
  if (review.status !== 'planned' || review.items || permit?.permit_group !== 'Plumbing' ||
      permit.equals?.PermitType || permit.date?.field !== 'PermitDate')
    throw new Error('The plumbing question did not prepare a group-only search plan');
  const result = await queryParcelData({ plan: review.plan });
  console.log(JSON.stringify({ event: 'preview_plumbing_plan_and_search', date: permit.date,
    status: result.status, has_more: Boolean(result.next_cursor), ...sourceSummary(result) }));
} catch (error) {
  console.warn(JSON.stringify({ event: 'preview_plumbing_plan_and_search_failed',
    code: error?.code ?? null, name: error?.name ?? null }));
}

try {
  const listed = await questionPermitCatalog();
  const catalog = async () => listed;
  const review = await askParcelData({ question: 'Show me all hood related permits', plan_only: true }, { catalog });
  if (review.status !== 'planned') throw new Error('Hood-related search did not produce a plan');
  const first = await queryParcelData({ plan: review.plan }, { catalog });
  const permitTypes = review.plan.requirements[0]?.one_of?.PermitType;
  console.log(JSON.stringify({ event: 'preview_hood_permit_page', status: first.status, permit_types: permitTypes,
    has_more: Boolean(first.next_cursor), ...sourceSummary(first) }));
  const ids = new Set();
  const parcels = new Set();
  let response = first;
  for (let pages = 1; pages <= 24; pages++) {
    for (const parcel of response.items ?? []) {
      parcels.add(`${parcel.city_parcel_id}:${parcel.city_objectid}`);
      for (const source of parcel.matching_sources.filter(({ source_id }) => source_id === 'municity'))
        for (const record of source.records) ids.add(record.record_id);
    }
    if (!response.next_cursor || pages === 24) {
      console.log(JSON.stringify({ event: 'preview_hood_permit_paging', pages, parcels: parcels.size,
        permits: ids.size, has_more: Boolean(response.next_cursor), status: response.status }));
      break;
    }
    response = await queryParcelData({ plan: review.plan, cursor: response.next_cursor }, { catalog });
  }
} catch (error) {
  console.warn(JSON.stringify({ event: 'preview_hood_permit_page_failed', name: error?.name, message: error?.message }));
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
    mixed_use_polygons: map.features.filter((feature) => feature.properties.recorded_use.category === 'mixed_use').length,
    zoning_status: zoning?.status, zoning_codes: zoning?.district_codes,
    examples: examples.map((item) => item.status === 'fulfilled' ? item.value : item.reason?.message) }));
} catch (error) {
  console.warn(JSON.stringify({ event: 'preview_parcel_use_failed', name: error?.name,
    message: error?.message }));
}

// Exercise the same read-only query used by the feed UI, REST and MCP.
try {
  const { listCityActivity } = await import('../search-index/city-activity.js');
  const first = await listCityActivity({ limit: 5 });
  const candidate = first.items.find((item) => item.neighborhoods.length);
  const neighborhood = candidate?.neighborhoods[0];
  const local = neighborhood ? await listCityActivity({ neighborhood, limit: 5 }) : null;
  const second = first.next_cursor ? await listCityActivity({ limit: 5, cursor: first.next_cursor }) : null;
  if (first.items.some(({ events, city_parcel_id, city_objectid }) => !city_parcel_id || !city_objectid ||
      events.some(({ source_url, event_date }) => !source_url.startsWith('https://') ||
        event_date < first.filters.from || event_date > first.filters.to)) ||
      local?.items.some((item) => !item.neighborhoods.includes(neighborhood)) ||
      second?.items.some((item) => first.items.some(({ id }) => id === item.id)))
    throw new Error('Activity parcel identity, dates, neighborhood or paging verification failed');
  console.log(JSON.stringify({ event: 'preview_city_activity', window: first.filters, status: first.coverage.status,
    items: first.items.length, kinds: [...new Set(first.items.flatMap(({ events }) => events.map(({ activity }) => activity)))],
    neighborhoods: first.neighborhoods.length, filtered_items: local?.items.length, next_page_items: second?.items.length,
    checks: first.coverage.sources.map(({ source_id, status, coverage_from, coverage_to }) =>
      [source_id, status, coverage_from, coverage_to]) }));
} catch (error) {
  console.warn(JSON.stringify({ event: 'preview_city_activity_failed', name: error?.name,
    code: error?.code ?? null, message: error?.message }));
}
