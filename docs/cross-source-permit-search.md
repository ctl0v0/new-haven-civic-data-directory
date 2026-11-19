# Cross-source municipal permit search

The private MCP tool `search_municipal_permits` and protected REST route `/api/v1/search-permits` answer bounded questions across the City of New Haven's public [municipal permit service](https://www.municityconnect.com/#/app/NewHavenCityCT/landing), [parcel GIS layer](https://gis.newhavenct.gov/server/rest/services/Hosted/New_Haven_Parcels_Authoritative_Parcel_Viewer/FeatureServer/0), and [neighborhood GIS layer](https://gis.newhavenct.gov/server/rest/services/Hosted/Neighborhoods_%28View%29/FeatureServer/0). These tools query live sources with the existing five-minute cache. The separate [private search index](search-index.md) stores selected official search facts and refresh coverage for broader questions.

Example MCP arguments for the November 18, 2026 Westville check:

```json
{
  "neighborhood": "Westville",
  "permit_type": "Water Heater",
  "permit_status": "Issued",
  "days_back": 90,
  "review_status": "Approved",
  "contact_role": "Contractor"
}
```

`days_back` applies to both the permit's published `PermitDate` and the linked application's review task `DateCompleted`, inclusively. The tool reports the computed calendar-date cutoff. `review_status` filters `Task.ApprovalStatus` only when `Task.Entity` is `Application` and `Task.Entity_ID` equals the permit's verified `Application_ID`. It does **not** rename the application's `PermitApplicationStatus`; in the checked 2026 examples that status is `Issued`, while the separate Plumbing Review task is `Approved`. Callers can separately filter `application_status` when that is the intended field. `contact_role` selects matching contact rows; `require_contact_role=true` also excludes permits without that role.

The source join has three checks:

1. Search the municipal service by exact `PermitType`, then apply the requested permit status and source calendar dates. The service's `numrecs` parameter caps a response; the tool marks the result partial when its 2,000-row bound is reached.
2. Query the named City neighborhood polygon and City parcel polygons that intersect it. The tool labels this relationship as polygon intersection, not an address or legal neighborhood assignment.
3. Require the municipal permit `PrintKey` to equal one and only one intersecting City parcel `mblu` after slash/space normalization. The existing permit detail lookup then verifies that permit ID on the matching municipal parcel and follows only its explicit application ID.

The response includes permit, application, review-task, contact, parcel and neighborhood source fields or URLs, plus source counts and a `partial` flag scoped to the query criteria. Optional child-detail gaps, such as a missing Inspection or Flag array, remain visible through each item's `detail_partial` and `detail_warnings`; they do not make an otherwise complete permit/review/contact search partial. Contractor phone, email, company and address are returned only when the source row's `ContactRole` is `Contractor` and its `Role.IsPublic` flag is true. Contacts under both permit and application are deduplicated by their source ID. Source rows with no exact parcel join or an ambiguous MBLU are excluded and counted. Queries that would require more than 50 parcel-linked permit detail checks must be narrowed by date. The tool does not use a status change log, infer an approval date from application status, or claim complete inspection coverage.

## Paged citywide and multi-type search

The private MCP tool `search_parcel_permits` and protected REST route `/api/v1/search-parcel-permits` add citywide or named City-neighborhood scope, up to six exact published `PermitType` values, and independently bounded source dates. The private `list_search_capabilities` tool and `/api/v1/search-capabilities` route list the implemented filters and remaining search gaps. They are backend-only; the public data guide and parcel result UI do not present a question interface. The original `search_municipal_permits` remains available for its narrower contract.

For a review-date question, send `review_status`, optional `review_type`, and `review_completed_from` / `review_completed_to`. Those bounds apply only to a verified linked application's `Task.DateCompleted`; `PermitDate` is returned but is not implicitly filtered. `permit_date_from` / `permit_date_to` separately filter `PermitDate`. `application_status` filters `PermitApplicationStatus`, while `permit_status` filters `PermStatus`. Each returned row retains the published status and date fields, source URLs, exact municipal `PrintKey` to City `mblu` join, and source-public contacts when requested.

Example MCP arguments for a bounded page of the reviewed Hood - C type:

```json
{
  "scope": "city",
  "permit_types": ["Hood - C"],
  "review_status": "Approved",
  "review_completed_from": "2023-06-01",
  "review_completed_to": "2023-06-30",
  "scan_limit": 8
}
```

The response is a **candidate scan page**, not an arbitrary-sized result page. Continue with `next_cursor` and the same criteria until the cursor is absent. Only then can `complete_for_query` be true. Coverage reports scanned candidates, returned permits and distinct City parcels, failed detail checks, ambiguous or absent MBLU joins, source-row gaps, and each type search's status. The cursor is signed and rejects changed criteria or changed municipal results. The official municipal service did not yield a verified stable next page in testing; any type returning 2,000 rows or a larger reported total is marked `partial`, and `complete_for_query` remains false even after all returned rows are scanned. The separate index cannot make a capped type complete either; it reports that type as blocked.

For indexed citywide permit parent records, use `search_indexed_permits`, `search_indexed_parcels`, or `search_indexed_records`, then `get_indexed_record` for the published source row and `get_permit_details` for its live application, fee, review, inspection, document and public contact children. The index has one validated run per published permit type and does not treat a permit date as a linked application approval date. See [index coverage](search-index.md) before treating a no-match as conclusive.

The official type catalog has separate `Hood`, `Hood - C`, `Fire Suppression-Hood`, and `Fire Suppression-Hood - C` entries. A request must select which types to include. An `Approved` review task, an application status, and an issued permit remain distinct published fields. The new search does not claim a complete inspection history or infer an approval date from a permit or application status.

## Supporting parcel records

| Search field | Existing parcel evidence | Detail path |
| --- | --- | --- |
| `PermitType`, `PermStatus`, `PermitDate`, `PrintKey` | Municipal permit row on the verified parcel | `get_parcel_records` (`activity`) and `get_permit_details` |
| `PermitApplicationStatus` | Explicitly linked municipal application | `get_permit_details` or `get_application_details` |
| `TaskType`, `ApprovalStatus`, `DateCompleted` | Task linked by `Entity=Application` and the verified `Application_ID` | `get_permit_details` or `get_application_details` |
| Source-public `ContactRole` and contact fields | Permit or linked application contact child row | `get_permit_details` or `get_application_details` |
| City `parcel_id`, `objectid`, `mblu`, and neighborhood intersection | Official City parcel and neighborhood GIS layers | `get_parcel_records` (`property` and `geography`) |

The parcel's grouped activity feed is intentionally compact; review tasks and full public contact fields are on-demand detail records. No supporting field had to be invented or scraped for this first search slice. The parcel UI already links to full permit details, so no new UI field is required for these criteria.
