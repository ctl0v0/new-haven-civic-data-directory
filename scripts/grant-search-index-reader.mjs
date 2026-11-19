import { indexQuery } from "../search-index/db.js";

if (!process.env.SEARCH_DATABASE_WRITE_URL)
  throw new Error("SEARCH_DATABASE_WRITE_URL is required to grant index access");

const role = process.env.SEARCH_DATABASE_READER_ROLE ?? "search_index_reader";
if (!/^[a-z][a-z0-9_]{0,62}$/.test(role))
  throw new Error("SEARCH_DATABASE_READER_ROLE must be a simple PostgreSQL role name");

const write = (statement, values = []) => indexQuery(statement, values, { write: true });
const roleRows = await write(`SELECT quote_ident($1::text) AS identifier,
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists`, [role]);
const identifier = roleRows[0].identifier;
if (!roleRows[0].exists) {
  const password = process.env.SEARCH_DATABASE_READER_PASSWORD;
  if (!password || password.length < 32)
    throw new Error("Set a random 32+ character SEARCH_DATABASE_READER_PASSWORD to create the reader role");
  const [literal] = await write(`SELECT quote_literal($1::text) AS password`, [password]);
  await write(`CREATE ROLE ${identifier} LOGIN NOINHERIT PASSWORD ${literal.password}`);
}
await write(`GRANT USAGE ON SCHEMA public TO ${identifier}`);
await write(`GRANT SELECT ON TABLE public.search_source_runs,
  public.search_active_runs, public.search_records,
  public.search_record_parcels TO ${identifier}`);

for (const table of ["search_source_runs", "search_active_runs", "search_records",
  "search_record_parcels"]) {
  const [access] = await write(`SELECT
    has_table_privilege($1, $2, 'SELECT') AS can_select,
    has_table_privilege($1, $2, 'INSERT') AS can_insert,
    has_table_privilege($1, $2, 'UPDATE') AS can_update,
    has_table_privilege($1, $2, 'DELETE') AS can_delete`,
  [role, `public.${table}`]);
  if (!access.can_select || access.can_insert || access.can_update || access.can_delete)
    throw new Error(`${role} does not have read-only access to ${table}`);
}
const [schemaAccess] = await write(`SELECT
  has_schema_privilege($1, 'public', 'CREATE') AS can_create`, [role]);
if (schemaAccess.can_create)
  throw new Error(`${role} can create objects in the public schema`);
console.log(`Read-only index access verified for ${role}.`);
