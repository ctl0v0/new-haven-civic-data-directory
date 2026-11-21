import { importArcgisSource, importStateRoster, importMunicipalPermitType,
  importMunicipalPermitCatalog, importSchoolAttendance,
  importMunicipalPermitWindows } from "../search-index/import.js";
import { municipalPermitCatalogRows, municipalTypeShard } from "../search-index/municity.js";
import { municipalPermitTypes } from "../parcel/permit-types.js";
import { importMunicipalPermitActivity } from "../search-index/import-permit-activity.js";
import { importMunicipalBusinessLicenses } from "../search-index/import-municipal-licenses.js";
import { STATE_ROSTERS } from "../search-index/socrata.js";
import { CHARITY_SOURCE } from "../parcel/charity-registrations.js";
import { REGISTRATION_SOURCE } from "../parcel/business-registrations.js";

const mode = process.argv[2] ?? "daily";
if (!["daily", "hourly", "municipal", "licenses"].includes(mode))
  throw new Error("Choose daily, hourly, municipal, or licenses refresh mode");
if (!process.env.SEARCH_DATABASE_WRITE_URL)
  throw new Error("SEARCH_DATABASE_WRITE_URL is required for index refresh");

const cityLicenses = ["municipal-business-licenses", () => importMunicipalBusinessLicenses()];
const charities = [CHARITY_SOURCE, () => importStateRoster(CHARITY_SOURCE)];
const registrations = [REGISTRATION_SOURCE, () => importStateRoster(REGISTRATION_SOURCE)];
const stateLicenses = Object.keys(STATE_ROSTERS).filter((id) => id !== CHARITY_SOURCE).map((id) =>
  [id, () => importStateRoster(id)]);
const results = [];
async function refreshSource([sourceId, refresh]) {
  try {
    const result = await refresh();
    results.push({ source_id: sourceId, status: "complete", ...result });
  } catch (error) {
    results.push({ source_id: sourceId,
      status: ["MUNICIPAL_TYPE_CAP", "MUNICIPAL_LICENSE_UNVERIFIED"].includes(error?.code) ? "blocked" : "failed",
      warning: String(error?.message ?? error).slice(0, 300) });
  }
  console.log(JSON.stringify({ event: "source_refresh", ...results.at(-1) }));
}

if (mode === "hourly") await refreshSource(cityLicenses);
const jobs = mode === "licenses" ? [charities, cityLicenses, ...stateLicenses] : mode === "daily" ? [
  ["parcels", () => importArcgisSource("parcels")],
  ["addresses", () => importArcgisSource("addresses")],
  registrations,
  charities,
  cityLicenses,
  ["municity:all-permit-types:recent-windows", () => importMunicipalPermitWindows()],
  ["municity-permit-activity", () => importMunicipalPermitActivity()],
  ...["zoning", "wards", "neighborhoods", "cmt", "trash-pickup", "managed-lots",
    "ct-brownfields", "metered-parking-spaces", "transit-stops"].map((id) =>
    [id, () => importArcgisSource(id)]),
  ...stateLicenses,
  ["school-attendance", () => importSchoolAttendance()],
  ["municity-permit-types", () => importMunicipalPermitCatalog()],
] : await (async () => {
  const catalog = await municipalPermitTypes({ retry429: true });
  const allTypes = municipalPermitCatalogRows(catalog).map((row) => row.record_id)
    .sort((a, b) => a.localeCompare(b));
  const shard = new Date().getUTCHours();
  // The recent Electrical run has a bounded date contract. A full-type capped
  // attempt must not replace or invalidate it until full history is solved.
  const eligible = allTypes.filter((type) => type !== "Electrical Permit");
  const types = mode === "hourly" ? eligible.filter((type) => municipalTypeShard(type) === shard)
    : eligible;
  console.log(JSON.stringify({ event: "municipal_refresh_selection", mode,
    catalog_types: allTypes.length, selected_types: types.length,
    ...(mode === "hourly" ? { utc_hour_shard: shard } : {}) }));
  return [["municity-permit-types", () => importMunicipalPermitCatalog()],
    ...types.map((type) =>
      [`municity:${type}`, () => importMunicipalPermitType(type)]),
  ];
})();

for (const job of jobs) await refreshSource(job);
console.log(JSON.stringify({ mode,
  completed: results.filter((item) => item.status === "complete").length,
  partial: results.filter((item) => item.status === "partial").map(({ source_id }) => source_id),
  blocked: results.filter((item) => item.status === "blocked"),
  failed: results.filter((item) => item.status === "failed") }));
if (results.some((result) => result.status === "failed")) process.exitCode = 1;
