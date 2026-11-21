import assert from "node:assert/strict";
import test from "node:test";
import { askParcelData } from "../search-index/parcel-question.js";
import { queryParcelData } from "../search-index/parcel-query.js";
import { questionDates } from "../search-index/question-dates.js";
import { searchIndexedParcels } from "../search-index/search.js";
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

test("school questions preserve the address and select the published NHPS names", async () => {
  const address = "20 Eld St";
  const source = "https://www.newhavenmagnetschools.com/index.php/enrollment/find-schools-in-your-attendance-zone";
  const feature = { attributes: { parcel_id: 11236, objectid: 979, property_address: address } };
  const resolve = async (value) => {
    assert.equal(value, address);
    return { candidates: [{ parcel_id: 11236, objectid: 979, address,
      match: { method: "address-point-intersection" } }] };
  };
  const records = async (sourceId) => {
    assert.equal(sourceId, "school-attendance");
    return { status: "ok", items: [
      { source_id: sourceId, source_record_id: "20 ELD ST:245", source_url: source,
        attributes: { address: "20 ELD ST", k8_attendance_zone_school: "East Rock Magnet",
          high_school_attendance_zone_school: "Wilbur Cross", street_name_as_published: "ELD ST",
          source_lookup_mode: "official_snapshot", source_snapshot_retrieved_at: "2026-11-19T13:20:40+00:00" } },
      { source_id: sourceId, source_record_id: "2 SIDE STREET:999", source_url: source,
        attributes: { address: "2 SIDE ST", k8_attendance_zone_school: "Fixture School" } },
    ] };
  };
  const answer = await askParcelData({ question: "What school would 20 Eld St go to?" }, {
    execute: (input) => queryParcelData(input, { resolve, load: async () => feature, records }),
    interpret: () => assert.fail("A simple school query should not need a gateway"),
  });
  assert.equal(answer.status, "ready");
  assert.equal(answer.items[0].city_objectid, 979);
  const zones = answer.items[0].matching_sources[0].records;
  assert.equal(zones.length, 1);
  assert.equal(zones[0].address_evidence.matches_query, true);
  assert.equal(zones[0].source_lookup_mode, "official_snapshot");
  assert.deepEqual(zones[0].fields, { k8_school: "East Rock Magnet", high_school: "Wilbur Cross" });
});

const plumbingQuestion = "Show me contractor contacts that have done plumbing work in the last 90 days";

test("permits for plumbing searches the full published group by PermitDate", async () => {
  const tradeCatalog = async () => ({ groups: [
    { name: "Plumbing", types: [{ name: "Plumbing Permit" }, { name: "Water Heater" }] },
    { name: "Electrical", types: [{ name: "Electrical Permit" }] },
  ] });
  const review = await askParcelData({ question: "show me permits for plumbing in the last 30 days", plan_only: true }, {
    now, interpret: () => assert.fail("The plain trade query should not require model interpretation"),
    execute: () => assert.fail("No parcel search should run before confirmation"),
  });
  assert.equal(review.status, "planned");
  assert.equal(review.items, undefined);
  assert.deepEqual(review.plan.requirements[0], { source_id: "municity", permit_group: "Plumbing",
    date: { field: "PermitDate", from: "2026-10-22", to: "2026-11-20" } });
  assert.equal(review.plan.permit_description_terms, undefined);

  const answer = await queryParcelData({ plan: review.plan }, { catalog: tradeCatalog,
    search: async ({ requirements }, { projection }) => {
      assert.equal(requirements[0].equals, undefined);
      assert.deepEqual(projection.permit_types, ["PLUMBING PERMIT", "WATER HEATER"]);
      assert.deepEqual([requirements[0].event_date_from, requirements[0].event_date_to],
        ["2026-10-22", "2026-11-20"]);
      return { complete_for_query: true, coverage: { index_status: "connected" }, items: [
        { city_parcel_id: 42, city_objectid: 99, matching_sources: [{ source_id: "municity", matching_record_count: 1,
          records: [{ record_id: "8", source_url: permitUrl("8"), event_date: "2026-11-03",
            fields: { PermitType: "Water Heater", PermitDate: "11/3/2026" } }] }] },
      ] };
    },
  });
  assert.equal(answer.status, "ready");
  assert.deepEqual(answer.plan, review.plan);
  assert.equal(answer.items[0].matching_sources[0].records[0].fields.PermitType, "Water Heater");
});

