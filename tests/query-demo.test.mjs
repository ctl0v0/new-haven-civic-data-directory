import test from "node:test";
import assert from "node:assert/strict";
import { askIndexedParcels, interpretBaselineQuestion, questionPermitCatalog, recentCalendarDates } from "../search-index/ask.js";
import { queryWorkbenchVisible } from "../api/pilot-page.js";
import { getDataContext, commercialUseCodes } from "../parcel/data-context.js";
import { municipalDateSearchFormat, municipalPermitDateRows } from "../search-index/municity.js";
import { buildIndexedSearchQuery, searchIndexedParcels } from "../search-index/search.js";
import { auditCityUseCodes } from "../search-index/use-codes.js";
import contextRoute from "../api/v1/data-context.js";
import mcpRoute from "../api/mcp.js";

const oldToken = process.env.PILOT_API_TOKEN;
const oldPassphrase = process.env.PILOT_PASSPHRASE;
const oldCookie = process.env.PILOT_COOKIE_SECRET;
const oldDatabase = process.env.SEARCH_DATABASE_URL;
process.env.PILOT_API_TOKEN = "query-demo-test-token-123456789";
process.env.PILOT_PASSPHRASE = "query-demo-test-passphrase-123456789";
process.env.PILOT_COOKIE_SECRET = "query-demo-test-cookie-123456789";
test.after(() => {
  if (oldToken == null) delete process.env.PILOT_API_TOKEN;
  else process.env.PILOT_API_TOKEN = oldToken;
  if (oldPassphrase == null) delete process.env.PILOT_PASSPHRASE;
  else process.env.PILOT_PASSPHRASE = oldPassphrase;
  if (oldCookie == null) delete process.env.PILOT_COOKIE_SECRET;
  else process.env.PILOT_COOKIE_SECRET = oldCookie;
  if (oldDatabase == null) delete process.env.SEARCH_DATABASE_URL;
  else process.env.SEARCH_DATABASE_URL = oldDatabase;
});

const catalog = async () => ({ partial: false, groups: [
  { name: "Electrical", types: [
    { name: "Electrical Permit" }, { name: "Electrical Wiring (NEW)" }] },
  { name: "Mechanical", types: [{ name: "Hood - C" }] },
] });
const interpreted = { intent: "search", commercial: false,
  permit_type: "Electrical Permit", permit_group: null, permit_status: null,
  permit_days: 30, neighborhood: null, clarification: null };

test("private query workbench appears on the pilot Preview branch only", () => {
  assert.equal(queryWorkbenchVisible({ VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "codex/parcel-pilot" }), true);
  assert.equal(queryWorkbenchVisible({ VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "main" }), false);
  assert.equal(queryWorkbenchVisible({ VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "codex/parcel-pilot", QUERY_DEMO_ENABLED: "true" }), false);
});

test("baseline spoken questions keep every supported filter and reject extra terms", () => {
  assert.deepEqual(interpretBaselineQuestion(
    "Show commercial parcels with electrical permits pulled in the past 30 days"),
  { intent: "search", commercial: true, permit_type: null,
    permit_group: "Electrical", permit_status: null, permit_days: 30,
    neighborhood: null, clarification: null });
  assert.equal(interpretBaselineQuestion(
    "Show me all the parcels, commercial parcels that have had electrical permits pulled in past 30 days")?.commercial, true);
  assert.equal(interpretBaselineQuestion(
    "Show parcels with electrical permits issued in the past 30 days"), null);
});

test("question tester reads a fresh complete official type catalog from the index", async () => {
  let liveCalled = false;
  const catalog = await questionPermitCatalog({ configured: () => true,
    now: new Date("2026-11-19T15:00:00Z"),
    query: async (sql) => sql.includes("FROM search_active_runs")
      ? [{ id: 42, status: "complete", expected_count: 2, returned_count: 2,
        finished_at: "2026-11-19T14:00:00Z" }]
      : [{ record_id: "Electrical Permit", group_name: "Electrical" },
        { record_id: "Electrical Wiring (NEW)", group_name: "Electrical" }],
    live: async () => { liveCalled = true; return {}; } });
  assert.equal(liveCalled, false);
  assert.deepEqual(catalog.groups[0].types.map((type) => type.name),
    ["Electrical Permit", "Electrical Wiring (NEW)"]);
});

