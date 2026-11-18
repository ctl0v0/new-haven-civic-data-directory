import { LAYERS } from "../../parcel/config.js";
import { arcgis, fetchJson } from "../../parcel/http.js";

export default {
  async fetch(request) {
    if (process.env.VERCEL_ENV !== "preview" || request.method !== "GET")
      return new Response("Not found", { status: 404 });
    const mode = new URL(request.url).searchParams.get("mode");
    if (mode === "schema") {
      const data = await fetchJson(`${LAYERS.parcels}?f=json`, { timeout: 12000, maxBytes: 5_000_000 });
      return Response.json({
        layer_id: data.id, name: data.name, object_id_field: data.objectIdField,
        geometry_type: data.geometryType, editing_info: data.editingInfo ?? null,
        fields: data.fields?.map(({ name, alias, type, nullable, length }) =>
          ({ name, alias, type, nullable, length })) ?? [],
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const where = mode === "second-owner"
      ? "owner_name_2 IS NOT NULL AND owner_name_2 <> ''"
      : "parcel_id IN (11236,10386,13791,24641)";
    if (mode !== "samples" && mode !== "second-owner")
      return new Response("Not found", { status: 404 });
    const data = await arcgis(LAYERS.parcels, {
      where, outFields: "*", returnGeometry: "false",
      resultRecordCount: mode === "samples" ? "20" : "5",
    });
    return Response.json({ where, exceeded_transfer_limit: Boolean(data.exceededTransferLimit),
      features: data.features?.map((feature) => feature.attributes) ?? [] },
    { headers: { "Cache-Control": "private, no-store" } });
  },
};
