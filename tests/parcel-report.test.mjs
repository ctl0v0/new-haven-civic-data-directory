import test from "node:test";
import assert from "node:assert/strict";
import { load } from "cheerio";
import route from "../api/parcel-report.js";
import { LAYERS } from "../parcel/config.js";
import { renderParcelReport } from "../site/render-parcel-report.js";

const sourceUrl = "https://www.municityconnect.com/";
const record = (source_id, source_record_id, attributes, fields = {}) => ({
  source_id, source_record_id, attributes, source_url: sourceUrl, ...fields,
});
const feature = { type: "Feature", properties: {},
  geometry: { type: "Polygon", coordinates: [[[-72.93, 41.3], [-72.92, 41.3], [-72.92, 41.31], [-72.93, 41.3]]] } };

test("report retains historical rows beyond one result page, with factual links and clean fields", () => {
  const permits = Array.from({ length: 30 }, (_, i) => record("municity", `permit:${i}`, {
    PermitNo: `BP-${i}`, PermitType: "Building", PermStatus: i ? "Closed" : "Issued",
    PermitDate: `${1995 + i}-01-02`, Description: "<script>untrusted publication</script>",
    LegalAddress: "138 Bradley St", IssueDate: null, Department: "Not provided", Permit_ID: i,
  }, { category: "Permit", event_date: `${1995 + i}-01-02` }));
  const html = renderParcelReport({
    parcel: { parcel_id: 11293, objectid: 23816, address: "136 Bradley St", source_url: LAYERS.parcels, account_number: null },
    searchedAddress: "138 Bradley St",
    groups: [
      { group: "property", sources: [], items: [
        record("assessor-valuations", "10", { valuation_year: "2010", valuation_type: "assessed", total: "$30,000" }),
        record("assessor-valuations", "25", { valuation_year: "2025", valuation_type: "assessed", total: "$40,000" }),
      ] },
      { group: "ownership", sources: [], items: [record("parcel-sale", "1", { price: 0, book: "12", page: "" },
        { event_date: "2001-01-01" })] },
      { group: "activity", items: [
        record("municity", "permit:undated", { PermitNo: "BP-UNKNOWN", PermitType: "Building" }, { category: "Permit" }),
        ...permits,
        record("municity", "contact:1", { contact_name: null, contact_role: "" }, { category: "Contact" }),
      ], sources: [{ source_id: "municity", source_url: sourceUrl, status: "ok",
        count: 32, omitted_categories: ["License"], warning: "The City omitted the License category." }] },
      { group: "business", sources: [], items: [record("ct-public-charities", "2671715",
        { dba: "BRADLEY STREET BICYCLE CO-OP", status: "ACTIVE", registered_address_as_published: "138 Bradley St" },
        { category: "Registration", event_date: "2024-11-19" })] },
      { group: "environment", sources: [], items: [] },
    ],
    addresses: { addresses: [{ address: "138 Bradley St", units: ["2"] }], source_url: LAYERS.addresses, status: "ok" },
    geometry: feature,
    photo: { status: "ok", source_url: sourceUrl, photo_url: "https://www.municitymedia.com/parcel.jpg" },
    context: { nearby_radius_m: 400, layers: [{ id: "transit-stops", title: "</script><script>unsafe</script>",
      scope: "nearby", status: "ok", source_url: "javascript:alert(0)", features: [feature] }] },
    generated_at: "2026-11-21T05:00:00.000Z",
  });
  const $ = load(html);
  assert.equal($("h1").text(), "136 Bradley St");
  assert.match($(".searched-address").text(), /138 Bradley St/);
  assert.match($('.mapped-addresses [title="138 Bradley St"]').text(), /138\s+Unit 2/);
  assert.ok($("#map").nextAll(".report-facts").length);
  assert.equal($(".report-facts .p-fact").length, 10);
  const latestSale = $(".report-facts a").filter((_, link) => $(link).text().includes("Latest sale"));
  assert.match(latestSale.text(), /Jan 1, 2001 · \$0/);
  assert.equal($(latestSale.attr("href")).parents("#ownership").length, 1);
  const latestPermit = $(".report-facts a").filter((_, link) => $(link).text() === "BP-29");
  assert.match(latestPermit.closest(".p-fact").text(), /BP-29[\s\S]*Jan 2, 2024[\s\S]*Closed/);
  assert.equal($(latestPermit.attr("href")).find(".record-head a").text(), "Open permit BP-29");
  assert.equal($("#activity .record").length, 31);
  assert.deepEqual($("#activity .record time").map((_, time) => $(time).attr("datetime")).get(),
    permits.map(({ event_date }) => event_date).reverse());
  assert.match($("#activity .record").last().find("h4").text(), /BP-UNKNOWN/);
  assert.match($("#activity .record").last().text(), /Date unpublished/);
  assert.equal($("#activity .record").last().find("time").length, 0);
  assert.equal($("#activity .record").first().find(".record-description").text(), "<script>untrusted publication</script>");
  assert.doesNotMatch($("#activity .record").first().find(".p-kv").text(), /Permit number|Permit type|Permit date|Description|Recorded address/i);
  assert.match($("#activity .record").first().find("[data-verbatim-for]").text(), /Permit Date2024-01-02/);
  assert.match($("#property .p-fields__record").first().find("h4").text(), /2025 assessed valuation/);
  assert.equal($("#history li").length, 32);
  assert.equal($(".report details:not([open])").length, 0);
  assert.equal($("#history li").first().find("time").attr("datetime"), "2024-11-19");
  assert.equal($("#history li").last().find("time").attr("datetime"), "1995-01-02");
  assert.match($("#business .record").text(), /BRADLEY STREET BICYCLE CO-OP/);
  assert.match($("#business h3").text(), /State charity registration/);
  assert.match($("#business .record-meta").text(), /Registered address\s*138 Bradley St/);
  assert.match($("#ownership .record").text(), /\$0/);
  assert.equal($("#environment").length, 0);
  assert.match($("#activity .p-checks").text(), /The City omitted the License category/);
  assert.match($(".p-masthead .coverage-note").text(), /Incomplete source checks in 1\s+section/);
  assert.match($("#sources").text(), /Partial response[\s\S]*City omitted the License category/);
  assert.ok($("#map #report-map").length);
  assert.equal(JSON.parse($("#report-map-data").text()).layers[0].title, "</script><script>unsafe</script>");
  assert.equal($("#report-photo").attr("src"), "https://www.municitymedia.com/parcel.jpg");
  const profileQuery = new URLSearchParams($("#nearby-profile").attr("data-parcel-query"));
  assert.equal(profileQuery.get("query_address"), "138 Bradley St");
  assert.equal($(".report-nav a[href='#nearby']").length, 1);
  assert.equal($("#nearby-profile .profile-controls[hidden]").length, 1);
  assert.equal($("#profile-output").children().length, 0);
  assert.equal($("script:not([src]):not([type])").length, 0);
  assert.equal($("a[href^='javascript:']").length, 0);
  assert.doesNotMatch($("#activity dl").text(), /Not provided|Permit ID|Issue date/i);
  for (const n of Array.from({ length: 35 }, (_, i) => i + 1)) {
    assert.equal($(`[id="record-${n}"]`).length, 1);
    assert.equal($(`[data-verbatim-for="record-${n}"]`).length, 1);
  }
  for (const link of $("#history a[href^='#record-']").toArray()) {
    assert.equal($($(link).attr("href")).length, 1);
  }
});

