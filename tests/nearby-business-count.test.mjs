import test from "node:test";
import assert from "node:assert/strict";
import { load } from "cheerio";
import route from "../api/v1/nearby-business-count.js";
import matchesRoute from "../api/v1/nearby-business-matches.js";
import { LAYERS } from "../parcel/config.js";
import { businessCategories, businessCategoryGroups } from "../parcel/nearby-business-count.js";

const host = "https://pilot.example.test";
const path = `${host}/api/v1/nearby-business-count`;
const key = "local-test-google-credential";
const token = "test-pilot-bearer-token-123456";
const env = {
  PILOT_PASSPHRASE: "test-pilot-passphrase-123456",
  PILOT_COOKIE_SECRET: "test-pilot-cookie-secret-123456",
  PILOT_API_TOKEN: token,
  PILOT_DISABLE_SHARED_TOKEN: "0",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "codex/parcel-pilot",
  GOOGLE_PLACES_AGGREGATE_API_KEY: key,
};
const oldEnv = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
const originalFetch = globalThis.fetch;
const parcel = { attributes: { parcel_id: 300021, objectid: 300022, property_address: "12 SAMPLE ST" },
  geometry: { rings: [[[-72.94, 41.30], [-72.94, 41.32], [-72.92, 41.32], [-72.92, 41.30], [-72.94, 41.30]]] } };
const point = (objectid, number, longitude = -72.93) => ({
  attributes: { objectid, house_number: number, full_street_name: "SAMPLE ST" },
  geometry: { x: longitude, y: 41.31 },
});
const other = point(22, 14, -72.932);
let places;
let cityPoints;
let requests;
let detailsRequests;
let detailsResponses;

