import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { issueCookie, authorized, authorizedBearer, sameOrigin } from "../parcel/auth.js";
import { resolveParcel } from "../parcel/resolve.js";
import { parcelRecords, parcelTrashPickup, parcelFeed, parcelOverview, parcelGeometry, parcelMapContext } from "../parcel/service.js";
import { parcelFeatureToGeoJSON } from "../parcel/geometry.js";
import { addressEvidence } from "../parcel/address-evidence.js";
import { parseLciProperty } from "../parcel/lci.js";
import { getGroup, getSourceRecords } from "../parcel/adapters.js";
import { permitDetails } from "../parcel/permit-details.js";
import { arcgis } from "../parcel/http.js";
import { findOfficialOwnerEntity, officialOwnerMatch } from "../parcel/business-registry.js";
import sourcesRoute from "../api/v1/sources.js";
import recordsRoute from "../api/v1/records.js";
import trashPickupRoute from "../api/v1/trash-pickup.js";
import feedRoute from "../api/v1/feed.js";
import geometryRoute from "../api/v1/geometry.js";
import mapContextRoute from "../api/v1/map-context.js";
import permitDetailsRoute from "../api/v1/permit-details.js";
import mcpRoute from "../api/mcp.js";
import pilotPage from "../api/pilot-page.js";
import pilotSession from "../api/pilot-session.js";

const oldEnv = {
  PILOT_PASSPHRASE: process.env.PILOT_PASSPHRASE,
  PILOT_COOKIE_SECRET: process.env.PILOT_COOKIE_SECRET,
  PILOT_API_TOKEN: process.env.PILOT_API_TOKEN,
  PILOT_API_KEYS: process.env.PILOT_API_KEYS,
  PILOT_DISABLE_SHARED_TOKEN: process.env.PILOT_DISABLE_SHARED_TOKEN,
};
process.env.PILOT_PASSPHRASE = "a-long-test-passphrase-123456";
process.env.PILOT_COOKIE_SECRET = "a-long-test-cookie-secret-123456";
process.env.PILOT_API_TOKEN = "a-long-test-bearer-token-123456";
const originalFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(oldEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const response = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
const polygon = {
  rings: [
    [
      [-72.93, 41.3],
      [-72.92, 41.3],
      [-72.92, 41.31],
      [-72.93, 41.3],
    ],
  ],
};
const parcel = (id) => ({
  attributes: {
    objectid: id + 10,
    parcel_id: id,
    property_address: "165 CHURCH ST",
    mblu: "12/34",
    sale_date: "2020-01-02",
    nh_ward: 7,
  },
  geometry: polygon,
});

test("private access fails closed and signed cookies cannot be forged", async () => {
  assert.equal(
    authorized(new Request("https://example.com/api/v1/sources")),
    false,
  );
  const token = issueCookie().split(";")[0];
  assert.equal(
    authorized(
      new Request("https://example.com/api/v1/sources", {
        headers: { cookie: token },
      }),
    ),
    true,
  );
  assert.equal(
    authorized(
      new Request("https://example.com/api/v1/sources", {
        headers: { cookie: token + "x" },
      }),
    ),
    false,
  );
  assert.equal(
    sameOrigin(
      new Request("https://example.com/", { headers: { origin: "garbage" } }),
    ),
    false,
  );
  const denied = await sourcesRoute.fetch(
    new Request("https://example.com/api/v1/sources"),
  );
  assert.equal(denied.status, 401);
  const allowed = await sourcesRoute.fetch(
    new Request("https://example.com/api/v1/sources", {
      headers: { authorization: "Bearer " + process.env.PILOT_API_TOKEN },
    }),
  );
  assert.equal(allowed.status, 200);
  const coverage = await allowed.json();
  assert.ok(coverage.sources.some((x) => x.id === "municity"));
  const attendance = coverage.sources.find((x) => x.id === "school-attendance");
  assert.equal(attendance.mode, "gap");
  assert.match(attendance.url, /newhavenmagnetschools\.com/);
  assert.equal(coverage.groups.length, 7);
  assert(coverage.groups.some((group) => group.id === "ownership"));
  assert.equal("context_sources" in coverage, false);
  assert.ok(coverage.sources.every((source) => ![
    "census-block-2020", "ct-tract-2020-acs", "ct-transit-stops",
    "nearby-municipal-business", "complete-streets", "service-requests",
  ].includes(source.id)));
});

test("invited keys can be revoked without a parcel database", () => {
  const token = "individual-test-token-with-adequate-entropy-123";
  const hash = createHash("sha256").update(token).digest("hex");
  const request = new Request("https://example.com/mcp", {
    headers: { authorization: `Bearer ${token}` },
  });
  process.env.PILOT_API_KEYS = JSON.stringify([
    { id: "reviewer_1", sha256: hash, active: true },
  ]);
  process.env.PILOT_DISABLE_SHARED_TOKEN = "1";
  try {
    assert.equal(authorizedBearer(request), true);
    assert.equal(authorizedBearer(new Request("https://example.com/mcp", {
      headers: { authorization: `Bearer ${process.env.PILOT_API_TOKEN}` },
    })), false);
    process.env.PILOT_API_KEYS = JSON.stringify([
      { id: "reviewer_1", sha256: hash, active: false },
    ]);
    assert.equal(authorizedBearer(request), false);
  } finally {
    delete process.env.PILOT_API_KEYS;
    delete process.env.PILOT_DISABLE_SHARED_TOKEN;
  }
});

test("LCI parser returns case metadata and listed fines, never complaint details", () => {
  const html = `<!doctype html><body><h1>165 CHURCH ST</h1><p>PID 999006</p>
    <h2>Money Owed to the City</h2><table><tr><th>Source</th><th>Case</th><th>Amount</th></tr>
    <tr><td>Housing Code fine</td><td>HC-2026-123</td><td>$1,250.00</td></tr></table>
    <h2>Housing Code Cases · 1 on file</h2><table><tr><th>Case #</th><th>Status</th><th>Date Filed</th></tr>
    <tr><td><a href="/public/case/HC-2026-123">HC-2026-123</a></td><td>open</td><td>November 9, 2026</td></tr></table>
    <div>Complaint narrative with a tenant name that must never leave the source</div></body>`;
  const out = parseLciProperty(html, parcel(999006), "https://lci.city/public/property/999006");
  assert.equal(out.cases.length, 1);
  assert.deepEqual(out.missing_sections, ["anti_blight"]);
  assert.deepEqual(out.cases[0], {
    case_number: "HC-2026-123",
    case_type: "housing_code",
    status: "open",
    filed_date: "2026-11-09",
    source_url: "https://lci.city/public/case/HC-2026-123",
    listed_fine_usd: 1250,
  });
  assert.doesNotMatch(JSON.stringify(out), /tenant name|complaint narrative/i);
  assert.throws(() =>
    parseLciProperty(html.replace("PID 999006", "PID 999007"), parcel(999006), "https://lci.city/public/property/999006"),
  );
  assert.throws(() =>
    parseLciProperty(html.replace("165 CHURCH ST", "311 BLAKE ST"), parcel(999006), "https://lci.city/public/property/999006"),
  );
});

test("LCI accepts an explicit empty case section but never guesses from absent markup", () => {
  const url = "https://lci.city/public/property/999040";
  const identity = "<body><h1>165 CHURCH ST</h1><p>PID 999040</p>";
  const empty = `${identity}<h2>Housing Code Cases · 0 on file</h2><h2>Anti-Blight Cases · 0 on file</h2>`;
  assert.deepEqual(parseLciProperty(empty, parcel(999040), url), {
    cases: [], truncated: false, missing_sections: [],
  });
  assert.throws(() => parseLciProperty(identity, parcel(999040), url));
  const alternate = `${identity}<h2>Housing Code Cases</h2>
    <table><tr><th>Case Number</th><th>Case Status</th><th>Filed Date</th></tr>
    <tr><td><a href="/public/case/HC-2026-123">HC-2026-123</a></td><td>Open</td><td>2026-11-09</td></tr></table>
    <h2>Anti-Blight Cases · 0 on file</h2>`;
  const parsed = parseLciProperty(alternate, parcel(999040), url);
  assert.equal(parsed.cases[0].case_number, "HC-2026-123");
  assert.deepEqual(parsed.missing_sections, []);
});

test("LCI source status and record match preserve the verified PID and address", async () => {
  globalThis.fetch = async () => new Response(`<body><h1>165 CHURCH ST</h1><p>PID 999043</p>
    <h2>Housing Code Cases</h2><table><tr><th>Case #</th><th>Status</th><th>Date Filed</th></tr>
    <tr><td>HC-2026-123</td><td>Open</td><td>2026-11-09</td></tr></table>
    <h2>Anti-Blight Cases · 0 on file</h2></body>`, {
    headers: { "content-type": "text/html" },
  });
  const found = await getSourceRecords("lci-cases", parcel(999043));
  assert.equal(found.status, "ok");
  assert.deepEqual(found.items[0].match, {
    method: "exact", parcel_field: "parcel_id", source_field: "PID",
    value: "999043", address_confirmed: true,
  });
  globalThis.fetch = async () => new Response(`<body><h1>165 CHURCH ST</h1><p>PID 999044</p>
    <h2>Housing Code Cases · 0 on file</h2><h2>Anti-Blight Cases · 0 on file</h2></body>`, {
    headers: { "content-type": "text/html" },
  });
  const empty = await getSourceRecords("lci-cases", parcel(999044));
  assert.equal(empty.status, "no_records");
  globalThis.fetch = async () => new Response(`<body><h1>165 CHURCH ST</h1><p>PID 999045</p>
    <h2>Housing Code Cases · 0 on file</h2></body>`, {
    headers: { "content-type": "text/html" },
  });
  const partial = await getSourceRecords("lci-cases", parcel(999045));
  assert.equal(partial.status, "partial");
  assert.deepEqual(partial.items, []);
});

test("pilot login creates a private page session", async () => {
  const login = await pilotSession.fetch(
    new Request("https://example.com/api/pilot-session", {
      method: "POST",
      headers: {
        origin: "https://example.com",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ passphrase: process.env.PILOT_PASSPHRASE }),
    }),
  );
  assert.equal(login.status, 303);
  assert.match(
    login.headers.get("set-cookie"),
    /HttpOnly; Secure; SameSite=Strict/,
  );
  const page = await pilotPage.fetch(
    new Request("https://example.com/parcel", {
      headers: { cookie: login.headers.get("set-cookie").split(";")[0] },
    }),
  );
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /id="search-form"/);
  assert.match(html, /id="parcel-map"/);
  assert.match(html, /\/leaflet\/leaflet\.js/);
  assert.match(page.headers.get("content-security-policy"), /img-src 'self' data: https:\/\/cteco\.uconn\.edu/);
  assert.equal(
    (
      await pilotSession.fetch(
        new Request("https://example.com/api/pilot-session", {
          method: "POST",
          headers: {
            origin: "http://example.com",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: "passphrase=wrong",
        }),
      )
    ).status,
    403,
  );
});

