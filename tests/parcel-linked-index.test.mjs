import assert from "node:assert/strict";
import test from "node:test";
import { askIndexedParcels } from "../search-index/ask.js";
import { normalizedBusinessLicenses, verifyMunicipalLicenseDate } from "../search-index/municipal-licenses.js";
import { municipalEntityRow, municipalParcelByPrintKey } from "../search-index/municity.js";
import { filteredPermitLinkGaps } from "../search-index/parcel-only-permits.js";
import { collectPermitActivity } from "../search-index/permit-activity-source.js";
import { searchIndexedRecords } from "../search-index/search.js";
import { reviewedSubparcelEvidence } from "../search-index/subparcel-parents.js";
import { scanCityLicenseParcels } from "../search-index/scan-city-licenses.js";
import { reconcileCityLicenses } from "../search-index/import-municipal-licenses.js";

test("the City sweep distinguishes an omitted license list from an empty list and stops on a rate limit", async () => {
  const input = ["1", "2", "3", "4"].map((id) => ({ objectid: id, parcel_id: id, mblu: id }));
  const timestamp = Date.parse("2026-11-20T17:00:00Z");
  const scan = await scanCityLicenseParcels(input, {
    lookup: async (id) => ({ Parcel_ID: id }),
    children: async (_kind, id) => {
      if (id === "1") return { License: [] };
      if (id === "2") return {};
      if (id === "3") throw Object.assign(new Error("rate limited"), { upstreamStatus: 429, retryAfter: "3600" });
      assert.fail("The sweep must stop sending requests after a rate limit");
    },
    now: () => timestamp, requestSpacingMs: 0,
  });
  assert.deepEqual(scan.updates.map(({ outcome }) => outcome), ["confirmed", "category_missing", "rate_limited"]);
  assert.equal(scan.rate_limited_until, "2026-11-20T18:00:00.000Z");
});

test("the sweep keeps earlier verified licenses after a source gap and excludes conflicting parcel links", () => {
  const history = [
    { record_id: "1", objectid: "10", parcel_id: "11", fields: { LegalAddress: "3 Edwards Street" } },
    { record_id: "2", objectid: "20", parcel_id: "21", fields: {} },
    { record_id: "3", objectid: "30", parcel_id: "31", fields: {} },
  ];
  const batch = [
    { outcome: "category_missing", parcel: { objectid: "10" }, records: [], conflictingIds: [] },
    { outcome: "confirmed", parcel: { objectid: "20" }, records: [], conflictingIds: [] },
    { outcome: "confirmed", parcel: { objectid: "40", parcel_id: "41" },
      records: [{ record_id: "3", fields: {} }], conflictingIds: [] },
  ];
  const result = reconcileCityLicenses(history, batch);
  assert.deepEqual(result.records.map(({ record }) => record.record_id), ["1"]);
  assert.equal(result.records[0].record.fields.NormalizedLegalAddress, "3 EDWARDS ST");
  assert.equal(result.conflicts, 1);
});

test("reviewed municipal subparcel evidence requires the published child, parent and address", () => {
  const permit = { Parcel_ID: 27404, PrintKey: "263 0135 00101", LegalAddress: "1 Example St" };
  const cityVendor = { ...permit, ParcelNote: "PORTION OF 263 0135 00100" };
  assert.equal(reviewedSubparcelEvidence(permit, cityVendor).city_parent_mblu, "263 0135 00100");
  assert.equal(reviewedSubparcelEvidence(permit, { ...cityVendor, ParcelNote: null }), null);
  assert.equal(reviewedSubparcelEvidence(permit, { ...cityVendor, LegalAddress: "2 Example St" }), null);
  assert.equal(reviewedSubparcelEvidence({ ...permit, PrintKey_Parcel: "263 0135 00102" }, cityVendor), null);
});

