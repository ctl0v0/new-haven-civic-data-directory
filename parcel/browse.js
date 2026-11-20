import { LAYERS } from "./config.js";
import { arcgis, SourceError } from "./http.js";
import { parcelFeatureToGeoJSON } from "./geometry.js";

const MAX_PARCELS = 500;

function viewport(value) {
  const values = String(value ?? "").split(",").map(Number);
  if (values.length !== 4 || values.some((number) => !Number.isFinite(number)))
    throw new SourceError("A four-coordinate map viewport is required", 400);
  const [west, south, east, north] = values;
  if (west < -180 || east > 180 || south < -90 || north > 90 ||
      east <= west || north <= south || east - west > 0.06 || north - south > 0.04)
    throw new SourceError("Map viewport is too large or invalid; zoom in", 400);
  return { xmin: west, ymin: south, xmax: east, ymax: north,
    spatialReference: { wkid: 4326 } };
}

export async function browseParcels(bounds) {
  const data = await arcgis(LAYERS.parcels, {
    geometry: JSON.stringify(viewport(bounds)),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects",
    returnGeometry: "true",
    outFields: "objectid,parcel_id,property_address,mblu,use_code",
    resultRecordCount: String(MAX_PARCELS + 1),
  });
  const wkid = data.spatialReference?.latestWkid ?? data.spatialReference?.wkid;
  if (wkid && wkid !== 4326)
    throw new SourceError("City parcel map returned unexpected coordinates");
  let invalid = 0;
  const features = [];
  for (const row of (data.features ?? []).slice(0, MAX_PARCELS)) {
    if (row.attributes?.parcel_id == null || row.attributes?.objectid == null) {
      invalid++;
      continue;
    }
    try {
      const feature = parcelFeatureToGeoJSON(row);
      feature.properties.source_url = `${LAYERS.parcels}/${row.attributes.objectid}`;
      features.push(feature);
    } catch { invalid++; }
  }
  const truncated = Boolean(data.exceededTransferLimit) || (data.features?.length ?? 0) > MAX_PARCELS;
  return {
    status: truncated || invalid ? "partial" : features.length ? "ok" : "no_records",
    features,
    warning: truncated ? "More City parcels intersect this view. Zoom in to see all outlines."
      : invalid ? `${invalid} City parcel geometries could not be displayed.` : null,
    source_url: LAYERS.parcels,
    note: "Viewport polygons come directly from the City parcel layer. Selecting one does not request the unified parcel records.",
  };
}
