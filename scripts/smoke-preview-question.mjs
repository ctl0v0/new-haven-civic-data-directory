import { recentCalendarDates, askIndexedParcels, questionPermitCatalog } from '../search-index/ask.js';
import { indexConfigured } from '../search-index/db.js';
import { askParcelData } from '../search-index/parcel-question.js';
import { queryParcelData } from '../search-index/parcel-query.js';
import { searchIndexedParcels, searchIndexedRecords } from '../search-index/search.js';
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
if (process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[charity-registration-smoke]')) {
  const { CHARITY_SOURCE } = await import('../parcel/charity-registrations.js');
  const { stateRosterInventory } = await import('../search-index/socrata.js');
  const [live, inventory, indexed] = await Promise.allSettled([
    askParcelData({ question: 'Show public charity registrations at 138 Bradley St' }),
    stateRosterInventory(CHARITY_SOURCE),
    searchIndexedRecords({ source_id: CHARITY_SOURCE, site_address: '138 Bradley St',
      equals: { fullcredentialcode: 'CHR.0068611' } }),
  ]);
  const proof = (rows) => rows.flatMap((row) => (row.matching_sources ?? []).flatMap((source) =>
    source.records.filter(({ record_id }) => record_id === '2671715')
      .map(({ record_id, fields, match }) => ({ parcel_id: row.city_parcel_id, record_id,
        address: fields.address, status: fields.status, match: match?.method }))));
  console.log(JSON.stringify({ event: 'preview_charity_registration_check',
    live: live.status === 'fulfilled' ? { status: live.value.status, matches: proof(live.value.items ?? []),
      checks: live.value.coverage?.source_checks?.map(({ source_id, status, warning }) => ({ source_id, status, warning })) }
      : { error: live.reason.message },
    inventory: inventory.status === 'fulfilled' ? { count: inventory.value.source_count }
      : { error: inventory.reason.message },
    indexed: indexed.status === 'fulfilled' ? {
      matches: indexed.value.items.map(({ city_parcel_id, record_id, match_methods }) =>
        ({ parcel_id: city_parcel_id, record_id, match_methods })), ...sourceSummary(indexed.value),
    } : { error: indexed.reason.message },
  }));
}
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

// Check both sections of the wider desktop view and reconcile them to City's IDs.
try {
  const [{ browseParcels }, { LAYERS }, { arcgis }, { parcelFeatureToGeoJSON }] = await Promise.all([
    import('../parcel/browse.js'), import('../parcel/config.js'), import('../parcel/http.js'), import('../parcel/geometry.js'),
  ]);
  const before = performance.now();
  const parts = await Promise.all(['-72.952,41.292,-72.928,41.324', '-72.928,41.292,-72.904,41.324']
    .map((bounds) => browseParcels(bounds, { zoom: '15' })));
  const milliseconds = Math.round(performance.now() - before);
  const ids = new Set();
  const counts = Object.create(null);
  for (const part of parts)
    for (const { properties } of part.features) {
      if (ids.has(properties.objectid)) continue;
      ids.add(properties.objectid);
      const use = part.recorded_uses[properties.use_code].category;
      counts[use] = (counts[use] ?? 0) + 1;
    }
  const city = await arcgis(LAYERS.parcels, {
    geometry: '-72.952,41.292,-72.904,41.324', geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', returnIdsOnly: 'true',
  });
  const missing = city.objectIds.filter((id) => !ids.has(id));
  let missingInside = missing.length;
  if (missing.length && missing.length <= 200) {
    // Compare City envelope matches using their WGS84 geometry as displayed on the map.
    const exact = await arcgis(LAYERS.parcels, { objectIds: missing.join(','), outFields: 'objectid,parcel_id',
      returnGeometry: 'true', outSR: '4326', resultRecordCount: String(missing.length) });
    for (const row of exact.features) {
      const [west, south, east, north] = parcelFeatureToGeoJSON(row).bbox;
      if (west > -72.904 || east < -72.952 || south > 41.324 || north < 41.292) missingInside--;
    }
  }
  console.log(JSON.stringify({ event: 'preview_browse_zoom_15', modes: parts.map((part) => part.mode),
    polygons: ids.size, counts, city_envelope_ids: city.objectIds.length, missing: missing.length, missing_inside: missingInside, milliseconds,
    sections_limited: parts.map((part) => part.viewport_limited),
    section_bytes: parts.map((part) => Buffer.byteLength(JSON.stringify(part))) }));
  if (ids.size <= 500 || !counts.mixed_use || parts.some((part) => part.viewport_limited) || missingInside)
    throw new Error(`Wider downtown sections returned ${ids.size} outlines with ${missingInside} City IDs missing inside the display extent`);
} catch (error) {
  console.warn(JSON.stringify({ event: 'preview_browse_zoom_15_failed', name: error?.name, message: error?.message }));
}

