import test from "node:test";
import assert from "node:assert/strict";
import cityActivityRoute from "../api/v1/city-activity.js";
import mcpRoute from "../api/mcp.js";
import { listCityActivity } from "../search-index/city-activity.js";

const now = new Date("2026-11-21T02:30:00Z");
const from = "2026-11-14";
const to = "2026-11-20";
const run = (source_id, run_id, extra = {}) => ({
  source_id, run_id, scope_key: "all", status: "complete",
  finished_at: "2026-11-20T12:00:00Z", ...extra,
});
const runs = [
  run("parcels", 1), run("neighborhoods", 2), run("municipal-business-licenses", 3),
  run("municity-permit-activity", 4),
  run("municity", 5, { scope_key: "permit-window:90", coverage_date_from: "2026-08-23",
    coverage_date_to: "2026-11-19", unlinked_count: 8 }),
];
const source_url = "https://www.municityconnect.com/#/app/NewHavenCityCT/entity/Permit/900";
const permitProject = {
  parcel_id: "10", objectid: "20", project_id: "permit:900", city_address: "21 Example St",
  parcel_source_url: "https://gis.newhavenct.gov/parcel/20", neighborhoods: ["East Rock"],
  event_date: to, events: [
    { source_id: "municity-permit-activity", activity: "inspection", event_date: to,
      record_id: "900:inspection:3", source_url, fields: { permit_id: "900", Results: "Passed" } },
    { source_id: "municity", activity: "permit", event_date: from,
      record_id: "900", source_url, published_type: "Water Heater", published_status: "Issued",
      fields: { PermitNo: "M-900", LegalAddress: "21 Example St" } },
  ],
};
const sale = {
  ...permitProject, project_id: "parcels:20", event_date: from, events: [
    { source_id: "parcels", activity: "sale", event_date: from, record_id: "20",
      source_url: "https://gis.newhavenct.gov/parcel/20", fields: { price: 300000, owner_name_1: "Unrelated owner field" } },
  ],
};

test("city activity defaults to seven New Haven dates, pins runs and pages project groups", async (t) => {
  const previousSecret = process.env.PILOT_COOKIE_SECRET;
  process.env.PILOT_COOKIE_SECRET = "city-activity-test-cookie-secret";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.PILOT_COOKIE_SECRET;
    else process.env.PILOT_COOKIE_SECRET = previousSecret;
  });
  const query = async (sql, values) => {
    if (sql.includes("FROM search_active_runs")) return runs;
    if (sql.includes("SELECT DISTINCT")) return [{ name: "East Rock", alias: "East Rock" }];
    assert.match(sql, /count\(DISTINCT \(city_parcel_id, city_objectid\)\) = 1 AND bool_and\(join_status = 'exact'\)/);
    assert.match(sql, /p.record_id = projects.objectid AND p.fields->>'parcel_id' = projects.parcel_id/);
    assert.deepEqual(values.slice(1, 3), [from, to]);
    assert.equal(values[6], "East Rock");
    assert.ok(JSON.parse(values[0]).some(({ run_id }) => run_id === "5"));
    assert.equal(values[7], 2);
    return values[8] === 0 ? [permitProject, sale] : [sale];
  };
  const options = { configured: () => true, query, now };
  const input = { neighborhood: "East Rock", limit: 1 };
  const first = await listCityActivity(input, options);
  assert.deepEqual(first.filters, { from, to, activity: null, neighborhood: "East Rock" });
  assert.equal(first.coverage.status, "partial");
  assert.match(first.coverage.sources.find(({ source_id }) => source_id === "municity").note, /part of the selected dates/);
  assert.deepEqual(first.items[0].events.map(({ date_field }) => date_field), ["CloseDate", "PermitDate"]);
  assert.equal(first.items[0].events[0].results, "Passed");
  assert.ok(first.next_cursor);
  const second = await listCityActivity({ ...input, cursor: first.next_cursor }, options);
  assert.equal(second.items[0].events[0].price, 300000);
  assert.equal(second.items[0].events[0].fields, undefined);
  assert.equal(second.next_cursor, null);
  await assert.rejects(listCityActivity({ cursor: first.next_cursor }, options), { status: 409 });
  await assert.rejects(listCityActivity({ from: "2026-11-22" }, options), { status: 400 });
});

test("city activity accepts an exact published permit type and rejects conflicting activity", async () => {
  const options = { configured: () => true, now, query: async (sql, values) => {
    if (sql.includes("FROM search_active_runs")) return runs;
    if (sql.includes("SELECT DISTINCT")) return [{ name: "East Rock" }];
    assert.match(sql, /kind = 'permit' AND lower\(trim\(published_type\)\) = lower\(\$10::text\)/);
    assert.deepEqual(values[3], ["permit"]);
    assert.equal(values[6], "East Rock");
    assert.equal(values[9], "Water Heater");
    return [];
  } };
  const filtered = await listCityActivity({ permit_type: " Water Heater ", neighborhood: "East Rock" }, options);
  assert.equal(filtered.filters.activity, "permit");
  assert.equal(filtered.filters.permit_type, "Water Heater");
  assert.deepEqual(filtered.items, []);
  await assert.rejects(listCityActivity({ activity: "license", permit_type: "Water Heater" }, options),
    { status: 400 });
});

test("city activity REST and MCP share the same filters and private authentication", async (t) => {
  const env = { ...process.env, PILOT_PASSPHRASE: "city-activity-test-passphrase",
    PILOT_COOKIE_SECRET: "city-activity-test-cookie-secret", PILOT_API_TOKEN: "city-activity-test-api-token" };
  delete env.SEARCH_DATABASE_URL;
  const oldEnv = process.env;
  process.env = env;
  t.after(() => { process.env = oldEnv; });
  const url = `https://example.com/api/v1/city-activity?from=${from}&to=${to}&activity=permit&permit_type=Water+Heater`;
  assert.equal((await cityActivityRoute.fetch(new Request(url))).status, 401);
  const headers = { authorization: `Bearer ${env.PILOT_API_TOKEN}` };
  const rest = await cityActivityRoute.fetch(new Request(url, { headers }));
  assert.equal(rest.status, 200);
  const mcp = await mcpRoute.fetch(new Request("https://example.com/mcp", {
    method: "POST", headers: { ...headers, "content-type": "application/json",
      accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "list_city_activity", arguments: { from, to, activity: "permit", permit_type: "Water Heater" } } }),
  }));
  assert.equal(mcp.status, 200);
  const raw = await mcp.text();
  const response = JSON.parse(raw.startsWith("event:") ? raw.match(/^data: (.+)$/m)?.[1] : raw);
  assert.deepEqual(response.result.structuredContent, await rest.json());
});
