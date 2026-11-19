import { indexQuery } from "../search-index/db.js";

if (!process.env.SEARCH_DATABASE_WRITE_URL)
  throw new Error("SEARCH_DATABASE_WRITE_URL is required for the writer check");

const [result] = await indexQuery(`SELECT
  has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_tables,
  EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis')
    AS postgis_available`, [], { write: true });
if (!result?.can_create_tables)
  throw new Error("Writer connection works but cannot create the search schema");
if (!result.postgis_available)
  throw new Error("Writer connection works but PostGIS is unavailable");
console.log("Writer connection, schema permission, and PostGIS availability verified.");
