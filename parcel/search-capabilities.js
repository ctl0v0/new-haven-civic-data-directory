// Backend-only query contract. Keep this aligned with the registered MCP tools
// and protected REST routes; the public data guide does not advertise searches.
import { NUMBER_FIELDS, SEARCH_FIELDS } from "../search-index/search.js";
import { MUNICIPAL_LICENSE_SOURCE } from "../search-index/municipal-licenses.js";
import { PERMIT_ACTIVITY_TYPES } from "../search-index/permit-activity-source.js";
import { STATE_ROSTERS } from "../search-index/socrata.js";
import { indexConfigured, indexQuery } from "../search-index/db.js";
import { SourceError } from "./http.js";
import { parcelQueryCatalog } from "./query-contract.js";
import { CHARITY_SOURCE } from "./charity-registrations.js";

const eventFields = { parcels: "sale_date", municity: "PermitDate",
  [MUNICIPAL_LICENSE_SOURCE]: "IssueDate",
  ...Object.fromEntries(Object.entries(STATE_ROSTERS).map(([id, source]) => [id, source.event_date])) };
const valueFields = {
  parcels: ["use_code", "zone"], zoning: ["zone_code"], wards: ["ward"],
  neighborhoods: ["neighborhood", "neighborhood_label"], "trash-pickup": ["trash_day"],
  municity: ["PermStatus"], [MUNICIPAL_LICENSE_SOURCE]: ["LicenseType", "Status"],
  "ct-liquor-permits": ["status"], "ct-child-care-licenses": ["licensetype", "status"],
  "ct-cannabis-retail": ["type"], [CHARITY_SOURCE]: ["credential", "status"], "managed-lots": ["status"],
};

export async function indexedQueryValues(source, field, { query = indexQuery, configured = indexConfigured } = {}) {
  if (!Object.hasOwn(valueFields, source) || !valueFields[source].includes(field) ||
      !SEARCH_FIELDS[source]?.includes(field))
    throw new SourceError("Observed values are available for the listed categorical fields.", 400);
  if (!configured()) return { status: "unconfigured", values: [] };
  const [run] = await query(`SELECT a.run_id, s.finished_at, s.status FROM search_active_runs a
    JOIN search_source_runs s ON s.id = a.run_id
    WHERE a.source_id = $1 AND a.scope_key = $2`,
  [source, source === "municity" ? "permit-window:90" : "all"]);
  if (!run) return { status: "not_indexed", values: [] };
  const rows = await query(`SELECT DISTINCT trim(fields->>$3) AS value FROM search_records
    WHERE source_id = $1 AND run_id = $2 AND nullif(trim(fields->>$3), '') IS NOT NULL
      AND EXISTS (SELECT 1 FROM search_record_parcels j WHERE j.run_id = search_records.run_id
        AND j.source_id = search_records.source_id AND j.record_id = search_records.record_id
        AND j.join_status = 'exact')
    ORDER BY value LIMIT 101`, [source, run.run_id, field]);
  return { status: run.status, checked_at: run.finished_at, values: rows.slice(0, 100).map(({ value }) => value),
    truncated: rows.length > 100 };
}

