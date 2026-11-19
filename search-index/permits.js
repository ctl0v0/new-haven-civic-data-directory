import { SourceError } from "../parcel/http.js";
import { fingerprint, makeSearchCursor, readSearchCursor } from "../parcel/search-cursor.js";
import { indexConfigured, indexQuery } from "./db.js";

const date = (value, name) => {
  if (value == null || value === "") return null;
  const raw = String(value);
  const parsed = Date.parse(`${raw}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(parsed) ||
      new Date(parsed).toISOString().slice(0, 10) !== raw)
    throw new SourceError(`Invalid ${name}`, 400);
  return raw;
};
const check = (sourceId, scopeKey, row, maxAge) => {
  if (!row) return { source_id: sourceId, scope_key: scopeKey, status: "not_indexed" };
  const fresh = Date.now() - Date.parse(row.finished_at) <= maxAge;
  const complete = fresh && row.status === "complete" && row.latest_attempt_status !== "failed" &&
    Number(row.expected_count) === Number(row.returned_count) &&
    Number(row.ambiguous_count) === 0 && Number(row.unlinked_count) === 0;
  return { source_id: sourceId, scope_key: scopeKey,
    status: complete ? "complete" : "partial", run_id: Number(row.run_id),
    fresh, expected_count: Number(row.expected_count),
    returned_count: Number(row.returned_count),
    ambiguous_count: Number(row.ambiguous_count),
    unlinked_count: Number(row.unlinked_count), finished_at: row.finished_at };
};

export async function searchIndexedPermits(input = {}, { query = indexQuery } = {}) {
  const allTypes = input.permit_types == null ||
    (Array.isArray(input.permit_types) && input.permit_types.length === 0);
  if (!allTypes && (!Array.isArray(input.permit_types) || input.permit_types.length > 6))
    throw new SourceError("Provide 1–6 exact municipal permit types, or omit them to search the indexed catalog", 400);
  let types = [...new Set((allTypes ? [] : input.permit_types).map((type) => {
    const name = String(type ?? "").trim();
    if (!name || name.length > 100 || /[\x00-\x1f]/.test(name))
      throw new SourceError("Invalid municipal permit type", 400);
    return name.toUpperCase();
  }))].sort();
  const scope = input.scope ?? "city";
  if (!["city", "neighborhood", "ward"].includes(scope))
    throw new SourceError("Invalid indexed permit search scope", 400);
  const scopeName = scope === "neighborhood" ? String(input.neighborhood ?? "").trim() :
    scope === "ward" ? String(input.ward ?? "").trim() : null;
  if (scope !== "city" && (!scopeName || scopeName.length > 80 ||
      (scope === "ward" && !/^\d{1,2}$/.test(scopeName))))
    throw new SourceError(`Provide one City ${scope} value`, 400);
  if (scope === "city" && (input.neighborhood || input.ward != null))
    throw new SourceError("Boundary name requires a matching scope", 400);
  const status = input.permit_status == null ? null : String(input.permit_status).trim();
  if (status != null && (!status || status.length > 100))
    throw new SourceError("Invalid published permit status", 400);
  const from = date(input.permit_date_from, "permit_date_from");
  const to = date(input.permit_date_to, "permit_date_to");
  if (from && to && from > to) throw new SourceError("Permit date range is reversed", 400);
  const limit = input.limit == null ? 25 : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new SourceError("limit must be 1–50", 400);
  const criteria = { permit_types: allTypes ? "all-catalog-types" : types,
    scope, scope_value: scopeName?.toUpperCase() ?? null,
    permit_status: status?.toUpperCase() ?? null, permit_date_from: from, permit_date_to: to };
  const wanted = ["parcels", "municity", ...(allTypes ? ["municity-permit-types"] : []),
    ...(scope === "city" ? [] : [scope === "ward" ? "wards" : "neighborhoods"])];
  if (!indexConfigured()) return { criteria, items: [], next_cursor: null,
    complete_for_query: false, coverage: { index_status: "unconfigured",
      source_checks: wanted.map((source_id) => ({ source_id, status: "unconfigured" })) } };
  let active;
  try {
    active = await query(`SELECT a.source_id, a.scope_key, r.id AS run_id,
      r.status, r.finished_at, r.expected_count, r.returned_count,
      r.ambiguous_count, r.unlinked_count,
      last.status AS latest_attempt_status
      FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
      LEFT JOIN LATERAL (SELECT status FROM search_source_runs
        WHERE source_id = a.source_id AND scope_key = a.scope_key
        ORDER BY started_at DESC, id DESC LIMIT 1) last ON true
      WHERE a.source_id = ANY($1::text[])`, [wanted]);
  } catch {
    return { criteria, items: [], next_cursor: null, complete_for_query: false,
      coverage: { index_status: "unavailable", source_checks: wanted.map((source_id) =>
        ({ source_id, status: "unavailable" })) } };
  }
  const byKey = new Map(active.map((row) => [`${row.source_id}:${row.scope_key}`, row]));
  if (allTypes) {
    const catalog = byKey.get("municity-permit-types:all");
    if (!catalog) return { criteria, items: [], next_cursor: null,
      complete_for_query: false, coverage: { index_status: "partial",
        source_checks: [check("municity-permit-types", "all", null, 48 * 3600_000)],
        note: "The full official permit type catalog has not been indexed. No all-type result was asserted." } };
    try {
      const catalogRows = await query(`SELECT record_id FROM search_records
        WHERE run_id = $1 AND source_id = 'municity-permit-types'
        ORDER BY record_id`, [catalog.run_id]);
      types = catalogRows.map((row) => String(row.record_id).toUpperCase());
      if (!types.length) throw new Error("Empty indexed permit type catalog");
    } catch {
      return { criteria, items: [], next_cursor: null,
        complete_for_query: false, coverage: { index_status: "unavailable",
          source_checks: [check("municity-permit-types", "all", catalog, 48 * 3600_000)],
          note: "The official permit type catalog could not be read; no all-type result was asserted." } };
    }
  }
  const checks = [check("parcels", "all", byKey.get("parcels:all"), 48 * 3600_000),
    ...(allTypes ? [check("municity-permit-types", "all",
      byKey.get("municity-permit-types:all"), 48 * 3600_000)] : []),
    ...(scope === "city" ? [] : [check(scope === "ward" ? "wards" : "neighborhoods",
      "all", byKey.get(`${scope === "ward" ? "wards" : "neighborhoods"}:all`), 48 * 3600_000)]),
    ...types.map((type) => check("municity", `permit-type:${type}`,
      byKey.get(`municity:permit-type:${type}`), 48 * 3600_000))];
  if (checks.some((item) => item.status === "not_indexed" && item.source_id !== "municity"))
    return { criteria, items: [], next_cursor: null, complete_for_query: false,
      coverage: { index_status: "partial", source_checks: checks,
        note: "The City parcel or boundary baseline is absent. No permit result was asserted." } };
  const allComplete = checks.every((item) => item.status === "complete");
  const runIds = Object.fromEntries(checks.filter((item) => item.run_id != null)
    .map((item) => [`${item.source_id}:${item.scope_key}`, item.run_id]));
  const sourceHash = fingerprint(runIds);
  const cursor = readSearchCursor(input.cursor, fingerprint(criteria), sourceHash);
  const availableTypeRuns = types.map((type) => runIds[`municity:permit-type:${type}`])
    .filter((runId) => runId != null);
  if (!availableTypeRuns.length) return { criteria, items: [], next_cursor: null,
    complete_for_query: false, coverage: { index_status: "partial", source_checks: checks,
      note: "None of the requested permit types has an indexed run. No zero result was asserted." } };
  const values = [availableTypeRuns,
    runIds["parcels:all"]];
  const add = (value) => { values.push(value); return `$${values.length}`; };
  const filters = [];
  if (status) filters.push(`upper(r.published_status) = upper(${add(status)})`);
  if (from) filters.push(`r.event_date >= ${add(from)}::date`);
  if (to) filters.push(`r.event_date <= ${add(to)}::date`);
  if (scope !== "city") {
    const boundary = scope === "ward" ? "wards" : "neighborhoods";
    const boundaryRun = add(runIds[`${boundary}:all`]);
    const field = scope === "ward" ? "ward" : "neighborhood";
    const label = scope === "ward" ? null : "neighborhood_label";
    const value = add(scopeName);
    filters.push(`EXISTS (SELECT 1 FROM search_record_parcels bj
      JOIN search_records br ON br.run_id = bj.run_id AND br.source_id = bj.source_id
        AND br.record_id = bj.record_id
      WHERE bj.run_id = ${boundaryRun} AND bj.source_id = '${boundary}'
        AND bj.city_parcel_id = j.city_parcel_id AND bj.city_objectid = j.city_objectid
        AND bj.join_status = 'exact' AND (upper(br.fields->>'${field}') = upper(${value})${label
          ? ` OR upper(br.fields->>'${label}') = upper(${value})` : ""}))`);
  }
  const statement = `SELECT j.city_parcel_id, j.city_objectid,
    p.fields->>'property_address' AS city_address,
    p.source_url AS city_parcel_source_url,
    r.record_id AS permit_id, r.fields->>'PermitNo' AS permit_number,
    r.published_type AS permit_type, r.published_status AS permit_status,
    r.event_date AS permit_date, r.fields->>'LegalAddress' AS published_legal_address,
    r.fields->>'Application_ID' AS published_application_id,
    r.source_url AS permit_source_url, j.match_method
    FROM search_records r
    JOIN search_record_parcels j ON j.run_id = r.run_id AND j.source_id = r.source_id
      AND j.record_id = r.record_id AND j.join_status = 'exact'
    JOIN search_records p ON p.run_id = $2 AND p.source_id = 'parcels'
      AND p.fields->>'parcel_id' = j.city_parcel_id::text
      AND p.fields->>'objectid' = j.city_objectid::text
    WHERE r.source_id = 'municity' AND r.run_id = ANY($1::bigint[])
      ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
    ORDER BY r.event_date DESC NULLS LAST, r.record_id, j.city_parcel_id
    OFFSET ${add(cursor.offset)} LIMIT ${add(limit + 1)}`;
  let rows;
  try { rows = await query(statement, values); }
  catch {
    return { criteria, items: [], next_cursor: null, complete_for_query: false,
      coverage: { index_status: "unavailable", source_checks: checks,
        note: "Indexed permit search failed; no zero result was asserted." } };
  }
  const hasMore = rows.length > limit;
  return { criteria, items: rows.slice(0, limit),
    next_cursor: hasMore ? makeSearchCursor({ v: 1, query: fingerprint(criteria),
      source: sourceHash, offset: cursor.offset + limit,
      expires: Date.now() + 30 * 60_000 }) : null,
    complete_for_query: !hasMore && allComplete,
    coverage: { index_status: allComplete ? "connected" : "partial", source_checks: checks,
      returned_this_page: Math.min(rows.length, limit),
      note: "Results include exact parcel joins from indexed types. Missing, stale, capped, or unlinked source rows keep the answer incomplete. PermitDate and PermStatus do not establish approval of a linked application or task; use get_permit_details for those fields." },
    retrieved_at: new Date().toISOString() };
}
