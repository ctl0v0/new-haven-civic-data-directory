import { resolveParcel, loadParcel } from "../../parcel/resolve.js";
import { getSourceRecords } from "../../parcel/adapters.js";

export default {
  async fetch(request) {
    if (process.env.VERCEL_ENV !== "preview" || request.method !== "GET")
      return new Response("Not found", { status: 404 });
    const [resolved, parcel] = await Promise.all([
      resolveParcel("20 Eld St"),
      loadParcel(11236, 979),
    ]);
    const [municipal, licenses, occupants] = await Promise.all([
      getSourceRecords("municity", parcel),
      getSourceRecords("municipal-business-licenses", parcel),
      getSourceRecords("municipal-occupants", parcel),
    ]);
    return Response.json({
      resolver: {
        status: resolved.status,
        candidates: resolved.candidates?.map(({ parcel_id, objectid, address, match }) =>
          ({ parcel_id, objectid, address, match_method: match?.method })),
      },
      parcel: {
        parcel_id: parcel.attributes.parcel_id,
        objectid: parcel.attributes.objectid,
        address: parcel.attributes.property_address,
        mblu: parcel.attributes.mblu,
      },
      municipal: {
        status: municipal.status,
        warning: municipal.warning,
        category_counts: municipal.category_counts,
        missing_categories: municipal.missing_categories,
        truncated_categories: municipal.truncated_categories,
      },
      raw_license_rows: municipal.items.filter((item) => item.category === "License")
        .slice(0, 40).map((item) => ({
          id: item.source_record_id,
          business_name: item.attributes?.BusinessName ?? null,
          name: item.attributes?.Name ?? null,
          status: item.attributes?.Status ?? null,
          expiration_date: item.attributes?.ExpirationDate ?? null,
          address: item.attributes?.LegalAddress ?? item.attributes?.Addr1 ?? null,
        })),
      named_licenses: {
        status: licenses.status,
        warning: licenses.warning,
        items: licenses.items.slice(0, 40).map((item) => item.attributes),
      },
      occupants: {
        status: occupants.status,
        warning: occupants.warning,
        items: occupants.items.slice(0, 40).map((item) => item.attributes),
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  },
};
