# Peer-city research

Research date: October 6, 2026. This is a focused comparison of four cities, not a comprehensive inventory. Examples from another city demonstrate useful patterns; they do not establish that equivalent New Haven data exists.

| City | Official evidence | Available pattern | Lesson for this directory |
| --- | --- | --- | --- |
| Hartford | [City-published building-permit metadata in the federal catalog](https://catalog.data.gov/dataset/building-permits-20200101-to-current) and [city open data portal](https://open-data-hartford-hartfordgis.hub.arcgis.com/) | Metadata lists CSV, GeoJSON, KML, shapefile and REST distributions, a contact and CC0 terms | Include downloads, API links, contacts and licenses; verify each access path separately |
| Cambridge | [GIS data guide](https://www.cambridgema.gov/gis/gisdata) and [Open Data Program](https://www.cambridgema.gov/departments/opendata) | Field documentation, shapefile/geodatabase downloads, GitHub GeoJSON in WGS84; program covers permits, traffic and environmental monitoring | Make file formats and coordinate systems explicit; connect available data with useful applications |
| Somerville | [SomerStat](https://www.somervillema.gov/departments/mayors-office/somerstat) | City describes service requests, permits/licenses, mobility, public safety, public health and community surveys | Service requests and permits are useful next investigations; community demand can guide categories |
| Boston | [Council roll-call votes](https://content.boston.gov/departments/city-council/city-council-roll-call-votes) and [historical permit guidance](https://content.boston.gov/departments/inspectional-services/how-find-historical-permit-records) | Official pages point to CSV voting data and permit search/open-data routes | Legislation is a useful civic category alongside finance and property |

Hartford is a nearby Connecticut reference. Cambridge and Somerville supply regional examples relevant to a smaller city. Boston offers a larger established comparison.

## Evidence limits

Cambridge's guide and program pages were inspected directly. Somerville's city page was opened and official indexed descriptions inspected. Hartford's city portal provided little readable content in this tool; city-published catalog metadata supplied the format/contact/license details. Boston's official guidance was discovered through indexed search; direct Analyze Boston dataset pages returned 403. No peer-city bulk download was tested.

Hartford metadata describes a nightly acquisition process but carries an older modified date. Record advertised frequency and observed freshness separately; neither alone establishes the current state of an endpoint.

## Recommended V1 additions

1. **Ward boundaries:** pairs naturally with the Alder roster and parcel geography, enabling location-to-representative tools. The exact current downloadable layer still needs investigation.
2. **Meetings and legislation:** New Haven's Legistar calendar is accessible. Documenting it enables agenda discovery and legislative tracking with little new infrastructure.

Investigate permits, service requests and zoning next. Do not import peer-city datasets into New Haven entries.

## Plain-language glossary

- **CSV:** a plain-text table, useful for spreadsheets and many data tools.
- **API:** a defined way for software to request data. An API may have limits or access requirements.
- **GeoJSON:** JSON that includes geographic shapes or locations.
- **Shapefile:** a geographic format usually delivered as a ZIP containing several related files.
- **Coordinate system:** how a location is represented. State Plane coordinates are not latitude and longitude.
- **Bulk export:** a complete or substantial dataset download, rather than individual browser lookups.
- **Provenance:** where data came from and the version or date used.
- **CC0:** a public-domain dedication used by some publishers; check the actual dataset terms.

## Existing finance project

The separate Civic Data Commons project offers useful practices: separate publisher and community copies, preserve source history, state review scope, and track coverage gaps. Reuse those ideas lightly. Avoid copying its financial extraction workflow, frontend or complex release process into V1.

[Finance README](https://github.com/ctl0v0/civic-data-commons/blob/main/finance/README.md) · [Source notes](https://github.com/ctl0v0/civic-data-commons/blob/main/finance/docs/source-notes.md)

The finance repository is private during initial setup, so these links may require access.