test("unconfigured pilot identifies missing variable names without exposing values", async () => {
  const token = process.env.PILOT_API_TOKEN;
  delete process.env.PILOT_API_TOKEN;
  try {
    const page = await pilotPage.fetch(
      new Request("https://example.com/parcel"),
    );
    const html = await page.text();
    assert.match(html, /PILOT_API_TOKEN \(absent\)/);
    assert.doesNotMatch(html, /a-long-test/);
  } finally {
    process.env.PILOT_API_TOKEN = token;
  }
});

test("duplicate official parcel IDs are returned as candidates", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.searchParams.get("where") === "parcel_id = 999001")
      return response({
        features: [
          parcel(999001),
          {
            ...parcel(999001),
            attributes: { ...parcel(999001).attributes, objectid: 999099 },
          },
        ],
      });
    return response({ features: [] });
  };
  const out = await resolveParcel("999001");
  assert.equal(out.status, "ambiguous");
  assert.equal(out.candidates.length, 2);
});

test("street search shows a second parcel found by its address point", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Addresses_") && !u.pathname.endsWith("/query"))
      return response({ fields: [{ name: "house_number", type: "esriFieldTypeString" }] });
    if (u.pathname.includes("Addresses_"))
      return response({
        features: [
          {
            attributes: { house_number: "100", full_street_name: "MAIN ST" },
            geometry: { x: -72.9, y: 41.3 },
          },
          {
            attributes: { house_number: "100", full_street_name: "MAIN AVE" },
            geometry: { x: -72.8, y: 41.3 },
          },
        ],
      });
    if (u.pathname.includes("Parcel_Viewer")) {
      if (u.searchParams.get("geometryType") === "esriGeometryPoint")
        return response({
          features: [{
            ...parcel(999012),
            attributes: { ...parcel(999012).attributes, property_address: "102 MAIN ST" },
          }],
        });
      if (u.searchParams.get("where")?.includes("property_address"))
        return response({
          features: [{
            ...parcel(999011),
            attributes: { ...parcel(999011).attributes, property_address: "100 MAIN ST" },
          }],
        });
      return response({ features: [] });
    }
    throw Error("Unexpected source");
  };
  const out = await resolveParcel("100 Main St");
  assert.equal(out.status, "ambiguous");
  assert.equal(out.candidates.length, 2);
  const point = out.candidates.find((x) => x.parcel_id === 999012);
  assert.equal(point.match.method, "address-point-intersection");
  assert.match(point.match.note, /different address/);
  assert.equal(Object.hasOwn(point.match, "confidence"), false);
});

test("3 Edwards-style search drops neighboring house numbers and keeps the point parcel", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Addresses_") && !u.pathname.endsWith("/query"))
      return response({ fields: [{ name: "house_number", type: "esriFieldTypeString" }] });
    if (u.pathname.includes("Addresses_"))
      return response({
        features: [{
          attributes: { house_number: "3", full_street_name: "EDWARDS ST" },
          geometry: { x: -72.9096569, y: 41.3159061 },
        }],
      });
    if (u.pathname.includes("Parcel_Viewer")) {
      if (u.searchParams.get("geometryType") === "esriGeometryPoint")
        return response({
          features: [{
            ...parcel(10386),
            attributes: { ...parcel(10386).attributes, property_address: "990 STATE ST" },
          }],
        });
      if (u.searchParams.get("where")?.includes("property_address"))
        return response({
          features: [30, 34, 360].map((house) => ({
            ...parcel(house),
            attributes: { ...parcel(house).attributes, property_address: `${house} EDWARDS ST` },
          })),
        });
      return response({ features: [] });
    }
    throw Error("Unexpected source");
  };
  const out = await resolveParcel("3 Edwards St");
  assert.equal(out.status, "resolved");
  assert.deepEqual(out.candidates.map((x) => x.parcel_id), [10386]);
  assert.match(out.candidates[0].match.note, /different address/);
});

test("listed parcel address takes precedence when its city address point also matches", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Addresses_") && !u.pathname.endsWith("/query"))
      return response({ fields: [{ name: "house_number", type: "esriFieldTypeString" }] });
    if (u.pathname.includes("Addresses_")) return response({ features: [] });
    if (u.pathname.includes("Parcel_Viewer"))
      return response({
        features: u.searchParams.get("where")?.includes("property_address")
          ? [{
              ...parcel(10386),
              attributes: { ...parcel(10386).attributes, property_address: "990 STATE ST" },
            }]
          : [],
      });
    throw Error("Unexpected source");
  };
  const out = await resolveParcel("990 State St");
  assert.equal(out.status, "resolved");
  assert.equal(out.candidates[0].parcel_id, 10386);
  assert.equal(out.candidates[0].match.method, "parcel-address");
});

test("address point agrees with the parcel listing even if the direct query returns no rows", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Addresses_") && !u.pathname.endsWith("/query"))
      return response({ fields: [{ name: "house_number", type: "esriFieldTypeString" }] });
    if (u.pathname.includes("Addresses_"))
      return response({ features: [{
        attributes: { house_number: "991", full_street_name: "STATE ST" },
        geometry: { x: -72.91, y: 41.31 },
      }] });
    if (u.pathname.includes("Parcel_Viewer"))
      return response({
        features: u.searchParams.get("geometryType") === "esriGeometryPoint"
          ? [{
              ...parcel(10386),
              attributes: { ...parcel(10386).attributes, property_address: "991 STATE ST" },
            }]
          : [],
      });
    throw Error("Unexpected source");
  };
  const out = await resolveParcel("991 STATE ST");
  assert.equal(out.status, "resolved");
  assert.equal(out.candidates[0].match.method, "address-point-intersection");
  assert.equal(Object.hasOwn(out.candidates[0].match, "confidence"), false);
});

test("179 Crown does not resolve to 181 Crown without an official address link", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Addresses_") && !u.pathname.endsWith("/query"))
      return response({ fields: [{ name: "house_number", type: "esriFieldTypeString" }] });
    if (u.pathname.includes("Addresses_")) return response({ features: [] });
    if (u.pathname.includes("Parcel_Viewer"))
      return response({
        features: [],
      });
    throw Error("Unexpected source");
  };
  const out = await resolveParcel("179 Crown St");
  assert.equal(out.status, "not_found");
  assert.deepEqual(out.candidates, []);
});

test("MBLU search does not trigger street-address point lookups", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    assert.ok(u.pathname.includes("Parcel_Viewer"));
    assert.match(u.searchParams.get("where"), /^UPPER\(mblu\)/);
    return response({ features: [parcel(999013)] });
  };
  const out = await resolveParcel("12/34");
  assert.equal(out.status, "resolved");
  assert.equal(out.candidates[0].parcel_id, 999013);
});

test("named municipal license appears in business records with historical status", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.endsWith("/GetM5Data"))
      return response({ rows: [{ PrintKey: "12 34", Parcel_ID: 99873 }] });
    if (u.pathname.endsWith("/Children"))
      return response({
        Permit: [],
        Application: [],
        Certificate: [],
        Document: [],
        Contact: [],
        License: [{
          License_ID: 99873,
          BusinessName: "Weary Hobo LLC aka Bar August",
          LicenseNumber: "FSE-21-1199",
          LicenseType: "Health - Food Service Establishment",
          Status: "Void",
          LegalAddress: "990 STATE ST",
          CreatedDate: "2021-07-02T13:30:15",
          Notes: "Unrelated vendor detail should stay out of the business summary",
        }],
      });
    throw Error("Unexpected source");
  };
  const out = await getSourceRecords("municipal-business-licenses", parcel(999014));
  assert.equal(out.status, "ok");
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].attributes.business_name, "Weary Hobo LLC aka Bar August");
  assert.equal(out.items[0].attributes.status, "Void");
  assert.equal(out.items[0].attributes.recorded_address, "990 STATE ST");
  assert.equal(out.items[0].attributes.recorded_address_field, "LegalAddress");
  assert.doesNotMatch(JSON.stringify(out), /Unrelated vendor detail/);
});

test("City parcel second owner, sale, and assessed fields retain official source names and zero values", async () => {
  const p = parcel(999058);
  Object.assign(p.attributes, {
    owner_name_1: "FIRST OWNER", owwner_name_2: "SECOND OWNER",
    co_line: "C/O MAIL CONTACT", mail_address: "20 ELD ST",
    price: 0, book: "10409", page: "55", units_residential: "3",
    total_assessed_bldg_value: 280770,
    total_assessed_parcel_value_x: 496090,
    total_assessed_parcel_value_y: 496090,
  });
  const [raw, owner, assessment, sale] = await Promise.all([
    getSourceRecords("parcels", p),
    getSourceRecords("parcel-owner", p),
    getSourceRecords("parcel-assessment", p),
    getSourceRecords("parcel-sale", p),
  ]);
  assert.equal(raw.items[0].attributes.owwner_name_2, "SECOND OWNER");
  assert.equal(raw.items[0].event_date, null);
  assert.equal(owner.items[0].attributes.owner_name_2, "SECOND OWNER");
  assert.equal(owner.items[0].attributes.owner_name_2_source_field, "owwner_name_2");
  assert.equal(owner.items[0].attributes.co_line, "C/O MAIL CONTACT");
  assert.equal(assessment.items[0].attributes.units_residential, "3");
  assert.equal(assessment.items[0].attributes.total_assessed_bldg_value, 280770);
  assert.equal(assessment.items[0].attributes.total_assessed_parcel_value_x, 496090);
  assert.equal(assessment.items[0].attributes.total_assessed_parcel_value_y, 496090);
  assert.equal(sale.items[0].attributes.price, 0);
  assert.equal(sale.items[0].attributes.book, "10409");
  assert.equal(sale.items[0].event_date, "2020-01-02");
  assert.ok([raw, owner, assessment, sale].every((source) =>
    source.items[0].source_url.includes("objectIds=999068")));
});

test("unnamed residential licenses stay in Activity and are counted in Business source coverage", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/GetM5Data"))
      return response({ rows: [{ PrintKey: "12 34", Parcel_ID: 99873 }] });
    if (url.pathname.endsWith("/Children")) return response({
      License: [
        { License_ID: 1, LicenseNumber: "RL-13-280", LicenseType: "LCI - Residential License",
          Status: "Renewed", ExpirationDate: "2016-03-31", LegalAddress: "20 ELD ST" },
        { License_ID: 2, LicenseNumber: "FSE-1", LicenseType: "Food Service",
          BusinessName: "Named Business", Status: "Void", LegalAddress: "20 ELD ST" },
      ],
      Permit: [], Application: [], Complaint: [], Contact: [], Document: [], Occupant: [], Certificate: [],
    });
    throw Error(`Unexpected source: ${url}`);
  };
  const p = parcel(9990150);
  const business = await getGroup("business", p);
  const activity = await getGroup("activity", p);
  assert.deepEqual(business.items.map((item) => item.attributes.business_name), ["Named Business"]);
  assert.equal(business.sources.find((source) => source.source_id === "municipal-business-licenses").unnamed_license_count, 1);
  assert.deepEqual(activity.items.filter((item) => item.category === "License")
    .map((item) => item.attributes.LicenseNumber), ["RL-13-280", "FSE-1"]);
});

