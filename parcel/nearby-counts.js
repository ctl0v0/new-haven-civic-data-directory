import { loadParcel } from "./resolve.js";
import { parcelFeatureToGeoJSON } from "./geometry.js";
import { arcgis, fetchJson, SourceError } from "./http.js";
import { MAP_LAYERS } from "./map-context.js";

const EARTH_RADIUS = 6371008.8;
const BATCH_SIZE = 200;
const MAX_CANDIDATES = 5000;
const LAYERS = new Map(MAP_LAYERS.filter((layer) =>
  ["metered-parking-spaces", "transit-stops"].includes(layer.id))
  .map((layer) => [layer.id, layer]));

function envelope(center, radius) {
  const lat = radius / EARTH_RADIUS * 180 / Math.PI;
  const lon = lat / Math.cos(center[1] * Math.PI / 180);
  return { xmin: center[0] - lon, ymin: center[1] - lat,
    xmax: center[0] + lon, ymax: center[1] + lat,
    spatialReference: { wkid: 4326 } };
}
function distance(center, point) {
  const lat1 = center[1] * Math.PI / 180;
  const lat2 = point[1] * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = (point[0] - center[0]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}
function publishedEdit(metadata) {
  const value = metadata?.editingInfo?.dataLastEditDate ??
    metadata?.editingInfo?.lastEditDate ?? metadata?.lastEditDate;
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : null;
}

async function layerCounts(layer, center, radius) {
  const source = { source_id: layer.id, source_url: layer.url,
    radius_meters: radius, origin: "center of the City parcel's mapped extent" };
  try {
    const geometry = JSON.stringify(envelope(center, radius));
    const options = { where: "1=1", geometry, geometryType: "esriGeometryEnvelope",
      inSR: "4326", spatialRel: "esriSpatialRelIntersects", returnGeometry: "false" };
    const [ids, count, metadata] = await Promise.all([
      arcgis(layer.url, { ...options, returnIdsOnly: "true" }),
      arcgis(layer.url, { ...options, returnCountOnly: "true" }),
      fetchJson(`${layer.url}?f=pjson`, { timeout: 8000 }),
    ]);
    const list = ids.objectIds ?? [];
    if (!Array.isArray(list) || !Number.isSafeInteger(count.count) ||
        list.length !== count.count || new Set(list).size !== list.length)
      throw new SourceError("Official mapped feature IDs and count disagree");
    if (list.length > MAX_CANDIDATES)
      return { ...source, status: "partial", mapped_count: null,
        candidate_count: list.length, source_updated_at: publishedEdit(metadata),
        warning: `More than ${MAX_CANDIDATES} mapped candidates were returned; no radius count was asserted.` };
    let mapped = 0;
    let nearest = null;
    const objectIdField = metadata.objectIdField;
    if (list.length && !["objectid", "OBJECTID"].includes(objectIdField))
      throw new SourceError("Official mapped feature ID field changed");
    for (let offset = 0; offset < list.length; offset += BATCH_SIZE) {
      const selected = list.slice(offset, offset + BATCH_SIZE);
      const data = await arcgis(layer.url, { where: "1=1", objectIds: selected.join(","),
        outFields: objectIdField, returnGeometry: "true", outSR: "4326",
        resultRecordCount: String(selected.length) });
      const returned = new Set();
      for (const feature of data.features ?? []) {
        const id = Number(feature.attributes?.[objectIdField]);
        const point = feature.geometry;
        const wkid = point?.spatialReference?.latestWkid ?? point?.spatialReference?.wkid;
        if (!selected.includes(id) || returned.has(id) || !Number.isFinite(point?.x) ||
            !Number.isFinite(point?.y) || (wkid && wkid !== 4326))
          throw new SourceError("Official mapped feature batch was incomplete");
        returned.add(id);
        const meters = distance(center, [point.x, point.y]);
        if (meters > radius) continue;
        mapped++;
        if (!nearest || meters < nearest.distance_meters)
          nearest = { source_record_id: String(id),
            source_url: `${layer.url}/${id}`, distance_meters: Math.round(meters) };
      }
      if (data.exceededTransferLimit || returned.size !== selected.length)
        throw new SourceError("Official mapped feature batch omitted an ID");
    }
    return { ...source, status: "complete", mapped_count: mapped,
      candidate_count: list.length, nearest,
      source_updated_at: publishedEdit(metadata),
      note: layer.id === "metered-parking-spaces"
        ? "Mapped metered-space inventory, not current availability or permission to park."
        : "Mapped stops, not service frequency or walking distance." };
  } catch (error) {
    return { ...source, status: "unavailable", mapped_count: null,
      warning: error instanceof SourceError ? error.message : "Official mapped source request failed" };
  }
}

export async function nearbyFeatureCounts(id, { objectid = null, radius_meters = 400,
  source_ids = ["metered-parking-spaces", "transit-stops"] } = {}) {
  const radius = Number(radius_meters);
  if (!Number.isSafeInteger(radius) || radius < 25 || radius > 1000)
    throw new SourceError("radius_meters must be 25–1000", 400);
  if (!Array.isArray(source_ids) || !source_ids.length || source_ids.length > 2 ||
      new Set(source_ids).size !== source_ids.length ||
      source_ids.some((sourceId) => !LAYERS.has(sourceId)))
    throw new SourceError("Choose one or two supported mapped point sources", 400);
  const parcel = await loadParcel(id, objectid);
  const geojson = parcelFeatureToGeoJSON(parcel);
  const center = [(geojson.bbox[0] + geojson.bbox[2]) / 2,
    (geojson.bbox[1] + geojson.bbox[3]) / 2];
  const layers = await Promise.all(source_ids.map((sourceId) =>
    layerCounts(LAYERS.get(sourceId), center, radius)));
  return { city_parcel_id: Number(parcel.attributes.parcel_id),
    city_objectid: Number(parcel.attributes.objectid), radius_meters: radius,
    origin: { method: "city-parcel-extent-center", longitude: center[0], latitude: center[1] },
    layers, complete_for_query: layers.every((layer) => layer.status === "complete"),
    retrieved_at: new Date().toISOString() };
}
