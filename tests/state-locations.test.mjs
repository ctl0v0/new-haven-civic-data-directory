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

test("State registrations use the official business street, retain units, and exclude ambiguous parcel joins", async () => {
  const cityParcel = { ...selected, attributes: { parcel_id: 11483, objectid: 8207, property_address: "4 PEARL ST" } };
  const address = (objectid, house_number, full_street_name, x, unit) => ({
    attributes: { objectid, house_number, full_street_name, unit }, geometry: { x, y: 41.305 },
  });
  const state = address(10, "820", "STATE ST", -72.925, "2");
  const pearl = address(11, "4", "PEARL ST", -72.924);
  const ambiguous = address(12, "822", "STATE ST", -72.922);
  const business = (number, billingstreet, fields = {}) => ({ id: `0018y000009pQ8nAA${number}`,
    name: `Fixture business ${number}`, billingcity: "New Haven", billingstate: "CT", billingstreet, ...fields });
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    const where = url.searchParams.get("$where") ?? url.searchParams.get("where") ?? "";
    if (url.pathname.endsWith("/n7gp-d28j.json")) {
      assert.match(where, /^upper\(billingcity\)='NEW HAVEN' AND upper\(billingstate\)='CT'/);
      assert.match(where, /'820 %'/);
      assert.match(where, /'4 %'/);
      return json([
        business(1, "820 State Street, Suite 2", { billing_unit: "STE 2", status: "Active", date_registration: "2020-06-01T00:00:00.000" }),
        business(2, "4 Pearl St", { date_registration: "0001-01-01T00:00:00.000" }),
        business(3, "820 State St", { billing_unit: "3" }),
        business(4, "24 Main St", { mailing_address: "820 State St" }),
        business(5, "822 State St"),
      ]);
    }
    if (url.pathname.includes("New_Haven_Addresses_Authoritative_view")) {
      if (url.searchParams.get("geometryType") === "esriGeometryPolygon")
        return json({ features: [state, pearl, ambiguous] });
      if (where.includes("'820'")) return json({ features: [state] });
      if (where.includes("'4'")) return json({ features: [pearl] });
      if (where.includes("'822'")) return json({ features: [ambiguous, address(13, "822", "STATE ST", -72.921)] });
    }
    if (url.pathname.includes("New_Haven_Parcels_Authoritative_Parcel_Viewer")) {
      const { x } = JSON.parse(url.searchParams.get("geometry"));
      return json({ features: [{ attributes: x === -72.921 ? { parcel_id: 1, objectid: 2 } : cityParcel.attributes }] });
    }
    throw Error(`Unexpected upstream: ${url}`);
  };
  const result = await getSourceRecords("ct-business-registrations", cityParcel);
  assert.equal(result.status, "partial");
  assert.match(result.warning, /non-unique City parcel joins/);
  assert.deepEqual(result.items.map(({ attributes }) => attributes.name), ["Fixture business 1", "Fixture business 2", "Fixture business 3"]);
  assert.deepEqual(result.items.map(({ event_date }) => event_date), ["2020-06-01", null, null]);
  const [confirmed, , noCityUnit] = result.items;
  assert.equal(confirmed.category, "Registration");
  assert.equal(confirmed.match.verified_city_unit, "2");
  assert.equal(confirmed.match.city_parcel_id, 11483);
  assert.deepEqual(confirmed.match.city_address_point_objectids, [10]);
  assert.equal(new URL(confirmed.source_url).searchParams.get("id"), confirmed.source_record_id);
  assert.equal(addressEvidence(confirmed, "820 State St").matches_query, true);
  assert.equal(addressEvidence(confirmed, "820 State St #2").matches_query, true);
  assert.equal(addressEvidence(noCityUnit, "820 State St #3").matches_query, false);
  assert.equal(addressEvidence(confirmed, "4 Pearl St").matches_query, false);
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
      if (url.pathname.endsWith("/ngch-56tr.json")) {
        assert.match(url.searchParams.get("$where"), /PUBLIC CHARITY.*PUBLIC CHARITY - EXEMPT/);
        assert.equal(url.searchParams.get("$order"), "credentialid");
        return json([
          { credentialid: "2671715", credential: "PUBLIC CHARITY", fullcredentialcode: "CHR.0068611",
            businessname: "CONNECTICUT COMMUNITY BICYCLE WORKSHOP INC", dba: "BRADLEY STREET BICYCLE CO-OP",
            address: "100 MAIN ST", city: "NEW HAVEN", status: "ACTIVE",
            issuedate: "2024-11-19T00:00:00.000", expirationdate: "2027-11-30T00:00:00.000" },
          { credentialid: "123", credential: "PUBLIC CHARITY - EXEMPT", address: "102 MAIN ST", city: "NEW HAVEN" },
        ]);
      }
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

  const [liquor, childCare, cannabis, charity] = await Promise.all([
    getSourceRecords("ct-liquor-permits", selected),
    getSourceRecords("ct-child-care-licenses", selected),
    getSourceRecords("ct-cannabis-retail", selected),
    getSourceRecords("ct-public-charities", selected),
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
  assert.equal(charity.items.length, 1);
  assert.match(charity.warning, /non-unique City parcel joins/);
  const [registration] = charity.items;
  assert.equal(registration.category, "Registration");
  assert.equal(registration.source_record_id, "2671715");
  assert.equal(registration.attributes.dba, "BRADLEY STREET BICYCLE CO-OP");
  assert.equal(registration.attributes.registered_address_as_published, "100 MAIN ST");
  assert.equal(registration.attributes.site_address_as_published, undefined);
  assert.equal(registration.match.method, "state-registered-address-city-address-point-unique-parcel");
  assert.equal(registration.event_date, "2024-11-19");
  assert.equal(addressEvidence(registration, "100 Main Street").matches_query, true);
  assert.equal(addressEvidence(registration, "102 Main St").matches_query, false);
  assert.equal(displayGroup(registration, new Date("2026-11-21T00:00:00Z")).key, "reported");
  assert.ok(requests.filter((url) => url.pathname.includes("New_Haven_Addresses_Authoritative_view") &&
    url.searchParams.get("geometryType") === "esriGeometryPolygon").length === 1);
  assert.ok(requests.every((url) => ["data.ct.gov", "gis.newhavenct.gov"].includes(url.hostname)));
  const unlinked = await getSourceRecords("ct-child-care-licenses", {
    ...selected, attributes: { objectid: 4402, parcel_id: 77002 },
  });
  assert.equal(unlinked.status, "not_linked");
  assert.deepEqual(unlinked.items, []);
  assert.match(unlinked.warning, /non-unique City parcel joins/);
});
