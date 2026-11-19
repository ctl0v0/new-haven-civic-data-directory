import { importArcgisSource, importStateRoster, importMunicipalPermitType,
  importMunicipalPermitCatalog, importSchoolAttendance } from "../search-index/import.js";
import { municipalPermitCatalogRows, municipalTypeShard } from "../search-index/municity.js";
import { municipalPermitTypes } from "../parcel/permit-types.js";

const mode = process.argv[2] ?? "daily";
if (!["daily", "hourly", "municipal"].includes(mode))
  throw new Error("Choose daily, hourly, or municipal refresh mode");
if (!process.env.SEARCH_DATABASE_WRITE_URL)
  throw new Error("SEARCH_DATABASE_WRITE_URL is required for index refresh");

const jobs = mode === "daily" ? [
  ["parcels", () => importArcgisSource("parcels")],
  ["addresses", () => importArcgisSource("addresses")],
  ...["zoning", "wards", "neighborhoods", "cmt", "trash-pickup", "managed-lots",
    "ct-brownfields", "metered-parking-spaces", "transit-stops"].map((id) =>
    [id, () => importArcgisSource(id)]),
  ...["ct-liquor-permits", "ct-child-care-licenses", "ct-cannabis-retail"].map((id) =>
    [id, () => importStateRoster(id)]),
  ["school-attendance", () => importSchoolAttendance()],
  ["municity-permit-types", () => importMunicipalPermitCatalog()],
] : await (async () => {
  const catalog = await municipalPermitTypes();
  const allTypes = municipalPermitCatalogRows(catalog).map((row) => row.record_id)
    .sort((a, b) => a.localeCompare(b));
  const shard = new Date().getUTCHours();
  const types = mode === "hourly" ? allTypes.filter((type) => municipalTypeShard(type) === shard)
    : allTypes;
  console.log(JSON.stringify({ event: "municipal_refresh_selection", mode,
    catalog_types: allTypes.length, selected_types: types.length,
    ...(mode === "hourly" ? { utc_hour_shard: shard } : {}) }));
  return [["municity-permit-types", () => importMunicipalPermitCatalog()],
    ...types.map((type) =>
      [`municity:${type}`, () => importMunicipalPermitType(type)]),
  ];
})();

const results = [];
for (const [sourceId, refresh] of jobs) {
  try {
    const result = await refresh();
    results.push({ source_id: sourceId, status: "complete", ...result });
  } catch (error) {
    results.push({ source_id: sourceId,
      status: error?.code === "MUNICIPAL_TYPE_CAP" ? "blocked" : "failed",
      warning: String(error?.message ?? error).slice(0, 300) });
  }
  console.log(JSON.stringify({ event: "source_refresh", ...results.at(-1) }));
}
console.log(JSON.stringify({ mode,
  completed: results.filter((item) => item.status === "complete").length,
  blocked: results.filter((item) => item.status === "blocked"),
  failed: results.filter((item) => item.status === "failed") }));
if (results.some((result) => result.status === "failed")) process.exitCode = 1;
