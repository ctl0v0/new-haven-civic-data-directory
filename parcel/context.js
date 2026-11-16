import { CONTEXT_SOURCES, LAYERS } from "./config.js";
import { getSourceRecords } from "./adapters.js";
import { arcgis, cached, fetchJson, SourceError } from "./http.js";
import { loadParcel } from "./resolve.js";

const RADIUS_M = 400;
const PAGE_PARCELS = 10;
const definitions = Object.fromEntries(CONTEXT_SOURCES.map((s) => [s.id, s]));
const now = () => new Date().toISOString();

function sourceResult(id, items, status = null, warning = null) {
  const definition = definitions[id];
  return {
    source_id: id,
    status: status ?? (items.length ? "ok" : "no_records"),
    count: items.length,
    items,
    warning,
    coverage: definition.coverage,
    source_url: definition.url,
    retrieved_at: now(),
  };
}

async function checked(id, fn) {
  try {
    return await fn();
  } catch (error) {
    return sourceResult(id, [], "unavailable", error instanceof SourceError ? error.message : "Source request failed");
  }
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point.y) !== (b[1] > point.y) &&
        point.x < ((b[0] - a[0]) * (point.y - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, rings) {
  return rings.reduce((inside, ring) => inside !== pointInRing(point, ring), false);
}

function representativePoint(geometry) {
  const rings = geometry?.rings?.filter((r) => Array.isArray(r) && r.length >= 3) ?? [];
  const first = rings[0];
  if (!first || first.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1])))
    throw new SourceError("Parcel geometry has no usable point");
  const xs = first.map((p) => p[0]), ys = first.map((p) => p[1]);
  const middle = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  if (pointInPolygon(middle, rings)) return middle;
  for (let i = 1; i < first.length - 1; i++) {
    const point = {
      x: (first[0][0] + first[i][0] + first[i + 1][0]) / 3,
      y: (first[0][1] + first[i][1] + first[i + 1][1]) / 3,
    };
    if (pointInPolygon(point, rings)) return point;
  }
  throw new SourceError("Parcel geometry has no unambiguous interior point");
}

function pointQuery(point, outFields, extra = {}) {
  return {
    geometry: JSON.stringify({ ...point, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields,
    ...extra,
  };
}

function areaRecord(id, key, attributes, sourceUrl, geography, period) {
  return {
    id: `${id}:${key}`,
    source_id: id,
    source_record_id: String(key),
    event_date: null,
    attributes: { ...attributes, geography, period },
    match: { method: "contains-parcel-point" },
    source_url: sourceUrl,
    retrieved_at: now(),
  };
}

async function censusBlock(point) {
  const id = "census-block-2020";
  const layer = definitions[id].url;
  const data = await arcgis(layer, pointQuery(point,
    "GEOID,P0010001,P0030001,H0010001", { resultRecordCount: "3" }));
  if (data.exceededTransferLimit || data.features?.length > 1)
    return sourceResult(id, [], "partial", "More than one census block matched the parcel point.");
  const a = data.features?.[0]?.attributes;
  if (!a?.GEOID) return sourceResult(id, []);
  return sourceResult(id, [areaRecord(id, a.GEOID, {
    total_population: a.P0010001 ?? null,
    adult_population: a.P0030001 ?? null,
    total_housing_units: a.H0010001 ?? null,
  }, layer, "census_block", "2020 Census")]);
}

async function tractDemographics(point) {
  const id = "ct-tract-2020-acs";
  const definition = definitions[id];
  const tract = await arcgis(definition.geometry_url,
    pointQuery(point, "FIPS", { resultRecordCount: "3" }));
  if (tract.exceededTransferLimit || tract.features?.length > 1)
    return sourceResult(id, [], "partial", "More than one census tract matched the parcel point.");
  const fips = String(tract.features?.[0]?.attributes?.FIPS ?? "");
  if (!/^09\d{9}$/.test(fips)) return sourceResult(id, []);
  const url = new URL("https://data.ct.gov/resource/3p9s-pdza.json");
  url.searchParams.set("geoid", String(Number(fips)));
  url.searchParams.set("$select", "geoid,medianhouseholdincome,povertyrate,censuspopulation");
  url.searchParams.set("$limit", "2");
  const rows = await fetchJson(url, { timeout: 10000, maxBytes: 20000 });
  if (!Array.isArray(rows)) throw new SourceError("State tract response lacks records");
  const matches = rows.filter((r) => String(Number(r.geoid)) === String(Number(fips)));
  if (matches.length > 1) return sourceResult(id, [], "partial", "State returned multiple rows for one tract GEOID.");
  if (!matches.length) return sourceResult(id, []);
  const row = matches[0];
  const number = (v) => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  return sourceResult(id, [areaRecord(id, fips, {
    median_household_income_usd: number(row.medianhouseholdincome),
    poverty_rate_source_value: number(row.povertyrate),
    census_population: number(row.censuspopulation),
  }, definition.url, "census_tract", "2020 ACS; State dataset published 2023")]);
}

function distanceMeters(point, other) {
  const lat = ((point.y + other.y) / 2) * Math.PI / 180;
  const dx = (other.x - point.x) * 111320 * Math.cos(lat);
  const dy = (other.y - point.y) * 111195;
  return Math.round(Math.hypot(dx, dy));
}

function distanceToParcel(point, rings) {
  if (pointInPolygon(point, rings)) return 0;
  const lat = point.y * Math.PI / 180;
  const project = (p) => [(p[0] - point.x) * 111320 * Math.cos(lat), (p[1] - point.y) * 111195];
  let distance = Infinity;
  for (const ring of rings) for (let i = 1; i < ring.length; i++) {
    const a = project(ring[i - 1]), b = project(ring[i]);
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, -(a[0] * vx + a[1] * vy) / (vx * vx + vy * vy || 1)));
    distance = Math.min(distance, Math.hypot(a[0] + t * vx, a[1] + t * vy));
  }
  return Number.isFinite(distance) ? Math.round(distance) : null;
}

