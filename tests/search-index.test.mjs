import test from "node:test";
import assert from "node:assert/strict";
import { arcgisInventory, arcgisFeatures, GIS_INDEX_FIELDS } from "../search-index/arcgis.js";
import { indexSourceCatalog } from "../search-index/catalog.js";
import { getSearchCoverage } from "../search-index/coverage.js";
import { buildIndexedSearchQuery, searchIndexedParcels } from "../search-index/search.js";
import { stateRosterInventory, stateRosterRows } from "../search-index/socrata.js";
import { arcgis } from "../parcel/http.js";
import { municipalPermitCatalogRows, municipalPermitTypeRows,
  sameMunicipalPermitRows } from "../search-index/municity.js";
import { searchIndexedPermits } from "../search-index/permits.js";
import { searchParcels } from "../parcel/parcel-search.js";
import searchParcelsRoute from "../api/v1/search-parcels.js";
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
    entry.source_id !== "parking-availability").length, 42);
  assert.equal(catalog.find((entry) => entry.source_id === "municity-permit-types")
    .index_source_id, "municity-permit-types");
  assert.equal(catalog.find((entry) => entry.source_id === "tax-bills").search_mode, "gap");
  assert.equal(catalog.find((entry) => entry.source_id === "assessor-subareas").search_mode,
    "parcel_only_pending_complete_enumeration");
  assert.equal(catalog.find((entry) => entry.source_id === "parcel-owner").index_source_id,
    "parcels");
  const coverage = await getSearchCoverage();
  assert.equal(coverage.index_status, "unconfigured");
  assert.ok(coverage.sources.every((entry) => !entry.complete));
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

test("indexed cross-source search uses exact parcel joins and refuses an unindexed source", async () => {
  const sql = buildIndexedSearchQuery([{ source_id: "zoning", equals: { zone_code: "BD" },
    event_date_from: null, event_date_to: null }], { parcels: 10, zoning: 11 }, 0, 25);
  assert.match(sql.query, /j\.join_status = 'exact'/);
  assert.match(sql.query, /'example_record'/);
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

test("indexed parcel ranges compare only source-published JSON numbers", async () => {
  const requirement = { source_id: "parcels", equals: {},
    number_gte: { units_commercial: 2 },
    number_lte: { total_assessed_parcel_value_y: 750000 },
    event_date_from: null, event_date_to: null };
  const sql = buildIndexedSearchQuery([requirement], { parcels: 10 }, 0, 25);
  assert.match(sql.query, /jsonb_typeof\(r\.fields->\$\d+\) = 'number'/);
  assert.ok(sql.values.includes(2));
  assert.ok(sql.values.includes(750000));
  assert.ok(!sql.query.includes("750000"));
  await assert.rejects(searchIndexedParcels({ requirements: [{ source_id: "parcels",
    number_gte: { owner_name_1: 2 } }] }), /numeric field/);
  await assert.rejects(searchIndexedParcels({ requirements: [{ source_id: "parcels",
    number_gte: { units_commercial: 5 }, number_lte: { units_commercial: 2 } }] }),
  /Reversed/);
});

test("municipal type import keeps only official Permit IDs and stops at the unpageable bound", async () => {
  const catalog = async () => ({ groups: [{ types: [{ name: "Hood - C" }] }] });
  const row = { Permit_ID: 569338, PermitType: "Hood - C", PermStatus: "Issued",
    PermitDate: "01/05/2026", PrintKey: "12/34/56", LegalAddress: "486 ORANGE ST" };
  const good = await municipalPermitTypeRows("Hood - C", { catalog,
    get: async () => ({ rows: [row], total: 1 }) });
  assert.equal(good.rows[0].event_date, "2026-01-05");
  assert.equal(good.rows[0].record_id, "569338");
  assert.equal(good.rows[0].fields.PrintKey, "12/34/56");
  await assert.rejects(municipalPermitTypeRows("Hood - C", { catalog,
    get: async () => ({ rows: [row], total: 2000 }) }), /2,000-row bound/);
  await assert.rejects(municipalPermitTypeRows("Hood - C", { catalog,
    get: async () => ({ rows: [row, row], total: 2 }) }), /unique published Permit_ID/);
});

test("municipal refresh compares published permit IDs independent of vendor row order", () => {
  const a = { record_id: "569338", published_status: "Issued" };
  const b = { record_id: "569339", published_status: "Issued" };
  assert.equal(sameMunicipalPermitRows([a, b], [b, a]), true);
  assert.equal(sameMunicipalPermitRows([a, b], [b, { ...a, record_id: b.record_id,
    published_status: "Voided" }]), false);
  assert.equal(sameMunicipalPermitRows([a, b], [a]), false);
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
