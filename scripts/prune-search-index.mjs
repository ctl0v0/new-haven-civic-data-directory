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
for (let offset = 0; offset < inactive.length; offset += 25) {
  const ids = inactive.slice(offset, offset + 25).map((run) => run.id);
  const [linkCount] = await indexQuery(`SELECT count(*)::integer AS count
    FROM search_record_parcels WHERE run_id = ANY($1::bigint[])`,
  [ids], { write: true });
  const [recordCount] = await indexQuery(`SELECT count(*)::integer AS count
    FROM search_records WHERE run_id = ANY($1::bigint[])`,
  [ids], { write: true });
  await indexQuery(`DELETE FROM search_record_parcels j
    WHERE j.run_id = ANY($1::bigint[]) AND NOT EXISTS
      (SELECT 1 FROM search_active_runs a WHERE a.run_id = j.run_id)`,
  [ids], { write: true });
  await indexQuery(`DELETE FROM search_records d
    WHERE d.run_id = ANY($1::bigint[]) AND NOT EXISTS
      (SELECT 1 FROM search_active_runs a WHERE a.run_id = d.run_id)`,
  [ids], { write: true });
  removedLinks += Number(linkCount?.count ?? 0);
  removedRecords += Number(recordCount?.count ?? 0);
}

const oldMetadata = await indexQuery(`SELECT id FROM search_source_runs r
  WHERE status <> 'running' AND finished_at < now() - interval '30 days'
    AND NOT EXISTS (SELECT 1 FROM search_active_runs a WHERE a.run_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM search_records d WHERE d.run_id = r.id)
  ORDER BY id LIMIT 1000`, [], { write: true });
if (oldMetadata.length)
  await indexQuery(`DELETE FROM search_source_runs r WHERE r.id = ANY($1::bigint[])
    AND NOT EXISTS (SELECT 1 FROM search_active_runs a WHERE a.run_id = r.id)`,
  [oldMetadata.map((row) => row.id)], { write: true });

const [size] = await indexQuery(`SELECT pg_database_size(current_database()) AS bytes,
  pg_total_relation_size('search_records') AS records_bytes,
  pg_total_relation_size('search_record_parcels') AS links_bytes`, [], { write: true });
const relations = await indexQuery(`SELECT c.relname AS name,
  pg_total_relation_size(c.oid) AS bytes,
  pg_relation_size(c.oid) AS heap_bytes,
  pg_indexes_size(c.oid) AS index_bytes,
  s.n_live_tup AS estimated_live_rows,
  s.n_dead_tup AS estimated_dead_rows
  FROM pg_class c LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
  WHERE c.relname IN ('search_records', 'search_record_parcels')
  ORDER BY c.relname`, [], { write: true });
console.log(JSON.stringify({ event: "search_index_prune",
  payload_runs_pruned: inactive.length, records_pruned: removedRecords,
  links_pruned: removedLinks, metadata_runs_pruned: oldMetadata.length,
  database_bytes_before_vacuum: Number(size?.bytes),
  records_bytes: Number(size?.records_bytes), links_bytes: Number(size?.links_bytes),
  relations: relations.map((row) => ({ name: row.name, bytes: Number(row.bytes),
    heap_bytes: Number(row.heap_bytes), index_bytes: Number(row.index_bytes),
    estimated_live_rows: Number(row.estimated_live_rows),
    estimated_dead_rows: Number(row.estimated_dead_rows) })) }));

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
  const [after] = await indexQuery(`SELECT pg_database_size(current_database()) AS bytes`,
    [], { write: true });
  console.log(JSON.stringify({ event: "search_index_prune_size_after_vacuum",
    database_bytes: Number(after?.bytes) }));
}
