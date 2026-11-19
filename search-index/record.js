import { SourceError } from "../parcel/http.js";
import { INDEX_DATASETS } from "./catalog.js";
import { indexConfigured, indexQuery } from "./db.js";

export async function getIndexedRecord(input = {}, { query = indexQuery } = {}) {
  const sourceId = String(input.source_id ?? "").trim();
  const recordId = String(input.record_id ?? "").trim();
  const permitType = input.permit_type == null ? null : String(input.permit_type).trim();
  if (!INDEX_DATASETS[sourceId] || !recordId || recordId.length > 160 ||
      /[\x00-\x1f]/.test(recordId))
    throw new SourceError("Provide a valid indexed source and official record ID", 400);
  if (sourceId === "municity" ? (!permitType || permitType.length > 100 ||
      /[\x00-\x1f]/.test(permitType)) : permitType != null)
    throw new SourceError("Permit type is required only for municipal permit records", 400);
  if (input.include_geometry != null && typeof input.include_geometry !== "boolean")
    throw new SourceError("include_geometry must be a boolean", 400);
  const scopeKey = sourceId === "municity" ? `permit-type:${permitType.toUpperCase()}` : "all";
  const key = { source_id: sourceId, scope_key: scopeKey, record_id: recordId };
  if (!indexConfigured()) return { ...key, found: false, complete_for_query: false,
    coverage: { index_status: "unconfigured" } };
  try {
    const runs = await query(`SELECT r.id AS run_id, r.status, r.expected_count,
      r.returned_count, r.ambiguous_count, r.unlinked_count,
      r.source_updated_at, r.finished_at,
      last.status AS latest_attempt_status, last.warning AS latest_attempt_warning
      FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
      LEFT JOIN LATERAL (SELECT status, warning FROM search_source_runs
        WHERE source_id = a.source_id AND scope_key = a.scope_key
        ORDER BY started_at DESC, id DESC LIMIT 1) last ON true
      WHERE a.source_id = $1 AND a.scope_key = $2`, [sourceId, scopeKey]);
    const run = runs[0];
    if (!run) return { ...key, found: false, complete_for_query: false,
      coverage: { index_status: "not_indexed" } };
    const fresh = Date.now() - Date.parse(run.finished_at) <= 48 * 3600_000;
    const complete = fresh && run.status === "complete" &&
      run.latest_attempt_status !== "failed" &&
      Number(run.expected_count) === Number(run.returned_count);
    const coverage = { index_status: complete ? "connected" : "partial",
      active_run_id: Number(run.run_id), fresh, source_count: Number(run.expected_count),
      returned_count: Number(run.returned_count),
      ambiguous_parcel_links: Number(run.ambiguous_count),
      unlinked_records: Number(run.unlinked_count),
      source_updated_at: run.source_updated_at,
      last_successful_refresh: run.finished_at,
      latest_attempt_status: run.latest_attempt_status,
      latest_attempt_warning: run.latest_attempt_warning };
    const rows = await query(`SELECT record_id, source_url, published_type,
      published_status, event_date, fields,
      CASE WHEN $4::boolean AND geometry IS NOT NULL
        THEN ST_AsGeoJSON(geometry)::jsonb ELSE NULL END AS geometry
      FROM search_records WHERE run_id = $1 AND source_id = $2 AND record_id = $3`,
    [run.run_id, sourceId, recordId, input.include_geometry === true]);
    if (!rows.length) return { ...key, found: false, complete_for_query: complete, coverage };
    const links = await query(`SELECT city_parcel_id, city_objectid,
      city_address_objectid, match_method, join_status
      FROM search_record_parcels WHERE run_id = $1 AND source_id = $2
        AND record_id = $3 ORDER BY city_parcel_id, city_objectid`,
    [run.run_id, sourceId, recordId]);
    return { ...key, found: true, complete_for_query: complete,
      record: rows[0], parcel_links: links,
      coverage, retrieved_at: new Date().toISOString(),
      note: sourceId === "municity"
        ? "Indexed municipal permit search fields. Use get_permit_details with an exact linked City parcel for full live permit, application, fee, task, inspection and public contact records."
        : "Fields are those selected from the official source for the index. Use the live parcel tools for complete source context." };
  } catch {
    return { ...key, found: false, complete_for_query: false,
      coverage: { index_status: "unavailable",
        note: "The read-only indexed record lookup failed; absence is not established." } };
  }
}
