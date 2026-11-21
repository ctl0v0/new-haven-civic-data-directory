import { arcgisToGeoJSON } from "@terraformer/arcgis";
import { LAYERS } from "./config.js";
import { arcgis, cached, fetchJson, SourceError } from "./http.js";
import { loadParcel } from "./resolve.js";
import { parcelFeatureToGeoJSON } from "./geometry.js";

const RADIUS_METERS = 400;
const MAX_FEATURES = 200;
const EARTH_RADIUS = 6371008.8;
const CITY_MAPS = "https://www.newhavenct.gov/government/departments-divisions/transportation-traffic-parking/resources/maps";

export const MAP_LAYERS = Object.freeze([
  { id: "parcel-addresses", title: "City address points on this parcel", scope: "parcel", url: LAYERS.addresses, kind: "point", fields: ["house_number", "full_street_name", "unit"] },
  { id: "zoning", title: "City zoning districts intersecting this parcel", scope: "parcel", url: LAYERS.zoning, kind: "polygon", fields: ["zone_code", "district_category", "districts"] },
  { id: "transit-stops", title: "City hosted CT Transit stops nearby", scope: "nearby", url: "https://services6.arcgis.com/AWSPcxcHO7OnZlnu/ArcGIS/rest/services/CT_Transit_New_Haven_Bus_Stops/FeatureServer/0", kind: "point", fields: ["StopId", "StopName", "OnStreet", "AtStreet", "InService"] },
  { id: "metered-parking-spaces", title: "City mapped metered parking spaces nearby", scope: "nearby", url: LAYERS.parkingSpaces, kind: "point", maxFeatures: 500,
    fields: ["meternum", "facilityid", "post_num", "spacenum", "zone_", "meterspec"],
    note: "Mapped meter inventory, not an available-space feed. Confirm current rules and rates on posted signs." },
]);

export const MAP_SOURCE_GAPS = Object.freeze([
  {
    id: "loading-zones",
    title: "Loading zones",
    status: "unverified_map_source",
    note: "No current City or State geospatial loading-zone feed has been verified. No loading-zone markers are drawn.",
    source_url: CITY_MAPS,
  },
  {
    id: "parking-availability",
    title: "Parking availability",
    status: "unverified_map_source",
    note: "The mapped metered-space inventory does not report whether a space is open now. No available-space markers are drawn.",
    source_url: CITY_MAPS,
  },
]);

function validCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length) return false;
  if (typeof coordinates[0] === "number")
    return coordinates.length >= 2 && Number.isFinite(coordinates[0]) &&
      Number.isFinite(coordinates[1]) && Math.abs(coordinates[0]) <= 180 &&
      Math.abs(coordinates[1]) <= 90;
  return coordinates.every(validCoordinates);
}

function geometryToGeoJSON(geometry) {
  if (!geometry) throw new SourceError("Mapped feature has no geometry");
  const wkid = geometry.spatialReference?.latestWkid ?? geometry.spatialReference?.wkid;
  if (wkid && wkid !== 4326)
    throw new SourceError("Mapped feature was not returned in longitude and latitude");
  const converted = arcgisToGeoJSON(geometry);
  if (!converted?.type || !validCoordinates(converted.coordinates))
    throw new SourceError("Mapped feature has invalid coordinates");
  return converted;
}

function metersFromCenter(point, center) {
  const longitude = (point[0] - center[0]) * Math.PI / 180;
  const latitude = (point[1] - center[1]) * Math.PI / 180;
  return [longitude * EARTH_RADIUS * Math.cos(center[1] * Math.PI / 180), latitude * EARTH_RADIUS];
}

function nearby(geometry, center, radiusMeters) {
  if (geometry.type === "Point")
    return Math.hypot(...metersFromCenter(geometry.coordinates, center)) <= radiusMeters;
  return false;
}

function searchEnvelope(center, radiusMeters) {
  const latOffset = radiusMeters / EARTH_RADIUS * 180 / Math.PI;
  const lonOffset = latOffset / Math.cos(center[1] * Math.PI / 180);
  return {
    xmin: center[0] - lonOffset,
    ymin: center[1] - latOffset,
    xmax: center[0] + lonOffset,
    ymax: center[1] + latOffset,
    spatialReference: { wkid: 4326 },
  };
}

function publishedDate(metadata) {
  const value = metadata?.editingInfo?.dataLastEditDate ??
    metadata?.editingInfo?.lastEditDate ?? metadata?.lastEditDate;
  return Number.isFinite(value) && value > 0
    ? new Date(value).toISOString().slice(0, 10) : null;
}

