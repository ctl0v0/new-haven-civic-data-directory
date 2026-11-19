import { GROUPS, SOURCES } from "./config.js";
import { DISPLAY_GROUPS } from "./record-state.js";

const methods = [
  ["resolve", "Resolve a parcel", "POST /api/v1/resolve", "resolve_parcel", "Start with an address, parcel ID, MBLU or assessor account. Select a City parcel from any candidates.", "query"],
  ["parcel", "Parcel identity", "GET /api/v1/parcel", "get_parcel", "Return the selected City parcel ID, object ID, published address and available groups.", "parcel_id, objectid"],
  ["overview", "Overview", "GET /api/v1/overview", "get_parcel_overview", "Return source-linked highlights, group counts, source coverage and five dated references.", "parcel_id, objectid"],
  ["manifest", "Parcel source manifest", "GET /api/v1/parcel-manifest", "get_parcel_manifest", "Return the status and count certainty of every configured source for one selected parcel.", "parcel_id, objectid"],
  ["records", "Grouped records", "GET /api/v1/records", "get_parcel_records", "Return a bounded, filterable page of official records, facets and source coverage.", "parcel_id, objectid, group, limit, cursor, filters"],
  ["feed", "Dated timeline", "GET /api/v1/feed", "get_parcel_feed", "Return dated source records. This is not a change log.", "parcel_id, objectid, limit, cursor, filters"],
  ["permit", "Permit details", "GET /api/v1/permit-details", "get_permit_details", "Follow an exact municipal permit ID on the selected parcel to its linked application and public child records.", "parcel_id, objectid, permit_id"],
  ["application", "Application details", "GET /api/v1/application-details", "get_application_details", "Follow an exact municipal application ID on the selected parcel to public child records.", "parcel_id, objectid, application_id"],
  ["geometry", "Parcel boundary", "GET /api/v1/geometry", "get_parcel_geometry", "Return the selected City parcel polygon, which is not a building footprint.", "parcel_id, objectid"],
  ["photo", "Parcel photo", "GET /api/v1/parcel-photo", "get_parcel_photo", "Return an official municipal street view or assessor building photo only after an exact parcel match; photo dates are not established.", "parcel_id, objectid"],
  ["map", "Map layers", "GET /api/v1/map-context", "get_parcel_map_context", "Return City and State mapped features on the parcel and separately labeled nearby context.", "parcel_id, objectid"],
  ["nearby-counts", "Nearby mapped point counts", "GET /api/v1/nearby-feature-counts", "get_nearby_feature_counts", "Return checked mapped meter and transit-stop counts within 25–1000 metres; meter inventory is not live availability.", "parcel_id, objectid, radius_meters, source_id"],
  ["trash", "Trash pickup zones", "GET /api/v1/trash-pickup", "get_parcel_trash_pickup", "Return mapped City pickup zones at City address points on the parcel; service eligibility is not established.", "parcel_id, objectid, query_address"],
  ["school-attendance", "NHPS attendance-zone schools", "GET /api/v1/school-attendance", "get_parcel_school_attendance", "Return address-level K–8 and high-school School Choice attendance zones from exact NHPS street ranges, with live or dated official-snapshot provenance. Placement is not guaranteed.", "parcel_id, objectid, query_address"],
  ["permit-search", "Cross parcel permit search", "GET /api/v1/search-permits", "search_municipal_permits", "Search municipal permits by exact type and City neighborhood with separately labeled linked application, review task and contact fields. Coverage limits remain explicit.", "neighborhood, permit_type, optional status/date/contact filters"],
  ["parcel-search", "Live City parcel search", "GET /api/v1/search-parcels", "search_parcels", "Page through official City parcel use, commercial-unit and sale fields with optional neighborhood or ward scope.", "scope, use_code, commercial_units_min, sale_date_from, sale_date_to, cursor"],
  ["indexed-parcel-search", "Cross-source parcel search", "POST /api/v1/search-indexed-parcels", "search_indexed_parcels", "Intersect indexed official source requirements by exact City parcel joins, including one exact municipal permit type and reviewed City numeric fields; requires validated active source runs.", "requirements, limit, cursor"],
  ["ask-parcels", "Ask a parcel search question", "POST /api/v1/ask-parcels", "ask_indexed_parcels", "Interpret a bounded text query into reviewed City parcel and permit filters; return exact matches with source coverage and the interpreted criteria.", "question"],
  ["data-context", "Data context", "GET /api/v1/data-context", "get_data_context", "Official-source explanations and separately labeled service reading rules for parcel and permit fields, neighborhoods and CMTs.", "term, source_id, field"],
  ["indexed-permit-search", "Indexed municipal permit search", "GET /api/v1/search-indexed-permits", "search_indexed_permits", "Search all indexed official permit types when permit_type is omitted, or exact named types, by published status or permit date and optional ward or neighborhood. Missing and capped types remain coverage gaps.", "permit_type, scope, permit_status, permit_date_from, permit_date_to, cursor"],
  ["indexed-record-search", "Indexed source record search", "POST /api/v1/search-indexed-records", "search_indexed_records", "Page every matching official indexed record and exact City parcel join from one source, with published fields and source links. Missing and ambiguous joins remain explicit gaps.", "source_id, equals, number_gte, number_lte, event_date_from, event_date_to, city_parcel_id, city_objectid, cursor"],
  ["search-coverage", "Cross-search source coverage", "GET /api/v1/search-coverage", "get_search_coverage", "Report index readiness, latest refresh attempts, join gaps and unsupported sources.", "none"],
  ["permit-linkage-audit", "Permit parcel-link audit", "GET /api/v1/permit-linkage-audit", "audit_municipal_permit_links", "Separate missing municipal PrintKey values from unmatched published keys for one indexed permit type. LegalAddress alone is not a parcel join.", "permit_type, sample_limit"],
  ["indexed-record", "Indexed record detail", "GET /api/v1/indexed-record", "get_indexed_record", "Read one indexed official source row with its City parcel joins and refresh coverage; full municipal work details remain available on demand.", "source_id, record_id, permit_type, include_geometry"],
  ["permit-types", "Municipal permit type catalog", "GET /api/v1/permit-types", "list_municipal_permit_types", "Return the City's live configured permit type names and groups. A catalog entry does not establish an issued permit.", "none"],
  ["catalog", "Source catalog", "GET /api/v1/sources", "list_sources", "Explain each source's access mode, coverage and known gaps.", "none"],
].map(([id, title, rest, mcp, description, inputs]) => ({ id, title, rest, mcp, description, inputs }));

