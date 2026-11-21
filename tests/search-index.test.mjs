import test from "node:test";
import assert from "node:assert/strict";
import { arcgisInventory, arcgisFeatures, GIS_INDEX_FIELDS } from "../search-index/arcgis.js";
import { indexSourceCatalog } from "../search-index/catalog.js";
import { getSearchCoverage } from "../search-index/coverage.js";
import { getIndexedRecord } from "../search-index/record.js";
import { auditMunicipalPermitLinks } from "../search-index/linkage-audit.js";
import { auditMunicipalAddressCandidates } from "../search-index/address-candidate-audit.js";
import { buildIndexedSearchQuery, searchIndexedParcels, searchIndexedRecords,
  SEARCH_FIELDS } from "../search-index/search.js";
import { searchCapabilities } from "../parcel/search-capabilities.js";
import { stateRosterInventory, stateRosterRows, STATE_ROSTERS } from "../search-index/socrata.js";
import { arcgis } from "../parcel/http.js";
import { municipalPermitCatalogRows, municipalPermitTypeRows,
  sameMunicipalPermitRows } from "../search-index/municity.js";
import { searchIndexedPermits } from "../search-index/permits.js";
import { searchParcels } from "../parcel/parcel-search.js";
import searchParcelsRoute from "../api/v1/search-parcels.js";
import searchIndexedRecordsRoute from "../api/v1/search-indexed-records.js";
import permitLinkageAuditRoute from "../api/v1/permit-linkage-audit.js";
import nearbyCountsRoute from "../api/v1/nearby-feature-counts.js";
import mcpRoute from "../api/mcp.js";

