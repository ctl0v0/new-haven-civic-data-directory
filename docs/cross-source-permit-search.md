# Cross-source municipal permit search

The private MCP tool `search_municipal_permits` and protected REST route `/api/v1/search-permits` answer bounded questions across the City of New Haven's public [municipal permit service](https://www.municityconnect.com/#/app/NewHavenCityCT/landing), [parcel GIS layer](https://gis.newhavenct.gov/server/rest/services/Hosted/New_Haven_Parcels_Authoritative_Parcel_Viewer/FeatureServer/0), and [neighborhood GIS layer](https://gis.newhavenct.gov/server/rest/services/Hosted/Neighborhoods_%28View%29/FeatureServer/0). They query live sources with the existing five-minute cache. There is no parcel or permit database.

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

## Citywide, multi-type questions

The current tool requires one exact permit type, one named neighborhood, and a permit-date bound. It cannot return a complete citywide list for a question such as “parcels with hood permits approved in the past year.” The official municipal type catalog has separate `Hood`, `Hood - C`, `Fire Suppression-Hood`, and `Fire Suppression-Hood - C` entries. A request must select which of these types to include. The published `PermStatus` on checked hood rows includes `Issued` and `Closed`; an `Approved` review task, an application status, and an issued permit are distinct fields. A review task's `DateCompleted` can bound an approval task when the task is explicitly linked to the application. `PermitDate` alone is not an approval date. Citywide completeness also requires paging past the service's 2,000-row type-search bound, checking parcel joins across the entire City, and processing more than 50 matching details when needed. A future small, refreshed index of official permit identifiers, type/status/date fields and exact City parcel joins could make these questions reliable while full source records and linked details remain live lookups. Such an index would need source retrieval timestamps, refresh checks, and explicit partial coverage rather than being treated as a new source of truth.