test("municipal parcel lookup includes public documents, complaint metadata and contact roles", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.endsWith("/GetM5Data"))
      return response({ rows: [{ PrintKey: "12 34", Parcel_ID: 99873 }] });
    if (u.pathname.endsWith("/Children"))
      return response({
        Document: [
          {
            Document_ID: 11,
            Name: "Permit plan.pdf",
            Public: true,
            Deleted: 0,
            UrlExists: true,
            Url: "https://www.municitymedia.com/public/plan.pdf",
            Modified: "2022-08-10T12:00:00",
          },
          {
            Document_ID: 12,
            Name: "Private notes.pdf",
            Public: false,
            Deleted: 0,
            UrlExists: true,
            Url: "https://www.municitymedia.com/private/notes.pdf",
          },
        ],
        Application: [],
        Complaint: [{
          Complaint_ID: 21,
          ComplaintNo: "C-22-02774",
          CompType: "Interior Maintenance",
          CompStatus: "Case Assigned",
          Date: "2022-08-09T20:53:21",
          Description: "Private complaint narrative",
        }],
        Contact: [{
          Contact_ID: 31,
          Fullname: "Example Owner",
          ContactRole: "Owner",
          ContactType: "OWNER",
          Email: "private@example.org",
          Phone: "555-0100",
        }],
        License: [],
        Permit: [],
        Occupant: [],
        Certificate: [],
      });
    throw Error("Unexpected source");
  };
  const out = await getSourceRecords("municity", parcel(999015));
  assert.equal(out.status, "ok");
  assert.equal(out.items.length, 3);
  assert.equal(out.category_counts.Document, 1);
  assert.equal(out.category_counts.Application, 0);
  assert.equal(out.category_counts.Complaint, 1);
  assert.equal(out.category_counts.Contact, 1);
  assert.equal(out.category_counts.License, 0);
  assert.equal(out.category_counts.Permit, 0);
  assert.equal(out.category_counts.Occupant, 0);
  assert.equal(out.category_counts.Certificate, 0);
  assert.deepEqual(out.missing_categories, []);
  assert.deepEqual(out.items[0].match, {
    method: "exact", parcel_field: "mblu", source_field: "PrintKey",
    value: "12 34", vendor_parcel_id: 99873,
  });
  assert.equal(out.items.find((x) => x.category === "Document").source_url,
    "https://www.municitymedia.com/public/plan.pdf");
  assert.equal(out.items.find((x) => x.category === "Complaint").attributes.complaint_number,
    "C-22-02774");
  assert.equal(out.items.find((x) => x.category === "Contact").attributes.contact_role,
    "Owner");
  assert.doesNotMatch(JSON.stringify(out), /Private notes|Private complaint narrative|private@example.org|555-0100/);
});

test("missing municipal License category is reported as partial", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.endsWith("/GetM5Data"))
      return response({ rows: [{ PrintKey: "12 34", Parcel_ID: 99873 }] });
    if (u.pathname.endsWith("/Children"))
      return response({ Document: [], Application: [], Complaint: [], Contact: [], Permit: [] });
    throw Error("Unexpected source");
  };
  const out = await getSourceRecords("municipal-business-licenses", parcel(999018));
  assert.equal(out.status, "partial");
  assert.equal(out.items.length, 0);
  assert.match(out.warning, /omitted its License category/);
  const municipal = await getSourceRecords("municity", parcel(999018));
  assert.equal(municipal.category_counts.License, null);
  assert.equal(municipal.category_counts.Permit, 0);
  assert.ok(municipal.missing_categories.includes("Certificate"));
});

test("municipal counts label returned rows separately from a truncated category", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.endsWith("/GetM5Data"))
      return response({ rows: [{ PrintKey: "12 34", Parcel_ID: 99873 }] });
    if (u.pathname.endsWith("/Children"))
      return response({ Permit: Array.from({ length: 501 }, (_, index) => ({
        Permit_ID: index + 1, Parcel_ID: 99873,
      })) });
    throw Error("Unexpected source");
  };
  const out = await getSourceRecords("municity", parcel(999041));
  assert.equal(out.status, "partial");
  assert.equal(out.category_counts.Permit, 500);
  assert.ok(out.truncated_categories.includes("Permit"));
  assert.equal(out.category_counts.Complaint, null);
});

test("Cask Republic remains in the original municipal work record on 181 Crown", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.endsWith("/GetM5Data"))
      return response({ rows: [{ PrintKey: "12 34", Parcel_ID: 99873 }] });
    if (u.pathname.endsWith("/Children")) {
      const description = "Exploratory demo for restaurant kitchen remodel at Cask Republic. Other work needs permits.";
      return response({
        Permit: [{ Permit_ID: 564534, PermitNo: "B-21-02020", PermStatus: "Issued",
          Description: description, LegalAddress: "181 CROWN ST", PermitDate: "2021-11-15" }],
        Application: [{ Application_ID: 15765, ApplicationNumber: "B-21-02020",
          Description: description, LegalAddress: "181 CROWN ST", ApplicationDate: "2021-11-12" }],
      });
    }
    throw Error("Unexpected source");
  };
  const out = await getSourceRecords("municity", parcel(999019));
  const permit = out.items.find((item) => item.category === "Permit");
  assert.equal(permit.attributes.PermitNo, "B-21-02020");
  assert.equal(permit.attributes.LegalAddress, "181 CROWN ST");
  assert.match(permit.attributes.Description, /Cask Republic/);
  assert.equal(permit.source_url, "https://www.municityconnect.com/#/app/NewHavenCityCT/entity/Permit/564534");
});

test("verified municipal permit details expose fees and reviews once with explicit application links", async () => {
  const id = 999070;
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Parcel_Viewer"))
      return response({ features: [parcel(id)], spatialReference: { wkid: 4326 } });
    if (u.pathname.endsWith("/GetM5Data")) {
      if (u.searchParams.get("entity") === "Parcel")
        return response({ rows: [{ PrintKey: "12 34", Parcel_ID: 22232 }] });
      if (u.searchParams.get("entity") === "Permit")
        return response({ rows: [{ Permit_ID: 569338, Parcel_ID: 22232, PrintKey: "12 34",
          Application_ID: 22797, PermitNo: "P-22-00708", Department: "Plumbing", PermStatus: "Issued",
          FullOnlyField: "official full row" }] });
      if (u.searchParams.get("entity") === "Application")
        return response({ rows: [{ Application_ID: 22797,
          PrintKey: "12 34", ApplicaNo: "P-22-00708", ApplicationStatus: "Approved",
          FullOnlyApplicationField: "full application row" }] });
    }
    if (u.pathname.endsWith("/Parcel/22232/Children"))
      return response({ Permit: [{ Permit_ID: 569338, Application_ID: 22797, PermitNo: "P-22-00708" }],
        Application: [{ Application_ID: 22797, ApplicaNo: "P-22-00708" }] });
    if (u.pathname.endsWith("/Permit/569338/Children") || u.pathname.endsWith("/Application/22797/Children"))
      return response({
        Fee: [{ Fee_ID: 898882, Amount: "77.52", FeePaid: "Yes", FeeType: "Permit Fee",
          Applicant: "omitted applicant", InternalNotes: "private fee notes" }],
        Task: [{ Task_ID: 492284, TaskType: "Plumbing Review", ApprovalStatus: "Approved",
          AssignedTo: "Plumbingreviews@newhavenct.gov", Entity: "Application", Entity_ID: 22797,
          InternalNotes: "private review notes" }],
        Document: [{ Document_ID: 327611, Name: "Public permit document", Public: true,
          UrlExists: true, Url: "https://www.municitymedia.com/public/permit.pdf" },
        { Document_ID: 327612, Name: "Private document", Public: false,
          UrlExists: true, Url: "https://www.municitymedia.com/private/permit.pdf" }],
        Contact: [{ Contact_ID: 639971, Fullname: "Example Owner", ContactRole: "Owner",
          Phone: "555-0100", Email: "private@example.org" }],
        Communication: [{ Communication_ID: 343495, Title: "Permit notice", Body: "private message" }],
      });
    throw Error(`Unexpected source: ${u}`);
  };
  const result = await permitDetails(parcel(id), "569338");
  assert.equal(result.permit.attributes.FullOnlyField, "official full row");
  assert.equal(result.application.attributes.ApplicationStatus, "Approved");
  assert.equal(result.application.attributes.FullOnlyApplicationField, "full application row");
  assert.equal(result.items.filter((item) => item.category === "Fee").length, 1);
  assert.equal(result.items.find((item) => item.category === "Task").linked_from.length, 2);
  assert.equal(result.category_counts.Document, 1);
  assert.equal(result.items.find((item) => item.category === "Document").source_url,
    "https://www.municitymedia.com/public/permit.pdf");
  assert.doesNotMatch(JSON.stringify(result), /omitted applicant|private fee notes|private review notes|Private document|555-0100|private@example.org|private message/);
  await assert.rejects(permitDetails(parcel(id), "777777"), { status: 404 });
  const auth = { authorization: "Bearer " + process.env.PILOT_API_TOKEN };
  const rest = await permitDetailsRoute.fetch(new Request(
    `https://example.com/api/v1/permit-details?parcel_id=${id}&permit_id=569338`, { headers: auth },
  ));
  assert.equal(rest.status, 200);
  const mcp = await mcpRoute.fetch(new Request("https://example.com/mcp", {
    method: "POST", headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/call",
      params: { name: "get_permit_details", arguments: { parcel_id: String(id), permit_id: "569338" } } }),
  }));
  assert.equal(mcp.status, 200);
  const mcpText = await mcp.text();
  const payload = JSON.parse(mcpText.startsWith("event:") ? mcpText.match(/^data: (.+)$/m)?.[1] : mcpText);
  assert.deepEqual(payload.result.structuredContent, await rest.json());
});

test("a linked application search without parcel ID needs a matching parcel child", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.endsWith("/GetM5Data")) {
      if (u.searchParams.get("entity") === "Parcel")
        return response({ rows: [{ PrintKey: "12 34", Parcel_ID: 555 }] });
      if (u.searchParams.get("entity") === "Permit")
        return response({ rows: [{ Permit_ID: 1001, Parcel_ID: 555, PrintKey: "12 34", Application_ID: 2001 }] });
      return response({ rows: [{ Application_ID: 2001, PrintKey: "12 34", ApplicationNumber: "A-1" }] });
    }
    if (u.pathname.endsWith("/Parcel/555/Children"))
      return response({ Permit: [{ Permit_ID: 1001, Application_ID: 2001 }] });
    if (u.pathname.endsWith("/Permit/1001/Children")) return response({ Fee: [] });
    if (u.pathname.endsWith("/Application/2001/Children"))
      return response({ Fee: [{ Fee_ID: 9001, Amount: "999" }] });
    throw Error(`Unexpected source: ${u}`);
  };
  const result = await permitDetails(parcel(999071), "1001");
  assert.equal(result.application, null);
  assert.equal(result.partial, true);
  assert.equal(result.items.length, 0);
});

