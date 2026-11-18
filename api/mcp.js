import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { bearerIdentity, sameOrigin } from "../parcel/auth.js";
import { json, readRequestText, SourceError } from "../parcel/http.js";
import {
  resolveParcel,
  parcelSummary,
  parcelGeometry,
  parcelPhoto,
  parcelMapContext,
  parcelOverview,
  parcelRecords,
  parcelTrashPickup,
  parcelPermitDetails,
  parcelApplicationDetails,
  searchMunicipalPermits,
  parcelFeed,
  sourceCoverage,
} from "../parcel/service.js";

function reply(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
}
function tool(server, name, title, description, inputSchema, handler) {
  server.registerTool(
    name,
    { title, description, inputSchema },
    async (args) => {
      try {
        return reply(await handler(args));
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Source lookup failed. Check the identifier and source coverage.",
            },
          ],
        };
      }
    },
  );
}
export function createServer() {
  const server = new McpServer({
    name: "new-haven-parcel-data",
    version: "0.1.0",
    title: "New Haven Parcel Data Pilot",
  });
  const parcelId = z.string().regex(/^\d{1,12}$/);
  const common = {
    parcel_id: parcelId,
    objectid: z
      .string()
      .regex(/^\d{1,12}$/)
      .optional(),
  };
  tool(
    server,
    "resolve_parcel",
    "Resolve parcel",
    "Search by address, parcel ID, MBLU, or assessor account; returns ambiguity rather than guessing.",
    z.object({ query: z.string().min(1).max(160) }),
    ({ query }) => resolveParcel(query),
  );
  tool(
    server,
    "get_parcel",
    "Get parcel",
    "Return the selected parcel identity and available groups.",
    z.object(common),
    ({ parcel_id, objectid }) => parcelSummary(parcel_id, objectid),
  );
  tool(
    server,
    "get_parcel_overview",
    "Get parcel overview",
    "Return compact group counts, source statuses and five dated record references; use get_parcel_records for details.",
    z.object(common),
    ({ parcel_id, objectid }) => parcelOverview(parcel_id, objectid),
  );
  tool(
    server,
    "get_parcel_geometry",
    "Get parcel geometry",
    "Return the selected City parcel boundary as GeoJSON, with source and parcel identifiers. The boundary is not a building footprint.",
    z.object(common),
    ({ parcel_id, objectid }) => parcelGeometry(parcel_id, objectid),
  );
  tool(
    server,
    "get_parcel_photo",
    "Get verified parcel photo",
    "Return an official municipal street-view photo URL after an exact parcel MBLU match, or a building photo URL from a matching City assessor card. Photo dates and current conditions are not established.",
    z.object(common),
    ({ parcel_id, objectid }) => parcelPhoto(parcel_id, objectid),
  );
  tool(
    server,
    "get_parcel_map_context",
    "Get parcel map context",
    "Return official mapped features on the selected parcel and nearby access features within 400 metres. Nearby features are not parcel records.",
    z.object(common),
    ({ parcel_id, objectid }) => parcelMapContext(parcel_id, objectid),
  );
  tool(
    server,
    "get_parcel_records",
    "Get grouped records",
    "Return one bounded group of source records with provenance and coverage.",
    z.object({
      ...common,
      group: z.enum([
        "property",
        "ownership",
        "geography",
        "environment",
        "representation",
        "activity",
        "business",
      ]),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
      query_address: z.string().min(1).max(160).optional(),
    }),
    ({ parcel_id, objectid, group, cursor, limit, query_address }) =>
      parcelRecords(parcel_id, group, { objectid, cursor, limit, query_address }),
  );
  tool(
    server,
    "get_parcel_feed",
    "Get parcel activity feed",
    "Return dated source records; this is not change tracking.",
    z.object({
      ...common,
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
      query_address: z.string().min(1).max(160).optional(),
    }),
    ({ parcel_id, objectid, cursor, limit, query_address }) =>
      parcelFeed(parcel_id, { objectid, cursor, limit, query_address }),
  );
  tool(
    server,
    "get_parcel_trash_pickup",
    "Get address trash pickup zones",
    "Return the City trash pickup day zone for each City address point on the selected parcel. A zone does not establish collection eligibility or holiday service.",
    z.object({
      ...common,
      query_address: z.string().min(1).max(160).optional(),
    }),
    ({ parcel_id, objectid, query_address }) =>
      parcelTrashPickup(parcel_id, { objectid, query_address }),
  );
  tool(
    server,
    "get_permit_details",
    "Get municipal permit details",
    "Return all published fields for a permit on the selected parcel, its explicitly linked application, and public fee, review task, inspection, document, contact-role, communication and source-flag metadata. Child rows are deduplicated by source ID.",
    z.object({ ...common, permit_id: z.string().regex(/^\d{1,12}$/) }),
    ({ parcel_id, objectid, permit_id }) => parcelPermitDetails(parcel_id, permit_id, objectid),
  );
  tool(
    server,
    "get_application_details",
    "Get municipal application details",
    "Return all published fields for an application on the selected parcel and its public fee, review task, inspection, document, contact-role, communication and source-flag metadata. No permit is inferred from a shared number.",
    z.object({ ...common, application_id: z.string().regex(/^\d{1,12}$/) }),
    ({ parcel_id, objectid, application_id }) => parcelApplicationDetails(parcel_id, application_id, objectid),
  );
  tool(
    server,
    "search_municipal_permits",
    "Search municipal permits across City neighborhoods",
    "Search an exact municipal permit type, join official City parcel MBLUs and neighborhood polygons, and optionally filter permit status, linked application status, application review task status/date, and contact role. days_back applies to permit and review completion dates. An approved review task is reported separately from application status; coverage limits are explicit.",
    z.object({
      neighborhood: z.string().min(1).max(80),
      permit_type: z.string().min(1).max(100),
      permit_status: z.string().min(1).max(100).optional(),
      days_back: z.number().int().min(1).max(365).optional(),
      permit_date_from: z.iso.date().optional(),
      permit_date_through: z.iso.date().optional(),
      application_status: z.string().min(1).max(100).optional(),
      review_status: z.string().min(1).max(100).optional(),
      review_completed_from: z.iso.date().optional(),
      contact_role: z.string().min(1).max(100).optional(),
      require_contact_role: z.boolean().optional(),
    }),
    (args) => searchMunicipalPermits(args),
  );
  tool(
    server,
    "list_sources",
    "List source coverage",
    "Return live, curated, paused, and unavailable source status and limitations.",
    z.object({}),
    () => sourceCoverage(),
  );
  server.registerResource(
    "source-coverage",
    "newhaven://parcel/sources",
    {
      title: "Parcel source coverage",
      description: "Available and unavailable parcel-related sources",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(sourceCoverage()),
        },
      ],
    }),
  );
  server.registerResource(
    "matching-method",
    "newhaven://parcel/methodology",
    {
      title: "Parcel matching method",
      description: "How live records are linked",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({
            rules: [
              "Official parcel ID anchors a result.",
              "Address and spatial matches may be ambiguous.",
              "Address-point and spatial matches can be candidates rather than parcel facts.",
              "No record returned does not prove no event occurred.",
            ],
          }),
        },
      ],
    }),
  );
  return server;
}

const handler = createMcpHandler(() => createServer(), { legacy: "stateless" });
export default {
  fetch: async (request) => {
    const client = bearerIdentity(request);
    if (!client)
      return json({ error: "Pilot bearer token required" }, 401);
    if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
    let inbound = request;
    if (request.method === "POST") {
      let body;
      try {
        body = await readRequestText(request, 65536);
      } catch (error) {
        return json(
          { error: "MCP request too large" },
          error instanceof SourceError ? error.status : 400,
        );
      }
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      inbound = new Request(request.url, { method: "POST", headers, body });
    }
    const response = await handler.fetch(inbound);
    console.info(JSON.stringify({
      event: "parcel_mcp_request",
      method: request.method,
      status: response.status,
      client,
    }));
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "private, no-store");
    return new Response(response.body, { status: response.status, headers });
  },
};
