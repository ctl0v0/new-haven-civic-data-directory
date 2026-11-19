import { cached, fetchJson, SourceError } from "./http.js";

const SOURCE_URL = "https://services5.municity5.com/M5Services/M5Service.svc/Customer/NewHavenCityCT/PermitTypes";

export async function municipalPermitTypes() {
  return cached("municipal-permit-types:v1", async () => {
    const rows = await fetchJson(SOURCE_URL, {
      headers: { SourceId: "2" }, timeout: 15000, maxBytes: 2_000_000,
    });
    if (!Array.isArray(rows) || !rows.length)
      throw new SourceError("Municipal permit type catalog did not return a row list");

    const groups = new Map();
    let omittedRows = 0;
    const names = new Set();
    for (const row of rows) {
      const name = typeof row?.MainCode === "string" ? row.MainCode.trim() : "";
      if (!name) {
        omittedRows++;
        continue;
      }
      const groupName = typeof row.TypeGroup === "string" ? row.TypeGroup.trim() || null : null;
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName).push({
        permit_type_id: row.PermitType_ID ?? null,
        name,
        deleted_as_published: row.Deleted ?? null,
      });
      names.add(name);
    }
    if (!names.size) throw new SourceError("Municipal permit type catalog has no named types");
    return {
      source_url: SOURCE_URL,
      retrieved_at: new Date().toISOString(),
      scope: "Municipal permit type catalog entries returned by the official source; this is not a count of issued or observed permits.",
      catalog_rows_returned: rows.length,
      omitted_unnamed_rows: omittedRows,
      partial: omittedRows > 0,
      distinct_type_names: names.size,
      group_count: groups.size,
      groups: [...groups].map(([name, types]) => ({
        name,
        count: types.length,
        types: types.sort((a, b) => a.name.localeCompare(b.name)),
      })).sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""))),
    };
  });
}
