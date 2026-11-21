import test from "node:test";
import assert from "node:assert/strict";
import route from "../api/v1/parcel-opportunity.js";
import { LAYERS } from "../parcel/config.js";
import { MAP_LAYERS } from "../parcel/map-context.js";

const token = "fixture-opportunity-auth-123456";
const env = {
  PILOT_PASSPHRASE: "fixture-opportunity-passphrase-1234",
  PILOT_COOKIE_SECRET: "fixture-opportunity-cookie-1234",
  PILOT_API_TOKEN: token,
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "codex/parcel-pilot",
  OPENROUTESERVICE_API_KEY: "fixture-walking-key",
  GOOGLE_PLACES_AGGREGATE_API_KEY: "fixture-google-key",
  PARCEL_OPPORTUNITY_RATE_LIMIT_CONFIGURED: "1",
};
const host = "https://pilot.example.test/api/v1/parcel-opportunity";
const originalFetch = globalThis.fetch;
const originalEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
const origin = [-72.932, 41.31];
const project = [-72.926, 41.312];
const transitLayer = MAP_LAYERS.find(({ id }) => id === "transit-stops").url;
let parcelId = 75598;
let walks, google, maxInFlight, inFlight, longWest, longEast, invalidShort, quota, zoneCode;
const ring = (west, east, south, north) => [
  [west, south], [east, south], [east, north], [west, north], [west, south],
];
const point = (objectid, house_number, full_street_name, [x, y]) =>
  ({ attributes: { objectid, house_number, full_street_name }, geometry: { x, y } });
const area = (value, points) => (
  { type: "Feature", properties: { value }, geometry: { type: "Polygon", coordinates: [points] } }
);

test.beforeEach(() => {
  Object.assign(process.env, env);
  parcelId++;
  walks = [];
  google = [];
  maxInFlight = 0;
  inFlight = 0;
  longWest = -72.94;
  longEast = -72.928; // The walk ends at the barrier west of the project.
  invalidShort = false;
  quota = false;
  zoneCode = "BA-1";
  globalThis.fetch = async (raw, options) => {
    const url = new URL(raw);
    if (url.href.startsWith(LAYERS.parcels + "/query")) return Response.json({ features: [
      { attributes: { parcel_id: parcelId, objectid: 111, property_address: "12 CONGRESS AVE" },
        geometry: { rings: [ring(-72.934, -72.93, 41.308, 41.312)] } },
    ] });
    if (url.href.startsWith(LAYERS.addresses + "/query")) {
      if (url.searchParams.get("where").includes("DIXWELL")) return Response.json({ features:
        [point(33, 150, "DIXWELL AVE", project)] });
      return Response.json({ features:
        [point(21, 12, "CONGRESS AVE", [-72.931, 41.31]), point(22, 14, "CONGRESS AVE", origin)] });
    }
    if (url.href.startsWith(LAYERS.zoning + "/query"))
      return Response.json({ features: [{ attributes: { objectid: 7, zone_code: zoneCode } }] });
    if (url.href.startsWith(LAYERS.neighborhoods + "/query"))
      return Response.json({ features: [{ attributes: { objectid: 8, neighborhood: "Hill" } }] });
    if (url.href.startsWith(transitLayer + "/query")) {
      const envelope = JSON.parse(url.searchParams.get("geometry"));
      assert.ok(Math.abs((envelope.xmin + envelope.xmax) / 2 - origin[0]) < 1e-9);
      return Response.json({ features: [
        { attributes: { OBJECTID: 1, StopId: 100 }, geometry: { x: -72.932, y: 41.315 } },
        { attributes: { OBJECTID: 2, StopId: 101 }, geometry: { x: -72.923, y: 41.316 } },
      ] });
    }
    if (url.origin + url.pathname === transitLayer) return Response.json({});
    if (url.hostname === "api.heigit.org") {
      assert.equal(url.pathname, "/openrouteservice/v2/isochrones/foot-walking");
      assert.equal(options.headers.Authorization, env.OPENROUTESERVICE_API_KEY);
      walks.push(JSON.parse(options.body));
      const short = area(600, ring(-72.936, -72.930, 41.308, 41.313).reverse());
      if (invalidShort) short.geometry.coordinates.push(short.geometry.coordinates[0]);
      return Response.json({ type: "FeatureCollection", features: [short,
        area(1200, ring(longWest, longEast, 41.304, 41.316))] });
    }
    if (url.hostname === "areainsights.googleapis.com") {
      assert.equal(options.headers["X-Goog-Api-Key"], env.GOOGLE_PLACES_AGGREGATE_API_KEY);
      assert.equal(options.cache, "no-store");
      const query = JSON.parse(options.body);
      google.push(query);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      if (quota) return Response.json({}, { status: 429 });
      const { includedTypes } = query.filter.typeFilter;
      if (query.filter.locationFilter.circle) {
        if (includedTypes.includes("pharmacy")) return Response.json({}, { status: 502 });
        return Response.json({ count: includedTypes.includes("grocery_store") ? "0" : "3" });
      }
      const points = query.filter.locationFilter.customArea.polygon.coordinates;
      const west = Math.min(...points.map(({ longitude }) => longitude));
      if (includedTypes.length === 1 && includedTypes[0] === "pharmacy" && west === longWest)
        return Response.json({}, { status: 502 });
      if (includedTypes.length === 4 && includedTypes.includes("supermarket"))
        return Response.json({ count: west === longWest ? "2" : "0" });
      return Response.json({ count: "3" });
    }
    return Response.json({}, { status: 503 });
  };
});
test.after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function post(params = {}, authenticated = true) {
  return route.fetch(new Request(host, {
    method: "POST",
    headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({
      parcel_id: parcelId, objectid: 111, query_address: "14 Congress Ave", confirmed_vacancy: true, ...params,
    }),
  }));
}

