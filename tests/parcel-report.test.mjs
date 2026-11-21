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
      { group: "ownership", sources: [], items: [record("parcel-sale", "1", { price: 0, book: "12", page: "" },
        { event_date: "2001-01-01" })] },
      { group: "activity", items: [...permits, record("municity", "contact:1", { contact_name: null, contact_role: "" },
        { category: "Contact" })], sources: [{ source_id: "municity", source_url: sourceUrl, status: "ok",
        count: 30, omitted_categories: ["License"], warning: "The City omitted the License category." }] },
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
  assert.match($(".mapped-addresses").text(), /138 Bradley St.*Unit 2/);
  assert.equal($("#activity .record").length, 30);
  assert.equal($("#history li").length, 32);
  assert.equal($(".report details:not([open])").length, 0);
  assert.equal($("#history li").first().find("time").attr("datetime"), "2024-11-19");
  assert.equal($("#history li").last().find("time").attr("datetime"), "1995-01-02");
  assert.match($("#business .record").text(), /BRADLEY STREET BICYCLE CO-OP/);
  assert.match($("#ownership .record").text(), /\$0/);
  assert.equal($("#environment").length, 0);
  assert.match($("#sources").text(), /Partial response[\s\S]*City omitted the License category/);
  assert.ok($("#map #report-map").length);
  assert.equal(JSON.parse($("#report-map-data").text()).layers[0].title, "</script><script>unsafe</script>");
  assert.equal($("#report-photo").attr("src"), "https://www.municitymedia.com/parcel.jpg");
  assert.equal($("script:not([src]):not([type])").length, 0);
  assert.equal($("a[href^='javascript:']").length, 0);
  assert.doesNotMatch($("#activity dl").text(), /Not provided|Permit ID|Issue date/i);
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
  globalThis.fetch = async (input) => {
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
  assert.match($("#sources").text(), /Unavailable/);
  process.env.VERCEL_ENV = "production";
  assert.equal((await route.fetch(new Request(url, { headers }))).status, 404);
});
