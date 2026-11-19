import { auditCityUseCodes } from "../search-index/use-codes.js";
import { indexQuery } from "../search-index/db.js";

if (!process.env.SEARCH_DATABASE_WRITE_URL)
  throw new Error("SEARCH_DATABASE_WRITE_URL is required to read the private City parcel index");
const report = await auditCityUseCodes({ query: (sql, values) =>
  indexQuery(sql, values, { write: true }) });
console.log(JSON.stringify({ event: "city_use_code_audit", ...report }));
