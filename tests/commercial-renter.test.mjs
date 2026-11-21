import assert from "node:assert/strict";
import test from "node:test";
import mcp from "../api/mcp.js";
import route from "../api/v1/commercial-renter.js";
import { LAYERS } from "../parcel/config.js";
import { countNearbyPlaces, getCommercialStorefrontEvidence, searchCommercialVacancies } from "../search-index/commercial-renter.js";
import { planRenterQuestion } from "../search-index/renter-question.js";

const storefront = { address: "486 Orange St", parcel_id: "12846", objectid: "4157" };
const alternate = { ...storefront, address: "488 Orange St" };
const sourceUrl = "https://www.municityconnect.com/#/app/NewHavenCityCT/entity/Permit/569338";
const hood = { permit_id: "569338", permit_number: "M-23-00357", permit_type: "Hood - C",
  permit_status: "Issued", permit_date: "2023-05-01", published_legal_address: "486 ORANGE STREET",
  city_parcel_id: 12846, city_objectid: 4157, permit_source_url: sourceUrl };
const catalog = async () => ({ partial: false, groups: [{ types: [{ name: "Hood - C" }, { name: "Plumbing" }] }] });
const resolve = async () => ({ status: "resolved", candidates: [{ ...storefront, address: "486 ORANGE ST" }] });

test("renter questions keep the selected address and detect an explicit address after a fractional radius", () => {
  const shortlist = planRenterQuestion("Which listed storefronts in East Rock have a commercial hood permit on record?", storefront);
  assert.deepEqual(shortlist.renter_plan.arguments, { neighborhood: "East Rock", hood_permit: true });
  const followUps = [
    ["Was the hood permit issued, and did it pass inspection?", "hood"],
    ["Was it inspected?", "hood"],
    ["Was there a restaurant here before?", "history"],
    ["How much ground-floor space is there?", "space"],
    ["What’s the zoning here?", "zoning"],
    ["What permits or applications should I look at to open here?", "applications"],
    ["Would the landlord take a one-year lease or a pop-up?", "lease"],
  ];
  for (const [question, section] of followUps)
    assert.deepEqual(planRenterQuestion(question, storefront).renter_plan.arguments, { section, storefront });
  const search = planRenterQuestion("Thai restaurants within 1/4 mile of 488 Orange St?", storefront);
  assert.deepEqual(search.renter_plan.arguments,
    { category: "thai_restaurant", radius_meters: 402, storefront: { address: "488 Orange St" } });
  assert.equal(planRenterQuestion("How many Thai restaurants within a 10-minute walk?", storefront).status, "clarify");
  assert.equal(planRenterQuestion("Show plumbing inspections at 486 Orange St", storefront), null);
});

test("vacancy shortlist intersects exact City parcel pairs and labels a hood permit at a sibling address", async () => {
  const listings = [alternate, storefront].map(({ address, parcel_id, objectid }) => ({
    address, parcel_id, objectid, status: "linked", neighborhoods: ["EAST-ROCK"], neighborhood_aliases: ["East Rock"],
  }));
  listings.push({ address: "123 Sample St", status: "ambiguous" });
  const result = await searchCommercialVacancies({ neighborhood: "East Rock", hood_permit: true }, {
    layer: async () => ({ status: "partial", listings, neighborhood_indexed_at: "2026-11-21" }),
    catalog,
    search: async (input, { parcelKeys }) => {
      assert.deepEqual(input.permit_types, ["Hood - C"]);
      assert.deepEqual(parcelKeys, [{ parcel_id: "12846", objectid: "4157" }]);
      return { items: [hood], next_cursor: null, complete_for_query: false,
        coverage: { source_checks: [{ source_id: "municity", status: "partial" }] } };
    },
  });
  assert.equal(result.status, "partial");
  assert.equal(result.coverage.unresolved_listings, 1);
  assert.equal(result.items[0].hood_permit.address_evidence.matches_query, true);
  assert.equal(result.items[1].hood_permit.address_evidence.matches_query, false);
  assert.equal(result.items[1].storefront.address, "488 Orange St");
  assert.equal(result.items[0].availability, "unverified");
});

test("storefront evidence keeps the published permit date and linked inspection without asserting equipment condition", async () => {
  const result = await getCommercialStorefrontEvidence({ storefront, section: "hood" }, {
    resolve, catalog, load: async () => ({}),
    search: async () => ({ items: [hood], coverage: { source_checks: [] }, complete_for_query: true, next_cursor: null }),
    records: async () => ({ source_id: "municity", status: "ok", items: [{ category: "Permit", source_url: sourceUrl,
      attributes: { Permit_ID: 569338, PermitType: "Hood - C", PermitNo: "M-23-00357",
        PermitDate: "/Date(1682899200000)/", LegalAddress: "486 ORANGE ST", PermStatus: "Issued" } }] }),
    details: async (_parcel, permitId) => {
      assert.equal(permitId, "569338");
      return { warnings: [], partial: false, items: [{ category: "Inspection", attributes: { Results: "Pass" } }] };
    },
  });
  assert.equal(result.permits.length, 1);
  assert.equal(result.permits[0].permit_date, "2023-05-01");
  assert.equal(result.permits[0].address_evidence.matches_query, true);
  assert.equal(result.work[0].inspections[0].attributes.Results, "Pass");
  assert.equal(result.equipment_condition, "unverified");
  const lease = await getCommercialStorefrontEvidence({ storefront, section: "lease" }, { resolve });
  assert.equal(lease.lease_terms, null);
});