test.beforeEach(() => {
  Object.assign(process.env, env);
  cityPoints = [point(15, 12), other];
  places = Response.json({ count: "3" });
  requests = [];
  detailsRequests = [];
  detailsResponses = new Map();
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.href.startsWith(LAYERS.parcels + "/query")) return Response.json({ features: [parcel] });
    if (url.href.startsWith(LAYERS.addresses + "/query")) {
      assert.equal(url.searchParams.get("geometryType"), "esriGeometryPolygon");
      assert.equal(url.searchParams.get("outSR"), "4326");
      assert.equal(url.searchParams.get("returnGeometry"), "true");
      return Response.json({ features: cityPoints, spatialReference: { wkid: 4326 } });
    }
    assert.equal(options.headers["X-Goog-Api-Key"], key);
    assert.equal(options.cache, "no-store");
    if (url.origin === "https://places.googleapis.com") {
      assert.match(url.pathname, /^\/v1\/places\/[a-zA-Z0-9_-]+$/);
      assert.equal(options.headers["X-Goog-FieldMask"], "displayName,formattedAddress,googleMapsUri");
      const id = url.pathname.split("/").at(-1);
      detailsRequests.push(id);
      return detailsResponses.get(id) ?? Response.json({ displayName: { text: `Business ${id}` },
        formattedAddress: "30 Sample Street, New Haven, CT", googleMapsUri: "https://maps.google.com/?cid=1" });
    }
    assert.equal(url.href, "https://areainsights.googleapis.com/v1:computeInsights");
    requests.push(JSON.parse(options.body));
    return places.clone();
  };
});
test.after(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(oldEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const identity = { parcel_id: parcel.attributes.parcel_id, objectid: parcel.attributes.objectid };
const auth = { authorization: `Bearer ${token}` };
const originRequest = (input = identity) => route.fetch(new Request(`${path}?${new URLSearchParams(input)}`, { headers: auth }));
const countRequest = (input = {}, headers = auth) => route.fetch(new Request(path, {
  method: "POST", headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify({ ...identity, category: "ice_cream_shop", ...input }),
}));
const matchRequest = (input = {}, headers = auth) => matchesRoute.fetch(new Request(`${host}/api/v1/nearby-business-matches`, {
  method: "POST", headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify({ ...identity, category: "ice_cream_shop", ...input }),
}));
const placeMatches = (ids) => Response.json({ count: String(ids.length), placeInsights: ids.map((id) => ({ place: `places/${id}` })) });

test("city origin discovery needs no Google key and does not request a Google count", async () => {
  delete process.env.GOOGLE_PLACES_AGGREGATE_API_KEY;
  cityPoints.push(point(35, 14, other.geometry.x));
  const response = await originRequest({ ...identity, query_address: "14 Sample Street" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const data = await response.json();
  assert.equal(data.configured, false);
  assert.equal(data.default_origin, "city-address-22");
  assert.equal(data.origins.length, 2);
  assert.equal((await countRequest({ query_address: "14 Sample Street" })).status, 503);
  assert.equal(requests.length, 0);
});

test("counts are live and use the verified alternate City address and one-mile default", async () => {
  const response = await countRequest({ query_address: "14 Sample Street" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const result = await response.json();
  assert.equal(result.count, 3);
  assert.equal(result.origin.address, "14 SAMPLE ST");
  assert.equal(result.attribution, "Google Maps");
  assert.equal(result.radius_label, "1 mile");
  assert.deepEqual(requests, [{ insights: ["INSIGHT_COUNT"], filter: {
    typeFilter: { includedTypes: ["ice_cream_shop"] },
    locationFilter: { circle: { latLng: { longitude: -72.932, latitude: 41.31 }, radius: 1609 } },
    operatingStatus: ["OPERATING_STATUS_OPERATIONAL"],
  } }]);
});

test("only a returned Google zero becomes a zero count", async () => {
  places = Response.json({ count: "0" });
  assert.equal((await (await countRequest({ category: "pharmacy", radius_meters: 402 })).json()).count, 0);
  places = Response.json({});
  assert.equal((await countRequest()).status, 502);
  places = Response.json({ error: { message: key } }, { status: 429 });
  const response = await countRequest();
  assert.equal(response.status, 429);
  assert.doesNotMatch(await response.text(), new RegExp(key));
  assert.equal(requests.length, 3);
});

test("an unmatched or ambiguous searched address needs an explicit verified City address choice", async () => {
  cityPoints.push(point(88, 14, -72.931));
  const origins = await (await originRequest({ ...identity, query_address: "14 Sample St" })).json();
  assert.equal(origins.default_origin, null);
  assert.equal((await countRequest({ query_address: "14 Sample St" })).status, 422);
  assert.equal((await countRequest({ query_address: "77 Sample St", origin: "parcel-center" })).status, 422);
  assert.equal((await countRequest({ query_address: "77 Sample St", origin: "city-address-900" })).status, 422);
  assert.equal(requests.length, 0);
  const result = await (await countRequest({ query_address: "77 Sample St", origin: "city-address-22" })).json();
  assert.equal(result.origin.id, "city-address-22");
  assert.equal(requests.length, 1);
});

test("a directly selected parcel can use its mapped center only by explicit choice", async () => {
  cityPoints = [];
  const origins = await (await originRequest()).json();
  assert.equal(origins.default_origin, null);
  assert.deepEqual(origins.origins.map(({ id }) => id), ["parcel-center"]);
  assert.equal((await countRequest()).status, 422);
  const result = await (await countRequest({ origin: "parcel-center" })).json();
  assert.equal(result.origin.method, "city-parcel-extent-center");
  assert.equal(requests.length, 1);
});

test("the route requires pilot access, Preview scope, and supported radius and category", async () => {
  assert.equal((await countRequest({}, {})).status, 401);
  assert.equal((await countRequest({ category: "anything" })).status, 400);
  assert.equal((await countRequest({ radius_meters: 15 })).status, 400);
  assert.equal((await countRequest({ latitude: 41.31 })).status, 400);
  process.env.VERCEL_ENV = "production";
  assert.equal((await countRequest()).status, 404);
  assert.equal((await originRequest()).status, 404);
  assert.equal(requests.length, 0);
});

test("the Preview exposes a short category menu and all supported subcategories", async () => {
  const { default: pilot } = await import("../api/pilot-page.js");
  const response = await pilot.fetch(new Request(`${host}/parcel`, { headers: auth }));
  const $ = load(await response.text());
  const catalog = load($("#nearby-business-type-catalog").html(), {}, false);
  const options = catalog("input[name=subcategory]").toArray().map((option) => catalog(option).val());
  assert.deepEqual(options, Object.keys(businessCategories));
  assert.deepEqual($("#nearby-business-category option").toArray().map((group) => $(group).val()),
    Object.keys(businessCategoryGroups));
  assert.equal($("#nearby-business-type-filter").attr("aria-controls"), "nearby-business-type-list");
  assert.equal($("#nearby-business-subcategories").attr("open"), undefined);
  const count = await (await countRequest({ category: "thai_restaurant" })).json();
  assert.equal(count.category_label, "Thai restaurants");
  assert.deepEqual(requests.at(-1).filter.typeFilter.includedTypes, ["thai_restaurant"]);
});

test("a category queries all its types or the selected subset in one count request", async () => {
  const group = "Restaurants & cuisines";
  const types = Object.keys(businessCategoryGroups[group]);
  const query = { category: undefined, group };
  assert.equal((await countRequest({ group })).status, 400);
  assert.equal((await countRequest({ ...query, subcategories: ["plumber"] })).status, 400);
  assert.equal(requests.length, 0);

  const broad = await countRequest(query);
  assert.equal(broad.status, 200);
  const result = await broad.json();
  assert.equal(result.group, group);
  assert.deepEqual(result.subcategories, []);
  assert.deepEqual(requests[0].filter.typeFilter.includedTypes, types);
  assert.equal((await countRequest({ ...query, subcategories: types })).status, 200);

  const selected = await countRequest({ ...query, subcategories: ["thai_restaurant", "indian_restaurant", "thai_restaurant"] });
  assert.equal(selected.status, 200);
  const expected = ["indian_restaurant", "thai_restaurant"];
  assert.deepEqual((await selected.json()).subcategories, expected);
  assert.deepEqual(requests[2].filter.typeFilter.includedTypes, expected);
  assert.equal(requests.length, 3);
});

test("one verified search returns live business names in bounded pages for the same match set", async () => {
  const ids = Array.from({ length: 12 }, (_, index) => String(index).padStart(2, "0"));
  places = placeMatches(ids);
  const query = { query_address: "14 Sample Street", radius_meters: 805, category: undefined,
    group: "Coffee, bakeries & sweets", subcategories: ["ice_cream_shop", "bakery"] };
  await countRequest(query);
  assert.deepEqual(detailsRequests, []);
  const response = await matchRequest(query);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const first = await response.json();
  assert.equal(first.count, 12);
  assert.equal(first.results.length, 10);
  assert.deepEqual(first.results[0], { name: "Business 00", address: "30 Sample Street, New Haven, CT", maps_url: "https://maps.google.com/?cid=1" });
  assert.deepEqual(requests[1].insights, ["INSIGHT_COUNT", "INSIGHT_PLACES"]);
  assert.deepEqual(requests[1].filter, requests[0].filter);
  assert.deepEqual(requests[1].filter.typeFilter.includedTypes, ["bakery", "ice_cream_shop"]);
  places = placeMatches([...ids].reverse());
  const second = await (await matchRequest({ ...query, subcategories: [...query.subcategories].reverse(), cursor: first.next_cursor })).json();
  assert.equal(second.results.length, 2);
  assert.equal(second.next_cursor, null);
  assert.deepEqual(detailsRequests, ids);
  assert.equal((await matchRequest({ ...query, radius_meters: 402, cursor: first.next_cursor })).status, 409);
  assert.equal((await matchRequest({ ...query, subcategories: ["bakery"], cursor: first.next_cursor })).status, 409);
  places = placeMatches([...ids.slice(0, -1), "new_match"]);
  assert.equal((await matchRequest({ ...query, cursor: first.next_cursor })).status, 409);
  assert.equal(detailsRequests.length, 12);
});

test("named matches enforce Google's limit and distinguish missing details from zero", async () => {
  places = Response.json({ count: "101" });
  assert.deepEqual(await (await matchRequest()).json(), { status: "above_limit", count: 101, results: [], next_cursor: null });
  assert.deepEqual(detailsRequests, []);
  places = Response.json({ count: "4", placeInsights: [
    { place: "places/valid" }, { place: "places/withdrawn" }, { place: "places/../invalid" },
  ] });
  detailsResponses.set("valid", Response.json({ displayName: { text: "Sample shop" }, googleMapsUri: "https://unrelated.example/" }));
  detailsResponses.set("withdrawn", Response.json({}, { status: 404 }));
  const partial = await (await matchRequest()).json();
  assert.equal(partial.count, 4);
  assert.equal(partial.results[0].address, null);
  assert.equal(new URL(partial.results[0].maps_url).searchParams.get("query_place_id"), "valid");
  assert.equal(partial.unavailable, 1);
  assert.equal(partial.missing_matches, 2);
  assert.deepEqual(detailsRequests, ["valid", "withdrawn"]);
});

test("named matches keep Preview access checks and report a blocked Places Details key", async () => {
  assert.equal((await matchRequest({}, {})).status, 401);
  process.env.VERCEL_ENV = "production";
  assert.equal((await matchRequest()).status, 404);
  assert.equal(requests.length, 0);
  process.env.VERCEL_ENV = "preview";
  places = placeMatches(["blocked"]);
  detailsResponses.set("blocked", Response.json({ error: key }, { status: 403 }));
  const response = await matchRequest();
  assert.equal(response.status, 503);
  const result = await response.text();
  assert.match(result, /Places API \(New\)/);
  assert.doesNotMatch(result, new RegExp(key));
});