test("HTML report requires the private pilot and leaves a usable report when map and photo checks fail", async (t) => {
  const env = {
    VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "codex/parcel-pilot",
    PILOT_PASSPHRASE: "fixture-report-passphrase-123456",
    PILOT_COOKIE_SECRET: "fixture-report-cookie-secret-123456",
    PILOT_API_TOKEN: "fixture-report-api-token-123456",
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let googleCalls = 0;
  globalThis.fetch = async (input) => {
    if (new URL(input).hostname === "areainsights.googleapis.com") googleCalls++;
    if (String(input).startsWith(LAYERS.parcels + "/query"))
      return Response.json({ features: [{ attributes: { objectid: 23816, parcel_id: 11293,
        property_address: "136 BRADLEY ST", owner_name_1: "Fixture Property Owner" }, geometry: { rings: [] } }] });
    return Response.json({}, { status: 503 });
  };
  const url = "https://preview.example.test/parcel-report?parcel_id=11293&objectid=23816";
  const headers = { authorization: `Bearer ${env.PILOT_API_TOKEN}` };
  assert.equal((await route.fetch(new Request(url))).status, 401);
  const result = await route.fetch(new Request(url, { headers }));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  assert.match(result.headers.get("Content-Type"), /text\/html/);
  const $ = load(await result.text());
  assert.equal($("h1").text(), "136 BRADLEY ST");
  assert.match($("#ownership").text(), /Fixture Property Owner/);
  assert.match($("#map").text(), /City parcel geometry was unavailable/);
  assert.equal($("#report-photo").length, 0);
  assert.match($("#ownership .p-checks").text(), /Assessor ownership history[\s\S]*Unavailable/);
  assert.match($("#sources").text(), /Unavailable/);
  assert.equal(googleCalls, 0);
  process.env.VERCEL_ENV = "production";
  assert.equal((await route.fetch(new Request(url, { headers }))).status, 404);
});

test("Plat keeps source records and original anchors when it groups cross-source matches", () => {
  const groups = [
    { group: "activity", sources: [], items: [
      record("municity", "permit:1", { PermitNo: "P-1", PermitType: "Plumbing", PermitDate: "2024-01-02" },
        { category: "Permit", event_date: "2024-01-02" }),
      record("municity", "application:2", { ApplicationNumber: "P-1", ApplicationDate: "2024-01-01" },
        { category: "Application", event_date: "2024-01-01" }),
      record("municity", "license:3", { LicenseNumber: "LIC-3", BusinessName: "Example" }, { category: "License" }),
    ] },
    { group: "business", sources: [], items: [
      record("municipal-business-licenses", "license:3",
        { business_name: "Example", license_number: "LIC-3", recorded_address: "138 Bradley St" }),
    ] },
    { group: "property", sources: [], items: [
      record("trash-pickup", "1", { address: "136 Bradley St", trash_day: "Monday" }),
      record("trash-pickup", "2", { address: "138 Bradley St", trash_day: "Tuesday" }),
    ] },
  ];
  const $ = load(renderParcelReport({
    parcel: { parcel_id: 11293, objectid: 23816, address: "136 Bradley St" }, groups,
    addresses: { addresses: [{ address: "138 Bradley St", units: [] }], status: "ok" },
    photo: { status: "no_records" }, generated_at: "2026-11-21T15:00:00Z",
  }));
  assert.equal($("#activity .p-record").length, 1);
  assert.equal($("#activity .p-life a").length, 2);
  assert.equal($("#business .p-record").length, 1);
  assert.match($("#services .p-ledger").text(), /Monday[\s\S]*Tuesday/);
  assert.equal($("#representation").length, 1);
  assert.equal($("#geography").length, 1);
  for (let n = 1; n <= 6; n++) {
    assert.equal($(`[id="record-${n}"]`).length, 1);
    assert.equal($(`[data-verbatim-for="record-${n}"] a.p-src`).attr("href"), sourceUrl);
  }
});

test("Plat shows one disclosure for an identical occupant projection and labels City Squared destinations", () => {
  const cityParcel = `${sourceUrl}#/app/NewHavenCityCT/entity/Parcel/11325`;
  const documents = `${cityParcel}/Document`;
  const publicFile = "https://www.municitymedia.com/public/plan.pdf";
  const occupant = { occupant_name: "Example Market", recorded_address: "892 STATE ST", occupancy_type: "Market" };
  const groups = [
    { group: "activity", sources: [], items: [
      record("municity", "occupant:501", { occupant_id: "501", ...occupant }, {
        category: "Occupant", source_url: documents, event_date: "2021-01-02",
      }),
      record("municity", "occupant:502", { occupant_id: "502", ...occupant }, {
        category: "Occupant", source_url: cityParcel, event_date: "2021-01-02",
      }),
      record("municity", "occupant:503", { occupant_id: "503", ...occupant, inactive: true }, {
        category: "Occupant", source_url: cityParcel, event_date: "2020-02-01",
      }),
      record("municity", "document:12", { document_name: "City plan metadata" }, {
        category: "Document", source_url: documents,
      }),
      record("municity", "document:13", { document_name: "City plan", public_document_url: publicFile }, {
        category: "Document", source_url: publicFile,
      }),
    ] },
    { group: "business", sources: [], items: [
      record("municipal-occupants", "occupant:501", { ...occupant, occupant_id: "501" }, {
        source_url: cityParcel, event_date: "2021-01-02",
      }),
      record("municipal-occupants", "occupant:503", { occupant_id: "503", ...occupant, inactive: false }, {
        source_url: cityParcel, event_date: "2020-02-01",
      }),
    ] },
  ];
  const $ = load(renderParcelReport({
    parcel: { parcel_id: 11662, objectid: 13714, address: "892 State St" }, groups,
    addresses: { addresses: [], status: "ok" }, photo: { status: "no_records" },
    generated_at: "2026-11-21T15:00:00Z",
  }));
  const merged = $("#business #record-6");
  assert.equal(merged.find("#record-1.report-anchor").length, 1);
  assert.equal(merged.find(".p-fields__record").length, 1);
  assert.match(merged.find(".p-fields dl").text(), /City occupant ID\s*501/);
  assert.match(merged.find(".p-fields__ids").text(), /Report reference 6/);
  assert.deepEqual(merged.find(".record-head a").map((_, a) => [$(a).text(), $(a).attr("href")].join("|")).get(), [
    `Open City Squared parcel|${cityParcel}`,
    `Open City Squared parcel documents|${documents}`,
  ]);
  assert.match($("#activity #record-2 .p-fields").text(), /City occupant ID\s*502/);
  assert.match($("#activity #record-3 .p-fields").text(), /Inactivetrue/);
  assert.match($("#business #record-7 .p-fields").text(), /Inactivefalse/);
  assert.equal($("#activity #record-4 .p-fields__ids a").text(), "Open City Squared parcel documents");
  assert.equal($("#activity #record-5 .record-head a").text(), "Open published document");
  assert.equal($("#business .p-section__stats").text(), "2 records");
  assert.equal($("#history li").length, 4);
});
