import assert from "node:assert/strict";
import test from "node:test";
import { askParcelData } from "../search-index/parcel-question.js";
import { queryParcelData } from "../search-index/parcel-query.js";
import { parcelQueryCatalog } from "../parcel/query-contract.js";

const question = "Show me Contractor contacts who did water heater replacements in the last 30 days";
const now = new Date("2026-11-20T17:00:00Z");
const catalog = async () => ({ groups: [{ name: "Plumbing", types: [{ name: "Water Heater" }] }] });
const cityParcel = { attributes: { parcel_id: 42, objectid: 99, property_address: "42 State St" } };
const permitUrl = (id) => `https://www.municityconnect.com/#/app/NewHavenCityCT/entity/Permit/${id}`;

test("work date ambiguity pauses before touching any source", async () => {
  const fail = () => assert.fail("No source or interpreter should be called during date clarification");
  const dependencies = { execute: fail, catalog: fail, interpret: fail, now };
  const clarification = await askParcelData({ question }, dependencies);
  assert.equal(clarification.status, "clarify");
  assert.equal(clarification.clarification.id, "work_date");
  assert.deepEqual(clarification.clarification.options.map(({ id }) => id), ["permit_date", "completion_date"]);
  const completion = await askParcelData({ question,
    clarification: { id: "work_date", choice: "completion_date" } }, dependencies);
  assert.equal(completion.status, "unsupported");
  assert.match(completion.reason, /no verified work-completion date/);
});

test("published work date returns only contacts attached to the qualifying permit on its exact City parcel", async () => {
  const result = await askParcelData({ question, clarification: { id: "work_date", choice: "permit_date" } }, {
    now, catalog, interpret: () => assert.fail("The checked baseline has an exact interpretation"),
    execute: (input) => queryParcelData(input, { catalog, load: async (parcelId, objectid) => {
      assert.deepEqual([parcelId, objectid], ["42", "99"]);
      return cityParcel;
    }, search: async ({ requirements }) => {
      assert.equal(requirements[0].equals.PermitType, "Water Heater");
      assert.deepEqual([requirements[0].event_date_from, requirements[0].event_date_to], ["2026-10-22", "2026-11-20"]);
      return { complete_for_query: true, coverage: { index_status: "connected" }, items: [
        { city_parcel_id: 42, city_objectid: 99, matching_sources: [{ source_id: "municity", matching_record_count: 2,
          records: ["8", "9"].map((id) => ({ record_id: id, source_url: permitUrl(id), event_date: "2026-11-03",
            fields: { PermitDate: "11/3/2026", PermitType: "Water Heater" } })) }] },
      ] };
    }, details: async (_, id) => ({
      permit: { source_url: permitUrl(id), attributes: { Description: id === "8" ? "Replace existing water heater" : "Install new heater" } },
      warnings: ["Permit Fee category was not returned."],
      items: [{ category: "Contact", event_date: null, source_record_id: `Contact:${id}`,
        source_url: permitUrl(id), attributes: { Fullname: "Published Contractor",
          ContactRole: "Contractor", Phone: "203-555-0100", PrivateField: "not requested" } },
      { category: "Contact", source_record_id: "Contact:200",
        attributes: { Fullname: "Listed owner", ContactRole: "Owner" } }],
    }) }),
  });
  assert.equal(result.status, "ready");
  assert.equal(result.items[0].city_objectid, 99);
  const [permitSource, contactSource] = result.items[0].matching_sources;
  assert.deepEqual(permitSource.records.map(({ record_id, date_field }) => [record_id, date_field]), [["8", "PermitDate"]]);
  assert.equal(contactSource.records[0].permit_id, "8");
  assert.equal(contactSource.records[0].source_url, permitUrl("8"));
  assert.equal(contactSource.records[0].event_date, null);
  assert.equal(contactSource.records[0].permit_description_as_published, "Replace existing water heater");
  assert.deepEqual(contactSource.records[0].fields,
    { Fullname: "Published Contractor", ContactRole: "Contractor", Phone: "203-555-0100" });
});

test("an optional source outage preserves the question's matching parcel and makes coverage partial", async () => {
  const result = await queryParcelData({ plan: { scope: { kind: "parcel", parcel_id: "42", objectid: "99" },
    include: [{ source_id: "parcels", fields: ["property_address"] }, { source_id: "assessor-owner" }] } }, {
    load: async () => cityParcel,
    records: async () => ({ status: "unavailable", items: [], warning: "Official assessor source unavailable" }),
  });
  assert.equal(result.items[0].city_objectid, 99);
  assert.equal(result.complete_for_query, false);
  assert.equal(result.coverage.live_source_checks.find(({ source_id }) => source_id === "assessor-owner").status, "unavailable");
  assert.deepEqual(result.items[0].matching_sources[0].records[0].fields, { property_address: "42 State St" });
});

test("an ambiguous address stays a choice until an official parcel pair is selected", async () => {
  const address = "42 State St";
  const discovery = { candidates: [
    { parcel_id: 42, objectid: 99, address: "42 State St", match: { method: "parcel-address" } },
    { parcel_id: 44, objectid: 77, address: "44 State St", match: { method: "address-point-intersection" } },
  ] };
  const resolve = async (value) => { assert.equal(value, address); return discovery; };
  const scope = { kind: "address", address };
  const initial = await queryParcelData({ plan: { scope } }, { resolve, load: assert.fail });
  assert.equal(initial.clarification.options.length, 2);
  const bogus = await queryParcelData({ plan: { scope: { ...scope, parcel_id: "42", objectid: "77" } } },
    { resolve, load: assert.fail });
  assert.equal(bogus.status, "clarify");
  const result = await queryParcelData({ plan: { scope: { ...scope, parcel_id: "42", objectid: "99" } } },
    { resolve, load: async () => cityParcel });
  assert.equal(result.status, "ready");
  assert.equal(result.address_match.searched_address, address);
});

test("a city business license question keeps its official issuance date and neighborhood scope", async () => {
  const result = await askParcelData({
    question: "Show me new business licenses in East Rock neighborhood in the last 30 days",
  }, { now, execute: async ({ plan }) => ({ status: "coverage_limited", plan, items: [] }) });
  assert.deepEqual(result.plan.scope, { kind: "neighborhood", name: "East Rock" });
  assert.deepEqual(result.plan.requirements[0],
    { source_id: "municipal-business-licenses", date: { field: "IssueDate", from: "2026-10-22", to: "2026-11-20" } });
});

test("typed queries reject unsupported date and return fields before asking any source", async () => {
  const plan = { requirements: [{ source_id: "municipal-business-licenses", date: {
    field: "CreatedDate", from: "2026-11-01" } }] };
  const result = await queryParcelData({ plan }, { search: assert.fail });
  assert.equal(result.status, "unsupported");
  const refused = await queryParcelData({ plan: { scope: { kind: "parcel", parcel_id: "42", objectid: "99" },
    include: [{ source_id: "permit-contacts", fields: ["UnpublishedNotes"] }] } }, { load: assert.fail });
  assert.equal(refused.status, "unsupported");
  assert.ok(parcelQueryCatalog().sources.find(({ source_id }) => source_id === "assessor-owner").return_fields.includes("co_owner_name"));
});
