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
    const parcelId = new URL(request.url).searchParams.get("sample") === "10386" ? 10386 : 11236;
    const parcel = await loadParcel(parcelId, parcelId === 11236 ? 979 : null);
    const assessor = await getSourceRecords("assessor", parcel);
    const fields = assessor.items[0]?.attributes ?? {};
    const owner = fields.lblOwner ?? "CLAY ST LLC";
    const query = new URLSearchParams({
      $select: "id,name,accountnumber,business_type,status,billingstreet,billingcity,billingpostalcode",
      $where: `name = '${owner.replaceAll("'", "''")}'`,
      $limit: "6",
    });
    const matches = await checked(fetchJson(`https://data.ct.gov/resource/${datasets.master}.json?${query}`, { timeout: 16000 }));
    const id = matches.ok && matches.value.length === 1 ? matches.value[0].id : null;
    const related = id ? await Promise.all([datasets.principals, datasets.agents].map(async (dataset, index) => {
      const where = `${index === 0 ? "business_id" : "business_key"} = '${id.replaceAll("'", "''")}'`;
      return checked(fetchJson(`https://data.ct.gov/resource/${dataset}.json?${new URLSearchParams({ $where: where, $limit: "11" })}`, { timeout: 12000 }));
    })) : null;
    return Response.json({
      parcel_id: parcelId,
      assessor_status: assessor.status,
      assessor_warning: assessor.warning,
      assessor_owner: fields.lblOwner ?? null,
      assessor_address_fields: Object.fromEntries(Object.entries(fields).filter(([key]) => /address|city|state|zip|mail/i.test(key))),
      city_owner_fields: Object.fromEntries(Object.entries(parcel.attributes).filter(([key]) => /owner|mail/i.test(key))),
      state_name_query: owner,
      master_match: matches.ok ? matches.value.map(({ id, name, accountnumber, business_type, status, billingstreet, billingcity, billingpostalcode }) =>
        ({ id, name, accountnumber, business_type, status, billingstreet, billingcity, billingpostalcode })) : matches,
      principals: related?.[0]?.ok ? related[0].value.map(({ business_id, name__c, designation, business_street_address_1, business_city, business_state }) =>
        ({ business_id, name__c, designation, business_street_address_1, business_city, business_state })) : related?.[0] ?? null,
      agents: related?.[1]?.ok ? related[1].value.map(({ business_key, name__c, type, agent_phone, email, business_address }) =>
        ({ business_key, name__c, type, agent_phone, email, business_address })) : related?.[1] ?? null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  },
};