const oldFetch = globalThis.fetch;
const oldSecret = process.env.PILOT_COOKIE_SECRET;
const oldToken = process.env.PILOT_API_TOKEN;
const oldPass = process.env.PILOT_PASSPHRASE;
const oldDatabase = process.env.SEARCH_DATABASE_URL;
process.env.PILOT_COOKIE_SECRET = "search-index-test-secret-123456789";
process.env.PILOT_API_TOKEN = "search-index-test-token-123456789";
process.env.PILOT_PASSPHRASE = "search-index-test-pass-123456789";
delete process.env.SEARCH_DATABASE_URL;
test.after(() => {
  globalThis.fetch = oldFetch;
  for (const [key, value] of Object.entries({ PILOT_COOKIE_SECRET: oldSecret,
    PILOT_API_TOKEN: oldToken, PILOT_PASSPHRASE: oldPass,
    SEARCH_DATABASE_URL: oldDatabase })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const json = (body) => new Response(JSON.stringify(body), {
  headers: { "content-type": "application/json" },
});

test("GIS inventory requests omit the default feature page limit", async () => {
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    requests.push(url);
    return json(url.searchParams.has("returnIdsOnly")
      ? { objectIds: [1, 2, 3] }
      : url.searchParams.has("returnCountOnly")
        ? { count: 3 } : { features: [] });
  };
  try {
    const layer = "https://gis.newhavenct.gov/server/rest/services/Hosted/test/FeatureServer/0";
    await arcgis(layer, { returnIdsOnly: "true" });
    await arcgis(layer, { returnCountOnly: "true" });
    await arcgis(layer, { objectIds: "1,2,3" });
    assert.equal(requests[0].searchParams.has("resultRecordCount"), false);
    assert.equal(requests[1].searchParams.has("resultRecordCount"), false);
    assert.equal(requests[2].searchParams.get("resultRecordCount"), "100");
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("index catalog names every parcel source and keeps documented gaps unavailable", async () => {
  const catalog = indexSourceCatalog();
  assert.equal(catalog.filter((entry) => entry.source_id !== "transit-stops" &&
    entry.source_id !== "metered-parking-spaces" && entry.source_id !== "loading-zones" &&
    entry.source_id !== "parking-availability").length, 45);
  assert.equal(catalog.find((entry) => entry.source_id === "ct-business-registrations").index_source_id, "ct-business-registrations");
  assert.equal(catalog.find((entry) => entry.source_id === "ct-public-charities").index_source_id, "ct-public-charities");
  assert.equal(catalog.find((entry) => entry.source_id === "municity-permit-types")
    .index_source_id, "municity-permit-types");
  assert.equal(catalog.find((entry) => entry.source_id === "tax-bills").search_mode, "gap");
  assert.equal(catalog.find((entry) => entry.source_id === "assessor-subareas").search_mode,
    "parcel_only_pending_complete_enumeration");
  assert.equal(catalog.find((entry) => entry.source_id === "parcel-owner").index_source_id,
    "parcels");
  assert.equal(catalog.find((entry) => entry.source_id === "municipal-business-licenses")
    .search_mode, "conditional_index");
  assert.equal(catalog.find((entry) => entry.source_id === "business-master")
    .index_source_id, null);
  assert.match(catalog.find((entry) => entry.source_id === "municity").release_gate,
    /Permit parent rows/);
  const coverage = await getSearchCoverage();
  assert.equal(coverage.index_status, "unconfigured");
  assert.ok(coverage.sources.every((entry) => !entry.complete));
});

test("cross-source field allowlists follow the official fields stored in the index", () => {
  assert.ok(SEARCH_FIELDS.parcels.includes("owwner_name_2"));
  assert.ok(SEARCH_FIELDS.cmt.includes("cmt_chair"));
  assert.ok(SEARCH_FIELDS["ct-liquor-permits"].includes("expire_date"));
  assert.ok(SEARCH_FIELDS["managed-lots"].includes("status"));
  const discovered = searchCapabilities().indexed_source_fields;
  assert.ok(discovered.parcels.equals.includes("owwner_name_2"));
  assert.ok(discovered.parcels.number_gte.includes("units_commercial"));
  assert.ok(discovered.municity.equals.includes("PermitType"));
  assert.ok(discovered["managed-lots"].equals.includes("mbp"));
});

test("GIS inventory compares official IDs and count before indexing any rows", async () => {
  const query = async (_layer, args) => args.returnIdsOnly
    ? { objectIds: [7, 9], objectIdFieldName: "objectid" }
    : { count: 2 };
  const inventory = await arcgisInventory("parcels", { query,
    metadata: async () => ({ geometryType: "esriGeometryPolygon",
      fields: GIS_INDEX_FIELDS.parcels.map((name) => ({ name })),
      editingInfo: { lastEditDate: 1760000000000 } }) });
  assert.deepEqual(inventory.object_ids, [7, 9]);
  const rows = await arcgisFeatures(inventory, [7, 9], {
    query: async () => ({ features: [7, 9].map((id) => ({
      attributes: { objectid: id, parcel_id: 1000 + id, mblu: `${id} 1`,
        property_address: `${id} MAIN ST` },
      geometry: { rings: [[[-72.93, 41.3], [-72.92, 41.3],
        [-72.92, 41.31], [-72.93, 41.3]]],
      spatialReference: { wkid: 4326 } },
    })) }),
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fields.parcel_id, 1007);
  await assert.rejects(arcgisInventory("parcels", {
    query: async (_layer, args) => args.returnIdsOnly ? { objectIds: [7, 9] } : { count: 3 },
    metadata: async () => ({}),
  }));
});

test("State roster retains published row IDs and refuses count or schema gaps", async () => {
  const source = await stateRosterInventory("ct-liquor-permits", { get: async (url) => {
    const text = String(url);
    return text.includes("api/views")
      ? { columns: ["dba", "backer", "permit_address", "permit_city", "credential",
        "effective_date", "expire_date", "status", "reason"].map((fieldName) => ({ fieldName })),
        rowsUpdatedAt: 1760000000 }
      : [{ count: "1" }];
  } });
  const records = await stateRosterRows(source, 0, 500, { get: async () => [
    { ":id": "row-a.1_~b", permit_city: "New Haven", permit_address: "20 Eld Street",
      credential: "LCT.123", status: "ACTIVE", effective_date: "01/14/2026" },
  ] });
  assert.equal(records[0].record_id, "row-a.1_~b");
  assert.equal(records[0].fields.normalized_site_address, "20 ELD ST");
  assert.equal(records[0].event_date, "2026-01-14");
  assert.match(records[0].source_url, /data\.ct\.gov/);
  await assert.rejects(stateRosterRows(source, 0, 500, { get: async () => [] }));
});

test("charity roster uses the State credential ID and restricts inventory to registered charity types", async () => {
  const sourceId = "ct-public-charities";
  const inventory = await stateRosterInventory(sourceId, { get: async (value) => {
    const url = new URL(value);
    if (url.pathname.includes("/api/views/")) return { rowsUpdatedAt: 1760000000,
      columns: STATE_ROSTERS[sourceId].fields.map((fieldName) => ({ fieldName })) };
    assert.equal(url.searchParams.get("$select"), "count(*)");
    assert.match(url.searchParams.get("$where"), /upper\(city\)='NEW HAVEN'.*'PUBLIC CHARITY', 'PUBLIC CHARITY - EXEMPT'/);
    return [{ count: "1" }];
  } });
  const row = { credentialid: "2671715", fullcredentialcode: "CHR.0068611",
    credential: "PUBLIC CHARITY", status: "ACTIVE", dba: "BRADLEY STREET BICYCLE CO-OP",
    address: "138 BRADLEY STREET", city: "NEW HAVEN", issuedate: "2024-11-19T00:00:00.000" };
  const [registration] = await stateRosterRows(inventory, 0, 500, { get: async (url) => {
    assert.equal(url.searchParams.get("$where"), inventory.where);
    assert.equal(url.searchParams.get("$order"), "credentialid");
    return [row];
  } });
  assert.equal(registration.record_id, "2671715");
  assert.equal(registration.published_type, "PUBLIC CHARITY");
  assert.equal(registration.event_date, "2024-11-19");
  assert.equal(registration.fields.normalized_site_address, "138 BRADLEY ST");
  assert.equal(new URL(registration.source_url).searchParams.get("credentialid"), "2671715");
  await assert.rejects(stateRosterRows(inventory, 0, 500, { get: async () => [{ ...row, credential: "PUBLIC ACCOUNTANT" }] }));
});

test("indexed cross-source search uses exact parcel joins and refuses an unindexed source", async () => {
  const sql = buildIndexedSearchQuery([{ source_id: "zoning", equals: { zone_code: "BD" },
    event_date_from: null, event_date_to: null }], { parcels: 10, zoning: 11 }, 0, 25);
  assert.match(sql.query, /j\.join_status = 'exact'/);
  assert.match(sql.query, /'example_record'/);
  assert.match(sql.query, /count\(DISTINCT r\.record_id\)/);
  assert.match(sql.query, /'city_address_objectid', j\.city_address_objectid/);
  assert.ok(!sql.query.includes("example_city_address_objectid"));
  assert.ok(!sql.query.includes("BD"));
  assert.ok(sql.values.includes("BD"));
  process.env.SEARCH_DATABASE_URL = "postgresql://test:test@example.com/test?sslmode=require";
  const input = { requirements: [{ source_id: "zoning", equals: { zone_code: "BD" } }] };
  const partial = await searchIndexedParcels(input, { query: async () => [
    { source_id: "parcels", scope_key: "all", run_id: 10, status: "complete", finished_at: new Date(),
      expected_count: 1, returned_count: 1, ambiguous_count: 0, unlinked_count: 0 },
  ] });
  assert.equal(partial.complete_for_query, false);
  assert.equal(partial.coverage.source_checks[1].status, "not_indexed");
  const full = await searchIndexedParcels(input, { query: async (statement) =>
    statement.includes("search_active_runs") ? [
      { source_id: "parcels", scope_key: "all", run_id: 10, status: "complete", finished_at: new Date(),
        expected_count: 1, returned_count: 1, ambiguous_count: 0, unlinked_count: 0 },
      { source_id: "zoning", scope_key: "all", run_id: 11, status: "complete", finished_at: new Date(),
        expected_count: 1, returned_count: 1, ambiguous_count: 0, unlinked_count: 0 },
    ] : [{ city_parcel_id: 7, city_objectid: 8, matching_sources: [] }] });
  assert.equal(full.complete_for_query, true);
  assert.equal(full.items[0].city_parcel_id, 7);
  delete process.env.SEARCH_DATABASE_URL;
});

test("cross-source parcel search combines one exact municipal type with another official source", async () => {
  process.env.SEARCH_DATABASE_URL = "postgresql://test:test@example.com/test?sslmode=require";
  const input = { requirements: [
    { source_id: "municity", equals: { PermitType: "Hood - C", PermStatus: "Issued" } },
    { source_id: "neighborhoods", equals: { neighborhood: "East Rock" } },
  ] };
  let checkedSql = "";
  const response = await searchIndexedParcels(input, { query: async (statement, values) => {
    if (statement.includes("search_active_runs")) {
      assert.equal(values[1], "permit-type:HOOD - C");
      return ["parcels", "neighborhoods", "municity"].map((source_id, index) => ({
        source_id, scope_key: source_id === "municity" ? "permit-type:HOOD - C" : "all",
        run_id: index + 1, status: "complete", finished_at: new Date(),
        expected_count: 1, returned_count: 1, ambiguous_count: 0, unlinked_count: 0,
      }));
    }
    checkedSql = statement;
    return [{ city_parcel_id: 12846, matching_sources: [] }];
  } });
  assert.equal(response.items[0].city_parcel_id, 12846);
  assert.match(checkedSql, /j\.join_status = 'exact'/);
  assert.equal(response.complete_for_query, true);
  await assert.rejects(searchIndexedParcels({ requirements: [
    { source_id: "municity", equals: { PermStatus: "Issued" } },
  ] }), /PermitType/);
  delete process.env.SEARCH_DATABASE_URL;
});

test("indexed parcel ranges safely parse published JSON numbers and numeric strings", async () => {
  const requirement = { source_id: "parcels", equals: {},
    number_gte: { units_commercial: 2 },
    number_lte: { total_assessed_parcel_value_y: 750000 },
    event_date_from: null, event_date_to: null };
  const sql = buildIndexedSearchQuery([requirement], { parcels: 10 }, 0, 25);
  assert.match(sql.query, /jsonb_typeof\(r\.fields->\$\d+\) = 'number'/);
  assert.match(sql.query, /jsonb_typeof\(r\.fields->\$\d+\) = 'string'/);
  assert.match(sql.query, /\[0-9\]\+\(\[\.\]\[0-9\]\+\)\?/);
  assert.ok(sql.values.includes(2));
  assert.ok(sql.values.includes(750000));
  assert.ok(!sql.query.includes("750000"));
  await assert.rejects(searchIndexedParcels({ requirements: [{ source_id: "parcels",
    number_gte: { owner_name_1: 2 } }] }), /numeric field/);
  await assert.rejects(searchIndexedParcels({ requirements: [{ source_id: "parcels",
    number_gte: { units_commercial: 5 }, number_lte: { units_commercial: 2 } }] }),
  /Reversed/);
});

test("municipal type import keeps only official Permit IDs and uses the checked larger bound", async () => {
  const catalog = async () => ({ groups: [{ types: [{ name: "Hood - C" }] }] });
  const row = { Permit_ID: 569338, PermitType: "Hood - C", PermStatus: "Issued",
    PermitDate: "01/05/2026", Parcel_ID: 32762, PrintKey: "12/34/56",
    PrintKey_Parcel: "12/34/56", LegalAddress: "486 ORANGE ST" };
  const good = await municipalPermitTypeRows("Hood - C", { catalog,
    get: async (url, options) => {
      assert.equal(url.searchParams.get("numrecs"), "10000");
      assert.ok(options.maxBytes >= 50_000_000);
      return { rows: [row], total: 1 };
    } });
  assert.equal(good.rows[0].event_date, "2026-01-05");
  assert.equal(good.rows[0].record_id, "569338");
  assert.equal(good.rows[0].fields.PrintKey, "12/34/56");
  assert.equal(good.rows[0].fields.Parcel_ID, 32762);
  assert.equal(good.rows[0].fields.PrintKey_Parcel, "12/34/56");
  const larger = await municipalPermitTypeRows("Hood - C", { catalog,
    get: async () => ({ rows: Array.from({ length: 2001 }, (_, i) =>
      ({ ...row, Permit_ID: i + 1 })), total: 2001 }) });
  assert.equal(larger.rows.length, 2001);
  await assert.rejects(municipalPermitTypeRows("Hood - C", { catalog,
    get: async () => ({ rows: [row], total: 10000 }) }), /10,000-row request bound/);
  const repeated = await municipalPermitTypeRows("Hood - C", { catalog,
    get: async () => ({ rows: [{ ...row, PrintKey: "" }, row, row], total: 3 }) });
  assert.equal(repeated.vendor_count, 3);
  assert.equal(repeated.duplicate_rows, 2);
  assert.equal(repeated.rows.length, 1);
  assert.equal(repeated.rows[0].fields.PrintKey, "12/34/56");
  await assert.rejects(municipalPermitTypeRows("Hood - C", { catalog,
    get: async () => ({ rows: [row, { ...row, PrintKey: "99/88/77" }], total: 2 }) }),
  /conflicting published PrintKey/);
  await assert.rejects(municipalPermitTypeRows("Hood - C", { catalog,
    get: async () => ({ rows: [row, { ...row, Parcel_ID: 99999 }], total: 2 }) }),
  /conflicting published Parcel_ID/);
});

test("municipal refresh compares published permit IDs independent of vendor row order", () => {
  const a = { record_id: "569338", published_status: "Issued" };
  const b = { record_id: "569339", published_status: "Issued" };
  assert.equal(sameMunicipalPermitRows([a, b], [b, a]), true);
  assert.equal(sameMunicipalPermitRows([a, b], [b, { ...a, record_id: b.record_id,
    published_status: "Voided" }]), false);
  assert.equal(sameMunicipalPermitRows([a, b], [a]), false);
  assert.equal(sameMunicipalPermitRows([
    { record_id: "1", fields: { PrintKey: "123", PermitType: "Hood - C" } },
  ], [
    { record_id: "1", fields: { PermitType: "Hood - C", PrintKey: "123" } },
  ]), true);
});

test("municipal type catalog rejects unnamed, missing, and repeated published types", () => {
  const catalog = { source_url: "https://services5.municity5.com/types",
    catalog_rows_returned: 2, distinct_type_names: 2, partial: false,
    groups: [{ name: "Mechanical", types: [
      { name: "Hood - C", permit_type_id: 1, deleted_as_published: null },
      { name: "Water Heater", permit_type_id: 2, deleted_as_published: null },
    ] }] };
  assert.deepEqual(municipalPermitCatalogRows(catalog).map((row) => row.record_id),
    ["Hood - C", "Water Heater"]);
  assert.throws(() => municipalPermitCatalogRows({ ...catalog, catalog_rows_returned: 3 }),
    /incomplete/);
  assert.throws(() => municipalPermitCatalogRows({ ...catalog, groups: [{ name: null,
    types: [{ name: "Hood - C" }, { name: "hood - c" }] }] }), /repeats/);
});

test("indexed permit search requires each exact type run before claiming an answer", async () => {
  process.env.SEARCH_DATABASE_URL = "postgresql://test:test@example.com/test?sslmode=require";
  const rows = [{ source_id: "parcels", scope_key: "all", run_id: 10,
    status: "complete", finished_at: new Date(), expected_count: 1,
    returned_count: 1, ambiguous_count: 0, unlinked_count: 0 }];
  const missing = await searchIndexedPermits({ permit_types: ["Hood - C"] },
    { query: async () => rows });
  assert.equal(missing.complete_for_query, false);
  assert.equal(missing.coverage.source_checks.at(-1).status, "not_indexed");
  const capped = await searchIndexedPermits({ permit_types: ["Roofing"] },
    { query: async (sql) => sql.includes("search_active_runs") ? rows : [{
      scope_key: "permit-type:ROOFING", status: "failed",
      warning: "MUNICIPAL_TYPE_CAP: reached the validated request bound",
      started_at: new Date(),
    }] });
  assert.equal(capped.coverage.source_checks.at(-1).status, "not_indexed");
  assert.equal(capped.coverage.source_checks.at(-1).latest_attempt_status, "blocked");
  let searchSql = "";
  const complete = await searchIndexedPermits({ permit_types: ["Hood - C"] },
    { query: async (statement) => {
      if (statement.includes("search_active_runs")) return [...rows,
        { ...rows[0], source_id: "municity", scope_key: "permit-type:HOOD - C", run_id: 11 }];
      searchSql = statement;
      return [{ city_parcel_id: 12846, permit_id: "569338" }];
    } });
  assert.equal(complete.complete_for_query, true);
  assert.equal(complete.items[0].permit_id, "569338");
  assert.match(searchSql, /j\.join_status = 'exact'/);
  delete process.env.SEARCH_DATABASE_URL;
});

test("all-type permit search returns indexed matches while listing missing catalog types", async () => {
  process.env.SEARCH_DATABASE_URL = "postgresql://test:test@example.com/test?sslmode=require";
  const run = (source_id, scope_key, run_id) => ({ source_id, scope_key, run_id,
    status: "complete", finished_at: new Date(), expected_count: 1,
    returned_count: 1, ambiguous_count: 0, unlinked_count: 0 });
  let queriedRuns;
  const result = await searchIndexedPermits({ permit_status: "Issued" }, { query: async (sql, values) => {
    if (sql.includes("search_active_runs")) return [run("parcels", "all", 10),
      run("municity-permit-types", "all", 11), run("municity", "permit-type:HOOD - C", 12)];
    if (sql.includes("FROM search_records\n")) return [
      { record_id: "Hood - C" }, { record_id: "Water Heater" }];
    queriedRuns = values[0];
    return [{ city_parcel_id: 12846, permit_type: "Hood - C" }];
  } });
  assert.deepEqual(queriedRuns, [12]);
  assert.equal(result.items.length, 1);
  assert.equal(result.complete_for_query, false);
  assert.equal(result.coverage.source_checks.at(-1).status, "not_indexed");
  delete process.env.SEARCH_DATABASE_URL;
});

test("verified recent windows serve all types and keep exact type and neighborhood filters on a shared run", async () => {
  process.env.SEARCH_DATABASE_URL = "postgresql://test:test@example.com/test?sslmode=require";
  const run = (source_id, scope_key, run_id, extra) => ({ source_id, scope_key, run_id,
    status: "complete", finished_at: new Date(), expected_count: 10, returned_count: 10,
    ambiguous_count: 0, unlinked_count: 0, ...extra });
  const dates = { permit_date_from: "2026-08-23", permit_date_to: "2026-11-20" };
  const active = [run("parcels", "all", 10), run("neighborhoods", "all", 11),
    run("municity", "permit-window:30", 12, { coverage_date_from: "2026-10-22", coverage_date_to: dates.permit_date_to }),
    run("municity", "permit-window:90", 13, { coverage_date_from: dates.permit_date_from, coverage_date_to: dates.permit_date_to }),
    run("municity", "permit-type:WATER HEATER", 14)];
  let statements = [];
  const query = async (sql, params) => {
    if (sql.includes("FROM search_active_runs")) return active;
    statements.push({ sql, params });
    return [{ permit_id: "1", permit_type: "Water Heater" }];
  };
  try {
    const all = await searchIndexedPermits(dates, { query });
    assert.equal(all.complete_for_query, true);
    assert.equal(all.criteria.permit_types, "all-published-types");
    assert.deepEqual(statements[0].params[0], [13]);
    assert.equal(statements.length, 1);
    const typed = await searchIndexedPermits({ ...dates, permit_types: ["Water Heater"],
      scope: "neighborhood", neighborhood: "Westville" }, { query });
    assert.equal(typed.coverage.source_checks.at(-1).scope_key, "permit-window:90");
    assert.match(statements[1].sql, /upper\(trim\(r\.published_type\)\) = ANY/);
    assert.ok(statements[1].params.some((value) => Array.isArray(value) && value[0] === "WATER HEATER"));
    assert.ok(statements[1].params.includes("Westville"));
    const historic = await searchIndexedPermits({ ...dates, permit_date_from: "2025-10-01",
      permit_types: ["Water Heater"] }, { query });
    assert.equal(historic.coverage.source_checks.at(-1).scope_key, "permit-type:WATER HEATER");
    active[3].latest_attempt_status = "failed";
    const short = await searchIndexedPermits({ ...dates, permit_date_from: "2026-10-22" }, { query });
    assert.equal(short.coverage.source_checks.at(-1).scope_key, "permit-window:30");
    assert.equal(short.complete_for_query, true);
    const partial = await searchIndexedPermits(dates, { query });
    assert.equal(partial.coverage.source_checks.at(-1).scope_key, "permit-window:90");
    assert.equal(partial.complete_for_query, false);
    statements = [];
    const requirement = { source_id: "municity", equals: { PermitType: "Water Heater" },
      event_date_from: dates.permit_date_from, event_date_to: dates.permit_date_to };
    const parcels = await searchIndexedParcels({ requirements: [requirement,
      { source_id: "neighborhoods", equals: { neighborhood: "Westville" } }] }, { query });
    const records = await searchIndexedRecords(requirement, { query });
    for (const result of [parcels, records])
      assert.equal(result.coverage.source_checks.find((check) => check.source_id === "municity").scope_key, "permit-window:90");
    assert.ok(statements.every(({ params }) => params.includes(13) && params.includes("Water Heater")));
  } finally { delete process.env.SEARCH_DATABASE_URL; }
});

test("coverage names every catalog type including one blocked at the vendor limit", async () => {
  process.env.SEARCH_DATABASE_URL = "postgresql://test:test@example.com/test?sslmode=require";
  const coverage = await getSearchCoverage({ query: async (sql) => {
    if (sql.includes("FROM search_active_runs a")) return [
      { source_id: "municity-permit-types", scope_key: "all", run_id: 10,
        status: "complete", finished_at: new Date(), expected_count: 2,
        returned_count: 2, linked_count: 0, ambiguous_count: 0, unlinked_count: 0,
        latest_attempt_status: "complete" },
      { source_id: "municity", scope_key: "permit-type:HOOD - C", run_id: 11,
        status: "complete", finished_at: new Date(), expected_count: 1,
        returned_count: 1, linked_count: 1, ambiguous_count: 0, unlinked_count: 0,
        latest_attempt_status: "complete" },
    ];
    if (sql.includes("WHERE scope_key = 'all'")) return [
      { source_id: "school-attendance", status: "failed",
        warning: "Official school snapshot could not be validated",
        started_at: new Date() },
    ];
    if (sql.includes("SELECT record_id")) return [
      { record_id: "Hood - C" }, { record_id: "Roofing" }];
    return [{ scope_key: "permit-type:HOOD - C", status: "complete" },
      { scope_key: "permit-type:ROOFING", status: "failed",
        warning: "MUNICIPAL_TYPE_CAP: reached the validated request bound" }];
  } });
  assert.equal(coverage.index_status, "connected");
  assert.equal(coverage.municipal_permit_catalog.catalog_types, 2);
  assert.equal(coverage.municipal_permit_catalog.types_without_index, 1);
  assert.equal(coverage.municipal_permit_types.find((type) => type.permit_type === "Roofing")
    .latest_attempt_warning, "MUNICIPAL_TYPE_CAP: reached the validated request bound");
  assert.equal(coverage.municipal_permit_types.find((type) => type.permit_type === "Roofing")
    .latest_attempt_status, "blocked");
  assert.equal(coverage.sources.find((source) => source.source_id === "school-attendance")
    .indexed, false);
  assert.equal(coverage.sources.find((source) => source.source_id === "school-attendance")
    .latest_attempt_warning, "Official school snapshot could not be validated");
  delete process.env.SEARCH_DATABASE_URL;
});

test("municipal permit linkage audit separates missing keys from unmatched published keys", async () => {
  process.env.SEARCH_DATABASE_URL = "postgresql://test:test@example.com/test?sslmode=require";
  const audited = await auditMunicipalPermitLinks({ permit_type: "Heating Permit",
    sample_limit: 2 }, { query: async () => [{ run_id: 71,
    status: "complete", returned_count: 4, unlinked_count: 3,
    finished_at: new Date(), latest_attempt_status: "complete",
    metadata: { parcel_link_summary: {
      indexed_count: 1, ambiguous_count: 0, unlinked_count: 3,
      missing_print_key: 2, unmatched_print_key: 1, unlinked_with_vendor_parcel_id: 1,
    } } }] });
  assert.equal(audited.counts.missing_print_key, 2);
  assert.equal(audited.counts.unmatched_print_key, 1);
  assert.equal(audited.counts.indexed_records, 1);
  assert.equal(audited.counts.distinct_source_records, 4);
  assert.deepEqual(audited.samples, []);
  const capped = await auditMunicipalPermitLinks({ permit_type: "Building Permit" },
    { query: async (sql) => sql.includes("search_active_runs") ? [] : [
      { status: "failed", warning: "MUNICIPAL_TYPE_CAP: 10,000 rows",
        started_at: new Date() }] });
  assert.equal(capped.counts, null);
  assert.equal(capped.coverage.latest_attempt_status, "blocked");
  const inconsistent = await auditMunicipalPermitLinks({ permit_type: "Heating Permit" },
    { query: async (sql) => sql.includes("search_active_runs")
      ? [{ run_id: 71, returned_count: 4, unlinked_count: 3 }]
      : [{ indexed_records: 4, unlinked_records: 2,
        missing_print_key: 1, unmatched_print_key: 1 }] });
  assert.equal(inconsistent.counts, null);
  assert.equal(inconsistent.coverage.index_status, "unavailable");
  delete process.env.SEARCH_DATABASE_URL;
});

test("address audit checks official address points against existing vendor parcel links without joining records", async () => {
  const audited = await auditMunicipalAddressCandidates(["Hood - C"], {
    query: async (sql) => {
      if (sql.includes("a.source_id = 'addresses'"))
        return [{ id: 10, status: "complete", returned_count: 3, finished_at: new Date() }];
      if (sql.includes("a.source_id = 'municity'"))
        return [{ id: 20, status: "complete", returned_count: 4, finished_at: new Date() }];
      if (sql.includes("WITH page AS")) return [
        { record_id: "101", normalized_address: "45 CLAY ST",
          links: [{ city_parcel_id: 7, city_objectid: 8, join_status: "exact" }] },
        { record_id: "102", normalized_address: "50 CLAY ST",
          links: [{ city_parcel_id: 9, city_objectid: 10, join_status: "exact" }] },
        { record_id: "103", normalized_address: "50 CLAY ST",
          links: [{ city_parcel_id: 11, city_objectid: 12, join_status: "exact" }] },
      ];
      return [
        { record_id: "1", legal_address: "45 CLAY STREET", print_key: "",
          vendor_parcel_id: "", links: [] },
        { record_id: "2", legal_address: "45 CLAY ST", print_key: "123",
          vendor_parcel_id: "10", links: [{ city_parcel_id: 7,
            city_objectid: 8, join_status: "exact" }] },
        { record_id: "3", legal_address: "45 CLAY ST", print_key: "456",
          vendor_parcel_id: "11", links: [{ city_parcel_id: 6,
            city_objectid: 5, join_status: "exact" }] },
        { record_id: "4", legal_address: "50 CLAY ST", print_key: "",
          vendor_parcel_id: "12", links: [] },
      ];
    }, sampleLimit: 2,
  });
  const { counts, samples } = audited.results[0];
  assert.equal(counts.unlinked_missing_print_key_with_candidate, 1);
  assert.equal(counts.exact_vendor_link_and_address_agree, 1);
  assert.equal(counts.exact_vendor_link_and_address_conflict, 1);
  assert.equal(counts.ambiguous_city_address_candidate, 1);
  assert.equal(counts.missing_print_key_with_vendor_parcel_id, 1);
  assert.equal(samples.unlinked_missing_key_candidates[0].city_address_candidate, "7:8");
  assert.equal(samples.vendor_link_address_conflicts[0].record_id, "3");
  assert.match(audited.note, /do not establish a vendor parcel relationship/);
});

test("protected linkage audit route and MCP agree when the index is unconfigured", async () => {
  const url = "https://example.com/api/v1/permit-linkage-audit?permit_type=Hood%20-%20C";
  const denied = await permitLinkageAuditRoute.fetch(new Request(url));
  assert.equal(denied.status, 401);
  const auth = { authorization: `Bearer ${process.env.PILOT_API_TOKEN}` };
  const rest = await permitLinkageAuditRoute.fetch(new Request(url, { headers: auth }));
  assert.equal(rest.status, 200);
  const mcp = await mcpRoute.fetch(new Request("https://example.com/mcp", {
    method: "POST", headers: { ...auth, "content-type": "application/json",
      accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 92, method: "tools/call",
      params: { name: "audit_municipal_permit_links",
        arguments: { permit_type: "Hood - C" } } }),
  }));
  assert.equal(mcp.status, 200);
  const raw = await mcp.text();
  const payload = JSON.parse(raw.startsWith("event:")
    ? raw.match(/^data: (.+)$/m)?.[1] : raw);
  assert.deepEqual(payload.result.structuredContent, await rest.json());
});

test("indexed record inspection keeps official fields and parcel join evidence separate", async () => {
  process.env.SEARCH_DATABASE_URL = "postgresql://test:test@example.com/test?sslmode=require";
  const row = { record_id: "572030", source_url: "https://www.municityconnect.com/Permit/572030",
    published_type: "Hood - C", published_status: "Issued",
    fields: { PermitNo: "M-23-00357" } };
  const inspect = async (recordId) => getIndexedRecord({ source_id: "municity",
    permit_type: "Hood - C", record_id: recordId }, { query: async (sql, values) => {
    if (sql.includes("FROM search_active_runs a")) {
      assert.deepEqual(values, ["municity", "permit-type:HOOD - C",
        ["permit-window:30", "permit-window:90"], recordId, "HOOD - C"]);
      return [{ run_id: 11, status: "complete", finished_at: new Date(),
        expected_count: 1, returned_count: 1, ambiguous_count: 0,
        unlinked_count: 0, latest_attempt_status: "complete" }];
    }
    if (sql.includes("FROM search_records r WHERE")) return recordId === "572030" ? [row] : [];
    return [{ city_parcel_id: 12846, city_objectid: 4157,
      match_method: "published-parcel-key-exact", join_status: "exact" }];
  } });
  const found = await inspect("572030");
  assert.equal(found.record.fields.PermitNo, "M-23-00357");
  assert.equal(found.parcel_links[0].city_parcel_id, 12846);
  assert.equal(found.complete_for_query, true);
  const absent = await inspect("999999");
  assert.equal(absent.found, false);
  assert.equal(absent.complete_for_query, true);
  await assert.rejects(getIndexedRecord({ source_id: "municity", record_id: "572030" }),
    /permit type or group/i);
  const blocked = await getIndexedRecord({ source_id: "municity", record_id: "1",
    permit_type: "Roofing" }, { query: async (sql) => sql.includes("search_active_runs")
      ? [] : [{ status: "failed", warning: "MUNICIPAL_TYPE_CAP: 10,000 rows",
        started_at: new Date() }] });
  assert.equal(blocked.found, false);
  assert.equal(blocked.coverage.latest_attempt_status, "blocked");
  delete process.env.SEARCH_DATABASE_URL;
});

test("indexed record search pages published rows and retains exact parcel evidence", async () => {
  process.env.SEARCH_DATABASE_URL = "postgresql://test:test@example.com/test?sslmode=require";
  const input = { source_id: "ct-liquor-permits", equals: { status: "ACTIVE" },
    city_parcel_id: "12846", city_objectid: "4157", limit: 1 };
  let statement;
  let params;
  const query = async (sql, values) => {
    if (sql.includes("search_active_runs")) return ["parcels", "ct-liquor-permits", "addresses"]
      .map((source_id, i) => ({ source_id, scope_key: "all", run_id: i + 10,
        status: "complete", finished_at: new Date(), expected_count: 2,
        returned_count: 2, ambiguous_count: 0, unlinked_count: 0,
        latest_attempt_status: "complete" }));
    statement = sql;
    params = values;
    return [{ record_id: "row-1", city_parcel_id: 12846,
      source_url: "https://data.ct.gov/resource/gwv2-eswx.json", fields: { status: "ACTIVE" } },
    { record_id: "row-2", city_parcel_id: 12846,
      source_url: "https://data.ct.gov/resource/gwv2-eswx.json", fields: { status: "ACTIVE" } }];
  };
  const page = await searchIndexedRecords(input, { query });
  assert.equal(page.items.length, 1);
  assert.ok(page.next_cursor);
  assert.equal(page.complete_for_query, false);
  assert.ok(statement.includes("j.join_status = 'exact'"));
  assert.ok(statement.includes("SELECT DISTINCT r.record_id"));
  assert.ok(statement.includes("a.record_id = j.city_address_objectid::text"));
  assert.ok(statement.includes("'full_street_name', a.fields->>'full_street_name'"));
  assert.ok(params.includes("12846"));
  assert.ok(params.includes("ACTIVE"));
  assert.ok(!statement.includes("ACTIVE"));
  const missing = await searchIndexedRecords({ source_id: "ct-liquor-permits" },
    { query: async () => [] });
  assert.equal(missing.complete_for_query, false);
  assert.equal(missing.coverage.source_checks[0].status, "not_indexed");
  await assert.rejects(searchIndexedRecords({ source_id: "municity",
    equals: { PermStatus: "Issued" } }), /PermitType/);
  await assert.rejects(searchIndexedRecords({ source_id: "parcels",
    city_parcel_id: "12846" }), /both City parcel ID/);
  delete process.env.SEARCH_DATABASE_URL;
});

test("protected REST and MCP expose the same indexed-record coverage when disconnected", async () => {
  const url = "https://example.com/api/v1/search-indexed-records";
  const body = JSON.stringify({ source_id: "parcels", equals: { use_code: "RET" } });
  const denied = await searchIndexedRecordsRoute.fetch(new Request(url, {
    method: "POST", headers: { "content-type": "application/json" }, body }));
  assert.equal(denied.status, 401);
  const auth = { authorization: `Bearer ${process.env.PILOT_API_TOKEN}` };
  const rest = await searchIndexedRecordsRoute.fetch(new Request(url, {
    method: "POST", headers: { ...auth, "content-type": "application/json" }, body }));
  assert.equal(rest.status, 200);
  const mcp = await mcpRoute.fetch(new Request("https://example.com/mcp", {
    method: "POST", headers: { ...auth, "content-type": "application/json",
      accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 91, method: "tools/call",
      params: { name: "search_indexed_records",
        arguments: { source_id: "parcels", equals: { use_code: "RET" } } } }),
  }));
  assert.equal(mcp.status, 200);
  const raw = await mcp.text();
  const payload = JSON.parse(raw.startsWith("event:")
    ? raw.match(/^data: (.+)$/m)?.[1] : raw);
  assert.deepEqual(payload.result.structuredContent, await rest.json());
});

test("City parcel search pages candidates and keeps REST and MCP responses aligned", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (!u.pathname.includes("Parcel_Viewer")) throw Error("Unexpected source");
    if (!u.pathname.endsWith("/query"))
      return json({ editingInfo: { lastEditDate: 1760000000000 } });
    if (u.searchParams.get("returnIdsOnly") === "true")
      return json({ objectIds: [10, 11] });
    if (u.searchParams.get("returnCountOnly") === "true") return json({ count: 2 });
    const ids = u.searchParams.get("objectIds").split(",").map(Number);
    return json({ features: ids.map((id) => ({ attributes: {
      objectid: id, parcel_id: 2000 + id,
      property_address: `${id} MAIN ST`, mblu: `${id} 1`,
      use_code: id === 10 ? "RET" : "APT", units_commercial: id === 10 ? "2" : "0",
      sale_date: "2025-06-01", price: 10,
    } })) });
  };
  const criteria = { scope: "city", use_codes: ["RET"], scan_limit: 1 };
  const first = await searchParcels(criteria);
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].city_parcel_id, 2010);
  assert.equal(first.complete_for_query, false);
  const second = await searchParcels({ ...criteria, cursor: first.next_cursor });
  assert.equal(second.items.length, 0);
  assert.equal(second.complete_for_query, true);
  assert.equal(second.coverage.candidate_city_features, 2);
  const auth = { authorization: "Bearer " + process.env.PILOT_API_TOKEN };
  const route = await searchParcelsRoute.fetch(new Request(
    `https://example.com/api/v1/search-parcels?scope=city&use_code=RET&scan_limit=1&cursor=${first.next_cursor}`,
    { headers: auth }));
  assert.equal(route.status, 200);
  const mcp = await mcpRoute.fetch(new Request("https://example.com/mcp", {
    method: "POST", headers: { ...auth, "content-type": "application/json",
      accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 88, method: "tools/call",
      params: { name: "search_parcels", arguments: { ...criteria,
        cursor: first.next_cursor } } }),
  }));
  assert.equal(mcp.status, 200);
  const text = await mcp.text();
  const payload = JSON.parse(text.startsWith("event:") ? text.match(/^data: (.+)$/m)?.[1] : text);
  const rest = await route.json();
  assert.deepEqual({ ...payload.result.structuredContent, retrieved_at: null },
    { ...rest, retrieved_at: null });
});