export function searchCapabilities() {
  return {
    version: 3,
    query_catalog: parcelQueryCatalog(),
    available: [
      {
        tool: "search_parcel_permits",
        rest: "GET /api/v1/search-parcel-permits",
        sources: ["municity", "city_parcels", "city_neighborhoods"],
        scopes: ["city", "neighborhood"],
        filter_fields: {
          permit_types: "Permit.PermitType; one to six exact published types, OR within the list",
          permit_status: "Permit.PermStatus",
          permit_date_from: "Permit.PermitDate; inclusive lower calendar date",
          permit_date_to: "Permit.PermitDate; inclusive upper calendar date",
          application_status: "Application.PermitApplicationStatus on the verified linked application",
          review_type: "Task.TaskType on the verified linked application",
          review_status: "Task.ApprovalStatus on the verified linked application",
          review_completed_from: "Task.DateCompleted; inclusive lower calendar date",
          review_completed_to: "Task.DateCompleted; inclusive upper calendar date",
          contact_role: "Published Contact.ContactRole on the permit or linked application",
          require_contact_role: "Exclude permits without the named published contact role",
          permit_description_terms: "Require any of up to six text terms in the published permit description",
        },
        join: "Permit.PrintKey equals one City parcel mblu after slash/space normalization; neighborhood uses City parcel-polygon intersection",
        paging: "scan_limit checks 1–12 candidate permits per call; continue next_cursor until absent",
        completeness: "complete_for_query is false during paging, after source or detail gaps, and when a municipal type reaches its unpageable 2,000-row bound",
        follow_up_tools: ["get_parcel_records", "get_permit_details", "get_application_details"],
      },
      {
        tool: "search_parcels",
        rest: "GET /api/v1/search-parcels",
        sources: ["parcels", "neighborhoods", "wards"],
        scopes: ["city", "neighborhood", "ward"],
        filter_fields: {
          use_codes: "City parcel use_code exact values",
          commercial_units_min: "City parcel units_commercial minimum",
          sale_date_from: "City parcel sale_date inclusive lower calendar date",
          sale_date_to: "City parcel sale_date inclusive upper calendar date",
        },
        paging: "scan_limit checks 1–200 City parcel features per call; follow next_cursor",
        completeness: "Complete only after every candidate feature is scanned with matching City IDs and counts and no unreadable filter fields or source gaps",
      },
      {
        tool: "search_indexed_parcels",
        rest: "POST /api/v1/search-indexed-parcels",
        sources: Object.keys(SEARCH_FIELDS),
        scopes: ["City parcel joins across one to five published-source requirements"],
        filter_fields: {
          equals: "Exact source-published fields from the search field allowlist",
          one_of: "Reviewed City parcel use_code values only; OR within the list",
          number_gte: "Inclusive lower bound on reviewed numeric City parcel fields, including unit counts and assessed values",
          number_lte: "Inclusive upper bound on the same reviewed numeric City parcel fields",
          municipal_type: "A municity requirement must name one exact PermitType; it can be combined with City and State source requirements",
          permit_group: "A municity requirement may instead name a published permit group with a validated bounded group run",
          event_date_from: "Source-published event date only, inclusive",
          event_date_to: "Source-published event date only, inclusive",
        },
        paging: "1–100 matched parcels per page; continue next_cursor",
        completeness: "Requires a fresh validated active run for every source, exact joins, no source row gaps, and the last result page. A date-bounded municipal run can establish completeness only inside its published coverage window",
        follow_up_tools: ["get_search_coverage", "get_indexed_record", "get_parcel_manifest", "get_parcel_records"],
      },
      {
        tool: "search_indexed_permits",
        rest: "GET /api/v1/search-indexed-permits",
        sources: ["municity", "parcels", "neighborhoods", "wards"],
        scopes: ["city", "neighborhood", "ward"],
        filter_fields: {
          permit_types: "Optional: one to six exact published PermitType values. Within a validated recent date window, omit to search all published types. Historical searches use the indexed type catalog",
          permit_status: "Published PermStatus exact value",
          permit_date_from: "Published PermitDate lower calendar date",
          permit_date_to: "Published PermitDate upper calendar date",
        },
        paging: "1–50 matching permit rows per page; continue next_cursor",
        completeness: "Provide both dates to use a verified all-type recent run when it covers the window. Other searches use historical type runs. Freshness, exact parcel joins, source gaps and remaining pages determine completeness; approval fields require live details",
        follow_up_tools: ["get_indexed_record", "get_permit_details", "get_application_details"],
      },
      {
        tool: "search_indexed_permit_activity",
        rest: "GET /api/v1/search-indexed-permit-activity",
        sources: ["municity-permit-activity", "parcels", "neighborhoods"],
        scopes: ["city", "neighborhood", "parcel", "permit"],
        filter_fields: {
          permit_type: "Exact Water Heater or Hood - C",
          activity_kind: "Application, review task, or inspection",
          activity_type: "Exact published type for the selected kind",
          activity_status: "Exact published status for the selected kind",
          activity_date_from: "Inclusive ApplicationDate, DateCompleted, or CloseDate lower bound",
          activity_date_to: "Inclusive upper bound on that same official date",
          permit_date_from: "Separate inclusive PermitDate lower bound",
          permit_date_to: "Separate inclusive PermitDate upper bound",
        },
        paging: "1–50 matching rows per page",
        completeness: "Bounded to the active 90-day parent PermitDate window; coverage reports activity checks and parent parcel link gaps",
        follow_up_tools: ["get_search_coverage", "get_permit_details", "get_application_details"],
      },
      {
        tool: "search_indexed_records",
        rest: "POST /api/v1/search-indexed-records",
        sources: Object.keys(SEARCH_FIELDS),
        scopes: ["all exact parcel-linked records in one indexed source", "one City parcel ID and object ID", "City neighborhood", "verified license or registration address"],
        filter_fields: {
          source_id: "One indexed official source; municipal rows require one exact PermitType",
          equals: "Exact published fields from indexed_source_fields",
          number_gte: "Inclusive bounds on reviewed numeric source fields",
          number_lte: "Inclusive bounds on reviewed numeric source fields",
          event_date_from: "Source event date, inclusive lower calendar date",
          event_date_to: "Source event date, inclusive upper calendar date",
          city_parcel_id: "Optional exact City parcel ID, paired with city_objectid",
          city_objectid: "Optional exact City feature ID, paired with city_parcel_id",
          neighborhood: "Exact City neighborhood name or label",
          site_address: "For indexed City and State licenses, match the published address through an exact City address point on the linked parcel",
        },
        paging: "1–50 matching source record and parcel-link pairs per page; continue next_cursor",
        completeness: "Requires fresh validated source and City parcel runs, exact joins, no source row gaps and the last result page. It does not include source rows without an exact parcel link. Address-linked sources include City address-point fields for each exact address join.",
        follow_up_tools: ["get_indexed_record", "get_parcel_manifest", "get_parcel_records"],
      },
      {
        tool: "ask_indexed_parcels",
        rest: "POST /api/v1/ask-parcels",
        sources: ["parcels", "neighborhoods", "municity", MUNICIPAL_LICENSE_SOURCE],
        scopes: ["Municipal permits and their published contact roles, reviewed commercial parcel use, and City business license issuance"],
        filter_fields: { question: "Permit type or group, published status, date window, City neighborhood, permit contact role, or recent City business license issuance" },
        paging: "First parcel page is returned with validated criteria; use search_indexed_parcels and its cursor for later pages",
        completeness: "The model supplies no source facts. The checked index and official code review control completeness; unsupported or ambiguous questions return clarification.",
        follow_up_tools: ["get_data_context", "get_search_coverage", "search_indexed_parcels"],
      },
      {
        tool: "get_data_context",
        rest: "GET /api/v1/data-context",
        sources: ["parcels", "neighborhoods", "cmt", "municity"],
        scopes: ["Reviewed official-source meanings and separately labeled service reading rules"],
        filter_fields: { term: "Optional text", source_id: "Optional source", field: "Optional published field" },
        completeness: "Only reviewed entries are returned; City use-code definitions are withheld until an official dictionary is reviewed.",
      },
      { tool: "ask_parcel_data", rest: "POST /api/v1/ask-parcel-data",
        sources: ["Parcel query catalog"], scopes: ["city", "parcel", "address", "neighborhood", "ward"],
        filter_fields: { question: "Natural-language question", plan_only: "Prepare a plan for confirmation before searching parcel records",
          clarification: "Optional returned clarification ID and selected option ID" },
        paging: "Run the reviewed plan with query_parcel_data. Use that same plan with next_cursor for additional pages.",
        completeness: "The interpreter supplies criteria. Official record coverage controls completeness.",
        follow_up_tools: ["list_parcel_query_catalog", "query_parcel_data", "get_search_coverage"] },
      { tool: "query_parcel_data", rest: "POST /api/v1/query-parcel-data",
        sources: ["Parcel query catalog"], scopes: ["city", "parcel", "address", "neighborhood", "ward"],
        filter_fields: { requirements: "Indexed source predicates and published date bounds",
          include: "Return sources and selected fields", contact_role: "Published permit contact role" },
        paging: "Use the same plan with next_cursor until the last page.",
        completeness: "Partial index and live checks are reported. Every match is grouped by exact City parcel ID and object ID.",
        follow_up_tools: ["list_parcel_query_catalog", "get_search_coverage", "get_parcel_manifest"] },
    ],
    not_yet_available: [
      "Indexed citywide permit fees and contact roles; live permit searches can check published contact roles",
      "Indexed citywide applications, review tasks, and inspections outside the configured permit types and parent PermitDate window",
      "Cross-parcel municipal occupant searches; City license issuance searches depend on published IssueDate coverage",
      "Citywide assessor ownership and valuation history, building subareas and outbuildings; exact-PID card detail is available per parcel",
      "Cross-parcel State LLC principal and agent search; the verified owner-LLC registry join is available per parcel",
      "Citywide LCI case search and official marketed-space availability search",
    ],
    spatial_summary: {
      tool: "get_nearby_feature_counts",
      rest: "GET /api/v1/nearby-feature-counts",
      sources: ["metered-parking-spaces", "transit-stops"],
      radius_meters: "25–1000 from the center of the City parcel's mapped extent",
      completeness: "Official ID and count checks and complete point geometry batches; incomplete layers return no asserted count",
      note: "Mapped meters do not report available spaces; mapped stop distance is straight-line, not walking distance or service frequency.",
    },
    indexed_source_fields: Object.fromEntries(Object.entries(SEARCH_FIELDS)
      .map(([source_id, fields]) => [source_id, {
        equals: fields,
        one_of: source_id === "parcels" ? ["use_code"] : [],
        number_gte: NUMBER_FIELDS[source_id] ?? [],
        number_lte: NUMBER_FIELDS[source_id] ?? [],
        event_date: "Only the source event_date value stored in the index; null dates do not match date bounds",
        event_date_field: eventFields[source_id] ?? null,
        observed_value_fields: (valueFields[source_id] ?? []).filter((field) => fields.includes(field)),
        site_address_supported: source_id === MUNICIPAL_LICENSE_SOURCE || Object.hasOwn(STATE_ROSTERS, source_id),
      }])),
    permit_activity_types: PERMIT_ACTIVITY_TYPES,
    diagnostics: {
      tool: "audit_municipal_permit_links",
      rest: "GET /api/v1/permit-linkage-audit",
      scope: "One exact published municipal permit type with an active indexed run",
      reports: ["exact parcel links", "ambiguous links", "missing PrintKey",
        "unmatched nonblank PrintKey", "unlinked records with vendor Parcel_ID"],
      note: "Only aggregate counts are retained for permits without verified parcel links.",
    },
    note: "All available matches use official New Haven or State source records. A partial result or missing source check cannot establish that no matching parcel exists.",
  };
}