try {
  const [{ browseParcels }, { LAYERS }, { arcgis }] = await Promise.all([
    import('../parcel/browse.js'), import('../parcel/config.js'), import('../parcel/http.js'),
  ]);
  const streets = await arcgis(LAYERS.parcels, {
    where: ['WILLOW', 'FOSTER', 'NICOLL'].map((street) => `UPPER(property_address) LIKE '% ${street} ST%'`).join(' OR '),
    outFields: 'objectid', returnGeometry: 'true', geometryPrecision: '6', outSR: '4326', resultRecordCount: '500',
  });
  const ids = new Set(streets.features.map((feature) => feature.attributes.objectid));
  if (streets.exceededTransferLimit || ids.size < 30) throw new Error('The City street parcel check returned an incomplete list');
  const points = streets.features.flatMap((feature) => feature.geometry?.rings?.flat() ?? []);
  const x = points.map(([longitude]) => longitude);
  const y = points.map(([, latitude]) => latitude);
  const bounds = [Math.min(...x), Math.min(...y), Math.max(...x), Math.max(...y)].join(',');
  const result = await browseParcels(bounds, { zoom: '15' });
  const seen = new Set(result.features.map(({ properties }) => properties.objectid));
  const missing = [...ids].filter((id) => !seen.has(id));
  if (result.viewport_limited || missing.length) throw new Error(`Wider East Rock view omitted ${missing.length} street parcels`);
  console.log(JSON.stringify({ event: 'preview_browse_east_rock', mode: result.mode,
    street_parcels: ids.size, viewport_polygons: seen.size, missing: missing.length }));
} catch (error) {
  console.warn(JSON.stringify({ event: 'preview_browse_east_rock_failed', name: error?.name, message: error?.message }));
}

// Only run a billable Google check on an explicitly marked Preview build.
const { opportunityAvailability } = await import('../parcel/storefront-opportunity.js');
console.log(JSON.stringify({ event: 'preview_storefront_opportunity', ...opportunityAvailability() }));

try {
  const { countPlacesInWalkingArea, nearbyBusinessCount, nearbyBusinessMatches, nearbyBusinessOrigins } = await import('../parcel/nearby-business-count.js');
  const parcel = { parcel_id: 10386, objectid: 20011, query_address: '3 Edwards St' };
  const result = await nearbyBusinessOrigins(parcel);
  const origin = result.origins.find(({ id }) => id === result.default_origin);
  console.log(JSON.stringify({ event: 'preview_nearby_business_origin', configured: result.configured,
    origins: result.origins.length, exact_address: origin?.method === 'city-address-point', warning: result.warning }));
  if (process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[places-half-mile-smoke]')) {
    const nearby = await nearbyBusinessCount({ ...parcel, category: 'grocery_store', radius_meters: 805 });
    if (nearby.radius_meters !== 805 || nearby.origin.id !== origin?.id || origin?.method !== 'city-address-point')
      throw new Error('The half-mile check did not use the expected City address and radius');
    console.log(JSON.stringify({ event: 'preview_storefront_half_mile', status: 'ok', radius_meters: nearby.radius_meters }));
  }
  if (process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[places-walk-smoke]')) {
    const routingKey = process.env.OPENROUTESERVICE_API_KEY?.trim();
    const googleKey = process.env.GOOGLE_PLACES_AGGREGATE_API_KEY?.trim();
    if (!routingKey || !googleKey || origin?.method !== 'city-address-point')
      throw new Error('The walking and Google keys and exact City address are required for the live check');
    const { walkingAreas } = await import('../parcel/walking-areas.js');
    const windows = await walkingAreas(origin, routingKey);
    const checks = await Promise.all(windows.map(async ({ minutes, ring, reason }) => {
      if (!ring) return { minutes, status: 'unavailable', reason };
      try {
        await countPlacesInWalkingArea(googleKey, ring, ['grocery_store'], 6000);
        return { minutes, status: 'ok' };
      } catch (error) {
        return { minutes, status: 'unavailable', reason: error.message };
      }
    }));
    console.log(JSON.stringify({ event: 'preview_storefront_walking_check', checks }));
  }
  if (process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[places-smoke]')) {
    const category = 'ice_cream_shop';
    const checked = await nearbyBusinessCount({ ...parcel, category });
    if (checked.origin.id !== origin?.id || checked.category !== category || checked.radius_meters !== 1609 ||
        !Number.isSafeInteger(checked.count) || checked.count < 0)
      throw new Error('The live business count did not match the verified City origin, category or radius');
    console.log(JSON.stringify({ event: 'preview_nearby_business_live', status: 'ok',
      category, radius_meters: checked.radius_meters, exact_address: true }));
  }
  if (process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[places-categories-smoke]')) {
    const categories = ['thai_restaurant', 'building_materials_store'];
    const checked = await Promise.all(categories.map((category) => nearbyBusinessCount({ ...parcel, category })));
    if (checked.some((item, index) => item.category !== categories[index] || item.origin.id !== origin?.id))
      throw new Error('An expanded business type did not match the verified City search');
    console.log(JSON.stringify({ event: 'preview_nearby_business_categories', status: 'ok', categories }));
  }
  if (process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[places-group-smoke]')) {
    const group = 'Restaurants & cuisines';
    const subcategories = ['indian_restaurant', 'thai_restaurant'];
    const [broad, narrowed] = await Promise.all([
      nearbyBusinessCount({ ...parcel, group }),
      nearbyBusinessCount({ ...parcel, group, subcategories }),
    ]);
    if ([broad, narrowed].some((item) => item.group !== group || item.origin.id !== origin?.id) ||
        broad.subcategories.length || narrowed.subcategories.join() !== subcategories.join() || broad.count < narrowed.count)
      throw new Error('The live category search did not match its expected scope');
    console.log(JSON.stringify({ event: 'preview_nearby_business_group', status: 'ok', group, subcategories }));
  }
  if (process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[places-outdoors-smoke]')) {
    const group = 'Parks & outdoor recreation';
    const subcategories = ['city_park', 'hiking_area', 'park'];
    const [broad, named] = await Promise.all([
      nearbyBusinessCount({ ...parcel, group }),
      nearbyBusinessMatches({ ...parcel, group, subcategories }),
    ]);
    if (broad.group !== group || broad.origin.id !== origin?.id || broad.count < named.count ||
        named.status !== 'ok' || !named.results.some(({ name, maps_url }) => name && maps_url))
      throw new Error('The live outdoor category search did not return the expected count and names');
    console.log(JSON.stringify({ event: 'preview_nearby_outdoor_places', status: 'ok', group, subcategories }));
  }
} catch (error) {
  console.warn(JSON.stringify({ event: 'preview_nearby_business_check_failed', status: error?.status,
    upstream_status: error?.upstreamStatus, error_type: error?.upstreamErrorType, message: error?.message }));
}