test("broad plumbing work asks about the date and then uses the official group without a keyword", async () => {
  const fail = () => assert.fail("This question should be handled before any source or model call");
  const initial = await askParcelData({ question: plumbingQuestion }, {
    now, catalog: fail, execute: fail, interpret: fail,
  });
  assert.equal(initial.clarification.id, "work_date");
  const answer = await askParcelData({ question: plumbingQuestion,
    clarification: { id: "work_date", choice: "permit_date" } }, {
    now, interpret: fail, execute: async ({ plan }) => ({ status: "ready", plan }),
  });
  assert.deepEqual(answer.plan.requirements[0], { source_id: "municity", permit_group: "Plumbing",
    date: { field: "PermitDate", from: "2026-08-23", to: "2026-11-20" } });
  assert.equal(answer.plan.permit_description_terms, undefined);
  assert.equal(answer.plan.contact_role, "contractor");
  assert.equal(answer.plan.require_contact_role, true);
});

test("language interpretation removes redundant trade text and respects explicitly requested description terms", async () => {
  const interpret = async () => ({
    intent: "search", scope: { kind: "city" },
    requirements: [{ source_id: "municity", permit_selection: { kind: "group", name: "Plumbing" }, predicates: [],
      date: { field: "PermitDate", days: 90 } }],
    include: [{ source_id: "permit-contacts", fields: ["ContactRole"] }],
    contact_role: "Contractor", require_contact_role: true,
    permit_description_terms: ["plumbing"],
  });
  const dependencies = { now, catalog, interpret,
    execute: async ({ plan }) => ({ status: "ready", plan }) };
  const broad = await askParcelData({ question: "Find listed plumbing permit contractors from the last 90 days." }, dependencies);
  const explicit = await askParcelData({
    question: "Find listed plumbing permit contractors from the last 90 days when the description says plumbing.",
  }, dependencies);
  assert.equal(broad.plan.permit_description_terms, undefined);
  assert.deepEqual(explicit.plan.permit_description_terms, ["plumbing"]);
});

test("a model plan keeps an exact permit type and rejects an extra type predicate", async () => {
  const question = 'Which permits of type "Water Heater" were recorded in the last 30 days?';
  const requirement = { source_id: "municity", permit_selection: { kind: "type", name: "Water Heater" },
    predicates: [], date: { field: "PermitDate", days: 30 } };
  const interpret = async () => ({ intent: "search", scope: { kind: "city" }, requirements: [requirement],
    include: [], permit_description_terms: [] });
  const dependencies = { now, catalog, interpret,
    execute: () => assert.fail("No parcel search should run before confirmation") };
  const review = await askParcelData({ question, plan_only: true }, dependencies);
  assert.equal(review.status, "planned");
  assert.deepEqual(review.plan.requirements[0].equals, { PermitType: "Water Heater" });
  assert.equal(review.plan.requirements[0].permit_group, undefined);
  requirement.predicates = [{ field: "PermitType", operator: "equals", value: "Water Heater" }];
  assert.equal((await askParcelData({ question, plan_only: true }, dependencies)).status, "planned");

  requirement.permit_selection = { kind: "group", name: "Plumbing" };
  requirement.predicates = [{ field: "PermitType", operator: "equals", value: "Water Heater" }];
  const invalid = await askParcelData({ question, plan_only: true }, dependencies);
  assert.equal(invalid.status, "clarify");
  assert.equal(invalid.reason_code, "invalid_interpretation");
  assert.equal(invalid.plan, undefined);
});

