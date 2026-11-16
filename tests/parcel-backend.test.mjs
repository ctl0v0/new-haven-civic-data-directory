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
  assert.ok((await allowed.json()).sources.some((x) => x.id === "municity"));
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

test("parcel geography preserves all intersecting zoning records", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(input);
    if (u.pathname.includes("Parcel_Viewer"))
      return response({ features: [parcel(999002)] });
    if (u.pathname.includes("Zoning_"))
      return response({
        features: [
          { attributes: { objectid: 1, zone_code: "A" } },
          { attributes: { objectid: 2, zone_code: "B" } },
        ],
      });
    if (u.pathname.includes("Wards_"))
      return response({ features: [{ attributes: { objectid: 3, ward: 7 } }] });
    if (u.pathname.includes("Neighborhoods_"))
      return response({
        features: [{ attributes: { objectid: 4, neighborhood: "Downtown" } }],
      });
    throw Error("Unexpected source");
  };
  const out = await parcelRecords("999002", "geography");
  assert.deepEqual(
    out.items
      .filter((x) => x.source_id === "zoning")
      .map((x) => x.attributes.zone_code),
    ["A", "B"],
  );
  assert.equal(out.partial, false);
  assert.equal(out.sources.length, 3);
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
});
