import { getSearchCoverage } from "../search-index/coverage.js";
import { searchIndexedPermits } from "../search-index/permits.js";

export async function checkRecentPermitWindows({ search = searchIndexedPermits } = {}) {
  const { index_status, municipal_recent_permits: windows } = await getSearchCoverage();
  if (!windows) return { index_status, windows: [] };
  const results = [];
  for (const window of windows) {
    if (!window.indexed) {
      results.push({ window });
      continue;
    }
    const date = (value) => value instanceof Date ? value.toISOString().slice(0, 10)
      : String(value).slice(0, 10);
    const dates = { permit_date_from: date(window.coverage_date_from),
      permit_date_to: date(window.coverage_date_to) };
    const all = await search({ ...dates, limit: 2 });
    const input = { ...dates, permit_types: ["Water Heater"],
      scope: "neighborhood", neighborhood: "Westville", limit: 50 };
    const waterHeater = await search(input);
    const check = (result) => result.coverage?.source_checks?.find((item) => item.source_id === "municity");
    const allCheck = check(all);
    const waterCheck = check(waterHeater);
    if (!allCheck?.scope_key?.startsWith("permit-window:") || !allCheck.date_covered ||
        waterCheck?.run_id !== allCheck.run_id ||
        [all, waterHeater].some((result) => result.coverage.index_status === "unavailable") ||
        waterHeater.items.some((item) => item.permit_type?.trim().toUpperCase() !== "WATER HEATER"))
      throw new Error(`The indexed searches could not verify the ${window.days}-day permit window`);
    results.push({ window, all_types_first_page: all.items.length,
      westville_water_heater: { matches_on_page: waterHeater.items.length,
        complete: waterHeater.complete_for_query, has_more: Boolean(waterHeater.next_cursor),
        examples: waterHeater.items.slice(0, 3).map((item) => ({
          permit_id: item.permit_id, permit_number: item.permit_number,
          parcel_id: item.city_parcel_id, permit_date: item.permit_date,
          source_url: item.permit_source_url,
        })) } });
  }
  return { index_status, windows: results };
}
