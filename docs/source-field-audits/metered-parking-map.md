# City metered parking spaces: map source audit

Checked November 18, 2026 against the City of New Haven ArcGIS FeatureServer services:

- [Metered_Parking_Spaces](https://gis.newhavenct.gov/server/rest/services/Hosted/Metered_Parking_Spaces/FeatureServer/0) is the base service selected for the map.
- [Metered_Parking_Spaces_view](https://gis.newhavenct.gov/server/rest/services/Hosted/Metered_Parking_Spaces_view/FeatureServer/0) reports `isView: true` and currently exposes the same layer name, fields, count, and sampled records.

Both layer counts were 2,886 point features. Both reported a layer edit timestamp of July 4, 2025, 02:13:54 UTC. A 400-metre query *envelope* around the mapped center of 20 Eld St contained 191 features; the app applies the 400-metre circle filter to those returned points. The edit timestamp describes the layer, not a verified inspection date for any particular meter.

The source includes `objectid`, `meternum`, `facilityid`, `post_num`, `spacenum`, `zone_`, and `meterspec`. The map returns those published values without interpreting `meterspec` as a current price or `zone_` as a current restriction. It links each marker to its City feature and exposes the layer through `get_parcel_map_context` and `/api/v1/map-context`. Map markers are nearby context, not parcel-linked records. A 500-feature response limit is marked `partial` if reached.

The layer does not report whether a space is currently available. Check posted signs for rules and rates. Loading zones and current parking availability remain unverified map sources.
