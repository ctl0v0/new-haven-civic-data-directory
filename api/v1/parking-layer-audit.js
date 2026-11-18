import { arcgis, fetchJson } from "../../parcel/http.js";
import { loadParcel } from "../../parcel/resolve.js";
import { parcelFeatureToGeoJSON } from "../../parcel/geometry.js";
import { parcelMapContext } from "../../parcel/map-context.js";

const ROOT = "https://gis.newhavenct.gov/server/rest/services/Hosted/";
const NAMES = ["Metered_Parking_Spaces_view", "Metered_Parking_Spaces"];
const OPTIONS = { timeout: 12000, maxBytes: 5_000_000 };

async function inspect(name, envelope) {
  const base = `${ROOT}${name}/FeatureServer`;
  try {
    const service = await fetchJson(`${base}?f=pjson`, OPTIONS);
    const layers = service.layers ?? [];
    const details = await Promise.all(layers.map(async (entry) => {
      const layer = `${base}/${entry.id}`;
      const [metadata, count, sample, nearby] = await Promise.all([
        fetchJson(`${layer}?f=pjson`, OPTIONS),
        fetchJson(`${layer}/query?f=json&where=1%3D1&returnCountOnly=true`, OPTIONS),
        fetchJson(`${layer}/query?f=json&where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=3`, OPTIONS),
        arcgis(layer, { where: "1=1", geometry: JSON.stringify(envelope), geometryType: "esriGeometryEnvelope",
          inSR: "4326", spatialRel: "esriSpatialRelIntersects", returnCountOnly: "true" }),
      ]);
      return { id: entry.id, name: metadata.name, type: metadata.type,
        is_view: metadata.isView ?? service.isView ?? null,
        geometry_type: metadata.geometryType, object_id_field: metadata.objectIdField,
        max_record_count: metadata.maxRecordCount, count: count.count,
        nearby_envelope_count_20_eld: nearby.count,
        editing_info: metadata.editingInfo, fields: metadata.fields?.map((field) => ({
          name: field.name, alias: field.alias, type: field.type,
        })), samples: sample.features?.map((feature) => feature.attributes),
        extent: metadata.extent, error: metadata.error ?? count.error ?? sample.error ?? null };
    }));
    return { name, service_description: service.serviceDescription,
      is_view: service.isView ?? null, service_item_id: service.serviceItemId ?? null,
      layers: details, error: service.error ?? null };
  } catch (error) {
    return { name, error: error.message };
  }
}

export default {
  async fetch(request) {
    if (process.env.VERCEL_ENV !== "preview" || request.method !== "GET")
      return new Response("Not found", { status: 404 });
    if (new URL(request.url).searchParams.get("mode") === "context") {
      const context = await parcelMapContext("11236", "979");
      const layer = context.layers.find((entry) => entry.id === "metered-parking-spaces");
      return Response.json({ parcel: context.parcel, layer: {
        id: layer.id, status: layer.status, count: layer.features.length,
        source_url: layer.source_url, source_updated_at: layer.source_updated_at,
        warning: layer.warning, example: layer.features[0] ?? null,
      } }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const parcel = await loadParcel("11236", "979");
    const bbox = parcelFeatureToGeoJSON(parcel).bbox;
    const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
    const latOffset = 400 / 111195;
    const lonOffset = latOffset / Math.cos(center[1] * Math.PI / 180);
    const envelope = { xmin: center[0] - lonOffset, xmax: center[0] + lonOffset,
      ymin: center[1] - latOffset, ymax: center[1] + latOffset,
      spatialReference: { wkid: 4326 } };
    return Response.json({ results: await Promise.all(NAMES.map((name) => inspect(name, envelope))) },
      { headers: { "Cache-Control": "private, no-store" } });
  },
};
