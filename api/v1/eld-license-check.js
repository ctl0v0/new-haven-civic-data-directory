import { resolveParcel, loadParcel } from "../../parcel/resolve.js";
import { getSourceRecords } from "../../parcel/adapters.js";
import { fetchJson } from "../../parcel/http.js";

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
    const stateChecks = await Promise.all([
      ["registry_name", "n7gp-d28j", "upper(name) like '%ALL DAY BAR%'"],
      ["registry_address", "n7gp-d28j", "upper(billingstreet) like '20%ELD%' AND upper(billingcity) = 'NEW HAVEN'"],
      ["credential_address", "ngch-56tr", "upper(address) like '20%ELD%' AND upper(city) = 'NEW HAVEN'"],
    ].map(async ([key, dataset, where]) => {
      const rows = await fetchJson(`https://data.ct.gov/resource/${dataset}.json?${new URLSearchParams({ $where: where, $limit: "100" })}`, { timeout: 12000 }).catch((error) => ({ error: error.message }));
      return [key, Array.isArray(rows) ? rows.map((row) => ({
        name: row.name ?? row.businessname ?? row.credentialname ?? null,
        address: row.billingstreet ?? row.address ?? null,
        city: row.billingcity ?? row.city ?? null,
        status: row.status ?? row.credentialstatus ?? null,
        id: row.id ?? row.credentialid ?? null,
        name_fields: Object.fromEntries(Object.entries(row).filter(([field]) => /name|license|credential|trade|dba/i.test(field))),
      })) : rows];
    }));
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
          source_fields: Object.keys(item.attributes ?? {}),
          name_and_license_fields: Object.fromEntries(Object.entries(item.attributes ?? {})
            .filter(([key, value]) => /name|business|trade|dba|applicant|license|company|entity|description|owner/i.test(key)
              && ["string", "number", "boolean"].includes(typeof value))
            .map(([key, value]) => [key, String(value).slice(0, 180)])),
        })),
      other_municipal_rows: municipal.items
        .filter((item) => ["Contact", "Document", "Permit"].includes(item.category))
        .map((item) => ({
          category: item.category,
          id: item.source_record_id,
          fields: Object.fromEntries(Object.entries(item.attributes ?? {})
            .filter(([key, value]) => /name|business|trade|dba|applicant|license|company|entity|description|owner|type|role/i.test(key)
              && typeof value === "string")
            .map(([key, value]) => [key, value.slice(0, 180)])),
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
      state_checks: Object.fromEntries(stateChecks),
    }, { headers: { "Cache-Control": "private, no-store" } });
  },
};