test("municipal occupants use only public fields attached to the verified parcel", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.endsWith("/GetM5Data"))
      return response({ rows: [{ PrintKey: "12 34", Parcel_ID: 99873 }] });
    if (u.pathname.endsWith("/Children"))
      return response({ Occupant: [
        { Occupant_ID: 1, Name: "Example Cafe", BusinessName: "Example Cafe",
          Parcel_ID: 99873, LegalAddress: "181 CROWN ST", OccupancyType: "Restaurant",
          CreatedDate: "2022-11-08T14:10:42", Modified: "2026-11-16T16:00:37",
          Phone: "555-0100", Comments: "Private notes" },
        { Occupant_ID: 2, Name: "Deleted Tenant", Deleted: 1 },
        { Occupant_ID: 3, Name: "Wrong Parcel", Parcel_ID: 444 },
      ] });
    throw Error("Unexpected source");
  };
  const out = await getSourceRecords("municipal-occupants", parcel(999021));
  assert.equal(out.status, "ok");
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].attributes.occupant_name, "Example Cafe");
  assert.equal(out.items[0].event_date, "2022-11-08");
  assert.match(out.items[0].source_url, /entity\/Parcel\/99873$/);
  assert.doesNotMatch(JSON.stringify(out), /555-0100|Private notes|Deleted Tenant|Wrong Parcel/);
});

test("assessor ownership and valuation tables become separate parcel records", async () => {
  let calls = 0;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /Parcel\.aspx\?pid=999030/);
    calls++;
    return new Response(`
      <span id="MainContent_lblPid">999030</span>
      <span id="MainContent_lblOwner">Example Owner LLC</span>
      <table id="MainContent_buildingFacts">
        <tr><td>Building Count</td><td>1</td></tr>
        <tr><td>Year Built:</td><td>1910</td></tr>
        <tr><td>Living Area:</td><td>1,588</td></tr>
        <tr><td>Size (Acres)</td><td>0.23</td></tr>
        <tr><td>Use Code</td><td>101</td></tr>
      </table>
      <table id="MainContent_grdSubareas"><tr><th>Code</th><th>Description</th><th>Gross<br>Area</th><th>Living<br>Area</th></tr>
      <tr><td>RET</td><td>RETAIL STORE</td><td>2,000</td><td>2,000</td></tr>
      <tr><td>UBM</td><td>UNFINISHED BASEMENT</td><td>800</td><td>0</td></tr>
      <tr><td colspan="2">Ttl Gross Liv / Lease Area</td><td>2,800</td><td>2,000</td></tr></table>
      <table id="MainContent_grdSales"><tr><th>Owner</th><th>Sale Price</th><th>Certificate</th><th>Book &amp; Page</th><th>Instrument</th><th>Sale Date</th></tr>
      <tr><td>Example Owner LLC</td><td>$0</td><td>&nbsp;</td><td>5187/0276</td><td>8</td><td>08/11/1997</td></tr>
      <tr><td>Prior Owner Inc</td><td>$125,000</td><td>&nbsp;</td><td>4861/0099</td><td>&nbsp;</td><td>05/08/1995</td></tr></table>
      <table id="MainContent_grdCurrentValueAppr"><tr><th>Valuation Year</th><th>Improvements</th><th>Land</th><th>Total</th></tr><tr><td>2025</td><td>$200</td><td>$100</td><td>$300</td></tr></table>
      <table id="MainContent_grdCurrentValueAsmt"><tr><th>Valuation Year</th><th>Improvements</th><th>Land</th><th>Total</th></tr><tr><td>2025</td><td>$140</td><td>$70</td><td>$210</td></tr></table>
      <table id="MainContent_grdHistoryValuesAppr"><tr><th>Valuation Year</th><th>Improvements</th><th>Land</th><th>Total</th></tr><tr><td>2024</td><td>$200</td><td>$100</td><td>$300</td></tr></table>
      <table id="MainContent_grdHistoryValuesAsmt"><tr><th>Valuation Year</th><th>Improvements</th><th>Land</th><th>Total</th></tr><tr><td>2024</td><td>$140</td><td>$70</td><td>$210</td></tr></table>
    `, { headers: { "content-type": "text/html" } });
  };
  const p = parcel(999030);
  const [sales, values, card, subareas] = await Promise.all([
    getSourceRecords("assessor-sales", p),
    getSourceRecords("assessor-valuations", p),
    getSourceRecords("assessor", p),
    getSourceRecords("assessor-subareas", p),
  ]);
  assert.equal(calls, 1);
  assert.equal(card.items[0].attributes.lblOwner, "Example Owner LLC");
  assert.equal(card.items[0].event_date, null);
  assert.deepEqual(card.items[0].attributes.building_facts, {
    building_count: 1,
    year_built: 1910,
    living_area_sq_ft: 1588,
    land_size_acres: 0.23,
    land_use_code: "101",
  });
  assert.equal(subareas.status, "ok");
  assert.deepEqual(subareas.items.map((item) => [item.attributes.code, item.attributes.gross_area_sq_ft, item.attributes.living_area_sq_ft]), [
    ["RET", 2000, 2000], ["UBM", 800, 0],
  ]);
  assert.ok(subareas.items.every((item) => item.event_date === null && item.source_url.endsWith("pid=999030")));
  assert.equal(sales.items.length, 2);
  assert.equal(sales.items[0].event_date, "1997-08-11");
  assert.equal(sales.items[0].attributes.book_page, "5187/0276");
  assert.equal(sales.items[0].attributes.sale_price, "$0");
  assert.match(sales.items[0].source_url, /Parcel\.aspx\?pid=999030$/);
  assert.equal(values.items.length, 4);
  assert.equal(values.items[0].attributes.valuation_year, "2025");
  assert.equal(values.items[0].attributes.valuation_type, "appraised");
  assert.equal(values.items[0].event_date, null);
  const assessorFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Parcel_Viewer")) return response({ features: [p] });
    if (u.pathname.includes("LCI_Managed_Lots")) return response({ features: [] });
    if (u.hostname === "gis.vgsi.com") return assessorFetch(input);
    throw Error("Other timeline source unavailable");
  };
  const feed = await parcelFeed("999030");
  assert.deepEqual(
    feed.items.filter((item) => item.source_id === "assessor-sales")
      .map((item) => item.event_date),
    ["1997-08-11", "1995-05-08"],
  );
});

test("assessor co-owner and building, land, feature, and outbuilding rows retain their source sections", async () => {
  globalThis.fetch = async (input) => {
    assert.match(String(input), /Parcel\.aspx\?pid=999056/);
    return new Response(`
      <span id="MainContent_lblPid">999056</span>
      <span id="MainContent_lblOwner">First Owner</span>
      <span id="MainContent_lblCoOwner">Second Owner</span>
      <span id="MainContent_lblAddr1">C/O Manager<br>12 MAIN ST<br>NEW HAVEN, CT 06511</span>
      <span id="MainContent_lblBldCount">2</span>
      <table id="MainContent_tblLandUse"><tr><td>Use Code</td><td>3030</td></tr>
        <tr><td>Description</td><td>MIXED USE</td></tr><tr><td>Zone</td><td>BA2</td></tr>
        <tr><td>Neighborhood</td><td>WHA3</td></tr></table>
      <table id="MainContent_tblLand"><tr><td>Size (Acres)</td><td>0.14</td></tr>
        <tr><td>Frontage</td><td>1</td></tr></table>
      <span id="MainContent_ctl02_lblHeading">Building 1 : Section 1</span>
      <table id="MainContent_ctl02_tblBldg"><tr><td>Year Built:</td><td>1940</td></tr>
        <tr><td>Replacement Cost:</td><td>$500,000</td></tr></table>
      <table id="MainContent_ctl02_grdCns"><tr><th>Field</th><th>Description</th></tr>
        <tr><td>Style:</td><td>Mix Ret Off</td></tr><tr><td>Heating Fuel</td><td>Gas/Oil</td></tr></table>
      <table id="MainContent_ctl02_grdSub"><tr><th>Code</th><th>Description</th><th>GrossArea</th><th>LivingArea</th></tr>
        <tr><td>RET</td><td>Retail Area</td><td>2,975</td><td>2,975</td></tr></table>
      <span id="MainContent_ctl03_lblHeading">Building 2 : Section 1</span>
      <table id="MainContent_ctl03_tblBldg"><tr><td>Year Built:</td><td>1950</td></tr></table>
      <table id="MainContent_ctl03_grdCns"><tr><th>Field</th><th>Description</th></tr>
        <tr><td>Style:</td><td>Warehouse</td></tr></table>
      <table id="MainContent_ctl03_grdSub"><tr><th>Code</th><th>Description</th><th>GrossArea</th><th>LivingArea</th></tr>
        <tr><td>BAS</td><td>First Floor</td><td>1,000</td><td>1,000</td></tr></table>
      <table id="MainContent_grdXf"><tr><th>Code</th><th>Description</th><th>Size</th><th>Value</th><th>Assessed Value</th><th>Bldg #</th></tr>
        <tr><td>SPR2</td><td>WET/CONCEALED</td><td>39610.00 S.F.</td><td>$78,600</td><td>$55,020</td><td>1</td></tr></table>
      <table id="MainContent_grdOb"><tr><th>Code</th><th>Description</th><th>Sub Code</th><th>Sub Description</th><th>Size</th><th>Value</th><th>Assessed Value</th><th>Bldg #</th></tr>
        <tr><td>PAV1</td><td>PAVING-ASPHALT</td><td></td><td></td><td>2700.00 S.F.</td><td>$5,500</td><td>$3,850</td><td>2</td></tr></table>
    `, { headers: { "content-type": "text/html" } });
  };
  const p = parcel(999056);
  const [owner, land, buildings, subareas, extras, outbuildings, card] = await Promise.all([
    getSourceRecords("assessor-owner", p),
    getSourceRecords("assessor-land", p),
    getSourceRecords("assessor-buildings", p),
    getSourceRecords("assessor-subareas", p),
    getSourceRecords("assessor-extra-features", p),
    getSourceRecords("assessor-outbuildings", p),
    getSourceRecords("assessor", p),
  ]);
  assert.equal(owner.items[0].attributes.co_owner_name, "Second Owner");
  assert.deepEqual(owner.items[0].attributes.mailing_address_lines,
    ["C/O Manager", "12 MAIN ST", "NEW HAVEN, CT 06511"]);
  assert.equal(land.items[0].attributes.assessor_zone_as_published, "BA2");
  assert.equal(land.items[0].attributes.land_measure_rows[1].label_as_published, "Frontage");
  assert.deepEqual(buildings.items.map((item) => item.attributes.building_number), [1, 2]);
  assert.equal(buildings.items[0].attributes.attribute_rows[1].value_as_published, "Gas/Oil");
  assert.deepEqual(subareas.items.map((item) => item.attributes.building_number), [1, 2]);
  assert.equal(extras.items[0].attributes.code, "SPR2");
  assert.equal(outbuildings.items[0].attributes.building_number_as_published, "2");
  assert.equal(card.items[0].attributes.building_facts.building_count, 2);
  assert.equal(card.items[0].attributes.building_facts.year_built, undefined);
  assert.ok([owner, land, buildings, subareas, extras, outbuildings].every((result) =>
    result.items.every((item) => item.source_url.endsWith("pid=999056") && item.event_date === null)));
});

