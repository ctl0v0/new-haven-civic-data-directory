import { indexQuery } from "../search-index/db.js";

if (!process.env.SEARCH_DATABASE_WRITE_URL)
  throw new Error("SEARCH_DATABASE_WRITE_URL is required for index pruning");

// Only the active run can answer a query. Retain old run metadata for an audit
// trail, but remove its duplicated records as soon as it is superseded. A
// 30-day payload retention exceeds the private Neon's 1 GB project limit.
const inactive = await indexQuery(`SELECT r.id, r.source_id, r.scope_key
  FROM search_source_runs r
  WHERE r.status <> 'running'
    AND NOT EXISTS (SELECT 1 FROM search_active_runs a WHERE a.run_id = r.id)
    AND (EXISTS (SELECT 1 FROM search_records d WHERE d.run_id = r.id)
      OR EXISTS (SELECT 1 FROM search_record_parcels j WHERE j.run_id = r.id))
  ORDER BY r.id LIMIT 1000`, [], { write: true });

let removedLinks = 0;
let removedRecords = 0;
for (const run of inactive) {
  const [linkCount] = await indexQuery(`SELECT count(*)::integer AS count
    FROM search_record_parcels WHERE run_id = $1`, [run.id], { write: true });
  const [recordCount] = await indexQuery(`SELECT count(*)::integer AS count
    FROM search_records WHERE run_id = $1`, [run.id], { write: true });
  await indexQuery(`DELETE FROM search_record_parcels WHERE run_id = $1
    AND NOT EXISTS (SELECT 1 FROM search_active_runs WHERE run_id = $1)`,
  [run.id], { write: true });
  await indexQuery(`DELETE FROM search_records WHERE run_id = $1
    AND NOT EXISTS (SELECT 1 FROM search_active_runs WHERE run_id = $1)`,
  [run.id], { write: true });
  removedLinks += Number(linkCount?.count ?? 0);
  removedRecords += Number(recordCount?.count ?? 0);
}

const oldMetadata = await indexQuery(`SELECT id FROM search_source_runs r
  WHERE status <> 'running' AND finished_at < now() - interval '30 days'
    AND NOT EXISTS (SELECT 1 FROM search_active_runs a WHERE a.run_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM search_records d WHERE d.run_id = r.id)
  ORDER BY id LIMIT 1000`, [], { write: true });
for (const row of oldMetadata)
  await indexQuery(`DELETE FROM search_source_runs WHERE id = $1
    AND NOT EXISTS (SELECT 1 FROM search_active_runs WHERE run_id = $1)`,
  [row.id], { write: true });

const [size] = await indexQuery(`SELECT pg_database_size(current_database()) AS bytes,
  pg_total_relation_size('search_records') AS records_bytes,
  pg_total_relation_size('search_record_parcels') AS links_bytes`, [], { write: true });
console.log(JSON.stringify({ event: "search_index_prune",
  payload_runs_pruned: inactive.length, records_pruned: removedRecords,
  links_pruned: removedLinks, metadata_runs_pruned: oldMetadata.length,
  database_bytes_before_vacuum: Number(size?.bytes),
  records_bytes: Number(size?.records_bytes), links_bytes: Number(size?.links_bytes) }));

if (inactive.length) {
  for (const table of ["search_records", "search_record_parcels"]) {
    try {
      await indexQuery(`VACUUM (ANALYZE) ${table}`, [], { write: true });
      console.log(JSON.stringify({ event: "search_index_vacuum", table, status: "complete" }));
    } catch (error) {
      console.log(JSON.stringify({ event: "search_index_vacuum", table,
        status: "unavailable", reason: String(error?.message ?? error).slice(0, 200) }));
    }
  }
}