test("Preview inspection offers half-mile research when the walking report is unavailable", async () => {
  delete process.env.PARCEL_OPPORTUNITY_RATE_LIMIT_CONFIGURED;
  const response = await route.fetch(new Request(`${host}?parcel_id=${parcelId}&objectid=111&query_address=14+Congress+Ave`, {
    headers: { authorization: `Bearer ${token}` },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const data = await response.json();
  assert.equal(data.configured, false);
  assert.equal(data.half_mile_available, true);
  assert.equal(data.default_origin, "city-address-22");
  assert.deepEqual(data.origins.map(({ id }) => id), ["city-address-21", "city-address-22"]);
  assert.equal(walks.length + google.length, 0);
});

test("analysis rejects unconfirmed vacancy, bad origins and missing Preview settings before paid calls", async () => {
  assert.equal((await post({}, false)).status, 401);
  assert.equal((await post({ confirmed_vacancy: false })).status, 400);
  assert.equal((await post({ storefront_sq_ft: 0 })).status, 400);
  assert.equal((await post({ space_checked_for: ["fresh-food"] })).status, 400);
  assert.equal((await post({ origin: "city-address-99" })).status, 422);
  delete process.env.PARCEL_OPPORTUNITY_RATE_LIMIT_CONFIGURED;
  assert.equal((await post()).status, 503);
  process.env.VERCEL_ENV = "production";
  assert.equal((await post()).status, 404);
  assert.equal(walks.length + google.length, 0);
});

test("one half-mile submission checks every category from a single verified City point", async () => {
  delete process.env.PARCEL_OPPORTUNITY_RATE_LIMIT_CONFIGURED;
  delete process.env.OPENROUTESERVICE_API_KEY;
  const mode = "half_mile";
  assert.equal((await post({ mode, confirmed_vacancy: false })).status, 400);
  assert.equal((await post({ mode, parcel_id: [parcelId] })).status, 400);
  assert.equal((await post({ mode, radius_meters: 1609 })).status, 400);
  assert.equal((await post({ mode, origin: "city-address-98" })).status, 422);
  assert.equal(google.length, 0);

  const response = await post({ mode });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const data = await response.json();
  assert.equal(data.origin.id, "city-address-22");
  assert.equal(data.radius_meters, 805);
  assert.equal(data.categories.length, 15);
  assert.equal(walks.length, 0);
  assert.equal(google.length, 14);
  assert.ok(maxInFlight <= 3);
  const requestedTypes = google.map(({ filter }) => filter.typeFilter.includedTypes);
  assert.deepEqual(requestedTypes, data.categories.filter(({ attribution }) => attribution === "Google Maps").map(({ types }) => types));
  for (const { insights, filter } of google) {
    assert.deepEqual(insights, ["INSIGHT_COUNT"]);
    assert.deepEqual(filter.locationFilter, { circle: { latLng: { latitude: origin[1], longitude: origin[0] }, radius: 805 } });
  }
  const [groceries, , pharmacy] = data.categories;
  assert.equal(groceries.status, "ok");
  assert.equal(groceries.count, 0);
  assert.equal(pharmacy.status, "unavailable");
  assert.equal(pharmacy.count, null);
  assert.equal(data.categories.at(-1).source_url, transitLayer);
  assert.equal(data.categories.at(-1).count, 1);
});

test("a Google quota response stops further half-mile lookups and preserves the City count", async () => {
  quota = true;
  const response = await post({ mode: "half_mile" });
  assert.equal(response.status, 200);
  const { categories } = await response.json();
  assert.equal(google.length, 3);
  assert.ok(categories.slice(0, -1).every(({ status, count, reason }) =>
    status === "unavailable" && count === null && reason.includes("quota")));
  assert.equal(categories.at(-1).count, 1);
});

test("both modeled walking windows use the alternate City address and return 46 bounded Google count checks", async () => {
  const response = await post({ storefront_sq_ft: 1800, space_checked_for: ["fresh-food"] });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const data = await response.json();
  assert.deepEqual(walks, [{ locations: [origin], range_type: "time", range: [600, 1200], location_type: "start" }]);
  assert.equal(google.length, 46);
  assert.ok(maxInFlight <= 6);
  assert.ok(google.every((query) => query.insights.join() === "INSIGHT_COUNT" &&
    !Object.hasOwn(query.filter.locationFilter, "circle") &&
    query.filter.locationFilter.customArea.polygon.coordinates[0].longitude < origin[0]));
  assert.equal(data.categories.length, 17);
  assert.equal(data.candidates.length, 6);
  assert.equal(data.origin.address, "14 CONGRESS AVE");
  const grocery = data.candidates.find(({ id }) => id === "fresh-food");
  assert.deepEqual(grocery.counts.map(({ count }) => count), [0, 2]);
  assert.equal(grocery.planned_project, null);
  assert.equal(grocery.access, "shorter_window");
  assert.equal(grocery.zoning.status, "by_right");
  assert.deepEqual(data.neighborhood, ["fresh-food"]);
  assert.deepEqual(data.commercial, ["fresh-food"]);
  const pharmacy = data.candidates.find(({ id }) => id === "pharmacy");
  assert.equal(pharmacy.counts[1].count, null);
  assert.equal(pharmacy.counts[1].status, "unavailable");
  assert.equal(pharmacy.access, "incomplete");
});

test("an official project inside the walking area changes the shortlist", async () => {
  longEast = -72.923;
  const data = await (await post({ storefront_sq_ft: 1800, space_checked_for: ["fresh-food"] })).json();
  const grocery = data.candidates.find(({ id }) => id === "fresh-food");
  assert.equal(grocery.planned_project.minutes, 20);
  assert.deepEqual(data.neighborhood, []);
  assert.deepEqual(data.commercial, []);
});

test("invalid geometry stays unavailable and an unreviewed zoning district stays a site check", async () => {
  invalidShort = true;
  zoneCode = "RM-2";
  const data = await (await post({ storefront_sq_ft: 1800, space_checked_for: ["fresh-food"] })).json();
  assert.equal(google.length, 23);
  assert.equal(data.walking.areas[0].status, "unavailable");
  const grocery = data.candidates.find(({ id }) => id === "fresh-food");
  assert.equal(grocery.counts[0].count, null);
  assert.equal(grocery.zoning.status, "review_needed");
  assert.deepEqual(data.commercial, []);
});

test("an upstream quota failure stops scheduling new count requests", async () => {
  quota = true;
  const data = await (await post()).json();
  assert.equal(google.length, 6);
  assert.equal(data.categories[0].counts[0].status, "unavailable");
  assert.match(data.categories[0].counts[0].reason, /quota/);
  assert.deepEqual(data.neighborhood, []);
});
