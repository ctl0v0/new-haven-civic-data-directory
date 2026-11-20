import { randomBytes } from "node:crypto";
import { indexQuery } from "../search-index/db.js";
import { getSearchCoverage } from "../search-index/coverage.js";
import { getIndexedRecord } from "../search-index/record.js";
import { searchIndexedParcels } from "../search-index/search.js";
import { recentCalendarDates } from "../search-index/ask.js";
import { checkRecentPermitWindows } from "./smoke-recent-permits.mjs";

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

process.env.PILOT_API_TOKEN ??= randomBytes(32).toString("hex");
process.env.PILOT_PASSPHRASE ??= randomBytes(32).toString("hex");
const { default: mcp } = await import("../api/mcp.js");
async function callMcp(name, args) {
  const response = await mcp.fetch(new Request("https://example.com/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.PILOT_API_TOKEN}`,
      "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name, arguments: args } }),
  }));
  const text = await response.text();
  const payload = JSON.parse(text.startsWith("event:") ? text.match(/^data: (.+)$/m)?.[1] : text);
  const result = payload.result?.structuredContent;
  if (!response.ok || !result) throw new Error(`The ${name} MCP query failed`);
  return result;
}
const recent = await checkRecentPermitWindows({ search: (args) => callMcp("search_indexed_permits", args) });
for (const item of recent.windows)
  console.log(JSON.stringify({ event: "recent_permits_mcp_smoke", ...item }));

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
const [retention] = await indexQuery(`SELECT count(*)::int AS rows_without_verified_parcels
  FROM search_active_runs a JOIN search_records r ON r.run_id = a.run_id
  WHERE a.source_id = 'municity' AND r.source_id = 'municity'
    AND NOT EXISTS (SELECT 1 FROM search_record_parcels j
      WHERE j.run_id = r.run_id AND j.source_id = r.source_id
        AND j.record_id = r.record_id AND j.join_status = 'exact')`);
if (retention.rows_without_verified_parcels !== 0)
  throw new Error("Active permit index includes records without a verified City parcel");
const reviewedParents = await indexQuery(`SELECT j.city_parcel_id, count(*)::int AS permits
  FROM search_active_runs a JOIN search_record_parcels j ON j.run_id = a.run_id
  WHERE a.source_id = 'municity' AND a.scope_key = 'permit-window:90'
    AND j.match_method = 'municipal-explicit-subparcel-parent'
  GROUP BY j.city_parcel_id ORDER BY j.city_parcel_id`);
console.log(JSON.stringify({ event: "parcel_permit_retention_smoke", ...retention,
  verified_subparcel_parents: reviewedParents }));
console.log(JSON.stringify({ event: "question_demo_source_smoke",
  reader_role_verified: true, date_window: window, group,
  source_checks: result.coverage.source_checks,
  complete_for_query: result.complete_for_query,
  first_page_count: result.items.length, has_more: Boolean(result.next_cursor),
  examples,
  indexed_record_verified: Boolean(inspected?.found) }));

const license = await callMcp("ask_indexed_parcels", {
  question: "Show me new business licenses in East Rock neighborhood in the last 30 days",
});
const licenseRows = license.search_result?.items ?? [];
if (license.interpretation?.date_field !== "IssueDate" ||
    licenseRows.some((row) => !row.city_parcel_id || !row.fields?.IssueDate || !row.fields?.BusinessName))
  throw new Error("Business license results did not preserve the published dates and parcel joins");
console.log(JSON.stringify({ event: "municipal_business_license_mcp_smoke",
  status: license.status, count: licenseRows.length, criteria: license.criteria,
  sources: license.search_result?.coverage?.source_checks }));
for (const source_id of ["ct-liquor-permits", "ct-child-care-licenses"]) {
  const answer = await callMcp("search_indexed_records", { source_id, neighborhood: "East Rock",
    event_date_from: window.from, event_date_to: window.to, limit: 5 });
  console.log(JSON.stringify({ event: "state_license_mcp_smoke", source_id,
    count: answer.items.length, complete_for_query: answer.complete_for_query,
    sources: answer.coverage.source_checks }));
}
for (const permit_type of ["Water Heater", "Hood - C"]) {
  for (const activity_kind of ["application", "review", "inspection"]) {
    const activity = await callMcp("search_indexed_permit_activity", { permit_type, activity_kind, limit: 5 });
    if (activity.items.some((row) => !row.city_parcel_id || row.fields?.activity_kind !== activity_kind))
      throw new Error("MCP permit activity included an invalid row or parcel join");
    console.log(JSON.stringify({ event: "permit_activity_mcp_smoke", permit_type, activity_kind,
      count: activity.items.length, coverage: activity.coverage }));
  }
}
