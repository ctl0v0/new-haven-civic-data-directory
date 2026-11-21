# Private cross-parcel question demo

The protected `/parcel?view=ask` tab prepares a plan through
`POST /api/v1/ask-parcel-data`. The user reviews the area, sources, date
fields, and return fields before running the search. MCP callers can pass
`plan_only: true` to `ask_parcel_data` and then send the reviewed plan to
`query_parcel_data`. Results retain official record links and source coverage.

The service uses published permit types, group names, record numbers, and
City parcel-use codes. It resolves time windows in the New Haven timezone.
“Last month” means the previous calendar month. “This past month” means
the last 30 calendar dates, including today. “This week” begins on Monday.
Permit issuance and approval questions require published event evidence.
The planner asks for clarification when that date cannot be established.
Hood-related permit questions select the City’s published permit types with
the word “Hood” in the title. The search plan lists the exact titles under
`one_of.PermitType`, and historical source coverage is shown for each type.

The **Test a question** tab is visible on the protected `codex/parcel-pilot`
Preview branch for source review. It shows partial matches and gaps explicitly;
it does not claim the complete commercial example works. The tab stays hidden
in production and other previews. Local development can set
`QUERY_DEMO_ENABLED=true`. The API and MCP tools remain protected by the
existing pilot credentials.

The tester includes examples for electrical permits, commercial use codes,
City business-license issuance, and permit contractors. Field filters can
run a typed query without a second model call.
From the browse parcel map, **View full records without map** moves the loaded
parcel into the wide Search records view and preserves the selected section;
the `view=records` URL restores that map-free layout.
The tester reads the fresh, validated municipal permit-type catalog from the
private index when available and falls back to the live official catalog when
it is absent or stale.

## Find a storefront

Open **Test a question** and choose **Browse vacancy listings** or the East Rock hood example. The shortlist uses the approved address export configured in Preview or imported from **Browse parcel map** in the same tab. Select a result or enter a New Haven street address. Follow-up questions keep that address until you choose **Change storefront**.

For MCP, pass the selected `storefront` with its address and both City parcel IDs to `ask_parcel_data`. If you only have the address, the server can resolve it and return City parcel choices when needed. Execute the returned `renter_plan.tool` with its `arguments` after reviewing the plan.

| Tool | Returns |
|---|---|
| `search_commercial_vacancies` | Five linked listing addresses per page, along with City neighborhood and optional indexed hood permit evidence. |
| `get_commercial_storefront_evidence` | Published hood permits and inspections, prior business records, assessor areas, zoning, or application instructions for one storefront. Lease terms are unknown until supplied. |
| `count_nearby_places` | One live Google Maps count from a verified City address point. The default radius is 402 meters. |
| `list_nearby_places` | One page of Google Maps names and links after an explicit request for a search with 1–100 matches. |

Check the address label on permit and business rows. Records linked only to the parcel can describe a different storefront. Current availability and hood condition require confirmation. Google results are returned on demand with attribution and stay in the current view.

## Release gates for the Electrical Permit example

1. Run the index migration, then refresh City parcels and the recent Electrical
   group window. The importer probes the official municipal `PermitDate` search using
   a known returned permit, fetches all 30 New Haven calendar dates, requires
   every daily published total to equal the returned rows below the 10,000-row
   limit, and refetches the window before activating it. A failed probe or
   changed row leaves the previous active run in place and the new attempt
   failed. If date enumeration is unsupported, obtain a date-bounded extract
   directly from the City; do not treat a capped type search as complete.
2. Inspect `get_search_coverage` for the published `Electrical` group:
   `coverage_date_from` and `coverage_date_to` must contain the requested
   dates, the run must be fresh, and ambiguous and unlinked counts must be
   zero. The run describes only its date window, not historical coverage. The
   exact `Electrical Permit` type is one catalog entry and had no rows during
   the November 19, 2026 source check for October 21 through November 19.
   The broad question must use the municipal catalog's full Electrical group.