test("a nearby search waits for a matching City address point and retains a true zero", async () => {
  const points = [
    { method: "city-address-point", id: "city-address-1", address: storefront.address },
    { method: "city-address-point", id: "city-address-2", address: storefront.address },
    { method: "city-address-point", id: "city-address-3", address: alternate.address },
  ];
  let calls = 0;
  const dependencies = { resolve, origins: async () => ({ origins: points }), countPlaces: async (input) => {
    calls++;
    assert.equal(input.origin, "city-address-2");
    assert.equal(input.radius_meters, 402);
    assert.equal(input.category, "thai_restaurant");
    return { count: 0 };
  } };
  const input = { storefront, category: "thai_restaurant" };
  assert.equal((await countNearbyPlaces(input, dependencies)).origins.length, 2);
  assert.equal((await countNearbyPlaces({ ...input, origin: "city-address-3" }, dependencies)).status, "clarify");
  assert.equal(calls, 0);
  const result = await countNearbyPlaces({ ...input, origin: "city-address-2" }, dependencies);
  assert.equal(result.count, 0);
  assert.equal(result.attribution, "Google Maps");
  assert.equal(result.distance_method, "straight_line_radius");
  assert.equal(calls, 1);
});

test("authenticated Preview MCP plans before Google lookup and can request place names", async (t) => {
  const env = {
    PILOT_API_TOKEN: "fixture-commercial-renter-token-123456",
    PILOT_PASSPHRASE: "fixture-commercial-renter-pass-123456",
    PILOT_COOKIE_SECRET: "fixture-commercial-renter-secret-123456",
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "codex/parcel-pilot",
    GOOGLE_PLACES_AGGREGATE_API_KEY: "fixture-maps-key",
  };
  for (const [name, value] of Object.entries(env)) {
    const original = process.env[name];
    process.env[name] = value;
    t.after(() => original === undefined ? delete process.env[name] : process.env[name] = original);
  }
  let aggregateRequests = 0;
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input);
    if (url.href.startsWith(LAYERS.parcels + "/query")) return Response.json({ features: [{
      attributes: { parcel_id: 12846, objectid: 4157, property_address: "486 ORANGE ST" },
      geometry: { rings: [[[-72.94, 41.30], [-72.94, 41.32], [-72.92, 41.32], [-72.92, 41.30], [-72.94, 41.30]]] },
    }] });
    if (url.href.startsWith(LAYERS.addresses + "/query")) return Response.json({ spatialReference: { wkid: 4326 },
      features: [{ attributes: { objectid: 23, house_number: 486, full_street_name: "ORANGE ST" },
        geometry: { x: -72.93, y: 41.31 } }] });
    if (url.href.startsWith(LAYERS.addresses + "?")) return Response.json({ fields: [] });
    if (url.hostname === "areainsights.googleapis.com") {
      aggregateRequests++;
      const { insights, filter } = JSON.parse(options.body);
      assert.equal(filter.locationFilter.circle.radius, 402);
      assert.deepEqual(filter.typeFilter.includedTypes, ["thai_restaurant"]);
      return Response.json({ count: "1", ...(insights.includes("INSIGHT_PLACES")
        ? { placeInsights: [{ place: "places/fixture-id" }] } : {}) });
    }
    if (url.hostname === "places.googleapis.com") return Response.json({ displayName: { text: "Sample Thai restaurant" } });
    throw new Error(`Unexpected request to ${url.hostname}`);
  });
  const request = (method, params, authorized = true) => new Request("https://pilot.example.test/mcp", {
    method: "POST", headers: { accept: "application/json, text/event-stream", "content-type": "application/json",
      ...(authorized ? { authorization: `Bearer ${env.PILOT_API_TOKEN}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const call = async (name, args) => {
    const response = await mcp.fetch(request("tools/call", { name, arguments: args }));
    const payload = response.headers.get("content-type")?.includes("text/event-stream")
      ? JSON.parse((await response.text()).split("\n").find((line) => line.startsWith("data: ")).slice(6))
      : await response.json();
    assert.equal(payload.result?.isError, undefined, JSON.stringify(payload));
    return payload.result.structuredContent;
  };

  const denied = await mcp.fetch(request("tools/list", {}, false));
  assert.equal(denied.status, 401);
  const preview = await call("ask_parcel_data", {
    question: "How many Thai restaurants are within a quarter mile?", plan_only: true, storefront,
  });
  assert.equal(preview.renter_plan.tool, "count_nearby_places");
  assert.equal(aggregateRequests, 0);
  const count = await call(preview.renter_plan.tool, preview.renter_plan.arguments);
  assert.equal(count.count, 1);
  const result = await call("list_nearby_places", { ...preview.renter_plan.arguments, count: count.count, origin: count.origin.id });
  assert.equal(result.results[0].name, "Sample Thai restaurant");
  assert.match(result.results[0].maps_url, /^https:\/\/www.google.com\/maps\//);
  assert.equal(aggregateRequests, 2);

  process.env.VERCEL_ENV = "production";
  const production = await route.fetch(new Request("https://pilot.example.test/api/v1/commercial-renter", {
    method: "POST", headers: { authorization: `Bearer ${env.PILOT_API_TOKEN}` },
    body: JSON.stringify(preview.renter_plan),
  }));
  assert.equal(production.status, 404);
});
