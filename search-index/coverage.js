import { indexConfigured, indexQuery } from "./db.js";
import { indexSourceCatalog } from "./catalog.js";

const maxAgeMs = (cadence) => cadence === "hourly" ? 2 * 3600_000 : 48 * 3600_000;

export async function getSearchCoverage() {
  const catalog = indexSourceCatalog();
  if (!indexConfigured()) return {
    index_status: "unconfigured", sources: catalog.map((source) => ({
      ...source, indexed: false, fresh: false, complete: false,
    })),
    note: "The private search index has not been connected. Existing live parcel and bounded permit tools remain available.",
  };
  try {
    const rows = await indexQuery(`SELECT a.source_id, a.scope_key, r.id AS run_id,
      r.status, r.expected_count, r.returned_count, r.linked_count,
      r.ambiguous_count, r.unlinked_count, r.source_updated_at,
      r.finished_at, r.warning, last.status AS latest_attempt_status,
      last.started_at AS latest_attempt_started_at,
      last.warning AS latest_attempt_warning
      FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
      LEFT JOIN LATERAL (SELECT status, started_at, warning FROM search_source_runs
        WHERE source_id = a.source_id AND scope_key = a.scope_key
        ORDER BY started_at DESC, id DESC LIMIT 1) last ON true`);
    const active = new Map(rows.filter((row) => row.scope_key === "all")
      .map((row) => [row.source_id, row]));
    const now = Date.now();
    const municipalTypes = rows.filter((row) => row.source_id === "municity" &&
      row.scope_key.startsWith("permit-type:")).map((row) => ({
        permit_type: row.scope_key.slice("permit-type:".length),
        run_id: Number(row.run_id), source_count: Number(row.expected_count),
        returned_count: Number(row.returned_count),
        ambiguous_count: Number(row.ambiguous_count),
        unlinked_count: Number(row.unlinked_count),
        last_successful_refresh: row.finished_at,
        fresh: now - Date.parse(row.finished_at) <= maxAgeMs("hourly"),
        complete: row.status === "complete" && row.latest_attempt_status !== "failed" &&
          Number(row.expected_count) === Number(row.returned_count) &&
          Number(row.ambiguous_count) === 0 && Number(row.unlinked_count) === 0 &&
          now - Date.parse(row.finished_at) <= maxAgeMs("hourly"),
      }));
    return {
      index_status: "connected",
      municipal_permit_types: municipalTypes,
      sources: catalog.map((source) => {
        const run = active.get(source.index_source_id);
        const fresh = Boolean(run && source.cadence &&
          now - Date.parse(run.finished_at) <= maxAgeMs(source.cadence));
        return { ...source, indexed: Boolean(run), fresh,
          complete: Boolean(run && fresh && run.status === "complete" &&
            run.latest_attempt_status !== "failed" &&
            Number(run.ambiguous_count) === 0 && Number(run.unlinked_count) === 0),
          ...(run ? { active_run_id: Number(run.run_id), source_count: run.expected_count,
            returned_count: run.returned_count, linked_count: run.linked_count,
            ambiguous_count: run.ambiguous_count, unlinked_count: run.unlinked_count,
            source_updated_at: run.source_updated_at,
            last_successful_refresh: run.finished_at, warning: run.warning,
            latest_attempt_status: run.latest_attempt_status,
            latest_attempt_started_at: run.latest_attempt_started_at,
            latest_attempt_warning: run.latest_attempt_warning } : {}),
        };
      }),
      checked_at: new Date().toISOString(),
      note: "A live parcel lookup and an indexed citywide search have different coverage. Complete refers only to a validated, fresh source run with established parcel joins.",
    };
  } catch {
    return { index_status: "unavailable", sources: catalog.map((source) => ({
      ...source, indexed: false, fresh: false, complete: false,
    })), note: "Search index status could not be checked; no complete cross-parcel claim is available." };
  }
}
