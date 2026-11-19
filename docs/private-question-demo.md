# Private cross-parcel question demo

The protected `/parcel?view=ask` tab, `POST /api/v1/ask-parcels`, and MCP
`ask_indexed_parcels` use the same indexed parcel search. The model only
interprets the question into a small allowlist of filters. The service checks
official type names, resolves New Haven calendar dates, expands a reviewed
City use-code dictionary, and runs parameterized indexed search. Results keep
the original City and municipal record links and source-run coverage. The
model does not supply records or definitions.

The tab is hidden until `QUERY_DEMO_ENABLED=true` is set for the private
Preview deployment. Keep it disabled until the gates below pass. The API and
MCP tools remain protected by the existing pilot credentials and report their
own source limitations when called directly.

## Release gates for the Electrical Permit example

1. Run the index migration, then refresh City parcels and the recent Electrical
   window. The importer probes the official municipal `PermitDate` search using
   a known returned permit, fetches all 30 New Haven calendar dates, requires
   every daily published total to equal the returned rows below the 10,000-row
   limit, and refetches the window before activating it. A failed probe or
   changed row leaves the previous active run in place and the new attempt
   failed. If date enumeration is unsupported, obtain a date-bounded extract
   directly from the City; do not treat a capped type search as complete.
2. Inspect `get_search_coverage` for `Electrical Permit`:
   `coverage_date_from` and `coverage_date_to` must contain the requested
   dates, the run must be fresh, and ambiguous and unlinked counts must be
   zero. The run describes only its date window, not historical coverage.
3. Run `npm run index:audit-use-codes` in the source-connected refresh
   environment. Review every distinct City `use_code` against an official City
   code definition, then fill `data/city-use-codes.json` with `code`,
   `published_label`, `business_space` (boolean), and `official_source_url`
   for every code and set `reviewed_on`. The audit and question endpoint both
   block commercial completeness when a new code appears. If the City layer
   has no coded-value domain or other official legend, request the dictionary
   from the City Assessor or GIS publisher. Do not infer the meaning from
   third-party property sites or sample assessor cards.
4. In Preview, run “Show commercial parcels with electrical permits pulled in
   the past 30 days.” Check the interpreted date range and use-code set, page
   through every result, then verify several returned permit IDs and parcel
   keys on their linked official records. Only then enable the tab.

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
  requirement. Values are checked and parameterized. A date-bounded municipal
  run cannot establish a complete answer outside its coverage dates.

The City Community Management Team context points to the [City's CMT page](https://www.newhavenct.gov/government/community-management-team).
The parcel and use-code source is the [City parcel GIS layer](https://gis.newhavenct.gov/server/rest/services/Hosted/New_Haven_Parcels_Authoritative_Parcel_Viewer/FeatureServer/0).
