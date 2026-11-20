import test from "node:test";
import assert from "node:assert/strict";
import route from "../api/v1/nearby-business-count.js";
import { LAYERS } from "../parcel/config.js";

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

test.beforeEach(() => {
  Object.assign(process.env, env);
  cityPoints = [point(15, 12), other];
  places = Response.json({ count: "3" });
  requests = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.href.startsWith(LAYERS.parcels + "/query")) return Response.json({ features: [parcel] });
    if (url.href.startsWith(LAYERS.addresses + "/query")) {
      assert.equal(url.searchParams.get("geometryType"), "esriGeometryPolygon");
      assert.equal(url.searchParams.get("outSR"), "4326");
      assert.equal(url.searchParams.get("returnGeometry"), "true");
      return Response.json({ features: cityPoints, spatialReference: { wkid: 4326 } });
    }
    assert.equal(url.href, "https://areainsights.googleapis.com/v1:computeInsights");
    assert.equal(options.headers["X-Goog-Api-Key"], key);
    assert.equal(options.cache, "no-store");
    requests.push(JSON.parse(options.body));
    return places;
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
