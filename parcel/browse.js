import { LAYERS } from "./config.js";
import { arcgis, SourceError } from "./http.js";
import { parcelFeatureToGeoJSON, parcelGeoJSON } from "./geometry.js";
import { indexConfigured, indexQuery } from "../search-index/db.js";

const MAX_PARCELS = 500;
const MAX_MAP_PARCELS = 6500;
const MAX_MAP_BYTES = 3_800_000;
const CITY_PAGE_SIZE = 1000;
const browseFields = "objectid,parcel_id,property_address,mblu,use_code";

function viewport(value, wide) {
  const parts = String(value ?? "").split(",");
  const values = parts.map(Number);
  if (parts.length !== 4 || parts.some((part) => !part.trim()) || values.some((number) => !Number.isFinite(number)))
    throw new SourceError("A four-coordinate map viewport is required", 400);
  const [west, south, east, north] = values;
  if (west < -180 || east > 180 || south < -90 || north > 90 ||
      east <= west || north <= south || east - west > (wide ? 0.2 : 0.06) || north - south > (wide ? 0.14 : 0.04))
    throw new SourceError("Map viewport is too large or invalid; zoom in", 400);
  return { xmin: west, ymin: south, xmax: east, ymax: north,
    spatialReference: { wkid: 4326 } };
}

const indexedViewportSql = `WITH active AS (
    SELECT r.id, r.finished_at
    FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
    WHERE a.source_id = 'parcels' AND a.scope_key = 'all' AND r.expected_count > 0
      AND r.returned_count = r.expected_count AND r.finished_at >= now() - interval '48 hours'
  )
  SELECT active.finished_at, visible.attributes, visible.geometry
  FROM active LEFT JOIN LATERAL (
    SELECT jsonb_build_object('objectid', p.fields->'objectid', 'parcel_id', p.fields->'parcel_id',
      'property_address', p.fields->'property_address', 'mblu', p.fields->'mblu', 'use_code', p.fields->'use_code') AS attributes,
      ST_AsGeoJSON(p.geometry, $5::integer)::jsonb AS geometry
    FROM search_records p
    WHERE p.run_id = active.id AND p.source_id = 'parcels'
      AND ST_Intersects(p.geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    LIMIT $6
  ) visible ON true`;

async function indexedViewport(bounds, zoom, query) {
  const rows = await query(indexedViewportSql, [bounds.xmin, bounds.ymin, bounds.xmax, bounds.ymax,
    zoom < 17 ? 6 : 7, MAX_MAP_PARCELS + 1]);
  if (!rows.length) return null;
  return formatParcels(rows.filter((row) => row.attributes), MAX_MAP_PARCELS,
    (row) => parcelGeoJSON(row.attributes, row.geometry), {
      mode: "indexed", indexed_at: rows[0].finished_at,
    });
}

async function liveViewport(bounds, zoom) {
  const wide = zoom !== null;
  const limit = wide ? MAX_MAP_PARCELS : MAX_PARCELS;
  const params = {
    geometry: JSON.stringify(bounds),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects",
    returnGeometry: "true",
    outFields: browseFields,
    ...(wide ? { orderByFields: "objectid ASC", geometryPrecision: zoom < 17 ? "6" : "7" } : {}),
    resultRecordCount: String(wide ? CITY_PAGE_SIZE : limit + 1),
  };
  const rows = [];
  const seen = new Set();
  let truncated = false;
  let interrupted = false;
  do {
    try {
      const data = await arcgis(LAYERS.parcels, wide ? { ...params, resultOffset: String(rows.length) } : params);
      const wkid = data.spatialReference?.latestWkid ?? data.spatialReference?.wkid;
      if (wkid && wkid !== 4326)
        throw new SourceError("City parcel map returned unexpected coordinates");
      const page = data.features ?? [];
      truncated = Boolean(data.exceededTransferLimit);
      if (wide && (!page.length && truncated || page.some(({ attributes }) => seen.has(attributes?.objectid)))) {
        interrupted = true;
        break;
      }
      for (const row of page) seen.add(row.attributes?.objectid);
      rows.push(...page);
    } catch (error) {
      if (!rows.length) throw error;
      interrupted = true;
      break;
    }
  } while (wide && truncated && rows.length < limit);
  return formatParcels(rows, limit, parcelFeatureToGeoJSON, {
    truncated, interrupted, ...(wide ? { mode: "live" } : {}),
  });
}

function formatParcels(rows, limit, toFeature, { truncated = false, interrupted = false, ...source }) {
  truncated ||= rows.length > limit;
  let invalid = 0;
  let bytes = 0;
  const features = [];
  for (const row of rows.slice(0, limit)) {
    if (row.attributes?.parcel_id == null || row.attributes?.objectid == null) {
      invalid++;
      continue;
    }
    try {
      const feature = toFeature(row);
      feature.properties.source_url = `${LAYERS.parcels}/${row.attributes.objectid}`;
      if (source.mode) {
        bytes += Buffer.byteLength(JSON.stringify(feature)) + 1;
        if (bytes > MAX_MAP_BYTES) {
          truncated = true;
          break;
        }
      }
      features.push(feature);
    } catch { invalid++; }
  }
  return {
    ...source,
    status: truncated || interrupted || invalid ? "partial" : features.length ? "ok" : "no_records",
    features,
    warning: interrupted ? "The City parcel layer returned only part of this view. Zoom in to retry."
      : truncated ? "More City parcels intersect this view. Zoom in to see all outlines."
      : invalid ? `${invalid} City parcels did not have displayable geometry and identifiers.` : null,
    source_url: LAYERS.parcels,
    note: source.mode === "indexed" ? "Viewport polygons use the most recent verified City parcel inventory. Selecting one does not request the unified parcel records."
      : "Viewport polygons come directly from the City parcel layer. Selecting one does not request the unified parcel records.",
  };
}

export async function browseParcels(bounds, { zoom = null, query = indexQuery, configured = indexConfigured } = {}) {
  if (zoom !== null) {
    if (!/^\d{2}$/.test(zoom) || Number(zoom) < 15 || Number(zoom) > 23)
      throw new SourceError("Parcel map zoom must be between 15 and 23", 400);
    zoom = Number(zoom);
  }
  const box = viewport(bounds, zoom !== null);
  if (zoom !== null && configured()) {
    try {
      const data = await indexedViewport(box, zoom, query);
      if (data) return data;
    } catch {
      // The browse map can still use the official live layer if the index is unavailable.
    }
  }
  return liveViewport(box, zoom);
}
