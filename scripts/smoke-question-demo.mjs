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
console.log(JSON.stringify({ event: "question_demo_source_smoke",
  reader_role_verified: true, date_window: window, group,
  source_checks: result.coverage.source_checks,
  complete_for_query: result.complete_for_query,
  first_page_count: result.items.length, has_more: Boolean(result.next_cursor),
  examples, indexed_record_verified: Boolean(inspected?.found) }));
