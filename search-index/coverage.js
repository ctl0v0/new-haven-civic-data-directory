import { indexConfigured, indexQuery } from "./db.js";
import { indexSourceCatalog } from "./catalog.js";

const maxAgeMs = (cadence) => cadence === "hourly" ? 2 * 3600_000 : 48 * 3600_000;

export async function getSearchCoverage({ query = indexQuery } = {}) {
  const catalog = indexSourceCatalog();
  if (!indexConfigured()) return {
    index_status: "unconfigured", sources: catalog.map((source) => ({
      ...source, indexed: false, fresh: false, complete: false,
    })),
    note: "The private search index has not been connected. Existing live parcel and bounded permit tools remain available.",
  };
  try {
    const rows = await query(`SELECT a.source_id, a.scope_key, r.id AS run_id,
      r.status, r.expected_count, r.returned_count, r.linked_count,
      r.ambiguous_count, r.unlinked_count, r.source_updated_at,
      r.coverage_date_from, r.coverage_date_to,
      r.finished_at, r.warning, last.status AS latest_attempt_status,
      last.started_at AS latest_attempt_started_at,
      last.warning AS latest_attempt_warning
      FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
      LEFT JOIN LATERAL (SELECT status, started_at, warning FROM search_source_runs
        WHERE source_id = a.source_id AND scope_key = a.scope_key
        ORDER BY started_at DESC, id DESC LIMIT 1) last ON true`);
    const latestAll = await query(`SELECT DISTINCT ON (source_id)
      source_id, status, warning, started_at
      FROM search_source_runs WHERE scope_key = 'all'
      ORDER BY source_id, started_at DESC, id DESC`);
    const active = new Map(rows.filter((row) => row.scope_key === "all")
      .map((row) => [row.source_id, row]));
    const latestAllBySource = new Map(latestAll.map((row) => [row.source_id, row]));
    const now = Date.now();
    const typeCatalogRun = active.get("municity-permit-types");
    const typeNames = typeCatalogRun ? await query(`SELECT record_id,
      fields->>'group' AS group_name
      FROM search_records WHERE run_id = $1 AND source_id = 'municity-permit-types'
      ORDER BY record_id`, [typeCatalogRun.run_id]) : [];
    const latestTypes = await query(`SELECT DISTINCT ON (scope_key)
      scope_key, status, warning, started_at
      FROM search_source_runs WHERE source_id = 'municity'
        AND scope_key LIKE 'permit-type:%'
      ORDER BY scope_key, started_at DESC, id DESC`);
    const byScope = new Map(rows.filter((row) => row.source_id === "municity")
      .map((row) => [row.scope_key, row]));
    const latestByScope = new Map(latestTypes.map((row) => [row.scope_key, row]));
    const catalogNames = new Set(typeNames.map((row) => row.record_id.toUpperCase()));
    const municipalTypes = [...typeNames.map((row) => row.record_id),
      ...rows.filter((row) => row.source_id === "municity" &&
        row.scope_key.startsWith("permit-type:") &&
        !catalogNames.has(row.scope_key.slice("permit-type:".length)))
        .map((row) => row.scope_key.slice("permit-type:".length))].map((name) => {
      const scope = `permit-type:${name.toUpperCase()}`;
      const run = byScope.get(scope);
      const latest = latestByScope.get(scope);
      const latestStatus = latest?.status === "failed" &&
        latest.warning?.startsWith("MUNICIPAL_TYPE_CAP:") ? "blocked" : latest?.status;
      const fresh = Boolean(run && now - Date.parse(run.finished_at) <= maxAgeMs("daily"));
      return { permit_type: name, in_catalog: catalogNames.has(name.toUpperCase()),
        indexed: Boolean(run), fresh,
        complete: Boolean(run && fresh && !run.coverage_date_from &&
          !run.coverage_date_to && run.status === "complete" &&
          latest?.status === "complete" &&
          Number(run.expected_count) === Number(run.returned_count) &&
          Number(run.ambiguous_count) === 0 && Number(run.unlinked_count) === 0),
        ...(run ? { run_id: Number(run.run_id), source_count: Number(run.expected_count),
          returned_count: Number(run.returned_count), linked_count: Number(run.linked_count),
          ambiguous_count: Number(run.ambiguous_count),
          unlinked_count: Number(run.unlinked_count),
          coverage_date_from: run.coverage_date_from ?? null,
          coverage_date_to: run.coverage_date_to ?? null,
          complete_for_covered_window: Boolean(fresh && run.status === "complete" &&
            latest?.status === "complete" &&
            Number(run.expected_count) === Number(run.returned_count) &&
            Number(run.ambiguous_count) === 0 && Number(run.unlinked_count) === 0),
          last_successful_refresh: run.finished_at,
          warning: run.warning } : {}),
        ...(latest ? { latest_attempt_status: latestStatus,
          latest_attempt_warning: latest.warning,
          latest_attempt_started_at: latest.started_at } : {}),
      };
    });
    const municipalGroups = [...new Set(typeNames.map((row) => row.group_name)
      .filter(Boolean))].sort().map((name) => {
      const run = byScope.get(`permit-group:${name.toUpperCase()}`);
      const fresh = Boolean(run && now - Date.parse(run.finished_at) <= maxAgeMs("daily"));
      return { permit_group: name, catalog_type_count: typeNames.filter((row) =>
        row.group_name === name).length, indexed: Boolean(run), fresh,
        complete_for_covered_window: Boolean(run && fresh && run.status === "complete" &&
          run.latest_attempt_status !== "failed" &&
          Number(run.expected_count) === Number(run.returned_count) &&
          Number(run.ambiguous_count) === 0 && Number(run.unlinked_count) === 0),
        ...(run ? { run_id: Number(run.run_id), source_count: Number(run.expected_count),
          linked_count: Number(run.linked_count), ambiguous_count: Number(run.ambiguous_count),
          unlinked_count: Number(run.unlinked_count),
          coverage_date_from: run.coverage_date_from ?? null,
          coverage_date_to: run.coverage_date_to ?? null,
          last_successful_refresh: run.finished_at,
          latest_attempt_status: run.latest_attempt_status,
          latest_attempt_warning: run.latest_attempt_warning } : {}) };
    });
    return {
      index_status: "connected",
      municipal_permit_types: municipalTypes,
      municipal_permit_groups: municipalGroups,
      municipal_permit_catalog: { indexed: Boolean(typeCatalogRun),
        catalog_types: typeNames.length,
        types_with_index: municipalTypes.filter((type) => type.in_catalog && type.indexed).length,
        types_with_complete_parcel_joins: municipalTypes.filter((type) => type.in_catalog && type.complete).length,
        types_without_index: municipalTypes.filter((type) => type.in_catalog && !type.indexed).length,
        type_catalog_last_refresh: typeCatalogRun?.finished_at ?? null },
      sources: catalog.map((source) => {
        const run = active.get(source.index_source_id);
        const attempt = source.index_source_id
          ? latestAllBySource.get(source.index_source_id) : null;
        const fresh = Boolean(run && source.cadence &&
          now - Date.parse(run.finished_at) <= maxAgeMs(source.cadence));
        return { ...source, indexed: Boolean(run), fresh,
          complete: Boolean(run && fresh && run.status === "complete" &&
            run.latest_attempt_status !== "failed" &&
            Number(run.expected_count) === Number(run.returned_count) &&
            Number(run.ambiguous_count) === 0 && Number(run.unlinked_count) === 0),
          ...(run ? { active_run_id: Number(run.run_id), source_count: run.expected_count,
            returned_count: run.returned_count, linked_count: run.linked_count,
            ambiguous_count: run.ambiguous_count, unlinked_count: run.unlinked_count,
            source_updated_at: run.source_updated_at,
            last_successful_refresh: run.finished_at, warning: run.warning,
            latest_attempt_status: run.latest_attempt_status,
            latest_attempt_started_at: run.latest_attempt_started_at,
            latest_attempt_warning: run.latest_attempt_warning } :
            attempt ? { latest_attempt_status: attempt.status,
              latest_attempt_started_at: attempt.started_at,
              latest_attempt_warning: attempt.warning } : {}),
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
