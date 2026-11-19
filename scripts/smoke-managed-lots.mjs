import { randomBytes } from "node:crypto";
import { indexQuery } from "../search-index/db.js";
import { getSearchCoverage } from "../search-index/coverage.js";
import { searchIndexedRecords } from "../search-index/search.js";
import { getIndexedRecord } from "../search-index/record.js";

const writer = process.env.SEARCH_DATABASE_WRITE_URL;
const password = process.env.SEARCH_DATABASE_READER_PASSWORD;
const role = process.env.SEARCH_DATABASE_READER_ROLE ?? "search_index_reader";
if (!writer || !password || !/^[a-z][a-z0-9_]*$/.test(role))
  throw new Error("Writer URL, reader password and valid reader role are required");
const reader = new URL(writer);
reader.username = role;
reader.password = password;
process.env.SEARCH_DATABASE_URL = reader.toString();
process.env.PILOT_COOKIE_SECRET ??= randomBytes(32).toString("hex");
const [identity] = await indexQuery(`SELECT current_user AS role,
  has_table_privilege(current_user, 'search_records', 'SELECT') AS can_read,
  has_table_privilege(current_user, 'search_records', 'INSERT') AS can_insert`);
if (identity?.role !== role || !identity.can_read || identity.can_insert)
  throw new Error("Managed-lot smoke check requires the restricted read-only role");

const coverage = await getSearchCoverage();
const source = coverage.sources?.find((item) => item.source_id === "managed-lots");
if (coverage.index_status !== "connected" || !source?.indexed ||
    Number(source.source_count) !== Number(source.returned_count) ||
    Number(source.linked_count) < 1 || Number(source.ambiguous_count) !== 0)
  throw new Error("Official managed-lot import is absent or its inventory is inconsistent");
const page = await searchIndexedRecords({ source_id: "managed-lots", limit: 5 });
if (page.coverage.index_status === "unavailable" || page.items.length !== 5 ||
    page.items.some((item) => item.source_id !== "managed-lots" ||
      !item.source_url?.startsWith("https://gis.newhavenct.gov/") ||
      !item.fields?.mbp || !item.match_methods?.includes("published-parcel-key-exact")))
  throw new Error("Read-only managed-lot record search did not return exact official links");
if (Number(source.unlinked_count) > 0 && page.complete_for_query)
  throw new Error("Unlinked managed-lot source rows were hidden from search coverage");
const first = page.items[0];
const detail = await getIndexedRecord({ source_id: "managed-lots",
  record_id: first.record_id });
if (!detail.found || detail.record?.fields?.mbp !== first.fields.mbp ||
    !detail.parcel_links?.some((link) => link.join_status === "exact" &&
      Number(link.city_parcel_id) === Number(first.city_parcel_id)))
  throw new Error("Indexed managed-lot detail disagrees with the search result");
console.log(JSON.stringify({ event: "managed_lot_readonly_smoke",
  reader_role_verified: true, source_count: Number(source.source_count),
  returned_count: Number(source.returned_count),
  linked_count: Number(source.linked_count),
  unlinked_count: Number(source.unlinked_count),
  ambiguous_count: Number(source.ambiguous_count),
  result_page_count: page.items.length,
  complete_for_query: page.complete_for_query,
  sample_record_id: first.record_id,
  sample_city_parcel_id: first.city_parcel_id }));
