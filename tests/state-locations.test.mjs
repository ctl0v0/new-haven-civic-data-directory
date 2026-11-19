import test from "node:test";
import assert from "node:assert/strict";
import { getSourceRecords } from "../parcel/adapters.js";
import { addressEvidence } from "../parcel/address-evidence.js";
import { displayGroup, publishedStatus } from "../parcel/record-state.js";

const originalFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = originalFetch; });
const json = (value) => new Response(JSON.stringify(value), {
  headers: { "content-type": "application/json" },
});
const selected = {
  attributes: { objectid: 4401, parcel_id: 77001 },
  geometry: { rings: [[[-72.93, 41.3], [-72.92, 41.3], [-72.92, 41.31], [-72.93, 41.3]]] },
};
const point = (id, house, x) => ({
  attributes: { objectid: id, house_number: String(house), full_street_name: "MAIN ST" },
  geometry: { x, y: 41.305 },
});

test("State site locations join only through exact City addresses with a unique parcel", async () => {
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    requests.push(url);
    if (url.hostname === "data.ct.gov") {
      if (url.pathname.endsWith("/gwv2-eswx.json")) return json([
        { credential: "LCT.1", dba: "Site Bar", permit_address: "100 Main Street",
          backer_address: "102 MAIN ST", permit_city: "New Haven", status: "ACTIVE",
          effective_date: "01/01/2026", expire_date: "12/31/2027" },
        { credential: "LCT.2", permit_address: "1000 Main St", permit_city: "New Haven", status: "ACTIVE" },
      ]);
      if (url.pathname.endsWith("/h8mr-dn95.json")) return json([
        { licensenumber: "DCCC.1", name: "Site School", licensetype: "Child Care Center",
          address2: "100 MAIN ST", mailaddress2: "999 REMOTE ST", city: "NEW HAVEN",
          status: "ACTIVE", effectivedate: "2026-02-01T00:00:00.000", expirationdate: "2028-01-31T00:00:00.000" },
        { licensenumber: "DCCC.2", name: "Mail Only", address2: "999 REMOTE ST",
          mailaddress2: "100 MAIN ST", city: "NEW HAVEN", status: "ACTIVE" },
        { licensenumber: "DCCC.3", name: "Shared Address", address2: "102 MAIN ST",
          city: "NEW HAVEN", status: "ACTIVE" },
      ]);
      if (url.pathname.endsWith("/42yd-3x3d.json")) return json([
        { license: "ACRE.1", business: "Retail LLC", dba: "Site Store",
          type: "Adult-Use Cannabis Only", street: "100 MAIN ST", city: "New Haven" },
        { license: "ACRE.2", business: "Other LLC", street: "101 MAIN ST", city: "New Haven" },
      ]);
    }
    if (url.pathname.includes("New_Haven_Addresses_Authoritative_view")) {
      if (url.searchParams.get("geometryType") === "esriGeometryPolygon")
        return json({ features: [point(1, 100, -72.925), point(2, 102, -72.924)] });
      const where = url.searchParams.get("where") ?? "";
      if (where.includes("house_number = '100'"))
        return json({ features: [point(1, 100, -72.925)] });
      if (where.includes("house_number = '102'"))
        return json({ features: [point(2, 102, -72.924), point(3, 102, -72.923)] });
    }
    if (url.pathname.includes("New_Haven_Parcels_Authoritative_Parcel_Viewer")) {
      const pointGeometry = JSON.parse(url.searchParams.get("geometry"));
      return json({ features: [{ attributes: {
        objectid: pointGeometry.x === -72.923 ? 4402 : 4401,
        parcel_id: pointGeometry.x === -72.923 ? 77002 : 77001,
      } }] });
    }
    throw Error(`Unexpected upstream: ${url}`);
  };

  const [liquor, childCare, cannabis] = await Promise.all([
    getSourceRecords("ct-liquor-permits", selected),
    getSourceRecords("ct-child-care-licenses", selected),
    getSourceRecords("ct-cannabis-retail", selected),
  ]);
  assert.equal(liquor.status, "ok");
  assert.equal(liquor.items[0].category, "Permit");
  assert.deepEqual(liquor.items.map((item) => item.attributes.credential), ["LCT.1"]);
  assert.equal(liquor.items[0].attributes.backer_address, "102 MAIN ST");
  assert.equal(liquor.items[0].event_date, "2026-01-01");
  assert.equal(liquor.items[0].source_record_id, "LCT.1");
  assert.equal(liquor.items[0].match.state_site_address_field, "permit_address");
  assert.deepEqual(liquor.items[0].match.city_address_point_objectids, [1]);
  assert.equal(addressEvidence(liquor.items[0], "100 Main St").matches_query, true);
  assert.equal(displayGroup(liquor.items[0], new Date("2026-11-19T00:00:00Z")).key, "reported");
  assert.equal(displayGroup({ ...liquor.items[0], attributes: {
    ...liquor.items[0].attributes, expiration_date: "2025-12-31",
  } }, new Date("2026-11-19T00:00:00Z")).key, "past");
  assert.equal(childCare.status, "ok");
  assert.equal(childCare.items[0].category, "License");
  assert.deepEqual(childCare.items.map((item) => item.attributes.licensenumber), ["DCCC.1"]);
  assert.match(childCare.warning, /non-unique City parcel joins/);
  assert.equal(childCare.items[0].attributes.mailaddress2, "999 REMOTE ST");
  assert.equal(childCare.items[0].attributes.license_type, "Child Care Center");
  assert.equal(cannabis.status, "ok");
  assert.deepEqual(cannabis.items.map((item) => item.attributes.license), ["ACRE.1"]);
  assert.equal(publishedStatus(cannabis.items[0]), null);
  assert.equal(displayGroup(cannabis.items[0]).key, "reported");
  assert.ok(requests.filter((url) => url.pathname.includes("New_Haven_Addresses_Authoritative_view") &&
    url.searchParams.get("geometryType") === "esriGeometryPolygon").length === 1);
  assert.ok(requests.every((url) => ["data.ct.gov", "gis.newhavenct.gov"].includes(url.hostname)));
});