async function transitStops(point) {
  const id = "ct-transit-stops";
  const layer = definitions[id].url;
  const data = await arcgis(layer, pointQuery(point,
    "OBJECTID,StopId,StopName,OnStreet,AtStreet,InService", {
      distance: String(RADIUS_M), units: "esriSRUnit_Meter",
      returnGeometry: "true", outSR: "4326", resultRecordCount: "200",
    }));
  const items = (data.features ?? []).filter((f) => f.attributes?.StopId != null &&
    Number.isFinite(f.geometry?.x) && Number.isFinite(f.geometry?.y)).map((f) => {
    const a = f.attributes;
    return {
      id: `${id}:${a.OBJECTID}`,
      source_id: id,
      source_record_id: String(a.StopId),
      event_date: null,
      attributes: {
        stop_name: a.StopName ?? null, on_street: a.OnStreet ?? null,
        at_street: a.AtStreet ?? null, in_service: a.InService ?? null,
        distance_m: distanceMeters(point, f.geometry),
      },
      match: { method: "within-radius", radius_m: RADIUS_M },
      source_url: layer,
      retrieved_at: now(),
    };
  }).filter((item) => item.attributes.distance_m <= RADIUS_M)
    .sort((a, b) => a.attributes.distance_m - b.attributes.distance_m);
  return sourceResult(id, items, data.exceededTransferLimit ? "partial" : null,
    data.exceededTransferLimit ? "Stop layer reached its 200-record response limit." : null);
}

async function nearbyParcels(point, selected) {
  const data = await arcgis(LAYERS.parcels, pointQuery(point,
    "objectid,parcel_id,property_address,mblu", {
      distance: String(RADIUS_M), units: "esriSRUnit_Meter",
      returnGeometry: "true", outSR: "4326", resultRecordCount: "1000",
    }));
  const parcels = (data.features ?? [])
    .filter((f) => f.geometry?.rings?.length && f.attributes?.mblu &&
      Number.isSafeInteger(Number(f.attributes?.parcel_id)) &&
      Number.isSafeInteger(Number(f.attributes?.objectid)) &&
      Number(f.attributes?.objectid) !== Number(selected.attributes.objectid))
    .map((f) => ({ ...f, distance_m: distanceToParcel(point, f.geometry.rings) }))
    .filter((f) => f.distance_m != null && f.distance_m <= RADIUS_M)
    .sort((a, b) => a.distance_m - b.distance_m ||
      Number(a.attributes.objectid) - Number(b.attributes.objectid));
  return { parcels, truncated: Boolean(data.exceededTransferLimit) };
}