test("calendar phrases use New Haven dates with inclusive bounds", () => {
  const expectWindow = (question, expected, clock = now) => {
    const { from, to } = questionDates(question, clock);
    assert.deepEqual([from, to], expected);
  };
  expectWindow("pulled last month", ["2026-10-01", "2026-10-31"]);
  expectWindow("any permits this past month?", ["2026-10-22", "2026-11-20"]);
  expectWindow("applications filed this week", ["2026-11-16", "2026-11-20"]);
  expectWindow("in the last two weeks", ["2026-11-07", "2026-11-20"]);
  expectWindow("in the past six months", ["2026-05-21", "2026-11-20"]);
  expectWindow("since January 1, 2026", ["2026-01-01", "2026-11-20"]);
  expectWindow("in the last 1 day", ["2026-11-20", "2026-11-20"], new Date("2026-11-21T02:00:00Z"));
  assert.ok(questionDates("during the same 30-day period", now).issue);
  assert.ok(questionDates("since February 30, 2026", now).issue);
});

test("common permit and license QA questions retain exact search criteria without the model", async () => {
  const fail = () => assert.fail("A recognized plan should bypass the model and wait for confirmation");
  const deps = { now, interpret: fail, execute: fail, catalog: async () => ({ groups: [
    { name: "Plumbing", types: [{ name: "Plumbing Permit" }, { name: "Water Heater - C" }] },
    { name: "Building", types: [{ name: "Roofing - C" }] },
    { name: "Mechanical", types: [{ name: "Hood - C" }] },
  ] }) };
  const cases = [
    ["Any plumbing permits in East Rock this past month?", { kind: "neighborhood", name: "East Rock" }, "Plumbing", ["2026-10-22", "2026-11-20"]],
    ["Pull electrical permits on commercial parcels from the past 30 days.", { kind: "city" }, "Electrical", ["2026-10-22", "2026-11-20"], "business_space"],
    ["Show strictly commercial parcels with a Hood - C permit dated in October 2026.", { kind: "city" }, "Hood - C", ["2026-10-01", "2026-10-31"], "commercial_only"],
    ["Find permits of the exact type Plumbing Permit from the last 30 days.", { kind: "city" }, "Plumbing Permit", ["2026-10-22", "2026-11-20"]],
    ["Find electrical permits pulled last month. Give me the published permit date.", { kind: "city" }, "Electrical", ["2026-10-01", "2026-10-31"]],
    ["Find Roofing - C permits, regardless of how the parcel is classified.", { kind: "city" }, "Roofing - C"],
  ];
  for (const [question, scope, selector, dates, use] of cases) {
    const response = await askParcelData({ question, plan_only: true }, deps);
    assert.equal(response.status, "planned", question);
    assert.deepEqual(response.plan.scope, scope);
    assert.equal(response.plan.parcel_use_category, use);
    const [filter] = response.plan.requirements;
    assert.equal(filter.permit_group ?? filter.equals?.PermitType, selector);
    assert.deepEqual(filter.date, dates ? { field: "PermitDate", from: dates[0], to: dates[1] } : undefined);
  }
  const liquor = await askParcelData({ question: "Which parcels have Connecticut liquor permits linked to them? Show the business name, licensed address, and published status.", plan_only: true }, deps);
  assert.deepEqual(liquor.plan.requirements, [{ source_id: "ct-liquor-permits" }]);
  assert.ok(liquor.plan.include[0].fields.includes("permit_address"));
  const charity = await askParcelData({ question: "Show public charity registrations at 138 Bradley Street", plan_only: true }, deps);
  assert.equal(charity.status, "planned");
  assert.deepEqual(charity.plan.scope, { kind: "address", address: "138 Bradley Street" });
  assert.deepEqual(charity.plan.requirements, []);
  assert.deepEqual(charity.plan.include, [{ source_id: "ct-public-charities" }]);
  const charities = await askParcelData({ question: "List public charities in East Rock neighborhood", plan_only: true }, deps);
  assert.equal(charities.status, "planned");
  assert.deepEqual(charities.plan.scope, { kind: "neighborhood", name: "East Rock" });
  assert.deepEqual(charities.plan.requirements, [{ source_id: "ct-public-charities" }]);
  const description = await askParcelData({ question: "Show plumbing permits where the description actually says ‘replace.’", plan_only: true }, deps);
  assert.deepEqual(description.plan.permit_description_terms, ["replace"]);
});