test("state records without an owner LLC and manually selected planning sources do not create parcel records", async () => {
  globalThis.fetch = async () => {
    throw Error("Gap sources must not make upstream record requests");
  };
  const p = parcel(13791);
  p.attributes.property_address = "181 CROWN ST";
  for (const sourceId of ["business-master", "business-principals", "business-agents", "state-licenses", "planning"]) {
    const out = await getSourceRecords(sourceId, p);
    assert.equal(out.status, "unavailable");
    assert.deepEqual(out.items, []);
  }
});

test("owner LLC join requires matching legal name and complete mailing address", () => {
  const city = {
    owner_name_1: "990 STATE STREET ASSOCIATES  LLC",
    mail_address: "40 FOXON HILL RD UNIT 54",
    mail_city: "NEW HAVEN", mail_state: "CT", mail_zip: "06513",
  };
  const state = {
    name: "990 STATE STREET ASSOCIATES, LLC",
    business_type: "LLC", billingstreet: "40 FOXON HILL ROAD 54",
    billingcity: "NEW HAVEN", billingpostalcode: "06513",
  };
  assert.equal(officialOwnerMatch(city, state), true);
  assert.equal(officialOwnerMatch(city, { ...state, billingstreet: "41 FOXON HILL ROAD 54" }), false);
  assert.equal(officialOwnerMatch(city, { ...state, billingpostalcode: "06511" }), false);
  assert.equal(officialOwnerMatch(city, { ...state, name: "990 STATE STREET HOLDINGS, LLC" }), false);
});

test("State owner lookup refuses two entities with the same official name and address", async () => {
  const city = {
    owner_name_1: "SAMPLE OWNER LLC", mail_address: "12 MAIN ST",
    mail_city: "NEW HAVEN", mail_state: "CT", mail_zip: "06511",
  };
  const row = { name: "SAMPLE OWNER, LLC", business_type: "LLC",
    billingstreet: "12 MAIN STREET", billingcity: "NEW HAVEN", billingpostalcode: "06511" };
  globalThis.fetch = async () => response([{ id: "entity-a", ...row }, { id: "entity-b", ...row }]);
  const found = await findOfficialOwnerEntity(city);
  assert.equal(found.entity, null);
  assert.match(found.reason, /More than one State entity/);
});

test("matched official owner entity joins State principals and agent without labeling either the property owner", async () => {
  const p = parcel(999055);
  Object.assign(p.attributes, {
    owner_name_1: "990 STATE STREET ASSOCIATES  LLC",
    mail_address: "40 FOXON HILL RD UNIT 54", mail_city: "NEW HAVEN",
    mail_state: "CT", mail_zip: "06513",
  });
  const master = { id: "state-entity-1", name: "990 STATE STREET ASSOCIATES, LLC",
    accountnumber: "0659195", business_type: "LLC", status: "Active",
    billingstreet: "40 FOXON HILL ROAD 54", billingcity: "NEW HAVEN",
    billingpostalcode: "06513", business_email_address: "entity@example.com" };
  const requested = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    requested.push(url);
    if (url.pathname.includes("Parcel_Viewer")) return response({ features: [p] });
    if (url.hostname === "gis.vgsi.com") return new Response(
      '<span id="MainContent_lblPid">999055</span><span id="MainContent_lblOwner">990 STATE STREET ASSOCIATES LLC</span>',
      { headers: { "content-type": "text/html" } });
    if (url.pathname.endsWith("n7gp-d28j.json")) {
      assert.match(url.searchParams.get("$where"), /name = '990 STATE STREET ASSOCIATES, LLC'/);
      return response([master]);
    }
    if (url.pathname.endsWith("ka36-64k6.json")) return response([{
      business_id: master.id, name__c: "The Robert Megna Trust",
      business_street_address_1: "40 FOXON HILL ROAD 54",
      business_city: "NEW HAVEN", business_state: "CT",
    }]);
    if (url.pathname.endsWith("qh2m-n44y.json")) return response([{
      business_key: master.id, name__c: "ROBERT MEGNA", type: "Individual",
      agent_phone: "2034940995", email: "agent@example.com",
    }]);
    throw Error("Unexpected request");
  };
  const [entity, principals, agents] = await Promise.all([
    getSourceRecords("business-master", p),
    getSourceRecords("business-principals", p),
    getSourceRecords("business-agents", p),
  ]);
  assert.equal(entity.items[0].attributes.alei, "0659195");
  assert.equal(entity.items[0].match.method, "official-owner-name-and-mailing-address");
  assert.equal(principals.items[0].attributes.principal_name, "The Robert Megna Trust");
  assert.equal(principals.items[0].attributes.designation, null);
  assert.match(principals.items[0].note, /not necessarily a beneficial owner/);
  assert.equal(agents.items[0].attributes.agent_phone, "2034940995");
  assert.match(agents.items[0].note, /not identified as a property owner/);
  assert.equal(requested.filter((url) => url.pathname.endsWith("n7gp-d28j.json")).length, 1);
  assert(requested.some((url) => url.pathname.endsWith("qh2m-n44y.json") &&
    url.searchParams.get("$where") === "business_key = 'state-entity-1'"));
  const ownership = await getGroup("ownership", p);
  assert(ownership.items.some((item) => item.source_id === "parcel-owner"));
  assert(ownership.items.some((item) => item.source_id === "assessor-owner"));
  assert.equal(ownership.items.find((item) => item.source_id === "parcel-owner").attributes.owner_name_1,
    "990 STATE STREET ASSOCIATES LLC");
  assert.match(ownership.items.find((item) => item.source_id === "parcel-owner").source_url,
    /objectIds=999065/);
  assert.equal(ownership.items.find((item) => item.source_id === "assessor-owner").attributes.owner_name,
    "990 STATE STREET ASSOCIATES LLC");
  assert(ownership.items.some((item) => item.source_id === "business-master"));
  assert(ownership.items.some((item) => item.source_id === "business-principals"));
  assert(ownership.items.some((item) => item.source_id === "business-agents"));
  const business = await getGroup("business", p);
  assert(business.items.every((item) =>
    ["municipal-business-licenses", "municipal-occupants"].includes(item.source_id)));
  assert(business.sources.every((source) => !source.source_id.startsWith("business-")));
  const auth = { authorization: "Bearer " + process.env.PILOT_API_TOKEN };
  const rest = await recordsRoute.fetch(new Request(
    "https://example.com/api/v1/records?parcel_id=999055&group=ownership",
    { headers: auth },
  ));
  assert.equal(rest.status, 200);
  const restData = await rest.json();
  assert.deepEqual(restData.items.slice(0, 2).map((item) => item.source_id),
    ["parcel-owner", "assessor-owner"]);
  assert(restData.items.some((item) => item.source_id === "business-master"));
  const mcp = await mcpRoute.fetch(new Request("https://example.com/mcp", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 35, method: "tools/call",
      params: { name: "get_parcel_records", arguments: { parcel_id: "999055", group: "ownership" } } }),
  }));
  assert.equal(mcp.status, 200);
  const body = await mcp.text();
  const payload = JSON.parse(body.startsWith("event:") ? body.match(/^data: (.+)$/m)?.[1] : body);
  assert.deepEqual(payload.result.structuredContent, restData);
});

test("assessor card does not merge facts from multiple buildings", async () => {
  globalThis.fetch = async () => new Response(`
    <span id="MainContent_lblPid">999031</span>
    <table><tr><td>Building Count</td><td>2</td></tr>
    <tr><td>Year Built</td><td>1910</td></tr>
    <tr><td>Living Area</td><td>1,000</td></tr>
    <tr><td>Year Built</td><td>1930</td></tr>
    <tr><td>Living Area</td><td>2,000</td></tr></table>
  `, { headers: { "content-type": "text/html" } });
  const out = await getSourceRecords("assessor", parcel(999031));
  assert.deepEqual(out.items[0].attributes.building_facts, { building_count: 2 });
});

test("assessor subareas preserve separate source tables and omit unreadable totals", async () => {
  globalThis.fetch = async () => new Response(`
    <span id="MainContent_lblPid">999032</span>
    <table><tr><th>Code</th><th>Description</th><th>Gross Area</th><th>Living Area</th></tr>
    <tr><td>BAS</td><td>FIRST FLOOR</td><td>1,000</td><td>1,000</td></tr></table>
    <table><tr><th>Code</th><th>Description</th><th>Gross Area</th><th>Living Area</th></tr>
    <tr><td>UBM</td><td>BASEMENT</td><td>600</td><td>0</td></tr>
    <tr><td>BAD</td><td>MALFORMED</td><td>unknown</td><td>0</td></tr></table>
  `, { headers: { "content-type": "text/html" } });
  const out = await getSourceRecords("assessor-subareas", parcel(999032));
  assert.equal(out.status, "partial");
  assert.deepEqual(out.items.map((item) => item.attributes.table_number), [1, 2, 2]);
  assert.equal(out.items[2].attributes.gross_area_sq_ft, null);
  assert.equal(out.items[2].attributes.gross_area_as_published, "unknown");
});

