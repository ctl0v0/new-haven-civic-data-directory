# Private cross-parcel search index

The parcel detail API and MCP still read the official City and State records live. The optional PostgreSQL/PostGIS index stores source IDs, selected published search fields, official links, geometry needed for joins, and refresh coverage. GIS and State runs are activated after their official counts, row IDs, fetched batches and parcel joins are checked. A municipal permit type is activated only when two type searches return the same published IDs and fields below the checked request bound; the vendor does not provide an independently verified full type count. Failed attempts are shown even if a source has never completed an import. Historical, closed and voided published rows remain searchable when the source returns them. Search responses always expose `complete_for_query`, source checks and a signed cursor.

The index is available to the private Preview API only when its read-only `SEARCH_DATABASE_URL` is configured. The live `search_parcels`, `search_parcel_permits`, parcel detail, and nearby count tools work without it. An unconfigured or failed index never produces a verified zero result.

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
| Municity permit catalog and permits | The full official type catalog is indexed; each type has its own complete row check and exact PrintKey to City MBLU join. One stable group of types refreshes each hour after the initial full sweep. Repeated Permit_ID rows are reconciled only when their nonblank published search fields agree; the run reports the raw and repeated row counts. | The official service returned more than 2,000 rows in direct checks. The index now requests up to 10,000 rows per type. Types filling that checked request bound remain blocked, not counted as complete. Conflicting duplicate IDs or malformed upstream responses fail a type refresh. Unlinked permit rows remain visible as coverage gaps. Application approval, review tasks and contacts still require live detail searches. |
| Vision assessor cards, LCI property cases, State business registry | Live parcel-only checks | No verified complete citywide enumeration. Their absence from cross-parcel results does not imply no matching record. |
| City LCI managed lots | Full official 500-ID inventory and point geometry batches; exact published `mbp` to current City `mblu` | The [validated import and read-only search check](https://github.com/ctl0v0/new-haven-civic-data-directory/actions/runs/44617130457) returned 494 exact parcel links, six unmatched rows, and no ambiguous links. Unmatched rows keep the source incomplete for citywide no-match claims. Raw status codes and a July 3, 2025 layer edit date do not establish current vacancy or availability. |
| Tax bills, land records, planning, general State licenses and inspections | Catalog gaps | No verified complete parcel join. |

Local and State historic district layers are excluded from cross-parcel search following the review decision to remove them. Every source in the parcel catalog appears in `get_search_coverage`, including parcel-only sources and gaps.

## Setup

Use a private PostgreSQL 17 database with PostGIS, such as Neon. The `neon-aero-clock` resource is connected to the Vercel project's Preview environment, but the index does not activate from that connection alone. Select a persistent Neon branch for the index, normally the project's default `main` branch. In the Neon Console, open that branch's **Connect** panel, select its database and owner role, turn off pooled connections, and copy its direct PostgreSQL connection URL. Use this URL as `SEARCH_DATABASE_WRITE_URL` in the isolated refresh runner. The Neon Vercel integration can create [a separate branch for each Preview deployment](https://neon.com/blog/neon-vercel-native-integration), so a Vercel Preview `DATABASE_URL_UNPOOLED` value may not target the persistent branch. Use separate reader and writer credentials on the same persistent branch. Put only the **reader** URL in the private pilot preview as `SEARCH_DATABASE_URL`. Neither credential belongs in a browser bundle or the public directory. Keep all existing `PILOT_*` settings on the same protected Preview branch.

For Neon, a role created with the default Console **Add role** action receives `neon_superuser` privileges ([Neon role documentation](https://neon.com/docs/manage/roles)). The refresh runner creates `search_index_reader` through SQL with only grants on the four search tables. Set a random password of at least 32 characters as the GitHub Actions secret `SEARCH_DATABASE_READER_PASSWORD`; do not use the Console Add role action for this reader. The runner verifies that this role cannot insert, update or delete search rows or create objects in `public`. Only the refresh workflow uses the writer URL. The app code does not use any owner URL injected by the initial Vercel integration connection; after verifying the separate reader connection, disconnect the resource from the app so that an owner URL is not present in its environment.

The scheduled GitHub Actions workflow lives on the repository's default branch because GitHub schedules run there. It checks out `codex/parcel-pilot`, so the refresh code and indexed search API remain in the private Preview branch. The workflow is disabled until the repository variable `PARCEL_INDEX_ENABLED` is exactly `true`. After the writer URL is added as the repository secret `SEARCH_DATABASE_WRITE_URL` and the reader password as `SEARCH_DATABASE_READER_PASSWORD`, enable the variable. The daily run refreshes City GIS, State rosters, NHPS, and the municipal type catalog. A full municipal run checks every type in the official catalog; the hourly run refreshes one stable 24-hour shard of types. Each source failure is recorded and never replaces its last validated active run. A type that reaches the current 10,000-row validated request bound remains explicitly blocked from a complete citywide result.

A change to the workflow file on `main` runs a connection-only check. It tests the GitHub writer secret, public-schema creation permission, and PostGIS availability without printing connection details. This check runs even before `PARCEL_INDEX_ENABLED` is set. Once that variable is `true`, a workflow-file change also starts a full municipal type sweep.

Build the reader URL privately from the same Neon host and database as the writer URL, with the username `search_index_reader` and the chosen reader password. Save it in Vercel as a Secret named `SEARCH_DATABASE_URL`, scoped to Preview branch `codex/parcel-pilot`, then redeploy that branch. Do not copy the integration's owner URL into this setting. The reader URL and password should never be pasted into a chat, issue, or build log. A connected database with no completed import still yields incomplete search coverage.

With Node 24 and the writer URL in the runner environment:

```sh
npm ci
npm run index:migrate
npm run index:grant-reader
npm run index:refresh:all -- daily
npm run index:refresh:all -- municipal
npm run index:prune
```

The municipal sweep discovers type names directly from the official catalog. The hourly runner selects one stable type group with `npm run index:refresh:all -- hourly`; types are refreshed within 24 hours when scheduled runs succeed. The daily runner refreshes City GIS sources in dependency order, then State rosters, NHPS, and the municipal catalog. Each source records a failed attempt without replacing its last validated active run. A failed latest attempt, stale run, ambiguous join or unlinked row makes a completeness claim false. The pruning command deletes nonactive runs older than 30 days; active runs and published historical source rows stay available. GitHub Actions schedules the hourly and daily jobs because Vercel Preview Cron does not run on the preview branch.

## Private tools

- `get_parcel_manifest` reports the checked status, returned count and count certainty for every source on one parcel.
- `get_search_coverage` reports active index runs, freshness, failed refresh attempts, join gaps and parcel-only sources.
- `audit_municipal_permit_links` examines one indexed permit type and separates records with no published `PrintKey` from records whose nonblank key does not match a City MBLU. It returns bounded official source-row examples and a count of unlinked rows that publish `LegalAddress`, without assigning those addresses to parcels. Protected REST: `GET /api/v1/permit-linkage-audit?permit_type=...`. The index now also preserves the published vendor `Parcel_ID` and `PrintKey_Parcel` when a type refresh returns them. `Parcel_ID` is a vendor identifier, not a City parcel PID; neither field is substituted for the City MBLU join.
- `npm run index:audit-links` also compares published permit `LegalAddress` values with the indexed City address points. It reports unique address-point candidates, missing or ambiguous City points, and whether those candidates agree with permits already linked by `PrintKey`. This is a read-only diagnostic; candidate addresses are never written as parcel links or returned as cross-parcel permit matches. The private audit workflow runs it with the restricted database reader.
- `search_parcels` scans official City parcel GIS fields live, with City neighborhood and ward scopes and cursor pagination.
- `search_indexed_parcels` intersects one to five published source-field requirements by exact City parcel joins, including one exact municipal permit type combined with other official source predicates. City parcel fields include the imported assessor owner, use, unit, sale and valuation fields; reviewed numeric City fields support inclusive `number_gte` and `number_lte` bounds. `POST /api/v1/search-indexed-parcels` accepts the same JSON input.
- `search_indexed_permits` searches every indexed permit type when no type is supplied, or up to six exact types, by published `PermStatus` and `PermitDate`, optionally within an indexed ward or neighborhood. It reports every missing, capped, stale, or unlinked type; application and review approval predicates remain in `search_parcel_permits` and the live work-detail tools.
- `get_indexed_record` retrieves one source row by published record ID with the indexed fields, direct official source URL, exact or ambiguous City parcel links, and refresh coverage. It does not substitute for `get_permit_details` when full live permit children are needed.
- `search_indexed_records` pages every exact record–parcel match from one indexed source and returns its published indexed fields, official URL, dates, and City parcel identifiers. Address-linked State, school and trash rows also return the matched City address-point IDs, published house number, street and unit fields, and direct City source URLs. It accepts the same indexed exact, reviewed numeric, and event-date filters as `search_indexed_parcels`; optional `city_parcel_id` and `city_objectid` limit results to one parcel. The source field allowlist is returned by `list_search_capabilities` as `indexed_source_fields`. This tool is also available at protected `POST /api/v1/search-indexed-records`. Municipal records require an exact `PermitType`. Missing, capped, ambiguous, and unlinked records remain coverage gaps.
- `get_nearby_feature_counts` returns mapped meter and stop counts within a chosen radius, plus nearest straight-line distance and official layer links. It never reports live parking availability.

Examples for a connected index:

```json
{"requirements":[{"source_id":"neighborhoods","equals":{"neighborhood":"Westville"}},{"source_id":"zoning","equals":{"zone_code":"BD"}}],"limit":25}
```

```json
{"permit_types":["Hood - C"],"scope":"neighborhood","neighborhood":"Westville","permit_date_from":"2026-01-01","limit":25}
```

Omit `permit_types` to search every currently indexed type in the official catalog. For a permit and City parcel field intersection:

```json
{"requirements":[{"source_id":"municity","equals":{"PermitType":"Hood - C","PermStatus":"Issued"}},{"source_id":"parcels","number_gte":{"units_commercial":1}}],"limit":25}
```

Continue `next_cursor` until absent. A last page with `complete_for_query: false` is still incomplete and cannot establish that no match exists. PermitDate is a published permit date; do not relabel it an application approval date. The live permit search remains the path for linked application status, review tasks and contractor contact roles.

To check for exact State liquor roster matches on a selected City parcel, including historical rows if the official roster still returns them:

```json
{"source_id":"ct-liquor-permits","city_parcel_id":"12846","city_objectid":"4157","limit":25}
```

Only exact parcel links appear in the result list. `get_indexed_record` can show ambiguous links for a particular published row. The indexed fields are selected search facts; the live parcel tools remain the source for full parcel detail.

## Verification

The test suite covers official GIS ID/count checks, State row IDs (including repeated license numbers), the municipal 10,000-row request gate, exact-join SQL generation, incomplete source behavior, and REST/MCP parity for live parcel search. The schema and a representative indexed cross-source query have also been run against local PostGIS. An index-dependent search needs a connected private database and completed real refresh before it can be verified against New Haven records.
