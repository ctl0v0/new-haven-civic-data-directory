import { loadParcel } from "../../parcel/resolve.js";
import { getSourceRecords } from "../../parcel/adapters.js";
import { fetchJson } from "../../parcel/http.js";

const datasets = {
  master: "n7gp-d28j",
  principals: "ka36-64k6",
  agents: "qh2m-n44y",
};
const checked = async (promise) => {
  try { return { ok: true, value: await promise }; }
  catch (error) { return { ok: false, error: error.message }; }
};

export default {
  async fetch(request) {
    if (process.env.VERCEL_ENV !== "preview" || request.method !== "GET")
      return new Response("Not found", { status: 404 });
    const parcel = await loadParcel(11236, 979);
    const assessor = await getSourceRecords("assessor", parcel);
    const fields = assessor.items[0]?.attributes ?? {};
    const owner = fields.lblOwner ?? null;
    const metadata = Object.fromEntries(await Promise.all(Object.entries(datasets).map(async ([key, id]) => {
      const result = await checked(fetchJson(`https://data.ct.gov/api/views/${id}.json`, { timeout: 10000 }));
      return [key, result.ok ? { columns: result.value.columns?.map((column) => column.fieldName) } : result];
    })));
    const query = new URLSearchParams({
      $where: `upper(name) = '${String(owner ?? "").toUpperCase().replaceAll("'", "''")}'`,
      $limit: "11",
    });
    const matches = await checked(fetchJson(`https://data.ct.gov/resource/${datasets.master}.json?${query}`, { timeout: 10000 }));
    return Response.json({
      parcel_id: 11236,
      assessor_owner: owner,
      assessor_address_fields: Object.fromEntries(Object.entries(fields).filter(([key]) => /address|city|state|zip|mail/i.test(key))),
      metadata,
      master_match: matches.ok ? matches.value.map(({ id, name, accountnumber, business_type, status, billingstreet, billingcity, billingpostalcode }) =>
        ({ id, name, accountnumber, business_type, status, billingstreet, billingcity, billingpostalcode })) : matches,
    }, { headers: { "Cache-Control": "private, no-store" } });
  },
};