const fields = [
  ["parcel_id", "City parcel identifier", "City parcel layer", "The selected parcel anchor; use objectid when one ID is ambiguous."],
  ["objectid", "City GIS feature ID", "City parcel layer", "Identifies the exact selected GIS feature."],
  ["source_id", "Source adapter", "This service", "Identifies the official source checked for a returned row."],
  ["source_record_id", "Source record identifier", "Official source", "Preserves the published row or entity identifier when supplied."],
  ["category", "Record category", "Official source and adapter", "Municipal categories remain distinct. State liquor permits are grouped as Permit; child care and cannabis credentials are grouped as License."],
  ["attributes", "Returned record fields", "Official source and adapter", "Contains source fields returned by this adapter, sometimes with labeled normalized fields. Check source coverage for fields omitted from the public response."],
  ["event_date", "Dated record value", "Official source", "A source event or record date, not a change detected by this service."],
  ["source_url", "Original record link", "Official source", "Open the official record for consequential use."],
  ["match", "Parcel join evidence", "This service", "Shows the official identifier or spatial relationship used to attach the row."],
  ["address_evidence", "Exact address comparison", "This service", "A badge is shown only for an eligible explicit source address; absence does not disprove association."],
  ["display_group", "Reading group", "This service", "Groups published statuses and dates for reading. The original status remains in attributes."],
  ["sources", "Checks and coverage", "This service", "Each source reports status, returned count, coverage, warning and official link where available."],
  ["facets", "Filter counts", "This service", "Counts cover records returned by the checked sources before filters and pagination."],
  ["total", "Filtered count", "This service", "Number of returned rows matching the current filters before pagination."],
  ["returned_total", "Unfiltered count", "This service", "Number of rows returned by checked sources for this group or feed."],
  ["next_cursor", "Next page offset", "This service", "Pass with the same parcel, group and filters; reset it when filters change."],
  ["complete_for_query", "Search completeness", "This service", "True only after the last page of a validated search with every required source and exact join complete."],
  ["source_checks", "Cross-search source checks", "This service", "Identifies missing, stale, unavailable or partial sources for the current search."],
  ["matching_sources", "Indexed match evidence", "This service", "Shows official source links and matching record counts behind a returned parcel."],
].map(([key, label, origin, meaning]) => ({ key, label, origin, meaning }));

export function schemaGuide() {
  return {
    title: "New Haven parcel data guide",
    methods, fields, groups: GROUPS, display_groups: DISPLAY_GROUPS,
    filters: [
      { key: "category", label: "Record category", applies_to: ["records", "feed"], multiple: true },
      { key: "record_type", label: "Exact published permit, application or license type", applies_to: ["records", "feed"], multiple: true },
      { key: "source_id", label: "Official source", applies_to: ["records", "feed"], multiple: true },
      { key: "display_group", label: "Published status reading group", applies_to: ["records"], multiple: true },
      { key: "source_status", label: "Exact published status", applies_to: ["records", "feed"], multiple: true },
      { key: "event_date_from", label: "Event date from, inclusive", applies_to: ["records", "feed"] },
      { key: "event_date_to", label: "Event date through, inclusive", applies_to: ["records", "feed"] },
      { key: "address_match", label: "Explicit source address matches query_address", applies_to: ["records", "feed"] },
    ],
    sources: SOURCES.map(({ id, group, title, url, mode, coverage, verification_url }) =>
      ({ id, group, title, url, mode, coverage, ...(verification_url ? { verification_url } : {}) })),
    rules: [
      "Resolve the City parcel before requesting parcel records.",
      "Only official City and State records are returned; a map background is visual context.",
      "A zero count covers the returned records, not every possible record held by the publisher.",
      "A known source without an integrated parcel join is not_integrated; an owner LLC without a verified State match is not_linked. Neither means a live check failed.",
      "Partial and unavailable live source checks are reported alongside results with their reason.",
      "A published status or date does not prove current occupancy, work underway or a complete history.",
      "NHPS attendance-zone schools describe School Choice placement preference for a published address range, not current enrollment or a guaranteed school assignment.",
      "Cross-parcel index results are conditional on fresh validated source runs. A missing index or failed refresh cannot establish a zero result.",
      "Mapped meter counts describe inventory, not open parking spaces. Stop distance is straight-line from the parcel extent center, not walking distance.",
    ],
  };
}
