import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { issueCookie, authorized, authorizedBearer, sameOrigin } from "../parcel/auth.js";
import { resolveParcel } from "../parcel/resolve.js";
import { parcelRecords, parcelFeed, parcelOverview } from "../parcel/service.js";
import { parseLciProperty } from "../parcel/lci.js";
import { getSourceRecords } from "../parcel/adapters.js";
import { arcgis } from "../parcel/http.js";
import sourcesRoute from "../api/v1/sources.js";
import recordsRoute from "../api/v1/records.js";
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
  assert.equal(coverage.groups.length, 6);
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
  assert.match(await page.text(), /id="search-form"/);
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
  assert.doesNotMatch(JSON.stringify(out), /Unrelated vendor detail/);
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
  assert.equal(permit.source_url, "https://www.municityconnect.com/#/app/NewHavenCityCT/entity/Parcel/99873");
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

test("address-only state and manually selected planning sources do not create parcel records", async () => {
  globalThis.fetch = async () => {
    throw Error("Gap sources must not make upstream record requests");
  };
  const p = parcel(13791);
  p.attributes.property_address = "181 CROWN ST";
  for (const sourceId of ["business-master", "state-licenses", "planning"]) {
    const out = await getSourceRecords(sourceId, p);
    assert.equal(out.status, "unavailable");
    assert.deepEqual(out.items, []);
  }
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
  assert.match(alder.warning, /ward layer/);
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
  assert.equal(out.items[0].source_id, "parcels");
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
  assert.equal(out.groups.length, 6);
  const property = out.groups.find((group) => group.id === "property");
  assert.equal(property.sources.find((s) => s.source_id === "tax-bills").status, "unavailable");
  assert.match(property.sources.find((s) => s.source_id === "land-records").source_url, /city-clerk/);
  assert.equal(out.recent_events[0].source_id, "parcels");
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
  const out = await getSourceRecords("parcels", feature);
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
