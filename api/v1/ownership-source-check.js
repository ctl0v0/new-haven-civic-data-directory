import { loadParcel } from "../../parcel/resolve.js";
import { getSourceRecords } from "../../parcel/adapters.js";
import { fetchJson } from "../../parcel/http.js";

export default {
  async fetch(request) {
    if (process.env.VERCEL_ENV !== "preview" || request.method !== "GET")
      return new Response("Not found", { status: 404 });
    const parcel = await loadParcel(10386);
    const exact = await fetchJson(`https://data.ct.gov/resource/n7gp-d28j.json?${new URLSearchParams({
      $where: "name = '990 STATE STREET ASSOCIATES, LLC'",
      $limit: "2",
    })}`, { timeout: 16000 }).then((rows) => ({ count: rows.length, names: rows.map((row) => row.name) }))
      .catch((error) => ({ error: error.message }));
    const sources = await Promise.all(
      ["business-master", "business-principals", "business-agents"]
        .map((sourceId) => getSourceRecords(sourceId, parcel)),
    );
    return Response.json({ exact, sources: sources.map((source) => ({
      source_id: source.source_id,
      status: source.status,
      warning: source.warning,
      count: source.items.length,
      match_method: source.items[0]?.match.method ?? null,
      legal_name: source.source_id === "business-master"
        ? source.items[0]?.attributes.legal_name ?? null : null,
    })) }, { headers: { "Cache-Control": "private, no-store" } });
  },
};
