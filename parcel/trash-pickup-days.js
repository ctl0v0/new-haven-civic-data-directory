// New Haven GIS publishes these coded values for TRASH_DAY.
// https://services6.arcgis.com/AWSPcxcHO7OnZlnu/ArcGIS/rest/services/Trash_Pickup_Day/FeatureServer/0
const weekdays = new Map([
  ["M", "Monday"], ["T", "Tuesday"], ["W", "Wednesday"], ["TH", "Thursday"], ["F", "Friday"],
]);

export function withTrashPickupDayName(fields = {}) {
  // Live parcel rows already include the label from the current layer's domain.
  const name = fields.trash_day_code == null
    ? weekdays.get(String(fields.trash_day ?? "").trim().toUpperCase())
    : fields.trash_day;
  return name ? { ...fields, trash_day_name: name } : fields;
}
