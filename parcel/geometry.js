import { arcgisToGeoJSON } from "@terraformer/arcgis";
import { LAYERS } from "./config.js";
import { SourceError } from "./http.js";

export function parcelFeatureToGeoJSON(feature) {
  if (!Array.isArray(feature?.geometry?.rings) || !feature.geometry.rings.length)
    throw new SourceError("Parcel geometry unavailable");
  const geometry = arcgisToGeoJSON(feature.geometry);
  const polygons = geometry?.type === "Polygon"
    ? [geometry.coordinates]
    : geometry?.type === "MultiPolygon"
      ? geometry.coordinates
      : null;
  if (!Array.isArray(polygons) || !polygons.length)
    throw new SourceError("Parcel polygon could not be read");

  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length)
      throw new SourceError("Parcel polygon could not be read");
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4)
        throw new SourceError("Parcel polygon could not be read");
      for (const point of ring) {
        if (!Array.isArray(point) || point.length < 2 ||
            !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
            Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)
          throw new SourceError("Parcel polygon has invalid coordinates");
        bbox[0] = Math.min(bbox[0], point[0]);
        bbox[1] = Math.min(bbox[1], point[1]);
        bbox[2] = Math.max(bbox[2], point[0]);
        bbox[3] = Math.max(bbox[3], point[1]);
      }
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1])
        throw new SourceError("Parcel polygon ring is not closed");
    }
  }

  const a = feature.attributes;
  return {
    type: "Feature",
    id: `${a.parcel_id}:${a.objectid}`,
    bbox,
    properties: {
      parcel_id: a.parcel_id,
      objectid: a.objectid,
      address: a.property_address ?? null,
      mblu: a.mblu ?? null,
      source_id: "parcels",
      source_url: LAYERS.parcels,
      description: "City mapped parcel boundary; not a building footprint.",
    },
    geometry,
  };
}