test("nearby mapped count verifies official IDs and never calls meter inventory availability", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.includes("Parcel_Viewer")) return json({ features: [{ attributes: {
      parcel_id: 999099, objectid: 9, property_address: "1 TEST ST" },
      geometry: { rings: [[[-72.93, 41.3], [-72.92, 41.3],
        [-72.92, 41.31], [-72.93, 41.3]]], spatialReference: { wkid: 4326 } },
    }], spatialReference: { wkid: 4326 } });
    if (!url.pathname.includes("Metered_Parking_Spaces")) throw Error("Unexpected source");
    if (!url.pathname.endsWith("/query")) return json({ objectIdField: "objectid" });
    if (url.searchParams.get("returnIdsOnly") === "true") return json({ objectIds: [1, 2] });
    if (url.searchParams.get("returnCountOnly") === "true") return json({ count: 2 });
    return json({ features: [
      { attributes: { objectid: 1 }, geometry: { x: -72.925, y: 41.305 } },
      { attributes: { objectid: 2 }, geometry: { x: -72.90, y: 41.32 } },
    ] });
  };
  const auth = { authorization: "Bearer " + process.env.PILOT_API_TOKEN };
  const rest = await nearbyCountsRoute.fetch(new Request(
    "https://example.com/api/v1/nearby-feature-counts?parcel_id=999099&radius_meters=400&source_id=metered-parking-spaces",
    { headers: auth }));
  assert.equal(rest.status, 200);
  const result = await rest.json();
  assert.equal(result.layers[0].mapped_count, 1);
  assert.equal(result.layers[0].candidate_count, 2);
  assert.match(result.layers[0].note, /not current availability/);
  assert.equal(result.complete_for_query, true);
});
