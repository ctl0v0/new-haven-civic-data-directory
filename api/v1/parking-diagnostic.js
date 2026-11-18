import { loadParcel } from "../../parcel/resolve.js";
import { parcelFeatureToGeoJSON } from "../../parcel/geometry.js";
import { arcgis } from "../../parcel/http.js";
import { LAYERS } from "../../parcel/config.js";
import { parcelMapContext } from "../../parcel/map-context.js";

const envelope = (center, metres) => {
  const lat = metres / 111195;
  const lon = lat / Math.cos(center[1] * Math.PI / 180);
  return { xmin: center[0] - lon, ymin: center[1] - lat,
    xmax: center[0] + lon, ymax: center[1] + lat,
    spatialReference: { wkid: 4326 } };
};

const meters = (center, x, y) => Math.hypot(
  (x - center[0]) * 111195 * Math.cos(center[1] * Math.PI / 180),
  (y - center[1]) * 111195,
);

export default {
  async fetch(request) {
    if (process.env.VERCEL_ENV !== "preview" || request.method !== "GET")
      return new Response("Not found", { status: 404 });
    const id = "10386";
    const objectid = "20011";
    const parcel = await loadParcel(id, objectid);
    const bbox = parcelFeatureToGeoJSON(parcel).bbox;
    const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
    const counts = await Promise.all([400, 1000, 2000].map(async (radius) => {
      const result = await arcgis(LAYERS.parkingSpaces, {
        geometry: JSON.stringify(envelope(center, radius)), geometryType: "esriGeometryEnvelope",
        inSR: "4326", spatialRel: "esriSpatialRelIntersects", returnCountOnly: "true",
      });
      return { radius, count: result.count };
    }));
    const candidates = await arcgis(LAYERS.parkingSpaces, {
      geometry: JSON.stringify(envelope(center, 2000)), geometryType: "esriGeometryEnvelope",
      inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects",
      returnGeometry: "true", outFields: "objectid,facilityid", resultRecordCount: "2000",
    });
    const closest = candidates.features.map((item) => ({
      id: item.attributes.objectid, facilityid: item.attributes.facilityid,
      distance_m: Math.round(meters(center, item.geometry.x, item.geometry.y)),
    })).sort((a, b) => a.distance_m - b.distance_m).slice(0, 5);
    const context = await parcelMapContext(id, objectid);
    const layer = context.layers.find((item) => item.id === "metered-parking-spaces");
    return Response.json({ parcel: { id, objectid, address: parcel.attributes.property_address, bbox },
      center, counts, closest, layer: { status: layer.status, count: layer.features.length,
        warning: layer.warning, source_updated_at: layer.source_updated_at } },
    { headers: { "Cache-Control": "private, no-store" } });
  },
};