test("City pickup zones consolidate duplicate address points and retain their IDs and source dates", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Trash_Pickup_Day") && !u.pathname.endsWith("/query"))
      return response({
        geometryType: "esriGeometryPolygon",
        editingInfo: { lastEditDate: 1751566162283 },
        fields: [{ name: "trash_day", domain: { codedValues: [
          { code: "M", name: "Monday" }, { code: "F", name: "Friday" },
          { code: "TH", name: "Thursday" },
        ] } }],
      });
    if (u.pathname.includes("Trash_Pickup_Day"))
      return response({ spatialReference: { wkid: 4326 }, features: [
        { attributes: { objectid: 10, trash_day: "M" }, geometry: { rings: [[
          [0, 0], [1, 0], [1, 1], [0, 1], [0, 0],
        ]] } },
        { attributes: { objectid: 11, trash_day: "F" }, geometry: { rings: [[
          [1, 0], [2, 0], [2, 1], [1, 1], [1, 0],
        ]] } },
      ] });
    if (u.pathname.includes("Addresses_"))
      return response({ spatialReference: { wkid: 4326 }, features: [
        { attributes: { objectid: 20, house_number: "3", full_street_name: "EDWARDS ST", unit: "2" }, geometry: { x: 0.5, y: 0.5 } },
        { attributes: { objectid: 22, house_number: "3", full_street_name: "EDWARDS ST", unit: "2" }, geometry: { x: 0.6, y: 0.5 } },
        { attributes: { objectid: 21, house_number: "990", full_street_name: "STATE ST" }, geometry: { x: 1.5, y: 0.5 } },
      ] });
    throw Error("Unexpected source");
  };
  const out = await getSourceRecords("trash-pickup", parcel(999061));
  assert.equal(out.status, "ok");
  assert.deepEqual(out.items.map((item) => [item.attributes.address, item.attributes.trash_day]), [
    ["3 EDWARDS ST", "Monday"], ["990 STATE ST", "Friday"],
  ]);
  assert.equal(out.items[0].attributes.source_last_edited, "2025-07-03");
  assert.deepEqual(out.items[0].attributes.address_point_objectids, [20, 22]);
  assert.deepEqual(out.items[0].match.address_point_objectids, [20, 22]);
  assert.equal(out.items[0].match.method, "address-point-zone-intersection");
  assert.equal(addressEvidence(out.items[0], "3 Edwards St").matches_query, true);
  assert.equal(addressEvidence(out.items[1], "3 Edwards St").matches_query, false);
});

test("overlapping City pickup zones do not assign an address a day", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Trash_Pickup_Day") && !u.pathname.endsWith("/query"))
      return response({ geometryType: "esriGeometryPolygon",
        editingInfo: { lastEditDate: 1751566162283 },
        fields: [{ name: "trash_day", domain: { codedValues: [
          { code: "M", name: "Monday" }, { code: "F", name: "Friday" },
        ] } }],
      });
    if (u.pathname.includes("Trash_Pickup_Day"))
      return response({ features: ["M", "F"].map((code, index) => ({
        attributes: { objectid: index + 10, trash_day: code },
        geometry: { rings: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      })) });
    if (u.pathname.includes("Addresses_"))
      return response({ features: [{ attributes: {
        objectid: 20, house_number: "3", full_street_name: "EDWARDS ST",
      }, geometry: { x: 0.5, y: 0.5 } }] });
    throw Error("Unexpected source");
  };
  const out = await getSourceRecords("trash-pickup", parcel(999062));
  assert.equal(out.status, "partial");
  assert.equal(out.items.length, 0);
  assert.match(out.warning, /multiple pickup zones/);
});

test("duplicate address points in different City zones do not assign a day", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Trash_Pickup_Day") && !u.pathname.endsWith("/query"))
      return response({ geometryType: "esriGeometryPolygon",
        editingInfo: { lastEditDate: 1751566162283 },
        fields: [{ name: "trash_day", domain: { codedValues: [
          { code: "M", name: "Monday" }, { code: "F", name: "Friday" },
        ] } }],
      });
    if (u.pathname.includes("Trash_Pickup_Day"))
      return response({ features: ["M", "F"].map((code, index) => ({
        attributes: { objectid: index + 10, trash_day: code },
        geometry: { rings: [[
          [index, 0], [index + 1, 0], [index + 1, 1], [index, 1], [index, 0],
        ]] },
      })) });
    if (u.pathname.includes("Addresses_"))
      return response({ features: [0.5, 1.5].map((x, index) => ({
        attributes: { objectid: index + 20, house_number: "20", full_street_name: "ELD ST", unit: "2" },
        geometry: { x, y: 0.5 },
      })) });
    throw Error("Unexpected source");
  };
  const out = await getSourceRecords("trash-pickup", parcel(999064));
  assert.equal(out.status, "partial");
  assert.equal(out.items.length, 0);
  assert.match(out.warning, /points in different pickup zones/);
});

test("pickup records have matching REST and MCP responses with address focus", async () => {
  const id = 999063;
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Parcel_Viewer"))
      return response({ features: [parcel(id)], spatialReference: { wkid: 4326 } });
    if (u.pathname.includes("Trash_Pickup_Day") && !u.pathname.endsWith("/query"))
      return response({ geometryType: "esriGeometryPolygon",
        editingInfo: { lastEditDate: 1751566162283 },
        fields: [{ name: "trash_day", domain: { codedValues: [{ code: "TH", name: "Thursday" }] } }],
      });
    if (u.pathname.includes("Trash_Pickup_Day"))
      return response({ features: [{ attributes: { objectid: 11, trash_day: "TH" },
        geometry: { rings: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      }] });
    if (u.pathname.includes("Addresses_"))
      return response({ features: [{ attributes: {
        objectid: 20, house_number: "3", full_street_name: "EDWARDS ST",
      }, geometry: { x: 0.5, y: 0.5 } }] });
    throw Error("Unexpected source");
  };
  const auth = { authorization: "Bearer " + process.env.PILOT_API_TOKEN };
  const rest = await trashPickupRoute.fetch(new Request(
    `https://example.com/api/v1/trash-pickup?parcel_id=${id}&query_address=3%20Edwards%20St`,
    { headers: auth },
  ));
  assert.equal(rest.status, 200);
  const records = await rest.json();
  assert.deepEqual(records, await parcelTrashPickup(id, { query_address: "3 Edwards St" }));
  assert.equal(records.source.source_id, "trash-pickup");
  assert.equal(records.items[0].attributes.trash_day, "Thursday");
  assert.equal(records.items[0].address_evidence.matches_query, true);
  const mcp = await mcpRoute.fetch(new Request("https://example.com/mcp", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call",
      params: { name: "get_parcel_trash_pickup", arguments: {
        parcel_id: String(id), query_address: "3 Edwards St",
      } } }),
  }));
  assert.equal(mcp.status, 200);
  const mcpText = await mcp.text();
  const payload = JSON.parse(mcpText.startsWith("event:") ? mcpText.match(/^data: (.+)$/m)?.[1] : mcpText);
  assert.deepEqual(payload.result.structuredContent, records);
  const denied = await trashPickupRoute.fetch(new Request(`https://example.com/api/v1/trash-pickup?parcel_id=${id}`));
  assert.equal(denied.status, 401);
});

test("parcel geography preserves all intersecting zoning records", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Parcel_Viewer"))
      return response({ features: [parcel(999002)] });
    if (u.pathname.includes("Zoning_"))
      return response({
        features: [
          { attributes: { objectid: 1, zone_code: "A", district_category: "Residential", districts: "A" } },
          { attributes: { objectid: 2, zone_code: "B", district_category: "Business", districts: "B" } },
        ],
      });
    if (u.pathname.includes("Wards_"))
      return response({ features: [{ attributes: { objectid: 3, ward: 7 } }] });
    if (u.pathname.includes("Neighborhoods_"))
      return response({
        features: [{ attributes: { objectid: 4, neighborhood: "Downtown" } }],
      });
    if (u.pathname.includes("New_Haven_Local_Historic_Districts"))
      return response({ features: [{ attributes: { OBJECTID: 5, HistoricDistrict: "Wooster Square" } }] });
    if (u.pathname.includes("New_Haven_State_Historic_Districts"))
      return response({ features: [] });
    throw Error("Unexpected source");
  };
  const out = await parcelRecords("999002", "geography");
  assert.deepEqual(
    out.items
      .filter((x) => x.source_id === "zoning")
      .map((x) => x.attributes.zone_code),
    ["A", "B"],
  );
  assert.equal(out.items.find((x) => x.source_id === "zoning" && x.attributes.zone_code === "B").attributes.district_category, "Business");
  assert.equal(out.partial, false);
  assert.equal(out.sources.length, 5);
  assert.equal(out.items.find((item) => item.source_id === "local-historic-districts").source_record_id, "5");
  assert.equal(out.items.find((item) => item.source_id === "local-historic-districts").match.method, "parcel-intersection");
});

test("DEEP inventory attaches only New Haven rows with an exact official parcel identifier", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    assert.ok(u.pathname.includes("Brownfields_Final_2025"));
    assert.match(u.searchParams.get("where"), /Site_Town/);
    return response({ features: [
      { attributes: { OBJECTID: 1, Site_Town: "New Haven", Site_Name: "Matched PID", Site_Parce: "999041" } },
      { attributes: { OBJECTID: 2, Site_Town: "New Haven", Site_Name: "Matched MBLU", Site_Parce: "12 34" } },
      { attributes: { OBJECTID: 3, Site_Town: "New Haven", Site_Name: "Same address, other parcel", Site_Parce: "999042", Site_Addre: "165 CHURCH ST" } },
      { attributes: { OBJECTID: 4, Site_Town: "Other Town", Site_Name: "Same ID, other town", Site_Parce: "999041" } },
    ] });
  };
  const out = await getSourceRecords("ct-brownfields", parcel(999041));
  assert.equal(out.status, "ok");
  assert.deepEqual(out.items.map((item) => item.attributes.site_name), ["Matched PID", "Matched MBLU"]);
  assert.deepEqual(out.items.map((item) => item.match.method), ["assessor-id-exact", "mblu-exact"]);
  assert.ok(out.items.every((item) => item.event_date === null));
});

test("ward-layer alder contact remains visible when the roster blocks requests", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Parcel_Viewer"))
      return response({ features: [parcel(999005)] });
    if (u.pathname.includes("Wards_"))
      return response({
        features: [
          {
            attributes: {
              objectid: 5,
              ward: 7,
              alder_name: "Test Alder",
              email: "ward7@example.com",
              phone: "203-555-0107",
            },
          },
        ],
      });
    if (u.pathname.includes("list-of-alders"))
      return new Response("", { status: 403 });
    throw Error("Unexpected source");
  };
  const out = await parcelRecords("999005", "representation");
  const alder = out.sources.find((item) => item.source_id === "alders");
  assert.equal(alder.status, "partial");
  assert.equal(
    out.items.find((item) => item.source_id === "alders").attributes.alder_name,
    "Test Alder",
  );
  assert.equal(out.items.find((item) => item.source_id === "alders").attributes.email, "ward7@example.com");
  assert.equal(out.items.find((item) => item.source_id === "alders").attributes.phone, "203-555-0107");
  assert.equal(out.items.find((item) => item.source_id === "alders").attributes.ward, 7);
  assert.match(out.items.find((item) => item.source_id === "alders").source_url, /FeatureServer\/0\/5$/);
  assert.match(alder.warning, /ward layer/);
});

