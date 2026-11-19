import { arcgisToGeoJSON } from "@terraformer/arcgis";
import { arcgis, fetchJson, SourceError } from "../parcel/http.js";
import { normalizeAddress } from "../parcel/resolve.js";
import { INDEX_DATASETS } from "./catalog.js";

export const GIS_INDEX_FIELDS = Object.freeze({
  parcels: ["objectid", "parcel_id", "mblu", "property_address", "account_number",
    "owner_name_1", "owwner_name_2", "co_line", "mail_address", "mail_city",
    "mail_state", "mail_zip", "use_code", "zone", "units_commercial",
    "units_residential", "units_condo", "year_building_built",
    "total_land_area_acres", "sale_date", "price", "book", "page",
    "total_assessed_bldg_value", "total_assessed_bldg_xf_value",
    "total_assessed_improvements", "total_assessed_land_value",
    "total_assessed_land_outbldg", "total_assessed_extra_features",
    "total_assessed_parcel_value_x", "total_assessed_parcel_value_y"],
  addresses: ["objectid", "house_number", "full_street_name", "street_name",
    "suffix_type", "unit", "unit_type"],
  "trash-pickup": ["objectid", "trash_day"],
  zoning: ["objectid", "zone_code", "district_category", "districts"],
  wards: ["objectid", "ward"],
  neighborhoods: ["objectid", "neighborhood", "neighborhood_label"],
  cmt: ["objectid", "district_num", "district_name", "district_manager",
    "dm_email", "dm_phone", "neighborhood_specialist", "ns_email", "ns_phone",
    "cmt_chair", "cmt_email", "cmt_phone"],
  "managed-lots": ["objectid", "mbp", "status", "full_address", "join_info"],
  "ct-brownfields": ["OBJECTID", "Site_Town", "Site_Name", "Site_Addre",
    "Site_Parce", "Parcel_Acr", "Program", "Program_Ap", "Funding_So"],
  "metered-parking-spaces": ["objectid", "meternum", "facilityid", "post_num",
    "spacenum", "zone_", "meterspec"],
  "transit-stops": ["OBJECTID", "StopId", "StopName", "OnStreet", "AtStreet", "InService"],
});
const whereFor = (sourceId) => sourceId === "ct-brownfields"
  ? "Site_Town IN ('New Haven','NEW HAVEN')" : "1=1";
const sourceDate = (value) => Number.isFinite(value) && value > 0
  ? new Date(value).toISOString() : null;
function calendarDate(value) {
  if (value == null || value === "" || value === 0) return null;
  const parsed = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new SourceError("Official GIS sale date could not be parsed");
  return new Date(parsed).toISOString().slice(0, 10);
}

export async function arcgisInventory(sourceId, { query = arcgis, metadata = fetchJson } = {}) {
  const definition = INDEX_DATASETS[sourceId];
  if (definition?.kind !== "arcgis") throw new SourceError("Unknown indexed GIS source", 400);
  const where = whereFor(sourceId);
  const [ids, count, info] = await Promise.all([
    query(definition.url, { where, returnIdsOnly: "true", returnGeometry: "false" }),
    query(definition.url, { where, returnCountOnly: "true", returnGeometry: "false" }),
    metadata(`${definition.url}?f=pjson`, { timeout: 10000 }),
  ]);
  if (ids.error || count.error || info.error || !Array.isArray(ids.objectIds) ||
      !Number.isSafeInteger(count.count) || count.count < 0)
    throw new SourceError("Official GIS layer did not provide its full ID list and count");
  const unique = [...new Set(ids.objectIds.map(Number))].sort((a, b) => a - b);
  if (unique.length !== ids.objectIds.length || unique.some((id) => !Number.isSafeInteger(id)) ||
      unique.length !== count.count)
    throw new SourceError("Official GIS ID list and count disagree");
  const publishedFields = new Set((info.fields ?? []).map((field) => field.name));
  if (GIS_INDEX_FIELDS[sourceId]?.some((field) => !publishedFields.has(field)))
    throw new SourceError("Official GIS layer no longer publishes an indexed field");
  const edited = info.editingInfo?.dataLastEditDate ?? info.editingInfo?.lastEditDate ?? info.lastEditDate;
  if (!sourceDate(edited)) throw new SourceError("Official GIS publisher revision is unavailable");
  return { source_id: sourceId, url: definition.url, where, object_ids: unique,
    source_count: count.count, source_updated_at: sourceDate(edited),
    geometry_type: info.geometryType ?? null };
}

export async function arcgisFeatures(inventory, objectIds, { query = arcgis } = {}) {
  if (!objectIds.length || objectIds.length > 200) throw new SourceError("Invalid GIS feature batch", 400);
  const requested = new Set(objectIds.map(Number));
  const data = await query(inventory.url, {
    where: inventory.where, objectIds: objectIds.join(","), outFields: "*",
    returnGeometry: "true", outSR: "4326", resultRecordCount: String(objectIds.length),
  });
  if (data.exceededTransferLimit || !Array.isArray(data.features) ||
      data.features.length !== requested.size)
    throw new SourceError("Official GIS feature batch was incomplete");
  const fields = GIS_INDEX_FIELDS[inventory.source_id] ?? [];
  const rows = data.features.map((feature) => {
    const attributes = feature.attributes ?? {};
    const id = Number(attributes.objectid ?? attributes.OBJECTID);
    if (!requested.delete(id)) throw new SourceError("Official GIS feature ID did not match the requested batch");
    const geometry = feature.geometry ? arcgisToGeoJSON(feature.geometry) : null;
    if (!geometry || !["Point", "Polygon", "MultiPolygon", "LineString", "MultiLineString"].includes(geometry.type))
      throw new SourceError("Official GIS feature had no usable geometry");
    const selectedFields = Object.fromEntries(fields.filter((field) => attributes[field] != null)
      .map((field) => [field, attributes[field]]));
    if (inventory.source_id === "addresses")
      selectedFields.normalized_address = normalizeAddress(
        `${attributes.house_number ?? ""} ${attributes.full_street_name ?? ""}`);
    return {
      record_id: String(id), source_url: `${inventory.url}/${id}`,
      fields: selectedFields,
      event_date: inventory.source_id === "parcels" ? calendarDate(attributes.sale_date) : null,
      geometry,
    };
  });
  if (requested.size) throw new SourceError("Official GIS feature batch omitted an ID");
  return rows;
}
