import { loadParcel } from "../../parcel/resolve.js";
import { getSourceRecords } from "../../parcel/adapters.js";
import { LAYERS } from "../../parcel/config.js";
import { fetchJson } from "../../parcel/http.js";

export default {
  async fetch(request) {
    if (process.env.VERCEL_ENV !== "preview" || request.method !== "GET")
      return new Response("Not found", { status: 404 });
    try {
      const parcel = await loadParcel(11236, 979);
      const [wards, alders, metadata] = await Promise.all([
        getSourceRecords("wards", parcel),
        getSourceRecords("alders", parcel),
        fetchJson(`${LAYERS.wards}?f=pjson`, { timeout: 8000 }),
      ]);
      return Response.json({
        wards: { status: wards.status, warning: wards.warning, items: wards.items.map(({ attributes }) => attributes) },
        alders: { status: alders.status, warning: alders.warning, items: alders.items.map(({ attributes, source_url, match }) => ({ attributes, source_url, match })) },
        ward_field_names: metadata.fields?.map(({ name }) => name),
      }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  },
};