test("relative PermitDate uses New Haven calendar dates, including today", () => {
  assert.deepEqual(recentCalendarDates(30, new Date("2026-11-19T15:00:00Z")), {
    from: "2026-10-21", to: "2026-11-19",
    meaning: "30 New Haven calendar dates including today",
  });
  assert.equal(recentCalendarDates(1, new Date("2026-11-19T01:00:00Z")).to,
    "2026-11-18");
});

test("question path uses an exact published permit type and date without assuming Issued", async () => {
  let criteria;
  const answer = await askIndexedParcels({ question: "permit type Electrical Permit in the past 30 days" }, {
    catalog, interpret: async () => interpreted,
    now: new Date("2026-11-19T15:00:00Z"),
    search: async (input) => {
      criteria = input;
      return { items: [{ city_parcel_id: 12 }], next_cursor: null,
        complete_for_query: true, coverage: { source_checks: [] } };
    },
  });
  assert.equal(answer.status, "ready");
  assert.deepEqual(criteria.requirements, [{ source_id: "municity",
    equals: { PermitType: "Electrical Permit" },
    event_date_from: "2026-10-21", event_date_to: "2026-11-19" }]);
  assert.equal(answer.interpretation.date_window.from, "2026-10-21");
});

test("broad electrical question uses the official group rather than the old exact type", async () => {
  let criteria;
  const answer = await askIndexedParcels({ question: "electrical permits in the past 30 days" }, {
    catalog, interpret: async () => ({ ...interpreted,
      permit_type: null, permit_group: "Electrical" }),
    now: new Date("2026-11-19T15:00:00Z"),
    search: async (input) => {
      criteria = input;
      return { items: [], next_cursor: null, complete_for_query: false,
        coverage: { source_checks: [{ status: "partial" }] } };
    },
  });
  assert.equal(answer.status, "coverage_limited");
  assert.deepEqual(criteria.requirements, [{ source_id: "municity",
    permit_group: "Electrical", event_date_from: "2026-10-21",
    event_date_to: "2026-11-19" }]);
});

test("edited tester filters use the same catalog and search without another model call", async () => {
  let criteria;
  const answer = await askIndexedParcels({ filters: {
    commercial: false, permit_type: null, permit_group: "Electrical",
    permit_status: null, permit_days: 30, neighborhood: null,
  } }, { catalog, interpret: async () => { throw Error("model should not run"); },
    now: new Date("2026-11-19T15:00:00Z"),
    search: async (input) => {
      criteria = input;
      return { items: [], next_cursor: null, complete_for_query: false,
        coverage: { source_checks: [{ status: "partial" }] } };
    } });
  assert.equal(answer.status, "coverage_limited");
  assert.deepEqual(criteria.requirements, [{ source_id: "municity",
    permit_group: "Electrical", event_date_from: "2026-10-21",
    event_date_to: "2026-11-19" }]);
  await assert.rejects(askIndexedParcels({ filters: { commercial: false } },
    { catalog }), { status: 400 });
});

test("commercial question stays blocked until all official City use codes are reviewed", async () => {
  assert.equal(commercialUseCodes(), null);
  let searched = false;
  const answer = await askIndexedParcels({ question: "all commercial parcels with electrical permits" }, {
    catalog, interpret: async () => ({ ...interpreted, commercial: true,
      permit_type: null, permit_group: "Electrical" }),
    search: async () => { searched = true; return {}; },
  });
  assert.equal(answer.status, "blocked");
  assert.match(answer.reason, /official City use-code definitions/);
  assert.equal(searched, false);
});

test("interpreter cannot silently drop the commercial or recent-date constraint", async () => {
  const answer = await askIndexedParcels({
    question: "commercial parcels with electrical permits in the past 30 days",
  }, { catalog, interpret: async () => ({ ...interpreted, commercial: false,
    permit_type: null, permit_group: "Electrical" }) });
  assert.equal(answer.status, "clarify");
  const dateDropped = await askIndexedParcels({ question: "electrical permits in the past 30 days" },
    { catalog, interpret: async () => ({ ...interpreted, permit_type: null,
      permit_group: "Electrical", permit_days: null }) });
  assert.equal(dateDropped.status, "clarify");
  const typeNarrowed = await askIndexedParcels({ question: "electrical permits in the past 30 days" },
    { catalog, interpret: async () => interpreted });
  assert.equal(typeNarrowed.status, "clarify");
});