async function mapLayer(definition, parcel, center) {
  try {
    const maxFeatures = definition.maxFeatures ?? MAX_FEATURES;
    const radiusMeters = definition.radiusMeters ?? RADIUS_METERS;
    const metadataPromise = cached(`map-layer-metadata:${definition.id}`, () =>
      fetchJson(`${definition.url}?f=pjson`, { timeout: 8000 }), 3600).catch(() => null);
    const area = definition.scope === "parcel"
      ? { geometry: JSON.stringify(parcel.geometry), geometryType: "esriGeometryPolygon" }
      : { geometry: JSON.stringify(searchEnvelope(center, radiusMeters)), geometryType: "esriGeometryEnvelope" };
    const data = await arcgis(definition.url, {
      ...area,
      inSR: "4326",
      outSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      returnGeometry: "true",
      outFields: "*",
      resultRecordCount: String(maxFeatures + 1),
    });
    const wkid = data.spatialReference?.latestWkid ?? data.spatialReference?.wkid;
    if (wkid && wkid !== 4326)
      throw new SourceError("Mapped features were not returned in longitude and latitude");
    const features = (data.features ?? []).map((row) => {
      const geometry = geometryToGeoJSON(row.geometry);
      const attributes = Object.fromEntries(definition.fields
        .filter((field) => row.attributes?.[field] != null)
        .map((field) => [field, row.attributes[field]]));
      const sourceRecordId = row.attributes?.objectid ?? row.attributes?.OBJECTID ??
        row.attributes?.FID ?? null;
      return {
        type: "Feature",
        id: sourceRecordId == null ? null : `${definition.id}:${sourceRecordId}`,
        properties: {
          ...attributes,
          source_id: definition.id,
          source_record_id: sourceRecordId == null ? null : String(sourceRecordId),
          source_url: sourceRecordId == null ? definition.url : `${definition.url}/${sourceRecordId}`,
          scope: definition.scope,
        },
        geometry,
      };
    }).filter((feature) => definition.scope === "parcel" || nearby(feature.geometry, center, radiusMeters));
    const truncated = Boolean(data.exceededTransferLimit) || (data.features?.length ?? 0) > maxFeatures;
    const metadata = await metadataPromise;
    return {
      id: definition.id,
      title: definition.title,
      scope: definition.scope,
      search_radius_m: definition.scope === "nearby" ? radiusMeters : null,
      source_url: definition.url,
      note: definition.note ?? null,
      source_updated_at: publishedDate(metadata),
      retrieved_at: new Date().toISOString(),
      status: truncated ? "partial" : features.length ? "ok" : "no_records",
      warning: truncated ? "The source returned more mapped features than this pilot displays." : null,
      features: features.slice(0, maxFeatures),
    };
  } catch (error) {
    return {
      id: definition.id,
      title: definition.title,
      scope: definition.scope,
      search_radius_m: definition.scope === "nearby" ? definition.radiusMeters ?? RADIUS_METERS : null,
      source_url: definition.url,
      note: definition.note ?? null,
      source_updated_at: null,
      retrieved_at: null,
      status: "unavailable",
      warning: error instanceof SourceError ? error.message : "Source request failed",
      features: [],
    };
  }
}

export function nearbyTransitStops({ longitude, latitude }, radiusMeters) {
  const definition = MAP_LAYERS.find(({ id }) => id === "transit-stops");
  return mapLayer({ ...definition, radiusMeters }, null, [longitude, latitude]);
}

export async function parcelMapContext(id, objectid = null) {
  const parcel = await loadParcel(id, objectid);
  const feature = parcelFeatureToGeoJSON(parcel);
  const center = [
    (feature.bbox[0] + feature.bbox[2]) / 2,
    (feature.bbox[1] + feature.bbox[3]) / 2,
  ];
  return cached(`map-context:v5:${parcel.attributes.parcel_id}:${parcel.attributes.objectid}`, async () => ({
    parcel: {
      parcel_id: parcel.attributes.parcel_id,
      objectid: parcel.attributes.objectid,
      address: parcel.attributes.property_address ?? null,
    },
    nearby_radius_m: RADIUS_METERS,
    nearby_origin: "center of the selected parcel's mapped extent",
    layers: await Promise.all(MAP_LAYERS.map((definition) => mapLayer(definition, parcel, center))),
    gaps: MAP_SOURCE_GAPS,
    note: "Nearby features are map context within each layer's reported search radius, not records linked to the selected parcel. Address points are mapped locations, not verified entrances. Metered parking points are a mapped inventory, not current availability.",
  }));
}
