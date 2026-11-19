import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { bearerIdentity, sameOrigin } from "../parcel/auth.js";
import { json, readRequestText, SourceError } from "../parcel/http.js";
import { schemaGuide } from "../parcel/guide-schema.js";
import { getDataContext } from "../parcel/data-context.js";
import { askIndexedParcels } from "../search-index/ask.js";
import { searchCapabilities } from "../parcel/search-capabilities.js";
import { getSearchCoverage } from "../search-index/coverage.js";
import { getIndexedRecord } from "../search-index/record.js";
import { auditMunicipalPermitLinks } from "../search-index/linkage-audit.js";
import { SEARCH_FIELDS } from "../search-index/search.js";
import {
  resolveParcel,
  parcelSummary,
  parcelGeometry,
  parcelPhoto,
  parcelMapContext,
  parcelOverview,
  parcelManifest,
  parcelRecords,
  parcelTrashPickup,
  parcelSchoolAttendance,
  parcelPermitDetails,
  parcelApplicationDetails,
  searchMunicipalPermits,
  searchParcelPermits,
  searchParcels,
  searchIndexedParcels,
  searchIndexedRecords,
  searchIndexedPermits,
  nearbyFeatureCounts,
  municipalPermitTypes,
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
      } catch (error) {
        const status = error instanceof SourceError ? error.status : 502;
        const failure = { error: {
          code: status === 400 ? "INVALID_QUERY" : status === 404 ? "NOT_FOUND"
            : status === 409 ? "CURSOR_STALE" : "SOURCE_UNAVAILABLE",
          status,
          message: error instanceof SourceError ? error.message : "A source request failed",
        } };
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(failure) }],
          structuredContent: failure,
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
  const selections = z.array(z.string().min(1).max(100)).max(20).optional();
  const recordFilters = {
    category: selections, record_type: selections, source_id: selections, source_status: selections,
    event_date_from: z.iso.date().optional(), event_date_to: z.iso.date().optional(),
    address_match: z.boolean().optional(),
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
    "get_parcel_manifest",
    "Get source-by-source parcel manifest",
    "Return every configured parcel source's status, returned count, and whether that count is established. Use paged groups and on-demand work details for full records.",
    z.object(common),
    ({ parcel_id, objectid }) => parcelManifest(parcel_id, objectid),
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
    "get_nearby_feature_counts",
    "Count mapped points near a parcel",
    "Count official City mapped metered spaces and City hosted transit stops within 25–1000 metres of the center of a parcel's mapped extent. Reports source IDs, nearest point, and partial coverage. Meter counts are inventory, not live availability.",
    z.object({ ...common,
      radius_meters: z.number().int().min(25).max(1000).optional(),
      source_ids: z.array(z.enum(["metered-parking-spaces", "transit-stops"])).min(1).max(2).optional(),
    }),
    ({ parcel_id, objectid, radius_meters, source_ids }) =>
      nearbyFeatureCounts(parcel_id, { objectid, radius_meters, source_ids }),
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
      ...recordFilters,
      display_group: selections,
    }),
    ({ parcel_id, group, ...options }) => parcelRecords(parcel_id, group, options),
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
      ...recordFilters,
    }),
    ({ parcel_id, ...options }) => parcelFeed(parcel_id, options),
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
    "get_parcel_school_attendance",
    "Get NHPS attendance-zone schools by address",
    "Return published NHPS K–8 and high-school School Choice attendance zones for exact City-listed parcel addresses. A zone gives placement preference, not guaranteed enrollment. Live lookup and official snapshot dates are reported.",
    z.object({
      ...common,
      query_address: z.string().min(1).max(160).optional(),
    }),
    ({ parcel_id, objectid, query_address }) =>
      parcelSchoolAttendance(parcel_id, { objectid, query_address }),
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
    "list_municipal_permit_types",
    "List municipal permit types",
    "Return the live City permit type catalog with exact published type names and groups. A catalog entry does not establish that any permit was issued.",
    z.object({}),
    () => municipalPermitTypes(),
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
    "search_parcel_permits",
    "Search municipal permits across verified City parcels",
    "Scan one bounded page of exact municipal permit types citywide or within a City neighborhood. Filter published permit status/date independently from linked application review type/status/completion date. Returns exact parcel joins, source links, coverage and a cursor; follow every page before relying on completeness. This does not infer approval from PermitDate.",
    z.object({
      scope: z.enum(["city", "neighborhood"]).optional(),
      neighborhood: z.string().min(1).max(80).optional(),
      permit_types: z.array(z.string().min(1).max(100)).min(1).max(6),
      permit_status: z.string().min(1).max(100).optional(),
      permit_date_from: z.iso.date().optional(),
      permit_date_to: z.iso.date().optional(),
      application_status: z.string().min(1).max(100).optional(),
      review_type: z.string().min(1).max(100).optional(),
      review_status: z.string().min(1).max(100).optional(),
      review_completed_from: z.iso.date().optional(),
      review_completed_to: z.iso.date().optional(),
      contact_role: z.string().min(1).max(100).optional(),
      require_contact_role: z.boolean().optional(),
      scan_limit: z.number().int().min(1).max(12).optional(),
      cursor: z.string().max(1500).optional(),
    }),
    (args) => searchParcelPermits(args),
  );
  tool(
    server,
    "search_parcels",
    "Search official City parcel fields",
    "Scan City parcel GIS features citywide or in one published neighborhood or ward. Filter exact City use codes, published commercial-unit count, or one published sale date. Continue the cursor until absent before treating the scan as complete; source and boundary gaps are explicit.",
    z.object({
      scope: z.enum(["city", "neighborhood", "ward"]).optional(),
      neighborhood: z.string().min(1).max(80).optional(),
      ward: z.number().int().min(1).max(100).optional(),
      use_codes: z.array(z.string().min(1).max(40)).max(20).optional(),
      commercial_units_min: z.number().int().min(0).optional(),
      sale_date_from: z.iso.date().optional(),
      sale_date_to: z.iso.date().optional(),
      scan_limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().max(3000).optional(),
    }),
    (args) => searchParcels(args),
  );
  tool(
    server,
    "search_indexed_parcels",
    "Search parcels across indexed official sources",
    "Intersect 1–5 source requirements by exact City parcel joins. Each requirement may filter published fields and event dates. A source without a validated index run, stale data, or ambiguous joins leaves completeness false; results retain official source links.",
    z.object({
      requirements: z.array(z.object({
        source_id: z.enum(["parcels", "addresses", "trash-pickup", "zoning",
          "wards", "neighborhoods", "cmt", "ct-brownfields",
          "ct-liquor-permits", "ct-child-care-licenses", "ct-cannabis-retail",
          "school-attendance", "municity"]),
        equals: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
        one_of: z.record(z.string(), z.array(z.string().min(1).max(40)).min(1).max(250)).optional(),
        number_gte: z.record(z.string(), z.number()).optional(),
        number_lte: z.record(z.string(), z.number()).optional(),
        event_date_from: z.iso.date().optional(),
        event_date_to: z.iso.date().optional(),
      })).min(1).max(5),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().max(3000).optional(),
    }),
    (args) => searchIndexedParcels(args),
  );
  tool(
    server,
    "ask_indexed_parcels",
    "Ask a bounded parcel search question",
    "Interpret a question into reviewed City parcel and municipal permit filters, then return exact parcel matches and source coverage. An unavailable official definition or capped source blocks a complete answer.",
    z.object({ question: z.string().min(1).max(500) }),
    (args) => askIndexedParcels(args),
  );
  tool(
    server,
    "get_data_context",
    "Get official-source data context",
    "Read official-source field meanings and separate service reading rules for parcel, permit, neighborhood and Community Management Team data.",
    z.object({ term: z.string().max(100).optional(), source_id: z.string().max(80).optional(),
      field: z.string().max(80).optional() }),
    (args) => getDataContext(args),
  );
  tool(
    server,
    "search_indexed_permits",
    "Search indexed municipal permits",
    "Search all indexed official permit types, or name up to six exact types, across City parcels and optional neighborhood or ward. Missing, capped, stale and unlinked types remain explicit coverage gaps. Permit date and status are source fields; linked application approvals require the live detail tools.",
    z.object({
      permit_types: z.array(z.string().min(1).max(100)).min(1).max(6).optional(),
      scope: z.enum(["city", "neighborhood", "ward"]).optional(),
      neighborhood: z.string().min(1).max(80).optional(),
      ward: z.number().int().min(1).max(99).optional(),
      permit_status: z.string().min(1).max(100).optional(),
      permit_date_from: z.iso.date().optional(),
      permit_date_to: z.iso.date().optional(),
      limit: z.number().int().min(1).max(50).optional(),
      cursor: z.string().max(3000).optional(),
    }),
    (args) => searchIndexedPermits(args),
  );
  tool(
    server,
    "search_indexed_records",
    "Search indexed official records and parcel links",
    "Page all matching records from one indexed City or State source, with their published fields and exact City parcel links. Filter official fields or a selected parcel; a missing, stale or partially linked source keeps completeness false. Municipal records require one exact PermitType. Use get_indexed_record to inspect all joins for a row.",
    z.object({
      source_id: z.enum(Object.keys(SEARCH_FIELDS)),
      equals: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      number_gte: z.record(z.string(), z.number()).optional(),
      number_lte: z.record(z.string(), z.number()).optional(),
      event_date_from: z.iso.date().optional(),
      event_date_to: z.iso.date().optional(),
      city_parcel_id: parcelId.optional(),
      city_objectid: z.string().regex(/^\d{1,12}$/).optional(),
      limit: z.number().int().min(1).max(50).optional(),
      cursor: z.string().max(3000).optional(),
    }),
    (args) => searchIndexedRecords(args),
  );
  tool(
    server,
    "get_search_coverage",
    "Get cross-parcel search coverage",
    "Return source-by-source index readiness, last complete refresh, join gaps, and live-only source limits. A live parcel lookup is not proof of citywide search coverage.",
    z.object({}),
    () => getSearchCoverage(),
  );
  tool(
    server,
    "audit_municipal_permit_links",
    "Audit municipal permit parcel links",
    "Count exact, ambiguous, and unlinked records for one indexed official permit type. Split unlinked records by missing versus unmatched published PrintKey and return bounded source-row examples. A legal address alone is not a parcel join.",
    z.object({
      permit_type: z.string().min(1).max(100),
      sample_limit: z.number().int().min(1).max(10).optional(),
    }),
    (args) => auditMunicipalPermitLinks(args),
  );
  tool(
    server,
    "get_indexed_record",
    "Inspect one official indexed record",
    "Return one official source row by its published ID, its indexed fields, exact or ambiguous City parcel joins, and refresh coverage. Municipal permit records require the exact published permit type. Full permit children remain available through get_permit_details.",
    z.object({ source_id: z.string().min(1).max(80),
      record_id: z.string().min(1).max(160),
      permit_type: z.string().min(1).max(100).optional(),
      include_geometry: z.boolean().optional() }),
    (args) => getIndexedRecord(args),
  );
  tool(
    server,
    "list_search_capabilities",
    "List cross-parcel search capabilities",
    "Return the implemented backend search scopes, exact source fields, paging and completeness rules, and planned searches that are not yet available.",
    z.object({}),
    () => searchCapabilities(),
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
    "parcel-schema",
    "newhaven://parcel/schema",
    {
      title: "Parcel API and MCP field guide",
      description: "Methods, filters, response fields, sources and reading rules",
      mimeType: "application/json",
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(schemaGuide()) }] }),
  );
  server.registerResource(
    "data-context",
    "newhaven://parcel/context",
    { title: "Official-source parcel data context", description: "Definitions, reading rules, and code-review status",
      mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json",
      text: JSON.stringify(getDataContext()) }] }),
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
