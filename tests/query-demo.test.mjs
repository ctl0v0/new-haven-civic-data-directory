import test from "node:test";
import assert from "node:assert/strict";
import { askIndexedParcels, recentCalendarDates } from "../search-index/ask.js";
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

const catalog = async () => ({ partial: false, groups: [{ types: [
  { name: "Electrical Permit" }, { name: "Hood - C" },
] }] });
const interpreted = { intent: "search", commercial: false,
  permit_type: "Electrical Permit", permit_status: null,
  permit_days: 30, neighborhood: null, clarification: null };

test("relative PermitDate uses New Haven calendar dates, including today", () => {
  assert.deepEqual(recentCalendarDates(30, new Date("2026-11-19T15:00:00Z")), {
    from: "2026-10-21", to: "2026-11-19",
    meaning: "30 New Haven calendar dates including today",
  });
  assert.equal(recentCalendarDates(1, new Date("2026-11-19T01:00:00Z")).to,
    "2026-11-18");
});

test("question path uses the published permit type and date without assuming Issued", async () => {
  let criteria;
  const answer = await askIndexedParcels({ question: "electrical permits in the past 30 days" }, {
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

test("commercial question stays blocked until all official City use codes are reviewed", async () => {
  assert.equal(commercialUseCodes(), null);
  let searched = false;
  const answer = await askIndexedParcels({ question: "all commercial parcels with electrical permits" }, {
    catalog, interpret: async () => ({ ...interpreted, commercial: true }),
    search: async () => { searched = true; return {}; },
  });
  assert.equal(answer.status, "blocked");
  assert.match(answer.reason, /official City use-code definitions/);
  assert.equal(searched, false);
});

test("interpreter cannot silently drop the commercial or recent-date constraint", async () => {
  const answer = await askIndexedParcels({
    question: "commercial parcels with electrical permits in the past 30 days",
  }, { catalog, interpret: async () => ({ ...interpreted, commercial: false }) });
  assert.equal(answer.status, "clarify");
  const dateDropped = await askIndexedParcels({ question: "electrical permits in the past 30 days" },
    { catalog, interpret: async () => ({ ...interpreted, permit_days: null }) });
  assert.equal(dateDropped.status, "clarify");
});

test("City code audit reports missing official labels without inventing classifications", async () => {
  const report = await auditCityUseCodes({
    metadata: async () => ({ fields: [{ name: "use_code", domain: null }] }),
    query: async () => [{ code: "ABC", parcel_count: 25 }],
  });
  assert.equal(report.official_domain_published, false);
  assert.equal(report.codes[0].published_label, null);
  assert.equal(report.codes[0].reviewed, false);
  assert.equal(report.unreviewed_codes, 1);
});

test("a model-supplied neighborhood must match an indexed City name", async () => {
  process.env.SEARCH_DATABASE_URL = "postgresql://test:test@example.com/test?sslmode=require";
  const answer = await askIndexedParcels({ question: "electrical permits in an unknown neighborhood" }, {
    catalog, interpret: async () => ({ ...interpreted,
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
