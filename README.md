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

## Understand the status

- **Source located:** a source was identified, but its access instructions have not been fully tested.
- **Access tested:** a page, metadata, download or query was inspected successfully. The evidence and limitations state exactly what was checked; this does not imply the complete dataset was downloaded.
- **Needs investigation:** a significant discovery or access question remains.
- **In progress:** documentation is being prepared; any links are preliminary starting points, not a ready-to-use dataset.

The initial research/check date is October 6, 2026. An entry's checked_on date is when access was checked, not the date the publisher updated the data. Indexed search results are marked as such; they are weaker evidence than inspecting current content directly.

A source being public does not establish its reuse license, currentness, completeness or bulk-access cost. Unknowns stay explicit. A browser lookup, map viewer, dataset download and API are different access methods.

## Build

Requires Node.js 22 or later. No dependency installation is needed.

```sh
npm run build
```

This validates sources/*.json and generates dist/index.html, an individual HTML page per source under dist/sources/, and dist/catalog.json, then copies the website styles and search script. Open dist/index.html directly in a browser. Each source has its own static HTML detail page linked from the directory table, so the site also works without JavaScript. Search and category filtering enhance browsing when JavaScript is available.

## Contribute and maintain

Edit one canonical JSON source record and submit a pull request. CI validates records and builds the website; pages are generated rather than edited separately. See [CONTRIBUTING.md](CONTRIBUTING.md) and [the source template](templates/source.json).

At weekly meetings, contributors can take one investigation or review one entry. Record the evidence, what was tested and unresolved questions. Entry maintainers are initially unassigned; they are distinct from the organizations publishing the original data.

## Scope

V1 provides documentation, a simple directory website, requests and an investigation roadmap. Data acquisition infrastructure, dataset explorers, accounts, databases and MCP servers are future work driven by actual requests.


The directory is independent of city government. City outreach is drafted for review before sending. No city or vendor data is redistributed here.
