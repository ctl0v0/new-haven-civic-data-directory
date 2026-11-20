import test from "node:test";
import assert from "node:assert/strict";
import data from "../data/permit-applications.json" with { type: "json" };
import { listPermitApplications, validatePermitApplicationInventory } from "../parcel/permit-applications.js";
import { questionPermitCatalog } from "../search-index/ask.js";

const catalog = async () => ({
  groups: [
    { name: "Building", types: [{ name: "Addition", permit_type_id: 1, deleted_as_published: 0 }] },
    { name: "Plumbing", types: [{ name: "Water Heater", permit_type_id: 2 },
      { name: "Water Heater - C", permit_type_id: 3 }] },
    { name: "City Plan", types: [{ name: "Letter Of Zoning Compliance", permit_type_id: 4 }] },
    { name: "Other", types: [{ name: "Unmapped Example", permit_type_id: 5 }] },
  ],
  retrieved_at: "2026-11-20T16:00:00Z",
});
const check = async () => ({ status: "reachable", checked_at: "2026-11-20T17:00:00Z" });
const dependencies = { catalog, check };

test("permit application coverage reconciles to the official types and preserves exact associations", async () => {
  const result = await listPermitApplications({}, dependencies);
  assert.equal(result.coverage.permit_type_count, 5);
  assert.deepEqual(result.coverage.type_counts,
    { verified_application: 2, shared_instructions: 2, no_verified_application: 1 });
  assert.deepEqual(result.items.map(({ permit_type_id }) => permit_type_id), [1, 4, 5, 2, 3]);
  const addition = result.items[0].applications.find(({ application_id }) => application_id === "adu-addition");
  assert.equal(addition.start.method, "portal_entry");
  assert.deepEqual(addition.start.selection,
    { department: "Building (1 and 2 family only) - Public", permit_type: "Addition" });
  assert.equal(addition.instructions[0].source.kind, "city_published_portal_walkthrough");
  assert.equal(addition.reviewed_on, data.reviewed_on);
  const zoning = result.items.find(({ permit_type_id }) => permit_type_id === 4).applications[0];
  assert.equal(zoning.filing_route, "mail");
  assert.equal(zoning.forms[0].kind, "blank_form");
  assert.notEqual(zoning.start.url, zoning.forms[0].url);
  const commercial = await listPermitApplications({ permit_type: "Water Heater - C" }, dependencies);
  assert.equal(commercial.items.length, 1);
  assert.equal(commercial.items[0].permit_type_id, 3);
  assert.equal(commercial.items[0].status, "shared_instructions");
  assert.equal(commercial.items[0].applications[0].start.selection, undefined);
});

test("unmatched entries and source outages preserve the last review date without asserting a current application", async () => {
  const report = await listPermitApplications({ view: "directory", q: "outdoor seating" }, {
    catalog: async () => { throw Error("offline"); },
    check: async (id) => id === "citysquared" ? { status: "unverified", warning: "Unavailable" } : check(),
  });
  assert.equal(report.coverage.catalog.status, "unavailable");
  assert.equal(report.coverage.permit_type_count, null);
  assert.equal(report.coverage.directory_entries_without_type_link, null);
  assert.equal(report.coverage.citysquared_menu.status, "unverified");
  assert.equal(report.items[0].application_id, "outdoor-seating");
  assert.equal(report.items[0].start.availability, "unverified");
  assert.equal(report.items[0].reviewed_on, data.reviewed_on);
  assert.equal(report.items[0].status, null);
  const linked = await listPermitApplications({ view: "directory", q: "outdoor seating" }, dependencies);
  assert.equal(linked.items[0].status, "no_verified_application");
  assert.deepEqual(linked.items[0].linked_types, []);
});

test("the catalog reader retains the official type ID and deletion flag from the checked index", async () => {
  const result = await questionPermitCatalog({
    configured: () => true, now: new Date("2026-11-20T17:00:00Z"),
    query: async (sql) => sql.includes("FROM search_active_runs")
      ? [{ id: 1, status: "complete", expected_count: 1, returned_count: 1, finished_at: "2026-11-20T16:00:00Z" }]
      : [{ record_id: "Addition", group_name: "Building", permit_type_id: 42, deleted_as_published: 0 }],
    live: () => assert.fail("A complete active run should be used"),
  });
  assert.deepEqual(result.groups[0].types[0], { name: "Addition", permit_type_id: 42, deleted_as_published: 0 });
});

test("application route validation rejects historical entity links and unapproved publishers", () => {
  for (const start_url of [
    "https://www.citysquared.com/#/app/NewHavenCityCT/entity/Application/43",
    "https://example.com/application",
  ]) {
    const entries = [{ ...data.applications[1], start_url, start_verified_on: "2026-11-20" }];
    assert.throws(() => validatePermitApplicationInventory({ ...data, applications: entries }), /Invalid application directory entry/);
  }
});

test("application filters page the same inventory and reject a cursor used with different filters", async (t) => {
  const previous = process.env.PILOT_COOKIE_SECRET;
  process.env.PILOT_COOKIE_SECRET = "permit-app-cursor-fixture-1234567890";
  t.after(() => previous == null ? delete process.env.PILOT_COOKIE_SECRET : process.env.PILOT_COOKIE_SECRET = previous);
  const first = await listPermitApplications({ limit: 2 }, dependencies);
  assert.ok(first.next_cursor);
  const next = await listPermitApplications({ limit: 2, cursor: first.next_cursor }, dependencies);
  assert.deepEqual(next.items.map(({ permit_type_id }) => permit_type_id), [5, 2]);
  await assert.rejects(listPermitApplications({ limit: 2, q: "Water", cursor: first.next_cursor }, dependencies), { status: 409 });
  const filtered = await listPermitApplications({ department: "City Plan", route: "mail", status: "verified_application" }, dependencies);
  assert.deepEqual(filtered.items.map(({ permit_type_id }) => permit_type_id), [4]);
});
