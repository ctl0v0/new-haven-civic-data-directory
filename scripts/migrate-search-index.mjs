import { readFile } from "node:fs/promises";
import { indexQuery } from "../search-index/db.js";
import { retainParcelPermits } from "../search-index/parcel-only-permits.js";

if (!process.env.SEARCH_DATABASE_WRITE_URL)
  throw new Error("SEARCH_DATABASE_WRITE_URL is required for search-index migration");
const schema = await readFile(new URL("../search-index/schema.sql", import.meta.url), "utf8");
const statements = schema.replace(/^\s*--.*$/gm, "")
  .split(/;\s*(?:\n|$)/).map((part) => part.trim()).filter(Boolean);
for (const statement of statements)
  await indexQuery(statement, [], { write: true });
const oldPermitRuns = await indexQuery(`SELECT s.id FROM search_source_runs s
  WHERE s.source_id = 'municity' AND s.status <> 'running'
    AND s.metadata->>'parcel_only' IS DISTINCT FROM 'true'
    AND EXISTS (SELECT 1 FROM search_records r WHERE r.run_id = s.id AND r.source_id = 'municity')
  ORDER BY s.id`, [], { write: true });
let permitsRemoved = 0;
for (const { id } of oldPermitRuns) {
  const retained = await retainParcelPermits(id);
  permitsRemoved += Number(retained.unlinked) + Number(retained.ambiguous);
}
if (oldPermitRuns.length) console.log(JSON.stringify({ event: "parcel_permit_retention_migrated",
  source_runs: oldPermitRuns.length, rows_without_verified_parcels_removed: permitsRemoved }));
console.log("Search index schema is ready.");
