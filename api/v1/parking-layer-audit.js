import { fetchJson } from "../../parcel/http.js";

const ROOT = "https://gis.newhavenct.gov/server/rest/services/Hosted/";
const NAMES = ["Metered_Parking_Spaces_view", "Metered_Parking_Spaces"];
const OPTIONS = { timeout: 12000, maxBytes: 5_000_000 };

async function inspect(name) {
  const base = `${ROOT}${name}/FeatureServer`;
  try {
    const service = await fetchJson(`${base}?f=pjson`, OPTIONS);
    const layers = service.layers ?? [];
    const details = await Promise.all(layers.map(async (entry) => {
      const layer = `${base}/${entry.id}`;
      const [metadata, count, sample] = await Promise.all([
        fetchJson(`${layer}?f=pjson`, OPTIONS),
        fetchJson(`${layer}/query?f=json&where=1%3D1&returnCountOnly=true`, OPTIONS),
        fetchJson(`${layer}/query?f=json&where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=3`, OPTIONS),
      ]);
      return { id: entry.id, name: metadata.name, type: metadata.type,
        geometry_type: metadata.geometryType, object_id_field: metadata.objectIdField,
        max_record_count: metadata.maxRecordCount, count: count.count,
        editing_info: metadata.editingInfo, fields: metadata.fields?.map((field) => ({
          name: field.name, alias: field.alias, type: field.type,
        })), samples: sample.features?.map((feature) => feature.attributes),
        extent: metadata.extent, error: metadata.error ?? count.error ?? sample.error ?? null };
    }));
    return { name, service_description: service.serviceDescription,
      layers: details, error: service.error ?? null };
  } catch (error) {
    return { name, error: error.message };
  }
}

export default {
  async fetch(request) {
    if (process.env.VERCEL_ENV !== "preview" || request.method !== "GET")
      return new Response("Not found", { status: 404 });
    return Response.json({ results: await Promise.all(NAMES.map(inspect)) },
      { headers: { "Cache-Control": "private, no-store" } });
  },
};
