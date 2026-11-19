import test from "node:test";
import assert from "node:assert/strict";
import permitTypesRoute from "../api/v1/permit-types.js";
import mcpRoute from "../api/mcp.js";

test("private REST and MCP expose the same live municipal permit type catalog", async () => {
  const token = process.env.PILOT_API_TOKEN;
  const passphrase = process.env.PILOT_PASSPHRASE;
  const secret = process.env.PILOT_COOKIE_SECRET;
  const previousFetch = globalThis.fetch;
  process.env.PILOT_API_TOKEN = "test-permit-type-token-123456789";
  process.env.PILOT_PASSPHRASE = "test-permit-type-passphrase-123456789";
  process.env.PILOT_COOKIE_SECRET = "test-permit-type-secret-123456789";
  let calls = 0;
  globalThis.fetch = async (input, options) => {
    calls++;
    assert.equal(String(input), "https://services5.municity5.com/M5Services/M5Service.svc/Customer/NewHavenCityCT/PermitTypes");
    assert.equal(options.headers.SourceId, "2");
    return Response.json([
      { PermitType_ID: 2, MainCode: "Water Heater", TypeGroup: "Plumbing", Deleted: null },
      { PermitType_ID: 1, MainCode: "Addition", TypeGroup: "Building", Deleted: 0 },
    ]);
  };
  try {
    const url = "https://example.com/api/v1/permit-types";
    assert.equal((await permitTypesRoute.fetch(new Request(url))).status, 401);
    const headers = { authorization: `Bearer ${process.env.PILOT_API_TOKEN}` };
    const rest = await permitTypesRoute.fetch(new Request(url, { headers }));
    assert.equal(rest.status, 200);
    const catalog = await rest.json();
    assert.equal(catalog.distinct_type_names, 2);
    assert.equal(catalog.group_count, 2);
    assert.deepEqual(catalog.groups.map((group) => group.name), ["Building", "Plumbing"]);
    assert.equal(catalog.groups[1].types[0].name, "Water Heater");
    assert.equal(catalog.groups[1].types[0].deleted_as_published, null);
    assert.match(catalog.scope, /not a count of issued/);

    const mcp = await mcpRoute.fetch(new Request("https://example.com/mcp", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call",
        params: { name: "list_municipal_permit_types", arguments: {} } }),
    }));
    assert.equal(mcp.status, 200);
    const body = await mcp.text();
    const payload = JSON.parse(body.startsWith("event:") ? body.match(/^data: (.+)$/m)?.[1] : body);
    assert.deepEqual(payload.result.structuredContent, catalog);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (token === undefined) delete process.env.PILOT_API_TOKEN;
    else process.env.PILOT_API_TOKEN = token;
    if (passphrase === undefined) delete process.env.PILOT_PASSPHRASE;
    else process.env.PILOT_PASSPHRASE = passphrase;
    if (secret === undefined) delete process.env.PILOT_COOKIE_SECRET;
    else process.env.PILOT_COOKIE_SECRET = secret;
  }
});
