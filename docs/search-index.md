# Private cross-parcel search index

The parcel detail API and MCP still read the official City and State records live. The optional PostgreSQL/PostGIS index stores source IDs, selected published search fields, official links, geometry needed for joins, and refresh coverage. A source run becomes active only after its official count and IDs are checked, every fetched batch is complete, and its parcel joins have been recorded. Historical, closed and voided published rows remain searchable when the source returns them. Search responses always expose `complete_for_query`, source checks and a signed cursor.

This index is **not connected on the current preview until `SEARCH_DATABASE_URL` is configured and an initial refresh completes**. The live `search_parcels`, `search_parcel_permits`, parcel detail, and nearby count tools work without it. An unconfigured or failed index never produces a verified zero result.

## Source coverage

| Source | Index path | Gate or limitation |
| --- | --- | --- |
| City parcel GIS | Complete official ID/count inventory, 200-feature batches | One published sale field set is searchable, not a title history or vacancy claim. |
| City address points | Full GIS inventory, geometry join to exactly one City parcel | Points crossing parcel boundaries remain ambiguous. |
| City zoning, ward, neighborhood and CMT polygons | Full GIS inventory, explicit polygon intersection | An intersection is a spatial relationship, not an assertion of a single district when a parcel crosses a boundary. |
| City trash day polygons | Full GIS inventory, join through City address points | Multiple pickup zones at an address stay ambiguous. |
| CT DEEP brownfields | New Haven GIS rows, exact published `Site_Parce` to City PID or MBLU | Unlinked and ambiguous rows are counted, not assigned by proximity. |
| City mapped meters and City hosted CT Transit stops | Full official feature ID/count inventory | Mapped inventory and straight-line distance only; no available meter or transit frequency claim. The bus-stop ArcGIS item is owned by a New Haven city account. |
| CT liquor, child care and cannabis location rosters | Official Socrata row ID, count, schema and page checks; unique City address-point join | Credentials can repeat and are never used as row IDs. Rows without one exact parcel remain unlinked. |
| NHPS attendance table | Validated official snapshot under 30 days; published ranges joined to City address points | School Choice preference, not guaranteed enrollment. Ambiguous or unmapped addresses remain unresolved. |
| Municity permits | One exact official permit type per run, exact PrintKey to City MBLU | A type hitting the unpageable 2,000-row service bound is refused. Application approval, review tasks and contacts still require live detail searches. |
| Vision assessor cards, LCI property cases, State business registry | Live parcel-only checks | No verified complete citywide enumeration. Their absence from cross-parcel results does not imply no matching record. |
| Managed lots | Held behind an explicit MBP join review | Do not publish a broad match until its official key semantics are checked. |
| Tax bills, land records, planning, general State licenses and inspections | Catalog gaps | No verified complete parcel join. |

Local and State historic district layers are excluded from cross-parcel search following the review decision to remove them. Every source in the parcel catalog appears in `get_search_coverage`, including parcel-only sources and gaps.

## Setup

Use a private PostgreSQL 17 database with PostGIS, such as Neon. Create separate reader and writer credentials. Put only the **reader** URL in the private pilot preview as `SEARCH_DATABASE_URL`; put the writer URL in the isolated refresh runner as `SEARCH_DATABASE_WRITE_URL`. Neither belongs in a browser bundle or the public directory. The reader role needs `SELECT` on the four `search_*` tables; the writer role needs schema migration and refresh permissions. Keep all existing `PILOT_*` settings on the same protected Preview branch.

With Node 24 and the writer URL in the runner environment:

```sh
npm ci
npm run index:migrate
npm run index:refresh:all -- daily
npm run index:refresh -- municity 'Hood - C'
npm run index:prune
```

`INDEX_PERMIT_TYPES` is a JSON array of exact names from `list_municipal_permit_types`. The hourly runner uses it with `npm run index:refresh:all -- hourly`. The daily runner refreshes City GIS sources in dependency order, then State rosters and NHPS. Each source records a failed attempt without replacing its last validated active run. A failed latest attempt, stale run, ambiguous join or unlinked row makes a completeness claim false. The pruning command deletes nonactive runs older than 30 days; active runs and published historical source rows stay available. Run refreshes from a private external scheduler with enough time for full City GIS enumeration. Vercel Preview Cron does not run on the preview branch, so a separate scheduler and database must be connected before claiming automated freshness.

## Private tools

- `get_parcel_manifest` reports the checked status, returned count and count certainty for every source on one parcel.
- `get_search_coverage` reports active index runs, freshness, failed refresh attempts, join gaps and parcel-only sources.
- `search_parcels` scans official City parcel GIS fields live, with City neighborhood and ward scopes and cursor pagination.
- `search_indexed_parcels` intersects one to five published source-field requirements by exact City parcel joins. `POST /api/v1/search-indexed-parcels` accepts the same JSON input.
- `search_indexed_permits` searches validated municipal type runs by published `PermStatus` and `PermitDate`, optionally within an indexed ward or neighborhood. Application and review approval predicates remain in `search_parcel_permits` and the live work-detail tools.
- `get_nearby_feature_counts` returns mapped meter and stop counts within a chosen radius, plus nearest straight-line distance and official layer links. It never reports live parking availability.

Examples for a connected index:

```json
{"requirements":[{"source_id":"neighborhoods","equals":{"neighborhood":"Westville"}},{"source_id":"zoning","equals":{"zone_code":"BD"}}],"limit":25}
```

```json
{"permit_types":["Hood - C"],"scope":"neighborhood","neighborhood":"Westville","permit_date_from":"2026-01-01","limit":25}
```

Continue `next_cursor` until absent. A last page with `complete_for_query: false` is still incomplete and cannot establish that no match exists. PermitDate is a published permit date; do not relabel it an application approval date. The live permit search remains the path for linked application status, review tasks and contractor contact roles.

## Verification

The test suite covers official GIS ID/count checks, State row IDs (including repeated license numbers), the municipal 2,000-row release gate, exact-join SQL generation, incomplete source behavior, and REST/MCP parity for live parcel search. The schema and a representative indexed cross-source query have also been run against local PostGIS. An index-dependent search needs a connected private database and completed real refresh before it can be verified against New Haven records.
