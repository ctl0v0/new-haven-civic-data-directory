import { resolveParcel, loadParcel } from "../../parcel/resolve.js";
import { getSourceRecords } from "../../parcel/adapters.js";

export default {
  async fetch(request) {
    if (process.env.VERCEL_ENV !== "preview" || request.method !== "GET")
      return new Response("Not found", { status: 404 });
    try {
      const found = await resolveParcel("20 Eld St");
      const candidate = found.candidates?.[0];
      if (!candidate) return Response.json({ found });
      const parcel = await loadParcel(candidate.parcel_id, candidate.objectid);
      const [addresses, trash] = await Promise.all([
        getSourceRecords("addresses", parcel),
        getSourceRecords("trash-pickup", parcel),
      ]);
      return Response.json({
        found,
        addresses: addresses.items.map((item) => ({
          source_record_id: item.source_record_id,
          attributes: item.attributes,
        })),
        trash: {
          status: trash.status,
          warning: trash.warning,
          items: trash.items.map((item) => ({
            source_record_id: item.source_record_id,
            attributes: item.attributes,
            match: item.match,
          })),
        },
      }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  },
};
