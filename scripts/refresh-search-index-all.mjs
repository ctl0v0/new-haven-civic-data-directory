import { importArcgisSource, importStateRoster, importMunicipalPermitType,
  importSchoolAttendance } from "../search-index/import.js";

const mode = process.argv[2] ?? "daily";
if (!["daily", "hourly"].includes(mode))
  throw new Error("Choose daily or hourly refresh mode");
if (!process.env.SEARCH_DATABASE_WRITE_URL)
  throw new Error("SEARCH_DATABASE_WRITE_URL is required for index refresh");

const jobs = mode === "daily" ? [
  ["parcels", () => importArcgisSource("parcels")],
  ["addresses", () => importArcgisSource("addresses")],
  ...["zoning", "wards", "neighborhoods", "cmt", "trash-pickup",
    "ct-brownfields", "metered-parking-spaces", "transit-stops"].map((id) =>
    [id, () => importArcgisSource(id)]),
  ...["ct-liquor-permits", "ct-child-care-licenses", "ct-cannabis-retail"].map((id) =>
    [id, () => importStateRoster(id)]),
  ["school-attendance", () => importSchoolAttendance()],
] : (() => {
  let types;
  try { types = JSON.parse(process.env.INDEX_PERMIT_TYPES ?? "[]"); }
  catch { throw new Error("INDEX_PERMIT_TYPES must be a JSON array of exact official types"); }
  if (!Array.isArray(types) || !types.length || types.length > 30 ||
      types.some((type) => typeof type !== "string" || !type.trim() || type.length > 100))
    throw new Error("INDEX_PERMIT_TYPES must contain 1–30 exact official types");
  return [...new Set(types)].map((type) =>
    [`municity:${type}`, () => importMunicipalPermitType(type)]);
})();

const results = [];
for (const [sourceId, refresh] of jobs) {
  try {
    const result = await refresh();
    results.push({ source_id: sourceId, status: "complete", ...result });
  } catch (error) {
    results.push({ source_id: sourceId, status: "failed",
      warning: String(error?.message ?? error).slice(0, 300) });
  }
}
console.log(JSON.stringify({ mode, results }));
if (results.some((result) => result.status === "failed")) process.exitCode = 1;