test("City code audit reports missing official labels without inventing classifications", async () => {
  const report = await auditCityUseCodes({
    metadata: async () => ({ fields: [{ name: "use_code", domain: null }] }),
    query: async (statement) => statement.includes("GROUP BY")
      ? [{ code: "ABC", parcel_count: 25 }]
      : [{ objectid: "9", parcel_id: null, use_code: "ABC" }],
  });
  assert.equal(report.official_domain_published, false);
  assert.equal(report.codes[0].published_label, null);
  assert.equal(report.codes[0].reviewed, false);
  assert.equal(report.unreviewed_codes, 1);
  assert.equal(report.unlinked_features[0].objectid, "9");
});

test("a model-supplied neighborhood must match an indexed City name", async () => {
  process.env.SEARCH_DATABASE_URL = "postgresql://test:test@example.com/test?sslmode=require";
  const answer = await askIndexedParcels({ question: "electrical permits in an unknown neighborhood" }, {
    catalog, interpret: async () => ({ ...interpreted, permit_type: null,
      permit_group: "Electrical",
      neighborhood: "Invented Neighborhood" }),
    query: async () => [{ name: "Westville", label: "Westville" }],
    search: async () => { throw Error("must not search"); },
  });
  assert.equal(answer.status, "clarify");
  delete process.env.SEARCH_DATABASE_URL;
});

test("one-of use-code SQL is parameterized and a date-bound permit run cannot answer outside its window", async () => {
  const sql = buildIndexedSearchQuery([{ source_id: "parcels", equals: {},
    one_of: { use_code: ["RET", "MIX"] } }], { parcels: 4 }, 0, 25);
  assert.match(sql.query, /= ANY\(\$\d+::text\[\]\)/);
  assert.ok(!sql.query.includes("RET"));
  assert.ok(sql.values.some((value) => Array.isArray(value) && value.includes("RET")));
  process.env.SEARCH_DATABASE_URL = "postgresql://test:test@example.com/test?sslmode=require";
  const input = { requirements: [{ source_id: "municity",
    equals: { PermitType: "Electrical Permit" },
    event_date_from: "2026-10-20", event_date_to: "2026-11-19" }] };
  const sourceRows = [
    { source_id: "parcels", scope_key: "all", run_id: 4, status: "complete",
      finished_at: new Date(), expected_count: 1, returned_count: 1,
      ambiguous_count: 0, unlinked_count: 0, latest_attempt_status: "complete" },
    { source_id: "municity", scope_key: "permit-type:ELECTRICAL PERMIT", run_id: 5,
      status: "complete", finished_at: new Date(), expected_count: 1,
      returned_count: 1, ambiguous_count: 0, unlinked_count: 0,
      coverage_date_from: "2026-10-21", coverage_date_to: "2026-11-19",
      latest_attempt_status: "complete" },
  ];
  const result = await searchIndexedParcels(input, { query: async (statement) =>
    statement.includes("search_active_runs") ? sourceRows : [] });
  assert.equal(result.complete_for_query, false);
  assert.equal(result.coverage.source_checks[1].date_covered, false);
  delete process.env.SEARCH_DATABASE_URL;
});

test("City features without a matching reviewed use code do not limit a scoped use-code query", async () => {
  process.env.SEARCH_DATABASE_URL = "postgresql://test:test@example.com/test?sslmode=require";
  const input = { requirements: [{ source_id: "parcels",
    one_of: { use_code: ["3030"] } }] };
  const active = [{ source_id: "parcels", scope_key: "all", run_id: 31,
    status: "complete", finished_at: new Date(), expected_count: 100,
    returned_count: 100, ambiguous_count: 0, unlinked_count: 6,
    latest_attempt_status: "complete" }];
  const query = async (statement) => statement.includes("search_active_runs a") ? active
    : statement.includes("count(*)::integer AS count") ? [{ count: 0 }] : [];
  const result = await searchIndexedParcels(input, { query });
  assert.equal(result.complete_for_query, true);
  assert.equal(result.coverage.source_checks[0].unlinked_count, 6);
  assert.equal(result.coverage.source_checks[0].unlinked_outside_filter, 6);
  const limited = await searchIndexedParcels(input, { query: async (statement) =>
    statement.includes("search_active_runs a") ? active
      : statement.includes("count(*)::integer AS count") ? [{ count: 1 }] : [] });
  assert.equal(limited.complete_for_query, false);
  delete process.env.SEARCH_DATABASE_URL;
});