test("exact official parcel and application requests send their published selectors", async () => {
  const parcel = { Parcel_ID: 7, PrintKey: "12 34" };
  assert.deepEqual(await municipalParcelByPrintKey("12/34", { get: async (url) => {
    assert.equal(url.searchParams.get("entity"), "Parcel");
    assert.equal(url.searchParams.get("searchfield"), "PrintKey");
    assert.equal(url.searchParams.get("value"), "12 34");
    return { total: 1, rows: [parcel] };
  } }), parcel);
  const app = { Application_ID: 8 };
  assert.deepEqual(await municipalEntityRow("Application", 8, { get: async (url) => {
    assert.equal(url.searchParams.get("entity"), "Application");
    assert.equal(url.searchParams.get("searchfield"), "Application_ID");
    assert.equal(url.searchParams.get("value"), "8");
    return { total: 1, rows: [app] };
  } }), app);
});

test("unrelated excluded permits do not create a gap in an exact permit filter", () => {
  const metadata = { parcel_only: true, permit_link_gaps: [
    { permit_type: "EXCAVATION", permit_status: "ISSUED", permit_date: "2026-11-10", unlinked_count: 2, ambiguous_count: 0 },
    { permit_type: "WATER HEATER", permit_status: "VOID", permit_date: "2026-11-01", unlinked_count: 1, ambiguous_count: 0 },
  ] };
  assert.deepEqual(filteredPermitLinkGaps(metadata, { types: ["WATER HEATER"],
    status: "Issued", from: "2026-11-05", to: "2026-11-20" }),
  { unlinked_count: 0, ambiguous_count: 0 });
});

test("permit activity uses official parent IDs and published date fields", async () => {
  const task = { Task_ID: 7, TaskType: "Building", ApprovalStatus: "Approved",
    Entity: "Application", Entity_ID: 5, DateCompleted: "2026-11-05" };
  const results = await collectPermitActivity({
    record_id: "4", published_type: "Water Heater", published_status: "Issued",
    fields: { PermitNo: "P-4", PermitDate: "2026-11-01", Application_ID: 5, PrintKey: "111 2222 33333" },
  }, {
    entity: async () => ({ Application_ID: 5, ApplicationDate: "2026-10-30", PermitApplicationStatus: "Approved" }),
    children: async (entity) => ({ Task: [task], Inspection: entity === "Permit" ? [
      { Inspection_ID: 12, SchedDate: "2026-11-10", Status: "Scheduled" },
      { Inspection_ID: 13, Entity: "Permit", Entity_ID: 99, Status: "Closed" },
    ] : [] }),
  });
  const [application, review, inspection] = results.records;
  assert.equal(application.event_date, "2026-10-30");
  assert.equal(review.event_date, "2026-11-05");
  assert.equal(review.fields.linked_from.length, 2);
  assert.equal(inspection.event_date, null);
  assert.equal(inspection.fields.SchedDate, "2026-11-10");
  assert.equal(results.gaps.inspection, 1);
});

test("City license validation reproduces an official IssueDate and excludes created-only dates", async () => {
  const license = { License_ID: 12, BusinessName: "Example business", Parcel_ID: 17,
    IssueDate: "2026-11-14", CreatedDate: "2026-11-02" };
  const { format } = await verifyMunicipalLicenseDate({
    children: async () => ({ License: [license] }),
    search: async (field, date, _limit, _get, _fieldtype, entity) => {
      assert.equal(field, "IssueDate");
      assert.equal(date, "11/14/2026");
      assert.equal(entity, "License");
      return { total: 1, rows: [license] };
    },
  });
  assert.deepEqual(format, { fieldtype: "text", encoding: "us" });
  assert.equal(normalizedBusinessLicenses([license])[0].event_date, "2026-11-14");
  assert.throws(() => normalizedBusinessLicenses([{ ...license, IssueDate: null }]), /issue date/i);
  const [undated] = normalizedBusinessLicenses([{ ...license, IssueDate: null }], { requireIssueDate: false });
  assert.equal(undated.event_date, null);
  assert.equal(undated.fields.CreatedDate, "2026-11-02");
});