test("official Alder roster exposes the name and contact fields for a matched ward", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Wards_"))
      return response({ features: [{ attributes: { objectid: 5, ward: 7 } }] });
    if (u.pathname.includes("list-of-alders"))
      return new Response(`<table><tr><th>WARD</th><th></th><th>NAME</th><th>ADDRESS</th><th>ZIP CODE</th><th>Telephone #</th></tr>
        <tr><td>7-D</td><td></td><td>Christine Kim<br><a href="mailto:ward7@newhavenct.gov">Ward7@newhavenct.gov</a></td>
        <td>406 Humphrey St</td><td>06511-3924</td><td>203-208-9715</td></tr></table>`,
      { headers: { "content-type": "text/html" } });
    throw Error("Unexpected source");
  };
  const out = await getSourceRecords("alders", parcel(999066));
  assert.equal(out.status, "ok");
  assert.deepEqual({
    ward: out.items[0].attributes.ward,
    ward_label: out.items[0].attributes.ward_label,
    alder_name: out.items[0].attributes.alder_name,
    email: out.items[0].attributes.email,
    phone: out.items[0].attributes.phone,
  }, {
    ward: 7,
    ward_label: "7-D",
    alder_name: "Christine Kim",
    email: "Ward7@newhavenct.gov",
    phone: "203-208-9715",
  });
  assert.equal(out.items[0].match.method, "ward-roster-number");
  assert.match(out.items[0].source_url, /list-of-alders$/);
});

test("CMT districts come from live parcel intersections and contacts stay provisional", async () => {
  globalThis.fetch = async (input, options) => {
    const u = new URL(input);
    if (u.pathname.includes("Parcel_Viewer"))
      return response({ features: [parcel(999008)] });
    if (u.pathname.includes("CMT_Districts")) {
      const outFields =
        u.searchParams.get("outFields") ?? options?.body?.get("outFields");
      assert.doesNotMatch(outFields, /meeting/i);
      return response({
        features: [
          {
            attributes: {
              objectid: 1,
              district_num: "1",
              district_name: "Downtown/Wooster Square",
              cmt_chair: "GIS Contact",
              cmt_email: "contact@example.org",
            },
          },
          {
            attributes: {
              objectid: 2,
              district_num: "2",
              district_name: "Neighboring district",
            },
          },
        ],
      });
    }
    if (u.pathname.includes("Wards_")) return response({ features: [] });
    if (u.pathname.includes("list-of-alders"))
      return new Response("", { status: 403 });
    throw Error("Unexpected source");
  };
  const out = await parcelRecords("999008", "representation");
  const districts = out.items.filter((item) => item.source_id === "cmt");
  assert.equal(districts.length, 2);
  assert.equal(out.sources.find((s) => s.source_id === "cmt").status, "partial");
  const contacts = out.items.filter((item) => item.source_id === "cmt-contacts");
  assert.equal(contacts.length, 2);
  assert.equal(contacts[0].attributes.cmt_chair, "GIS Contact");
  assert.equal(
    out.sources.find((s) => s.source_id === "cmt-contacts").status,
    "partial",
  );
  assert.match(
    out.sources.find((s) => s.source_id === "cmt-contacts").verification_url,
    /newhavenct\.gov\/government\/community-management-team/,
  );
  assert.doesNotMatch(JSON.stringify(contacts), /meeting_location|meetiing_times/);
});

test("upstream permit failure is labeled partial while dated parcel facts remain", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Parcel_Viewer"))
      return response({ features: [parcel(999003)] });
    if (u.hostname === "gis.vgsi.com")
      return new Response(
        '<span id="MainContent_lblPid">999003</span><span id="MainContent_lblLocation">165 Church St</span>',
        { headers: { "content-type": "text/html" } },
      );
    if (u.hostname === "services5.municity5.com")
      throw Error("Source unavailable");
    if (u.hostname === "lci.city")
      return new Response("", { status: 503 });
    if (u.pathname.includes("LCI_Managed_Lots"))
      return response({ features: [] });
    throw Error("Unexpected source");
  };
  const out = await parcelFeed("999003");
  assert.equal(out.partial, true);
  assert.equal(
    out.sources.find((x) => x.source_id === "municity").status,
    "unavailable",
  );
  assert.equal(out.items[0].event_date, "2020-01-02");
  assert.equal(out.items[0].source_id, "parcel-sale");
});

test("overview keeps source gaps and links visible without raw source fields", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Parcel_Viewer"))
      return response({ features: [parcel(999007)] });
    if (u.pathname.includes("LCI_Managed_Lots"))
      return response({ features: [] });
    if (u.hostname === "lci.city") return new Response("", { status: 404 });
    throw Error("Upstream unavailable");
  };
  const out = await parcelOverview("999007");
  assert.equal(out.groups.length, 7);
  const property = out.groups.find((group) => group.id === "property");
  assert.equal(property.sources.find((s) => s.source_id === "tax-bills").status, "unavailable");
  assert.match(property.sources.find((s) => s.source_id === "land-records").source_url, /city-clerk/);
  assert.equal(out.recent_events[0].source_id, "parcel-sale");
  assert.doesNotMatch(JSON.stringify(out), /sale_date|property_address/);
});

test("ArcGIS uses a form body for long spatial queries and source dates accept epoch milliseconds", async () => {
  let seen;
  globalThis.fetch = async (input, options) => {
    seen = { input: String(input), options };
    return response({ features: [] });
  };
  await arcgis("https://example.com/FeatureServer/0", {
    geometry: "x".repeat(3000),
  });
  assert.equal(seen.options.method, "POST");
  assert.equal(seen.options.body.get("geometry").length, 3000);
  const feature = parcel(999004);
  feature.attributes.sale_date = 1577923200000;
  const out = await getSourceRecords("parcel-sale", feature);
  assert.equal(out.items[0].event_date, "2020-01-02");
});

test("MCP requires pilot auth and lists bounded read tools", async () => {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    },
  });
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  assert.equal(
    (
      await mcpRoute.fetch(
        new Request("https://example.com/mcp", {
          method: "POST",
          headers,
          body,
        }),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await mcpRoute.fetch(
        new Request("https://example.com/mcp", {
          method: "POST",
          headers: { ...headers, cookie: issueCookie().split(";")[0] },
          body,
        }),
      )
    ).status,
    401,
  );
  const response = await mcpRoute.fetch(
    new Request("https://example.com/mcp", {
      method: "POST",
      headers: {
        ...headers,
        authorization: "Bearer " + process.env.PILOT_API_TOKEN,
      },
      body,
    }),
  );
  assert.equal(response.status, 200);
  assert.match(await response.text(), /new-haven-parcel-data/);
  const listed = await mcpRoute.fetch(
    new Request("https://example.com/mcp", {
      method: "POST",
      headers: {
        ...headers,
        authorization: "Bearer " + process.env.PILOT_API_TOKEN,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    }),
  );
  assert.equal(listed.status, 200);
  const toolsList = await listed.text();
  assert.match(toolsList, /get_parcel_overview/);
  assert.match(toolsList, /"environment"/);
  assert.doesNotMatch(toolsList, /get_parcel_context/);
});

test("REST and MCP return the same environmental parcel group", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Parcel_Viewer"))
      return response({ features: [parcel(999046)] });
    if (u.pathname.includes("Brownfields_Final_2025"))
      return response({ features: [] });
    throw Error("Unexpected source");
  };
  const auth = { authorization: "Bearer " + process.env.PILOT_API_TOKEN };
  const rest = await recordsRoute.fetch(new Request(
    "https://example.com/api/v1/records?parcel_id=999046&group=environment",
    { headers: auth },
  ));
  assert.equal(rest.status, 200);
  const restData = await rest.json();
  const mcp = await mcpRoute.fetch(new Request("https://example.com/mcp", {
    method: "POST",
    headers: {
      ...auth,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: {
        name: "get_parcel_records",
        arguments: { parcel_id: "999046", group: "environment" },
      },
    }),
  }));
  assert.equal(mcp.status, 200);
  const mcpText = await mcp.text();
  const mcpData = JSON.parse(
    mcpText.startsWith("event:")
      ? mcpText.match(/^data: (.+)$/m)?.[1]
      : mcpText,
  );
  assert.equal(mcpData.result.structuredContent.group, "environment");
  assert.deepEqual(mcpData.result.structuredContent, restData);
});

test("business group prioritizes issued licenses, separates voided licenses, and has REST/MCP parity", async () => {
  const today = new Date().toISOString().slice(0, 10);
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.includes("Parcel_Viewer")) return response({ features: [parcel(999054)] });
    if (url.pathname.endsWith("/GetM5Data"))
      return response({ rows: [{ PrintKey: "12 34", Parcel_ID: 99553 }] });
    if (url.pathname.endsWith("/Children")) return response({
      License: [
        { License_ID: 1, BusinessName: "Current license name", Status: "Issued",
          IssueDate: today, ExpirationDate: "2099-12-31" },
        { License_ID: 2, BusinessName: "Past license name", Status: "Void",
          IssueDate: "2021-01-01", ExpirationDate: "2022-01-01" },
      ],
      Occupant: [{ Occupant_ID: 3, Name: "Listed occupant", InActive: false,
        CreatedDate: today }],
      Permit: [], Application: [], Complaint: [], Contact: [], Document: [], Certificate: [],
    });
    throw Error(`Unexpected source: ${url}`);
  };
  const auth = { authorization: "Bearer " + process.env.PILOT_API_TOKEN };
  const rest = await recordsRoute.fetch(new Request(
    "https://example.com/api/v1/records?parcel_id=999054&group=business",
    { headers: auth },
  ));
  assert.equal(rest.status, 200);
  const data = await rest.json();
  assert.deepEqual(data.items.map((item) => item.attributes.business_name ?? item.attributes.occupant_name),
    ["Current license name", "Past license name", "Listed occupant"]);
  assert.deepEqual(data.items.map((item) => item.display_group.key),
    ["reported", "past", "unclassified"]);
  assert.equal(data.display_group_counts.past, 1);
  const mcp = await mcpRoute.fetch(new Request("https://example.com/mcp", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 37, method: "tools/call",
      params: { name: "get_parcel_records", arguments: { parcel_id: "999054", group: "business" } } }),
  }));
  assert.equal(mcp.status, 200);
  const body = await mcp.text();
  const payload = JSON.parse(body.startsWith("event:") ? body.match(/^data: (.+)$/m)?.[1] : body);
  assert.deepEqual(payload.result.structuredContent, data);
});

test("parcel geometry preserves holes and separate polygon parts", () => {
  const feature = parcel(999047);
  feature.geometry = {
    spatialReference: { wkid: 4326 },
    rings: [
      [[-72.93, 41.3], [-72.93, 41.31], [-72.92, 41.31], [-72.92, 41.3], [-72.93, 41.3]],
      [[-72.928, 41.302], [-72.925, 41.302], [-72.925, 41.305], [-72.928, 41.305], [-72.928, 41.302]],
      [[-72.91, 41.3], [-72.91, 41.31], [-72.90, 41.31], [-72.90, 41.3], [-72.91, 41.3]],
    ],
  };
  const out = parcelFeatureToGeoJSON(feature);
  assert.equal(out.type, "Feature");
  assert.equal(out.geometry.type, "MultiPolygon");
  assert.deepEqual(out.geometry.coordinates.map((part) => part.length).sort(), [1, 2]);
  assert.deepEqual(out.bbox, [-72.93, 41.3, -72.90, 41.31]);
  assert.equal(out.properties.source_id, "parcels");
  assert.match(out.properties.description, /not a building footprint/);
  assert.throws(() => parcelFeatureToGeoJSON({ ...feature, geometry: { rings: [] } }));
});

