import { randomBytes } from "node:crypto";
import { indexQuery } from "../search-index/db.js";
import { getSearchCoverage } from "../search-index/coverage.js";
import { getIndexedRecord } from "../search-index/record.js";
import { searchIndexedParcels } from "../search-index/search.js";
import { recentCalendarDates } from "../search-index/ask.js";

const writer = process.env.SEARCH_DATABASE_WRITE_URL;
const password = process.env.SEARCH_DATABASE_READER_PASSWORD;
const role = process.env.SEARCH_DATABASE_READER_ROLE ?? "search_index_reader";
if (!writer || !password || !/^[a-z][a-z0-9_]*$/.test(role))
  throw new Error("Index writer, read-only password and role are required");
const reader = new URL(writer);
reader.username = role;
reader.password = password;
process.env.SEARCH_DATABASE_URL = reader.toString();
process.env.PILOT_COOKIE_SECRET ??= randomBytes(32).toString("hex");

const [identity] = await indexQuery(`SELECT current_user AS role,
  has_table_privilege(current_user, 'search_records', 'SELECT') AS can_read,
  has_table_privilege(current_user, 'search_records', 'INSERT') AS can_insert`);
if (identity?.role !== role || !identity.can_read || identity.can_insert)
  throw new Error("Question demo must use the read-only index role");

const window = recentCalendarDates(30);
const coverage = await getSearchCoverage();
const group = coverage.municipal_permit_groups?.find((item) =>
  item.permit_group === "Electrical");
if (!group?.indexed) throw new Error("Official Electrical group run is absent");
const result = await searchIndexedParcels({ requirements: [{ source_id: "municity",
  permit_group: "Electrical", event_date_from: window.from,
  event_date_to: window.to }], limit: 5 });
const examples = result.items.map((item) => {
  const source = item.matching_sources?.find((match) => match.source_id === "municity");
  return { city_parcel_id: item.city_parcel_id,
    city_objectid: item.city_objectid, city_address: item.city_address,
    permit_count: source?.matching_record_count,
    source_record_id: source?.example_record?.record_id,
    source_url: source?.example_record?.source_url,
    permit_type: source?.example_record?.published_type,
    permit_date: source?.example_record?.event_date };
});
const first = examples.find((item) => item.source_record_id);
const inspected = first ? await getIndexedRecord({ source_id: "municity",
  permit_group: "Electrical", record_id: first.source_record_id }) : null;
if (first && (!inspected?.found || !inspected.parcel_links.some((link) =>
    Number(link.city_parcel_id) === Number(first.city_parcel_id))))
  throw new Error("A grouped Electrical permit failed indexed record inspection");
const unlinked = await indexQuery(`SELECT r.record_id, r.source_url,
    r.fields->>'PermitNo' AS permit_number,
    r.fields->>'PermitType' AS permit_type,
    r.fields->>'Parcel_ID' AS vendor_parcel_id,
    r.fields->>'PrintKey' AS print_key,
    r.fields->>'PrintKey_Parcel' AS parent_print_key,
    r.fields->>'VerifiedParentPrintKey' AS verified_parent_print_key,
    r.fields->>'LegalAddress' AS legal_address
  FROM search_records r WHERE r.run_id = $1 AND r.source_id = 'municity'
    AND NOT EXISTS (SELECT 1 FROM search_record_parcels j
      WHERE j.run_id = r.run_id AND j.source_id = r.source_id
        AND j.record_id = r.record_id)
  ORDER BY r.record_id`, [group.run_id]);
if (unlinked.length !== group.unlinked_count)
  throw new Error("Grouped Electrical unlinked evidence disagrees with source coverage");
const [parcelRun] = await indexQuery(`SELECT run_id FROM search_active_runs
  WHERE source_id = 'parcels' AND scope_key = 'all'`);
const unlinkedCandidates = [];
for (const permit of unlinked) {
  const byAddress = await indexQuery(`SELECT record_id, source_url,
      fields->>'parcel_id' AS city_parcel_id,
      fields->>'objectid' AS city_objectid,
      fields->>'mblu' AS city_mblu,
      fields->>'property_address' AS city_address
    FROM search_records WHERE run_id = $1 AND source_id = 'parcels'
      AND upper(trim(fields->>'property_address')) = upper(trim($2))
    ORDER BY record_id LIMIT 10`, [parcelRun.run_id, permit.legal_address]);
  const byVendorId = await indexQuery(`SELECT record_id, source_url,
      fields->>'parcel_id' AS city_parcel_id,
      fields->>'objectid' AS city_objectid,
      fields->>'mblu' AS city_mblu,
      fields->>'property_address' AS city_address
    FROM search_records WHERE run_id = $1 AND source_id = 'parcels'
      AND fields->>'parcel_id' = $2 ORDER BY record_id LIMIT 10`,
  [parcelRun.run_id, permit.vendor_parcel_id]);
  unlinkedCandidates.push({ record_id: permit.record_id, address_candidates_only: byAddress,
    vendor_id_candidates_only: byVendorId });
}
console.log(JSON.stringify({ event: "question_demo_source_smoke",
  reader_role_verified: true, date_window: window, group,
  source_checks: result.coverage.source_checks,
  complete_for_query: result.complete_for_query,
  first_page_count: result.items.length, has_more: Boolean(result.next_cursor),
  examples, unlinked_evidence: unlinked, unlinked_candidates_not_joined: unlinkedCandidates,
  indexed_record_verified: Boolean(inspected?.found) }));
