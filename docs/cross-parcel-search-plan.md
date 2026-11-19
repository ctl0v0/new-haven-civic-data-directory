# Cross-parcel search plan for the private MCP

## Goal and current boundary

The MCP should answer two different questions: “what do the official sources say about this selected parcel?” and “which parcels or addresses satisfy these published criteria?” Every cross-parcel result should carry the matching source row, the City parcel identifier, the exact join or spatial relationship, a source URL, the source field used for each date and status, retrieval time, and query coverage. A missing or failed source check must never be converted into a negative finding. Keep historical rows accessible when current or recently dated rows are shown first.

The parcel-scoped tools answer the first question. The original `search_municipal_permits` is limited to one exact permit type, one City neighborhood, and a permit-date bound. The new backend-only `search_parcel_permits` provides citywide or neighborhood scope, multiple exact types, independent permit and linked review-task date bounds, and signed candidate-scan paging. It returns explicit source and join coverage. The municipal type search itself still has an unpageable 2,000-row response bound, so a broad query can remain incomplete after every returned candidate is checked.

All proposed source facts below come from the existing [official City and State source catalog](../parcel/config.js). “Candidate” means a returned parcel meeting listed source fields; it does not mean a vacant, rentable, safe, permitted, or available space.

## Questions worth supporting

| Audience | Example question | Official fields and join | Delivery |
| --- | --- | --- | --- |
| Residents | Which addresses on this block have Thursday trash pickup? | City address points intersect City trash-zone polygons; return addresses, zone IDs and layer edit date | Expand live GIS address search |
| Residents | Which addresses have East Rock Magnet as their K–8 School Choice attendance zone? | City address number and street checked against NHPS published street ranges; report preference, not enrollment | Search the dated official NHPS snapshot, with the existing live check for selected addresses |
| Residents | Which parcels in my ward had a published permit issued this year? | City ward polygon + parcel MBLU + municipal `PermStatus` and `PermitDate` | Expand permit search |
| Residents | Which properties in my neighborhood have housing cases filed recently? | LCI PID and address-verified case `filed_date` | Block citywide claim until an official complete case search or export is verified; parcel lookup stays available |
| Tradespeople | Show Hood - C permits with an Approved Mechanical Review completed in a chosen period. | Exact municipal type; linked Application `TaskType`, `ApprovalStatus`, `DateCompleted`; exact `PrintKey` = City MBLU | Paged backend search available; observe source cap |
| Tradespeople | Find issued Water Heater permits in Westville and the source-public Contractor contact. | Municipal permit and linked application/contact rows; City neighborhood intersection; only source-public contractor details | Paged backend search available; observe source cap |
| Tradespeople | Find parcels with Kitchen Hood inspections reported Passed last month. | Permit child `Inspection.InspType`, `Status`, and separately named `SchedDate` or `CloseDate` | Needs searchable child records and a reviewed date rule; do not treat a scheduled date as a passed date |
| Commercial owners | Which parcels in a neighborhood have two or more published commercial units and intersect a named zoning district? | City parcel `units_commercial` and City zoning polygons | Live GIS query and spatial join; report codes, not permitted uses |
| Commercial owners | Which parcels show a City GIS sale date in the last year? | City parcel `sale_date`, `price`, `book`, `page`; optional neighborhood intersection | Live GIS query; clearly label this as one published sale field set, not complete ownership history |
| Commercial owners | Which selected parcels have a matched owner LLC and State-listed principals? | City owner legal name and mailing address; exact State registry entity join, then principal entity ID | Bounded multi-parcel enrichment; principals are not declared beneficial owners |
| Commercial owners | Which parcels are listed in the State brownfields inventory? | DEEP `Site_Parce` equals official parcel PID or MBLU | Search official inventory and verify exact join; an inventory row is not a present-condition finding |
| Entrepreneurs | Which parcels have a published commercial use code, commercial units, and a 1,000–3,000 sq ft assessor subarea? | City parcel fields plus exact-PID Vision building subarea rows | Candidate search after a bounded assessor search path exists; a subarea is not available retail floor area |
| Entrepreneurs | Where do municipal business licenses or State liquor locations appear near a candidate address? | Municipal MBLU parcel join or State site address uniquely resolved through City address points; distance from a specified City point or parcel boundary | Add typed business-location and nearby-context searches; historical records remain visible |
| Entrepreneurs | Which candidates have mapped bus stops or metered parking spaces within a stated distance? | Official City-hosted map points, explicit radius and measurement origin | Live spatial summary; count mapped features, never available parking spaces or walking distance |
| Entrepreneurs | Which storefronts are available to rent now? | No verified official vacancy or marketed-space source in the current catalog | Do not answer from missing occupants, old licenses, low assessment values, or a managed-lot flag. Add only after an official availability source and direct parcel/address join are verified |

## Search contract

Build a small set of typed MCP tools over a shared search service:

