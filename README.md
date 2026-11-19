# New Haven Civic Data Directory

A community guide to finding and using New Haven civic data. People and their agents can read the same source records; a static website makes those records easier to browse.

## Start here

| Source | What it helps you find |
| --- | --- |
| [Alders](sources/alders.json) | Elected representatives and published ward contacts |
| [Assessor](sources/assessor.json) | Property assessment lookup |
| [Parcels](sources/gis-parcels.json) | Parcel geometry and identifiers |
| [Finance](sources/finance.json) | Official reports located; file-level access and coverage checks in progress |
| [Ward boundaries](sources/ward-boundaries.json) | Discovery routes; usable boundary data still needs verification |
| [Meetings and legislation](sources/meetings-legislation.json) | Meeting calendars, agendas and legislative records |

[Request data](https://github.com/ctl0v0/new-haven-civic-data-directory/issues/new?template=data-request.yml) · [Report a correction](https://github.com/ctl0v0/new-haven-civic-data-directory/issues/new?template=source-correction.yml) · [Roadmap](ROADMAP.md) · [Peer-city research](research/peer-cities.md)

**[Browse the live directory](https://new-haven-civic-data-directory.vercel.app/).** Deployment and local preview instructions are in [site/README.md](site/README.md).

## Parcel data pilot

The repository now includes a private, parcel-first backend and a review page at `/parcel`. It resolves an address or official identifier, calls public sources on demand, and groups parcel records by property, geography, representation, activity, environment, and business. A separate map context endpoint supplies official mapped features on the parcel and nearby street context without adding them to parcel records. The REST API and MCP server use the same resolver and source adapters. Live results are cached for five minutes. An optional private [search index](docs/search-index.md) stores selected official source facts and exact parcel joins for cross-parcel queries; parcel detail remains live. See [pilot setup and API reference](docs/parcel-pilot.md).

The pilot requires server-side access secrets before `/parcel`, `/api/v1/*`, or `/mcp` can return data. The existing directory stays public. Source failures and unverified lookups appear as coverage gaps; the dated feed is a timeline of source records, not a log of changes to source data.

## Understand the status

- **Source located:** a source was identified, but its access instructions have not been fully tested.
- **Access tested:** a page, metadata, download or query was inspected successfully. The evidence and limitations state exactly what was checked; this does not imply the complete dataset was downloaded.
- **Needs investigation:** a significant discovery or access question remains.
- **In progress:** documentation is being prepared; any links are preliminary starting points, not a ready-to-use dataset.

The initial research/check date is October 6, 2026. An entry's checked_on date is when access was checked, not the date the publisher updated the data. Indexed search results are marked as such; they are weaker evidence than inspecting current content directly.

A source being public does not establish its reuse license, currentness, completeness or bulk-access cost. Unknowns stay explicit. A browser lookup, map viewer, dataset download and API are different access methods.

## Build

Requires Node.js 24 or later.

```sh
npm ci
npm run build
npm test
```

This validates sources/*.json and generates dist/index.html, an individual HTML page per source under dist/sources/, dist/catalog.json and dist/parcel-source-catalog.json, then copies the website assets. Open dist/index.html directly in a browser to review the static directory. The parcel page and API need a Vercel function runtime and pilot secrets.

## Contribute and maintain

Edit one canonical JSON source record and submit a pull request. CI validates records and builds the website; pages are generated rather than edited separately. See [CONTRIBUTING.md](CONTRIBUTING.md) and [the source template](templates/source.json).

At weekly meetings, contributors can take one investigation or review one entry. Record the evidence, what was tested and unresolved questions. Entry maintainers are initially unassigned; they are distinct from the organizations publishing the original data.

## Scope

V1 provides documentation, a simple directory website, requests and an investigation roadmap. The separate parcel pilot adds on-demand data access and an MCP server for review; it does not change the public directory's source claims.


The directory is independent of city government. City outreach is drafted for review before sending. No city or vendor data is redistributed here.