test("group search selects its date-bounded source run and keeps published member types", async () => {
  process.env.SEARCH_DATABASE_URL = "postgresql://test:test@example.com/test?sslmode=require";
  const rows = [
    { source_id: "parcels", scope_key: "all", run_id: 30, status: "complete",
      finished_at: new Date(), expected_count: 1, returned_count: 1,
      ambiguous_count: 0, unlinked_count: 0, latest_attempt_status: "complete" },
    { source_id: "municity", scope_key: "permit-group:ELECTRICAL", run_id: 31,
      status: "complete", finished_at: new Date(), expected_count: 1,
      returned_count: 1, ambiguous_count: 0, unlinked_count: 0,
      coverage_date_from: "2026-10-21", coverage_date_to: "2026-11-19",
      latest_attempt_status: "complete" },
  ];
  const result = await searchIndexedParcels({ requirements: [{ source_id: "municity",
    permit_group: "Electrical", event_date_from: "2026-10-21",
    event_date_to: "2026-11-19" }] }, { query: async (sql) =>
    sql.includes("search_active_runs a") ? rows : [] });
  assert.equal(result.complete_for_query, true);
  assert.equal(result.coverage.source_checks[1].scope_key, "permit-group:ELECTRICAL");
  delete process.env.SEARCH_DATABASE_URL;
});

test("date search must reproduce a known vendor permit and reconcile the exact day", async () => {
  const sample = { Permit_ID: 99, PermitType: "Electrical Permit",
    PermitDate: "11/18/2026", PrintKey: "1 2 3" };
  const get = async (url) => {
    const p = new URL(url).searchParams;
    if (p.get("searchfield") === "PermitType") return { rows: [sample], total: 1 };
    return p.get("value") === "11/18/2026"
      ? { rows: [sample], total: 1 } : { rows: "", total: 0 };
  };
  const format = await municipalDateSearchFormat("Electrical Permit", { get });
  assert.deepEqual(format, { fieldtype: "text", encoding: "us" });
  const day = await municipalPermitDateRows("2026-11-18", "Electrical Permit", format, { get });
  assert.equal(day.rows[0].record_id, "99");
  assert.equal(day.rows[0].event_date, "2026-11-18");
  assert.deepEqual(day.observed_types, { "Electrical Permit": 1 });
  const grouped = await municipalPermitDateRows("2026-11-18",
    ["Electrical Permit", "Electrical Wiring (NEW)"], format, { get: async (url) => {
      const p = new URL(url).searchParams;
      if (p.get("searchfield") !== "PermitDate") throw Error("Unexpected source query");
      return { rows: [sample, { ...sample, Permit_ID: 100,
        PermitType: "Electrical Wiring (NEW)" },
      { ...sample, Permit_ID: 101, PermitType: "Hood - C" }], total: 3 };
    } });
  assert.equal(grouped.rows.length, 2);
  assert.deepEqual(grouped.rows.map((row) => row.published_type),
    ["Electrical Permit", "Electrical Wiring (NEW)"]);
  await assert.rejects(municipalPermitDateRows("2026-11-18", "Electrical Permit", format, {
    get: async () => ({ rows: [{ ...sample, PermitDate: "11/17/2026" }], total: 1 }),
  }), /unverified row or date/);
});

test("official context is protected and the MCP returns the same reviewed entries", async () => {
  assert.ok(getDataContext({ term: "Community Management Team" }).entries[0]
    .official_source_url.endsWith("/community-management-team"));
  const url = "https://example.com/api/v1/data-context?term=Community%20Management%20Team";
  assert.equal((await contextRoute.fetch(new Request(url))).status, 401);
  const headers = { authorization: `Bearer ${process.env.PILOT_API_TOKEN}` };
  const rest = await contextRoute.fetch(new Request(url, { headers }));
  assert.equal(rest.status, 200);
  const mcp = await mcpRoute.fetch(new Request("https://example.com/mcp", {
    method: "POST", headers: { ...headers, "content-type": "application/json",
      accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 13, method: "tools/call",
      params: { name: "get_data_context", arguments: { term: "Community Management Team" } } }),
  }));
  const raw = await mcp.text();
  const payload = JSON.parse(raw.startsWith("event:") ? raw.match(/^data: (.+)$/m)?.[1] : raw);
  assert.deepEqual(payload.result.structuredContent, await rest.json());
});