test("the business license question preserves East Rock, 30 dates and the City source", async () => {
  const response = await askIndexedParcels({
    question: "Show me new business licenses in East Rock neighborhood in the last 30 days",
  }, {
    now: new Date("2026-11-20T17:00:00Z"),
    catalog: () => assert.fail("License questions do not need the permit type catalog"),
    searchRecords: async (input) => {
      assert.deepEqual(input, { source_id: "municipal-business-licenses",
        neighborhood: "East Rock", event_date_from: "2026-10-22", event_date_to: "2026-11-20", limit: 25 });
      return { items: [], complete_for_query: false };
    },
  });
  assert.equal(response.status, "coverage_limited");
  assert.equal(response.interpretation.date_field, "IssueDate");
});

test("State license searches cross-filter using the exact City neighborhood of the linked site", async (t) => {
  const oldURL = process.env.SEARCH_DATABASE_URL;
  process.env.SEARCH_DATABASE_URL = "postgresql://test:test@example.com/test?sslmode=require";
  t.after(() => {
    if (oldURL == null) delete process.env.SEARCH_DATABASE_URL;
    else process.env.SEARCH_DATABASE_URL = oldURL;
  });
  const sourceId = "ct-liquor-permits";
  const result = await searchIndexedRecords({ source_id: sourceId, neighborhood: "East Rock",
    event_date_from: "2026-10-22", event_date_to: "2026-11-20" }, { query: async (sql, values) => {
    if (sql.includes("search_active_runs")) return values[0].map((source_id, index) => ({
      source_id, scope_key: "all", run_id: index + 1, status: "complete", finished_at: new Date(),
      latest_attempt_status: "complete", expected_count: 1, returned_count: 1, ambiguous_count: 0, unlinked_count: 0,
    }));
    assert.match(sql, /r\.event_date >= \$\d+::date/);
    assert.match(sql, /b\.source_id = 'neighborhoods' AND b\.join_status = 'exact'/);
    assert.match(sql, /b\.city_parcel_id = j\.city_parcel_id AND b\.city_objectid = j\.city_objectid/);
    assert.ok(values.includes("East Rock"));
    return [{ city_parcel_id: 123, record_id: "row-123" }];
  } });
  assert.deepEqual(result.items, [{ city_parcel_id: 123, record_id: "row-123" }]);
  assert.equal(result.complete_for_query, true);
});

test("a City license address filter requires current parcel and recorded legal address agreement", async (t) => {
  const oldURL = process.env.SEARCH_DATABASE_URL;
  process.env.SEARCH_DATABASE_URL = "postgresql://test:test@example.com/test?sslmode=require";
  t.after(() => {
    if (oldURL == null) delete process.env.SEARCH_DATABASE_URL;
    else process.env.SEARCH_DATABASE_URL = oldURL;
  });
  const sourceId = "municipal-business-licenses";
  const result = await searchIndexedRecords({ source_id: sourceId, site_address: "3 Edwards Street",
    event_date_from: "2026-10-22" }, { query: async (sql, parameters) => {
    if (sql.includes("search_active_runs")) return parameters[0].map((source_id, index) => ({
      source_id, scope_key: "all", run_id: index + 1, status: "complete", finished_at: new Date(),
      latest_attempt_status: "complete", expected_count: 1, returned_count: 1,
      ambiguous_count: 0, unlinked_count: 0,
      ...(source_id === sourceId ? { metadata: { named_licenses_without_issue_date: 1 } } : {}),
    }));
    assert.ok(parameters.includes("3 EDWARDS ST"));
    assert.match(sql, /a\.fields->>'normalized_address' = r\.fields->>'NormalizedLegalAddress'/);
    assert.match(sql, /ap\.join_status = 'exact' AND ap\.city_parcel_id = j\.city_parcel_id/);
    assert.match(sql, /op\.city_objectid IS DISTINCT FROM j\.city_objectid/);
    return [];
  } });
  assert.equal(result.coverage.source_checks.find(({ source_id }) => source_id === sourceId).date_covered, false);
  assert.equal(result.complete_for_query, false);
});