async function nearbyBusiness(point, selected, offset) {
  const id = "nearby-municipal-business";
  const nearby = await cached(`context:nearby:${selected.attributes.parcel_id}:${selected.attributes.objectid}`,
    () => nearbyParcels(point, selected));
  const page = nearby.parcels.slice(offset, offset + PAGE_PARCELS);
  const results = new Array(page.length);
  let next = 0;
  async function worker() {
    while (next < page.length) {
      const index = next++;
      const feature = page[index];
      const license = await getSourceRecords("municipal-business-licenses", feature);
      const occupants = await getSourceRecords("municipal-occupants", feature);
      results[index] = { feature, sources: [license, occupants] };
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, page.length) }, worker));
  const items = results.flatMap(({ feature, sources }) => sources.flatMap((source) =>
    source.items.map((item) => ({
      ...item,
      id: `${id}:${feature.attributes.objectid}:${item.id}`,
      source_id: id,
      attributes: {
        ...item.attributes,
        nearby_parcel_id: feature.attributes.parcel_id,
        nearby_parcel_address: feature.attributes.property_address ?? null,
        distance_m: feature.distance_m,
        municipal_record_type: source.source_id === "municipal-business-licenses" ? "License" : "Occupant",
      },
      match: { method: "nearby-parcel-exact-mblu", radius_m: RADIUS_M },
      note: "This municipal record belongs to the named nearby parcel. Its status does not establish a currently operating storefront.",
    }))));
  const failures = results.flatMap((r) => r.sources.filter((s) => ["unavailable", "partial"].includes(s.status)));
  const warning = [
    nearby.truncated ? "City parcel query reached its 1,000-record limit; nearby coverage is incomplete." : null,
    offset + PAGE_PARCELS < nearby.parcels.length ? `Only ${offset + page.length} of ${nearby.parcels.length} nearby parcels have been checked.` : null,
    failures.length ? `${failures.length} municipal parcel source checks were unavailable or partial.` : null,
  ].filter(Boolean).join(" ") || null;
  return {
    source: sourceResult(id, items, warning ? "partial" : null, warning),
    parcels_checked: page.length,
    parcels_available: nearby.parcels.length,
    next_cursor: offset + PAGE_PARCELS < nearby.parcels.length ? String(offset + PAGE_PARCELS) : null,
  };
}

export async function parcelContext(parcelId, { objectid = null, cursor = null } = {}) {
  const offset = Number(cursor ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000 || offset % PAGE_PARCELS)
    throw new SourceError("Invalid context cursor", 400);
  const parcel = await loadParcel(parcelId, objectid);
  const point = representativePoint(parcel.geometry);
  const [block, tract, stops, nearby] = await Promise.all([
    offset ? null : checked("census-block-2020", () => cached(`context:block:${parcel.attributes.parcel_id}:${parcel.attributes.objectid}`, () => censusBlock(point))),
    offset ? null : checked("ct-tract-2020-acs", () => cached(`context:tract:${parcel.attributes.parcel_id}:${parcel.attributes.objectid}`, () => tractDemographics(point))),
    offset ? null : checked("ct-transit-stops", () => cached(`context:stops:${parcel.attributes.parcel_id}:${parcel.attributes.objectid}`, () => transitStops(point))),
    checked("nearby-municipal-business", () => nearbyBusiness(point, parcel, offset)),
  ]);
  const sources = [block, tract, stops, nearby?.source ?? nearby].filter(Boolean);
  return {
    parcel_id: Number(parcel.attributes.parcel_id),
    radius_m: RADIUS_M,
    distance_basis: "Straight-line distance from a point inside the selected parcel to a stop point or the nearest nearby parcel boundary.",
    sources: sources.map(({ items, ...rest }) => rest),
    items: sources.flatMap((source) => source.items),
    parcels_checked: nearby?.parcels_checked ?? 0,
    parcels_available: nearby?.parcels_available ?? null,
    next_cursor: nearby?.next_cursor ?? null,
    partial: sources.some((source) => ["partial", "unavailable"].includes(source.status)),
  };
}
