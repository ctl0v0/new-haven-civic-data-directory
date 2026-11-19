import { indexQuery } from "../search-index/db.js";

if (!process.env.SEARCH_DATABASE_WRITE_URL)
  throw new Error("SEARCH_DATABASE_WRITE_URL is required for index pruning");
const old = await indexQuery(`SELECT id FROM search_source_runs r
  WHERE status <> 'running' AND finished_at < now() - interval '30 days'
    AND NOT EXISTS (SELECT 1 FROM search_active_runs a WHERE a.run_id = r.id)
  ORDER BY id LIMIT 1000`, [], { write: true });
for (const row of old) {
  await indexQuery(`DELETE FROM search_record_parcels WHERE run_id = $1`,
    [row.id], { write: true });
  await indexQuery(`DELETE FROM search_records WHERE run_id = $1`,
    [row.id], { write: true });
  await indexQuery(`DELETE FROM search_source_runs WHERE id = $1
    AND NOT EXISTS (SELECT 1 FROM search_active_runs WHERE run_id = $1)`,
  [row.id], { write: true });
}
console.log(JSON.stringify({ pruned_runs: old.length }));
