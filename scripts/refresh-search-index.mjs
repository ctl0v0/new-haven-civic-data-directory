import { importArcgisSource, importStateRoster, importMunicipalPermitType,
  importSchoolAttendance } from "../search-index/import.js";
import { INDEX_DATASETS } from "../search-index/catalog.js";

const sourceId = process.argv[2];
const kind = INDEX_DATASETS[sourceId]?.kind;
if (!["arcgis", "socrata-location", "municipal-type", "official-snapshot"].includes(kind))
  throw new Error("Pass one indexed GIS, State roster, school, or municipal source ID");
if (!process.env.SEARCH_DATABASE_WRITE_URL)
  throw new Error("SEARCH_DATABASE_WRITE_URL is required for index refresh");
const result = kind === "arcgis" ? await importArcgisSource(sourceId)
  : kind === "socrata-location" ? await importStateRoster(sourceId)
    : kind === "municipal-type" ? await importMunicipalPermitType(process.argv[3])
      : await importSchoolAttendance();
console.log(JSON.stringify({ source_id: sourceId, ...result }));