test("unsupported issuance, completion, cottage food, and radius queries never offer a broader search", async () => {
  const fail = () => assert.fail("Do not call the model or search when a known constraint cannot be met");
  for (const [question, status, code] of [
    ["List permits issued last month. Give me the issuance date.", "clarify", "unverified_event_date"],
    ["Who actually finished an addition in Westville this year?", "unsupported"],
    ["Has the state issued any cottage food licenses in New Haven this year?", "unsupported", "unverified_source"],
    ["Any food businesses licensed within a quarter mile of 965 State St in the past six months?", "unsupported", "unsupported_scope"],
    ["Find all kinds of plumbing permits from the same 30-day period.", "clarify", "date_range"],
  ]) {
    const response = await askParcelData({ question }, { now, interpret: fail, execute: fail });
    assert.equal(response.status, status);
    assert.equal(response.reason_code, code);
    assert.equal(response.plan, undefined);
  }
});

test("fallback plans keep the requested calendar and parcel-use meaning", async () => {
  const response = await askParcelData({ question: "Which commercial parcels had electrical permits pulled last month?", plan_only: true }, {
    now,
    catalog: async () => ({ groups: [{ name: "Electrical", types: [{ name: "Electrical Permit" }] }] }),
    execute: assert.fail,
    interpret: async () => ({ intent: "search", scope: { kind: "city" }, use_category: "commercial_only",
      requirements: [{ source_id: "municity", permit_selection: { kind: "group", name: "Electrical" },
        predicates: [], date: { field: "PermitDate", days: 30 } }], include: [], permit_description_terms: [] }),
  });
  assert.equal(response.status, "planned");
  assert.equal(response.plan.parcel_use_category, "business_space");
  assert.deepEqual(response.plan.requirements[0].date, { field: "PermitDate", from: "2026-10-01", to: "2026-10-31" });
});

test("application filing plans compile one supported parent type and use ApplicationDate", async () => {
  const result = await askParcelData({ question: "Which kitchen hood applications were filed last month?", plan_only: true }, {
    now, catalog, execute: assert.fail, interpret: async () => ({ intent: "search", scope: { kind: "city" },
      requirements: [{ source_id: "municity-permit-activity", permit_selection: { kind: "type", name: "Hood - C" },
        predicates: [{ field: "activity_kind", operator: "equals", value: "application" },
          { field: "permit_type", operator: "equals", value: "Hood - C" }], date: { field: "ApplicationDate", days: 30 } }],
      include: [], permit_description_terms: [] }),
  });
  assert.equal(result.status, "planned");
  assert.deepEqual(result.plan.requirements[0], { source_id: "municity-permit-activity",
    equals: { activity_kind: "application", permit_type: "Hood - C" },
    date: { field: "ApplicationDate", from: "2026-10-01", to: "2026-10-31" } });
});

