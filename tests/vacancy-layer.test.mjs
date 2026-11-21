import test from "node:test";
import assert from "node:assert/strict";
import { approvedListingAddresses, vacancyLayer } from "../search-index/vacancy-layer.js";
import { listCityActivity } from "../search-index/city-activity.js";

const indexTime = "2026-11-21T12:00:00Z";
const source = "https://gis.newhavenct.gov/";
const run = (source_id, run_id) => ({ source_id, run_id, scope_key: "all", status: "complete", finished_at: indexTime });
const candidate = (key, overrides = {}) => ({
  key, join_status: "exact", address_objectid: "31", parcel_id: "10", objectid: "20",
  parcel_address: "12 EXAMPLE ST", parcel_source_url: source, location_source_url: source,
  location: { type: "Point", coordinates: [-72.9, 41.3] }, neighborhoods: ["East Rock"],
  ...overrides,
});

test("approved CSV addresses normalize without dropping distinct storefronts", () => {
  assert.deepEqual(approvedListingAddresses([
    "10 Example Street, New Haven, Connecticut 06511, United States",
    "10 Example St, New Haven CT 06511", "12 Example St",
  ]), [
    { id: "10 EXAMPLE ST", address: "10 Example Street" },
    { id: "12 EXAMPLE ST", address: "12 Example St" },
  ]);
  assert.throws(() => approvedListingAddresses(["100 Example St, New Haven, NY"]), { status: 400 });
});

test("GIS pins require a unique exact City match and a single mapped point", async () => {
  const addresses = ["10 Example St", "12 Example St", "14 Example St", "16 Example St", "18 Example St"];
  const scope = await vacancyLayer(addresses, { configured: () => true, query: async (sql, values) => {
    if (sql.includes("FROM search_active_runs")) return [run("addresses", 1), run("parcels", 2)];
    assert.match(sql, /ST_Intersects\(a.geometry, p.geometry\)/);
    assert.match(sql, /NOT EXISTS \(SELECT 1 FROM address_points/);
    assert.equal(values[3].length, 5);
    return [
      candidate("10 EXAMPLE ST"), candidate("12 EXAMPLE ST", { address_objectid: null }),
      candidate("14 EXAMPLE ST"), candidate("14 EXAMPLE ST", { objectid: "99" }),
      candidate("16 EXAMPLE ST"), candidate("16 EXAMPLE ST", { location: { type: "Point", coordinates: [-72.91, 41.31] } }),
    ];
  } });
  assert.deepEqual(scope.listings.map(({ status }) => status), ["linked", "linked", "ambiguous", "linked", "unmatched"]);
  assert.deepEqual(scope.features.map(({ properties }) => properties.match), ["city-address-point", "city-parcel-address"]);
  assert.equal(scope.listings[3].geometry, null);
  const unavailable = await vacancyLayer(addresses, { configured: () => false });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.listings.length, 5);
});

test("listing Activity uses distinct verified parcel keys before paging and explicit source addresses", async (t) => {
  const original = process.env.PILOT_COOKIE_SECRET;
  process.env.PILOT_COOKIE_SECRET = "activity-listing-test-cookie-key";
  t.after(() => {
    if (original === undefined) delete process.env.PILOT_COOKIE_SECRET;
    else process.env.PILOT_COOKIE_SECRET = original;
  });
  const resolveListings = async () => ({ status: "partial", listings: [
    { id: "10 EXAMPLE ST", status: "linked", address: "10 Example St", neighborhoods: ["East Rock"], parcel_id: "10", objectid: "20" },
    { id: "12 EXAMPLE ST", status: "linked", address: "12 Example St", neighborhoods: ["East Rock"], parcel_id: "10", objectid: "20" },
    { id: "14 EXAMPLE ST", status: "ambiguous", address: "14 Example St" },
  ] });
  const filters = { collection: "civic-fit", listing_addresses: ["10 Example St", "12 Example St", "14 Example St"],
    neighborhood: "East Rock", limit: 1 };
  let hits = 0;
  const options = { resolveListings, configured: () => true, now: new Date(indexTime),
    query: async (sql, values) => {
      if (sql.includes("FROM search_active_runs")) return [run("parcels", 1), run("neighborhoods", 2)];
      if (sql.includes("SELECT DISTINCT")) return [{ name: "East Rock" }];
      assert.ok(sql.indexOf("jsonb_to_recordset($11") < sql.indexOf("LIMIT $8"));
      assert.deepEqual(JSON.parse(values[10]), [{ parcel_id: "10", objectid: "20" }]);
      hits++;
      return [{
        parcel_id: "10", objectid: "20", project_id: "permit:1",
        neighborhoods: ["East Rock"], event_date: "2026-11-20", events: [{
          activity: "permit", source_id: "municity", event_date: "2026-11-20", source_url: source,
          fields: { LegalAddress: "10 EXAMPLE STREET" },
        }, {
          activity: "license", source_id: "municipal-business-licenses", event_date: "2026-11-19", source_url: source,
          fields: { Addr1: "12 EXAMPLE ST" },
        }],
      }];
    } };
  const result = await listCityActivity(filters, options);
  assert.equal(result.collection.matching_parcels, 1);
  assert.equal(result.collection.matching_listings, 2);
  assert.deepEqual(result.items[0].listing_addresses, ["10 Example St", "12 Example St"]);
  assert.deepEqual(result.items[0].events.map(({ matched_listing_addresses }) => matched_listing_addresses), [["10 Example St"], []]);
  const empty = await listCityActivity({ ...filters, listing_query: "14" }, options);
  assert.equal(hits, 1);
  assert.deepEqual(empty.items, []);
});