3. Run `npm run index:audit-use-codes` in the source-connected refresh
   environment. Review every distinct City `use_code` against an official City
   code definition, then fill `data/city-use-codes.json` with `code`,
   `published_label`, `business_space` (boolean), and `official_source_url`
   for every code and set `reviewed_on`. A verified label can appear on the
   parcel map with `business_space: null` while its eligibility for commercial
   search remains unresolved. The audit and question endpoint both
   block commercial completeness when a new code appears. If the City layer
   has no coded-value domain or other official legend, request the dictionary
   from the City Assessor or GIS publisher. Do not infer the meaning from
   third-party property sites or sample assessor cards.
4. In Preview, run “Show commercial parcels with electrical permits pulled in
   the past 30 days.” Check the interpreted date range and use-code set, page
   through every result, then verify several returned permit IDs and parcel
   keys on their linked official records. The exact baseline wording is parsed
   without AI Gateway; other natural-language phrasing uses the constrained
   interpreter. Confirm AI Gateway through the deployment's OIDC token before
   relying on broader phrasing. Only call the commercial result complete once
   the source gates above pass.

“Pulled” is the published `PermitDate`. The permit's published status remains
separate. “Commercial” means City parcels whose published `use_code` is in the
reviewed set describing business space; it does not prove current use, vacancy,
or availability. A complete result means complete for the checked source run
and exact parcel joins as of its refresh, not for unpublished future changes.

## Interfaces

- `POST /api/v1/ask-parcels` and MCP `ask_indexed_parcels` accept a `question`
  of at most 500 characters. They return the interpreted fields, exact search
  criteria, a first page of source-linked parcels, context entries, and source
  coverage. The client uses `search_indexed_parcels` with the returned
  criteria and `next_cursor` for further pages.
- `GET /api/v1/data-context` and MCP `get_data_context` accept optional
  `term`, `source_id`, and `field` filters. Each entry separates an official
  source fact from the service's reading rule and includes the official URL.
- `search_indexed_parcels` accepts `one_of.use_code` only on the City parcel
  requirement and `permit_group` for a municipal requirement with a verified
  group run. Values are checked and parameterized. A date-bounded municipal
  run cannot establish a complete answer outside its coverage dates.

The City Community Management Team context points to the [City's CMT page](https://www.newhavenct.gov/government/community-management-team).
The parcel and use-code source is the [City parcel GIS layer](https://gis.newhavenct.gov/server/rest/services/Hosted/New_Haven_Parcels_Authoritative_Parcel_Viewer/FeatureServer/0).

## November 19, 2026 source check

The official catalog listed 38 types in its Electrical group. The verified
October 21–November 19 date window returned 81 Electrical-group permits; 77
had an exact City parcel link and four did not. The read-only smoke check
returned permit IDs, published `PermitType`, `PermitDate`, City parcel IDs and
source links. It did not call the set of 77 a complete answer.

The four unmatched [municipal permit records](https://www.municityconnect.com/#/app/NewHavenCityCT/landing)
publish parcel keys absent from the City GIS parcel layer. Municipal Parcel
notes for permits 590915 (1450 Chapel St) and 590963 (789 Howard Ave) describe
their parcels as portions of another mapped MBLU; that prose has not been
converted into an automatic join. The other two permit records, 590646 and
590925, have no explicit parent MBLU in the municipal Parcel fields checked.
An address or key prefix alone remains diagnostic evidence, not a join.

The City parcel layer publishes 246 distinct `use_code` values without a
coded-value domain or official label in its layer metadata. On November 20,
we compared those published codes with the exact New Haven PIDs and codes in
the [State-published 2025 assessor export](https://data.ct.gov/Local-Government/2025-Connecticut-Parcel-and-CAMA-Data/rny9-6ak2/about_data).
The map uses only entries with a confirmed code and a single published label
across the matched records. The export reports generic mixed-use labels for
codes `107C`, `3030`, `303I`, and `303R`. The map colors those codes orange under
Mixed-use and shows the assessor’s label and source in the parcel sidebar.
Queries for a confirmed residential and business mix require a reviewed
definition identifying both uses. The generic assessor labels carry no
reviewed business-space assignment.
