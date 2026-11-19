// Backend-only query contract. Keep this aligned with the registered MCP tools
// and protected REST routes; the public data guide does not advertise searches.
export function searchCapabilities() {
  return {
    version: 1,
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
          contact_role: "source-public Contact.ContactRole on the permit or linked application",
          require_contact_role: "exclude permits without that source-public contact role",
        },
        join: "Permit.PrintKey equals one City parcel mblu after slash/space normalization; neighborhood uses City parcel-polygon intersection",
        paging: "scan_limit checks 1–12 candidate permits per call; continue next_cursor until absent",
        completeness: "complete_for_query is false during paging, after source or detail gaps, and when a municipal type reaches its unpageable 2,000-row bound",
        follow_up_tools: ["get_parcel_records", "get_permit_details", "get_application_details"],
      },
    ],
    not_yet_available: [
      "City ward filter and inspection predicates for cross-parcel permit search",
      "Cross-parcel City GIS attribute, sale, zoning, and mapped-feature search",
      "Cross-address trash pickup and school attendance search",
      "Cross-parcel municipal and State business-location search",
      "Citywide LCI case search and official marketed-space availability search",
    ],
    note: "All available matches use official New Haven or State source records. A partial result or missing source check cannot establish that no matching parcel exists.",
  };
}