test("a plan-only permit-number lookup searches linked active inventory only after confirmation", async () => {
  const review = await askParcelData({ question: "What happened after permit M-23-00357 was filed? Show the linked application, reviews, inspections, and their dates.", plan_only: true }, {
    now, execute: assert.fail, interpret: assert.fail,
  });
  assert.equal(review.status, "planned");
  assert.deepEqual(review.plan.requirements[0].equals, { PermitNo: "M-23-00357" });
  assert.deepEqual(review.plan.include.map(({ source_id }) => source_id),
    ["municity", "permit-applications", "permit-reviews", "permit-inspections"]);
  const result = await queryParcelData({ plan: review.plan }, {
    query: async (sql, values) => {
      assert.match(sql, /bool_and\(j\.join_status = 'exact'\)/);
      assert.deepEqual(values, ["M-23-00357"]);
      return [{ permit_type: "Hood - C", event_date: "2023-06-04" }];
    },
    catalog: async () => ({ groups: [{ name: "Mechanical", types: [{ name: "Hood - C" }] }] }),
    search: async ({ requirements }) => {
      assert.deepEqual(requirements[0].equals, { PermitNo: "M-23-00357", PermitType: "Hood - C" });
      assert.equal(requirements[0].event_date_from, "2023-06-04");
      return { items: [], coverage: { index_status: "partial" }, complete_for_query: false };
    },
  });
  assert.deepEqual(result.plan, review.plan);
});

test("exact parcel permit results preserve address evidence and an omitted License category stays partial", async () => {
  const resolve = async () => ({ candidates: [{ parcel_id: 42, objectid: 99, address: "42 State St" }] });
  const records = async (id) => id === "municity" ? { status: "ok", items: [
    { source_id: "municity", category: "Permit", source_record_id: "permit:8", attributes: { LegalAddress: "42 State Street" } },
    { source_id: "municity", category: "Permit", source_record_id: "permit:9", attributes: { LegalAddress: "44 State Street" } },
    { source_id: "municity", category: "Application", source_record_id: "application:16", attributes: {} },
  ] } : { status: "no_records", count_established: false, warning: "The City vendor response omitted the License category.", items: [] };
  const result = await askParcelData({ question: "What permits were pulled at 42 State St? Which records list that exact address?" }, {
    now, interpret: assert.fail, execute: (input) => queryParcelData(input, { load: async () => cityParcel, records, resolve }),
  });
  assert.deepEqual(result.items[0].matching_sources[0].records.map((record) => [record.record_id, record.address_evidence?.matches_query]),
    [["permit:8", true], ["permit:9", false]]);
  const history = await askParcelData({ question: "What business licenses have been associated with 42 State St over time? Keep expired licenses visible." }, {
    now, interpret: assert.fail, execute: (input) => queryParcelData(input, { load: async () => cityParcel, records, resolve }),
  });
  assert.equal(history.complete_for_query, false);
  assert.equal(history.coverage.live_source_checks[0].count_established, false);
  assert.equal(history.coverage.live_source_checks[0].status, "partial");
});

test("a contact query scans past an empty candidate batch and returns a linked contractor", async () => {
  const load = async (cityId, objectId) => ({ attributes: { parcel_id: cityId, objectid: objectId } });
  const makeParcel = (id) => ({ city_parcel_id: id, city_objectid: 100 + id,
    matching_sources: [{ source_id: "municity", matching_record_count: 1,
      records: [{ record_id: String(id), source_url: permitUrl(id), fields: { PermitType: "Water Heater" } }] }] });
  const search = async ({ cursor }, { projection }) => {
    assert.deepEqual(projection.permit_types, ["WATER HEATER"]);
    return { items: (cursor ? [4] : [1, 2, 3]).map(makeParcel),
      next_cursor: cursor ? null : "verified-index-cursor",
      complete_for_query: Boolean(cursor), coverage: { index_status: "connected" } };
  };
  const details = async (_, id) => ({ permit: { source_url: permitUrl(id),
    attributes: { Description: "Install water heater" } },
    warnings: id === "2" ? ["Permit Contact category was not returned."] : [],
    items: id === "4" ? [{ category: "Contact", source_record_id: "Contact:4",
      source_url: permitUrl(id), attributes: { ContactRole: "Contractor" } }] : [] });
  const result = await queryParcelData({ plan: {
    requirements: [{ source_id: "municity", permit_group: "Plumbing" }],
    include: [{ source_id: "permit-contacts", fields: ["ContactRole"] }],
    contact_role: "Contractor", require_contact_role: true,
  } }, { search, catalog, load, details });
  assert.deepEqual(result.items.map(({ city_parcel_id }) => city_parcel_id), [4]);
  assert.equal(result.coverage.candidate_parcels_checked, 4);
  assert.equal(result.complete_for_query, false);
  assert.equal(result.coverage.live_source_checks[0].status, "partial");
  assert.equal(result.next_cursor, null);
});