// Verify the live matches service without logging Google listing fields.
if (process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[places-details-smoke]')) {
  try {
    const { nearbyBusinessMatches } = await import('../parcel/nearby-business-count.js');
    let verified = false;
    for (const category of ['ice_cream_shop', 'grocery_store']) {
      const result = await nearbyBusinessMatches({ parcel_id: 10386, objectid: 20011, query_address: '3 Edwards St', category });
      verified = result.status === 'ok' && result.results.length <= 10 &&
        result.results.some(({ name, address, maps_url }) => name && address && maps_url?.startsWith('https://'));
      if (verified) break;
    }
    if (!verified) throw new Error('The live matches page did not contain a name, address and Maps link');
    console.log(JSON.stringify({ event: 'preview_nearby_business_matches', status: 'ok', fields_verified: ['name', 'address', 'maps_url'] }));
  } catch (error) {
    console.warn(JSON.stringify({ event: 'preview_nearby_business_matches_failed', status: error?.status, message: error?.message }));
  }
}

// Exercise the same read-only query used by the feed UI, REST and MCP.
try {
  const { listCityActivity } = await import('../search-index/city-activity.js');
  const first = await listCityActivity({ limit: 5 });
  const candidate = first.items.find((item) => item.neighborhoods.length);
  const neighborhood = candidate?.neighborhoods[0];
  const hasNeighborhoodPermit = (item) => item.neighborhoods.length &&
    item.events.some((event) => event.activity === "permit" && event.published_type);
  const permitItem = first.items.find(hasNeighborhoodPermit) ??
    (await listCityActivity({ activity: "permit", limit: 10 })).items.find(hasNeighborhoodPermit);
  const permitType = permitItem?.events.find((event) => event.activity === "permit" && event.published_type)?.published_type;
  const [local, second, byType] = await Promise.all([
    neighborhood ? listCityActivity({ neighborhood, limit: 5 }) : null,
    first.next_cursor ? listCityActivity({ limit: 5, cursor: first.next_cursor }) : null,
    permitType ? listCityActivity({ neighborhood: permitItem.neighborhoods[0], permit_type: permitType, limit: 5 }) : null,
  ]);
  if (first.items.some(({ events, city_parcel_id, city_objectid }) => !city_parcel_id || !city_objectid ||
      events.some(({ source_url, event_date }) => !source_url.startsWith('https://') ||
        event_date < first.filters.from || event_date > first.filters.to)) ||
      local?.items.some((item) => !item.neighborhoods.includes(neighborhood)) ||
      second?.items.some((item) => first.items.some(({ id }) => id === item.id)) ||
      (byType && (!byType.items.length || byType.items.some((item) => !item.neighborhoods.includes(permitItem.neighborhoods[0]) ||
        item.events.some((event) => event.activity !== "permit" || event.published_type?.trim().toLowerCase() !== permitType.trim().toLowerCase())))))
    throw new Error('Activity parcel identity, dates, neighborhood, permit type or paging verification failed');
  console.log(JSON.stringify({ event: 'preview_city_activity', window: first.filters, status: first.coverage.status,
    items: first.items.length, kinds: [...new Set(first.items.flatMap(({ events }) => events.map(({ activity }) => activity)))],
    neighborhoods: first.neighborhoods.length, filtered_items: local?.items.length, next_page_items: second?.items.length,
    exact_permit_type_items: byType?.items.length,
    checks: first.coverage.sources.map(({ source_id, status, coverage_from, coverage_to }) =>
      [source_id, status, coverage_from, coverage_to]) }));
} catch (error) {
  console.warn(JSON.stringify({ event: 'preview_city_activity_failed', name: error?.name,
    code: error?.code ?? null, message: error?.message }));
}
