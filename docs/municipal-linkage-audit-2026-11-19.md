# Municipal permit parcel-link audit — November 19, 2026

This is an internal diagnostic of official source rows, **not** a source dataset for the MCP. The read-only [index audit run](https://github.com/ctl0v0/new-haven-civic-data-directory/actions/runs/44615335667) checked active municipal permit-type runs against the City's [parcel GIS](https://gis.newhavenct.gov/server/rest/services/Hosted/New_Haven_Parcels_Authoritative_Parcel_Viewer/FeatureServer/0) and 42,761 [City address points](https://gis.newhavenct.gov/server/rest/services/Hosted/New_Haven_Addresses_Authoritative_view/FeatureServer/0). The active permit runs can refresh independently, so these counts describe the named run IDs at audit time, not a frozen citywide snapshot.

| Published permit type | Active run ID | Indexed parent rows | Unlinked to City parcel | Unlinked rows missing `PrintKey` | Missing-key rows with one exact City address-point parcel candidate | Existing vendor-key links that disagreed with the City address candidate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Heating Permit | 1245 | 4,305 | 4,305 | 4,305 | 0 | 0 |
| Gas Service Lateral | 1231 | 2,301 | 1,801 | 1,797 | 717 | 2 |
| Dumpster/Pod/Container | 1176 | 2,008 | 1,523 | 1,520 | 403 | 4 |
| Water Lateral | 1115 | 1,600 | 1,129 | 1,121 | 285 | 1 |
| Hood - C | 1248 | 75 | 4 | 0 | 0 | 0 |

The address candidate counts require the same normalized address in the published permit `LegalAddress` and City address-point layer, all matching address points linked exactly to one City parcel, and no second candidate parcel. They do **not** prove that the vendor permit belongs to that parcel. Existing exact `PrintKey` links disagree with the address candidate in seven checked records across the three utility/container types above. Therefore the importer does not use `LegalAddress` to create a City parcel link or include these candidate rows in cross-parcel permit results.

The official permit type search and exact-ID search both published vendor `Parcel_ID` and `PrintKey_Parcel` for checked unmatched Hood - C permits [571466](https://www.municityconnect.com/#/app/NewHavenCityCT/entity/Permit/571466) and [572909](https://www.municityconnect.com/#/app/NewHavenCityCT/entity/Permit/572909). The current City parcel at `68 WHITNEY AV` publishes MBLU `223 0334 01600` while permit 572909 publishes `223 0334 01602`. The 196 Crown St address in permit 571466 corresponds to multiple current City unit parcels and its vendor MBLU is different. These need an official historical parcel crosswalk. Vendor `Parcel_ID` is not a City PID.

The checked missing-key rows in these types did not publish a substitute vendor `Parcel_ID` or `PrintKey_Parcel`. Heating Permit published neither a parcel key nor `LegalAddress` in its indexed 4,305 rows. An address lookup cannot recover those rows. The technical requirements for a supported recurring City/vendor feed and historical parcel crosswalk are in the [draft request](official-municipal-feed-request.md), which has not been sent.

Until source relationships are supplied or individually verified, MCP searches retain these records as coverage gaps. A no-match is not a complete absence when the selected permit type has unlinked rows, a failed refresh, or a capped source response.

After the [full type refresh](https://github.com/ctl0v0/new-haven-civic-data-directory/actions/runs/44613924848), a second [read-only audit](https://github.com/ctl0v0/new-haven-civic-data-directory/actions/runs/44616826060) counted 265 indexed permit types, 70,606 published permit IDs, and 19,945 unlinked records across their active runs. `Building Permit` and `Electrical Permit` remained blocked by the checked 10,000-row bound; `Plumbing Permit` and `Rehab-Residential` returned malformed JSON. A failed type run did not replace its last validated active run. These totals do not establish complete citywide permit coverage.