test("geometry REST and MCP require one selected City parcel object", async () => {
  let calls = 0;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /Parcel_Viewer/);
    calls++;
    const first = parcel(999048);
    const second = parcel(999048);
    second.attributes.objectid = 88001;
    return response({ features: [first, second], spatialReference: { wkid: 4326 } });
  };
  const auth = { authorization: "Bearer " + process.env.PILOT_API_TOKEN };
  const base = "https://example.com/api/v1/geometry?parcel_id=999048";
  assert.equal((await geometryRoute.fetch(new Request(base))).status, 401);
  assert.equal((await geometryRoute.fetch(new Request(base, { headers: auth }))).status, 409);
  const rest = await geometryRoute.fetch(new Request(base + "&objectid=88001", { headers: auth }));
  assert.equal(rest.status, 200);
  const feature = await rest.json();
  assert.equal(feature.id, "999048:88001");
  assert.equal(feature.properties.objectid, 88001);
  const mcp = await mcpRoute.fetch(new Request("https://example.com/mcp", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "get_parcel_geometry", arguments: { parcel_id: "999048", objectid: "88001" } },
    }),
  }));
  assert.equal(mcp.status, 200);
  const mcpText = await mcp.text();
  const payload = JSON.parse(mcpText.startsWith("event:") ? mcpText.match(/^data: (.+)$/m)?.[1] : mcpText);
  assert.deepEqual(payload.result.structuredContent, feature);
  assert.equal(calls, 2, "successful selected parcel geometry uses the five-minute cache");
});

test("geometry never publishes absent or projected parcel coordinates", async () => {
  globalThis.fetch = async () => response({
    features: [{ attributes: parcel(999049).attributes }],
    spatialReference: { wkid: 4326 },
  });
  const auth = { authorization: "Bearer " + process.env.PILOT_API_TOKEN };
  const missing = await geometryRoute.fetch(new Request(
    "https://example.com/api/v1/geometry?parcel_id=999049", { headers: auth },
  ));
  assert.equal(missing.status, 502);
  globalThis.fetch = async () => response({
    features: [parcel(999050)], spatialReference: { wkid: 3857 },
  });
  const projected = await geometryRoute.fetch(new Request(
    "https://example.com/api/v1/geometry?parcel_id=999050", { headers: auth },
  ));
  assert.equal(projected.status, 502);
});

test("map context keeps official parcel and nearby layers separate with REST and MCP parity", async () => {
  const id = 999051;
  const center = [-72.925, 41.305];
  const point = (x, y, attributes) => ({ attributes, geometry: { x, y, spatialReference: { wkid: 4326 } } });
  const zone = { attributes: { OBJECTID: 70, zone_code: "BA", district_category: "Business" }, geometry: polygon };
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (!url.pathname.endsWith("/query"))
      return response({ editingInfo: { lastEditDate: Date.UTC(2026, 3, 15) } });
    if (url.pathname.includes("Parcel_Viewer"))
      return response({ features: [parcel(id)], spatialReference: { wkid: 4326 } });
    if (url.pathname.includes("Addresses_"))
      return response({ features: [point(...center, { objectid: 22, house_number: "165", full_street_name: "CHURCH ST" })], spatialReference: { wkid: 4326 } });
    if (url.pathname.includes("Zoning_"))
      return response({ features: [zone], spatialReference: { wkid: 4326 } });
    if (url.pathname.includes("CT_Transit_New_Haven_Bus_Stops"))
      return response({ features: [
        point(...center, { OBJECTID: 1, StopName: "Church Street", InService: 1 }),
        point(-72.90, 41.32, { OBJECTID: 2, StopName: "Far away" }),
      ], spatialReference: { wkid: 4326 } });
    throw Error(`Unexpected map source: ${url.pathname}`);
  };
  const auth = { authorization: "Bearer " + process.env.PILOT_API_TOKEN };
  const url = `https://example.com/api/v1/map-context?parcel_id=${id}`;
  assert.equal((await mapContextRoute.fetch(new Request(url))).status, 401);
  const rest = await mapContextRoute.fetch(new Request(url, { headers: auth }));
  assert.equal(rest.status, 200);
  const context = await rest.json();
  assert.equal(context.nearby_radius_m, 400);
  assert.deepEqual(context.layers.map((layer) => layer.id), ["parcel-addresses", "zoning", "transit-stops"]);
  assert.equal(context.layers.find((layer) => layer.id === "parcel-addresses").features[0].properties.house_number, "165");
  assert.equal(context.layers.find((layer) => layer.id === "transit-stops").features.length, 1);
  assert.equal(context.layers.find((layer) => layer.id === "zoning").source_updated_at, "2026-04-15");
  assert.ok(context.gaps.some((gap) => gap.id === "loading-zones"));
  assert.doesNotMatch(JSON.stringify(context.layers), /loading.zone|parking.available/i);
  const mcp = await mcpRoute.fetch(new Request("https://example.com/mcp", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/call",
      params: { name: "get_parcel_map_context", arguments: { parcel_id: String(id) } } }),
  }));
  assert.equal(mcp.status, 200);
  const mcpText = await mcp.text();
  const payload = JSON.parse(mcpText.startsWith("event:") ? mcpText.match(/^data: (.+)$/m)?.[1] : mcpText);
  assert.deepEqual(payload.result.structuredContent, context);
  assert.deepEqual(await parcelMapContext(String(id)), context);
});

test("address focus uses explicit full source addresses, not descriptions or parcel-only links", () => {
  const query = "3 Edwards St";
  assert.equal(addressEvidence({ source_id: "addresses", attributes: {
    house_number: "3", full_street_name: "EDWARDS STREET",
  } }, query).matches_query, true);
  assert.equal(addressEvidence({ source_id: "parcels", attributes: {
    property_address: "990 STATE ST",
  } }, query).matches_query, false);
  assert.deepEqual(addressEvidence({ source_id: "municity", category: "Permit", attributes: {
    LegalAddress: "3 EDWARDS STREET", Description: "Work at 990 State St",
  } }, query), {
    source_field: "LegalAddress", source_address: "3 EDWARDS STREET", matches_query: true,
  });
  assert.equal(addressEvidence({ source_id: "municity", category: "Permit", attributes: {
    Description: "Work at 3 Edwards St",
  } }, query), null);
  assert.equal(addressEvidence({ source_id: "municipal-business-licenses", attributes: {
    recorded_address: "3 EDWARDS ST", recorded_address_field: "Addr1",
  } }, query), null);
  assert.equal(addressEvidence({ source_id: "municipal-business-licenses", attributes: {
    recorded_address: "990 STATE ST", recorded_address_field: "LegalAddress",
  } }, query).matches_query, false);
  assert.equal(addressEvidence({ source_id: "assessor-sales", attributes: {
    owner: "3 Edwards St LLC",
  } }, query), null);
  assert.equal(addressEvidence({ source_id: "municity", category: "Document", attributes: {
    document_name: "3 Edwards St plan",
  } }, query), null);
});

test("address focus annotates REST and MCP records without filtering the parcel", async () => {
  const id = 999052;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.includes("Parcel_Viewer"))
      return response({ features: [{ ...parcel(id), attributes: {
        ...parcel(id).attributes, property_address: "990 STATE ST",
      } }], spatialReference: { wkid: 4326 } });
    if (url.pathname.includes("Addresses_") && url.pathname.endsWith("/query"))
      return response({ features: [{ attributes: {
        objectid: 63, house_number: "3", full_street_name: "EDWARDS ST",
      } }] });
    return response({ features: [] });
  };
  const auth = { authorization: "Bearer " + process.env.PILOT_API_TOKEN };
  const rest = await recordsRoute.fetch(new Request(
    `https://example.com/api/v1/records?parcel_id=${id}&group=property&query_address=3%20Edwards%20St`,
    { headers: auth },
  ));
  assert.equal(rest.status, 200);
  const records = await rest.json();
  assert.equal(records.query_address, "3 Edwards St");
  assert.equal(records.items.find((item) => item.source_id === "addresses").address_evidence.matches_query, true);
  assert.equal(records.items.find((item) => item.source_id === "parcels").address_evidence.matches_query, false);
  assert.ok(records.items.some((item) => item.source_id === "parcels"), "parcel-wide records remain visible");
  const mcp = await mcpRoute.fetch(new Request("https://example.com/mcp", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/call",
      params: { name: "get_parcel_records", arguments: {
        parcel_id: String(id), group: "property", query_address: "3 Edwards St",
      } } }),
  }));
  assert.equal(mcp.status, 200);
  const mcpText = await mcp.text();
  const payload = JSON.parse(mcpText.startsWith("event:") ? mcpText.match(/^data: (.+)$/m)?.[1] : mcpText);
  assert.deepEqual(payload.result.structuredContent, records);
  const invalid = await recordsRoute.fetch(new Request(
    `https://example.com/api/v1/records?parcel_id=${id}&group=property&query_address=not-an-address`,
    { headers: auth },
  ));
  assert.equal(invalid.status, 400);
});

test("address focus marks only municipal permit LegalAddress in the dated feed", async () => {
  const id = 999053;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.includes("Parcel_Viewer"))
      return response({ features: [{ ...parcel(id), attributes: {
        ...parcel(id).attributes, property_address: "990 STATE ST",
      } }], spatialReference: { wkid: 4326 } });
    if (url.pathname.endsWith("/GetM5Data"))
      return response({ rows: [{ PrintKey: "12 34", Parcel_ID: 999053 }] });
    if (url.pathname.endsWith("/Children"))
      return response({ Permit: [
        { Permit_ID: 1, Parcel_ID: id, LegalAddress: "3 EDWARDS ST", PermitDate: "2024-06-01", Description: "Shop work" },
        { Permit_ID: 2, Parcel_ID: id, PermitDate: "2024-05-01", Description: "3 Edwards St shop work" },
      ] });
    return response({ features: [] });
  };
  const auth = { authorization: "Bearer " + process.env.PILOT_API_TOKEN };
  const responseData = await feedRoute.fetch(new Request(
    `https://example.com/api/v1/feed?parcel_id=${id}&query_address=3%20Edwards%20St`,
    { headers: auth },
  ));
  assert.equal(responseData.status, 200);
  const feed = await responseData.json();
  const permits = feed.items.filter((item) => item.category === "Permit");
  assert.equal(permits.length, 2);
  assert.equal(permits[0].address_evidence.matches_query, true);
  assert.equal(permits[1].address_evidence, null);
  assert.ok(feed.items.some((item) => item.source_id === "parcel-sale"), "parcel-wide sale entry remains");
});
