import { auditCityUseCodes } from "../search-index/use-codes.js";
import { indexQuery } from "../search-index/db.js";
import { municipalPermitTypes } from "../parcel/permit-types.js";

if (!process.env.SEARCH_DATABASE_WRITE_URL)
  throw new Error("SEARCH_DATABASE_WRITE_URL is required to read the private City parcel index");
const report = await auditCityUseCodes({ query: (sql, values) =>
  indexQuery(sql, values, { write: true }) });
console.log(JSON.stringify({ event: "city_use_code_audit", ...report }));
const catalog = await municipalPermitTypes();
console.log(JSON.stringify({ event: "municipal_electrical_type_audit",
  source_url: catalog.source_url, retrieved_at: catalog.retrieved_at,
  catalog_partial: catalog.partial,
  matching_entries: catalog.groups.flatMap((group) => group.types
    .filter((type) => /electr/i.test(`${group.name ?? ""} ${type.name}`))
    .map((type) => ({ group: group.name, ...type }))) }));