1. `search_parcels`: City GIS attribute and boundary criteria, with optional **positive** source-record predicates. Return distinct City `parcel_id` + `objectid` pairs and the rows that matched.
2. `search_parcel_permits` (first slice of municipal record search): exact published permit types, citywide or one verified neighborhood, permit/application/review field filters, and independent inclusive permit and review-completion dates, with the existing source-public contact-role option. Ward and inspection predicates remain to be implemented. Do not use `PermitDate` as a proxy for an approval or inspection date.
3. `search_business_locations`: Search verified municipal business rows and the three integrated State location rosters, retaining source-specific status and exact site-address join evidence.
4. `search_addresses`: Address-level NHPS attendance-zone and City trash-zone search. Return address identifiers as well as parcel joins when unique; do not turn a spatial address point into a legal unit determination.
5. Keep `get_parcel_records`, `get_permit_details`, and `get_application_details` as follow-up tools for the full record. Add a `list_search_capabilities` resource/tool so an MCP client can discover supported fields, source meanings, and query limits before forming a search.

Use one validated query shape: `scope` (city, official neighborhood or ward identifier, parcel IDs, or bounded geometry), source-specific `filters`, `sort`, `limit`, and opaque `cursor`. Arrays of exact published types can express OR within one field; different filters are AND. Reject unsupported joins and ambiguous date phrases rather than silently choosing a field. Resolve relative periods to explicit dates, echo the bounds and reference date, and distinguish a rolling year from the previous calendar year. A natural-language client can translate a question into these typed arguments, but the server decides which joins are allowed.

For example, “Hood - C permits with an Approved Mechanical Review completed in the last year” should compile to exact `PermitType = "Hood - C"`, `TaskType = "Mechanical Review"`, `ApprovalStatus = "Approved"`, and an inclusive range on `Task.DateCompleted`. The permit's own `PermitDate` remains a returned field, not an implicit filter. A citywide scope is explicit; if the source cannot be fully paged, the response says the query is incomplete.

Each page returns `matches` with source record IDs/URLs and `match` evidence; `coverage` with searched scope, source rows examined, exact joins, ambiguous/unmatched rows, failures and truncation; `complete_for_query`; `retrieved_at`; and `next_cursor`. Distinguish unique parcel count from matching record count. If a required source is incomplete, the result remains available with `complete_for_query: false`; never answer “none” as a definitive absence. Source `Modified` metadata and service retrieval time stay separate from event dates. Contact update timestamps never become contact events.

## Execution and storage

Start each query at the most selective official source. Push supported type, status, date and geometry filters to the City GIS, State Socrata, or municipal service; then verify each returned parcel association against the City parcel layer. Avoid requesting the full 41-source parcel feed for every candidate. Reuse the existing five-minute cache for bounded live lookups.

Citywide searches need completeness checks. Confirm whether the municipal service offers stable pagination or an official export beyond its current 2,000-row request bound. Confirm source sort order and deletions before using any high-water mark. If those checks fail, do not label a result complete. Similar source-level reviews are needed for State roster row limits, assessor card availability, and LCI citywide access.

The first durable storage, if needed, should be a **search index of official facts**, not a copy of every parcel response: source record ID and URL, City parcel ID/object ID, exact join key, searchable published type/status/date fields, source retrieval/refresh time, and coverage/version metadata. Index public review-task fields only after the approval/date semantics are tested. Full permit fields, contact details, documents and photos remain on-demand live lookups. The existing dated NHPS fallback is a separate source snapshot. Reconcile changed and removed source rows on refresh; a failed refresh must not silently present stale rows as current.

## Delivery sequence and acceptance checks

1. **Query contract and evidence:** implement the typed criteria, independent source-date filters, cursor paging, coverage response, and capability catalog. Preserve historical statuses. Test 486 Orange St: Hood - C permit `M-23-00357` joins City parcel 12846 through MBLU; its two Approved review tasks have June 2023 `DateCompleted` values, so it does not match an approval window in 2025–2026.
2. **Permit search first:** support citywide or one boundary, multiple exact types, review-task date upper/lower bounds, and complete pagination or an explicit incomplete result. Keep application `Status`, `PermitApplicationStatus`, permit `PermStatus`, and task `ApprovalStatus` distinct. Return a page of verified parcels and linked permit rows without the 50-detail hard stop.
3. **Live GIS and address search:** parcel attributes, sale fields, ward/neighborhood/zoning intersections, trash address points, NHPS ranges and bounded mapped-feature counts. State whether distance starts at a parcel boundary, center, or official address point.
4. **Business and State joins:** municipal licenses/occupants, State liquor/child care/cannabis locations, DEEP parcel inventory, then matched owner LLC principals. Require the current exact joins; do not turn a business license into present occupancy or a registered agent into the parcel owner.
5. **Source gaps and availability:** seek an official City or State marketed-property feed and a citywide LCI case path. Publish those tools only after join, update, and coverage checks pass. Until then, return “availability not established” and keep positive parcel candidate criteria separate.

For each tool, verify a positive result, a no-match with complete coverage, an upstream failure, truncation, an ambiguous address/MBLU, and a historical row. Compare the MCP and REST results for the same query. Keep the pilot private while measuring source request volume and refresh behavior.
