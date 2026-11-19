import { indexQuery } from "../search-index/db.js";
import { fetchJson } from "../parcel/http.js";

const writer = process.env.SEARCH_DATABASE_WRITE_URL;
const password = process.env.SEARCH_DATABASE_READER_PASSWORD;
const role = process.env.SEARCH_DATABASE_READER_ROLE ?? "search_index_reader";
if (!writer || !password || !/^[a-z][a-z0-9_]*$/.test(role))
  throw new Error("Index writer, read-only password and role are required");
const reader = new URL(writer);
reader.username = role;
reader.password = password;
process.env.SEARCH_DATABASE_URL = reader.toString();
const [identity] = await indexQuery(`SELECT current_user AS role,
  has_table_privilege(current_user, 'search_records', 'SELECT') AS can_read,
  has_table_privilege(current_user, 'search_records', 'INSERT') AS can_insert`);
if (identity?.role !== role || !identity.can_read || identity.can_insert)
  throw new Error("Parent-key audit requires the read-only index role");

const [permitRun] = await indexQuery(`SELECT run_id FROM search_active_runs
  WHERE source_id = 'municity' AND scope_key = 'permit-group:ELECTRICAL'`);
const [cityRun] = await indexQuery(`SELECT run_id FROM search_active_runs
  WHERE source_id = 'parcels' AND scope_key = 'all'`);
if (!permitRun || !cityRun) throw new Error("Validated permit and City parcel runs are required");
const unlinked = await indexQuery(`SELECT r.record_id, r.fields->>'Parcel_ID' AS vendor_parcel_id,
    r.fields->>'PrintKey' AS print_key, r.fields->>'LegalAddress' AS legal_address
  FROM search_records r WHERE r.run_id = $1 AND r.source_id = 'municity'
    AND NOT EXISTS (SELECT 1 FROM search_record_parcels j
      WHERE j.run_id = r.run_id AND j.source_id = r.source_id
        AND j.record_id = r.record_id)
  ORDER BY r.record_id LIMIT 20`, [permitRun.run_id]);

const evidence = [];
for (const permit of unlinked) {
  const url = new URL("https://services5.municity5.com/M5Services/M5Service.svc/GetM5Data");
  for (const [key, value] of Object.entries({ Customer: "NewHavenCityCT",
    entity: "Parcel", entity_id: "", fieldtype: "text", mapid: "", mapobject: "",
    module: "", numrecs: "5", operator: "=", pid: "", searchfield: "Parcel_ID",
    section: "", value: String(permit.vendor_parcel_id ?? "") }))
    url.searchParams.set(key, value);
  let published = null;
  let sourceError = null;
  if (/^\d{1,12}$/.test(String(permit.vendor_parcel_id ?? ""))) {
    try {
      const data = await fetchJson(url, { headers: { SourceId: "2" },
        timeout: 15000, maxBytes: 10_000_000 });
      if (Number(data.total) === 1 && Array.isArray(data.rows) &&
          String(data.rows[0]?.Parcel_ID) === String(permit.vendor_parcel_id)) {
        published = Object.fromEntries(Object.entries(data.rows[0])
          .filter(([key]) => /parcel|parent|print.?key|mblu|map|block|lot|unit|address|account/i.test(key)));
      } else sourceError = "Municipal Parcel_ID search did not return one matching row";
    } catch (error) { sourceError = String(error?.message ?? error).slice(0, 150); }
  }
  // Similar keys and addresses are diagnostic only. No candidate is stored as
  // a permit-to-parcel join unless the publisher supplies an explicit key.
  const keyPrefix = permit.print_key?.slice(0, -2) ?? "";
  const candidates = keyPrefix ? await indexQuery(`SELECT source_url,
      fields->>'parcel_id' AS city_parcel_id,
      fields->>'mblu' AS city_mblu,
      fields->>'property_address' AS city_address
    FROM search_records WHERE run_id = $1 AND source_id = 'parcels'
      AND fields->>'mblu' LIKE $2 ORDER BY record_id LIMIT 20`,
  [cityRun.run_id, `${keyPrefix}%`]) : [];
  evidence.push({ permit_id: permit.record_id, vendor_parcel_id: permit.vendor_parcel_id,
    permit_print_key: permit.print_key, permit_legal_address: permit.legal_address,
    municipal_parcel_source_url: url.toString(), municipal_parcel_fields: published,
    municipal_parcel_error: sourceError, city_key_prefix_candidates_not_joined: candidates });
}
console.log(JSON.stringify({ event: "recent_electrical_parent_key_audit",
  reader_role_verified: true, permit_run_id: Number(permitRun.run_id),
  city_run_id: Number(cityRun.run_id), unlinked_checked: unlinked.length, evidence }));