test("indexed permits keep the requested page size while live permit details use bounded batches", async () => {
  const requirements = [{ source_id: "municity", equals: { PermitType: "Hood - C" } }];
  const permitFields = { source_id: "municity", fields: ["PermitNo", "PermitType"] };
  const catalog = async () => ({ groups: [{ name: "Mechanical", types: [{ name: "Hood - C" }] }] });
  for (const [include, expectedLimit] of [
    [[permitFields], 25],
    [[permitFields, { source_id: "permit-inspections" }], 3],
  ]) {
    const result = await queryParcelData({ plan: { requirements, include, limit: 25 } }, { catalog,
      search: async ({ limit }) => {
        assert.equal(limit, expectedLimit);
        return { items: [], complete_for_query: false, coverage: { index_status: "partial" } };
      }, load: assert.fail });
    assert.deepEqual(result.items, []);
  }
});

test("a hood-related question searches all official hood types and tracks each historical run", async () => {
  const types = ["Fire Suppression-Hood", "Fire Suppression-Hood - C", "Hood", "Hood - C"];
  const catalog = async () => ({ groups: [
    { name: "Mechanical", types: ["Hood", "Hood - C", "HVAC"].map((name) => ({ name })) },
    { name: "Plumbing", types: types.slice(0, 2).map((name) => ({ name })) },
  ] });
  const review = await askParcelData({ question: "Show me all hood related permits", plan_only: true }, {
    now, catalog, interpret: assert.fail, execute: assert.fail,
  });
  assert.equal(review.status, "planned");
  assert.deepEqual(review.plan.requirements[0].one_of.PermitType, types);
  assert.equal(review.plan.permit_description_terms, undefined);
  const scopes = types.map((type) => `permit-type:${type.toUpperCase()}`);
  const active = (source_id, scope_key, run_id) => ({ source_id, scope_key, run_id, status: "complete",
    latest_attempt_status: "complete", finished_at: new Date().toISOString(), expected_count: 1, returned_count: 1,
    ambiguous_count: 0, unlinked_count: 0 });
  const result = await queryParcelData({ plan: review.plan }, { catalog,
    search: (input, options) => searchIndexedParcels(input, { ...options, configured: () => true,
      query: async (sql, values) => {
        if (sql.includes("search_source_runs")) {
          assert.deepEqual(values[2], scopes);
          return [active("parcels", "all", 1), ...scopes.slice(0, 3).map((scope, i) => active("municity", scope, i + 2))];
        }
        assert.match(sql, /j\.run_id = ANY\(\$\d+::bigint\[\]\)/);
        assert.ok(values.some((value) => Array.isArray(value) && value.join(",") === "2,3,4"));
        assert.ok(values.some((value) => Array.isArray(value) && value.join(",") === types.map((type) => type.toUpperCase()).join(",")));
        return [{ city_parcel_id: 42, city_objectid: 99, matching_sources: [{ source_id: "municity", matching_record_count: 1,
          records: [{ record_id: "82", fields: { PermitNo: "M-22-00082", PermitType: "Hood" } }] }] }];
      },
    }),
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.complete_for_query, false);
  assert.deepEqual(result.coverage.source_checks.filter((item) => item.source_id === "municity").map(({ scope_key, status }) =>
    [scope_key, status]), scopes.map((scope, i) => [scope, i === 3 ? "not_indexed" : "complete"]));
});
