import { SourceError } from "../parcel/http.js";
import { fingerprint, makeSearchCursor, readSearchCursor } from "../parcel/search-cursor.js";
import { indexConfigured, indexQuery } from "./db.js";
import { dateOnly, permitSearchDate } from "./permits.js";
import { PERMIT_ACTIVITY_KINDS, PERMIT_ACTIVITY_SOURCE, PERMIT_ACTIVITY_TYPES } from "./permit-activity-source.js";
import { RECENT_PERMIT_WINDOWS } from "./municity.js";

const exact = (value, field, max = 100) => {
  if (value == null) return null;
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > max || /[\x00-\x1f]/.test(text)) throw new SourceError(`Invalid ${field}`, 400);
  return text.toUpperCase();
};

export async function searchIndexedPermitActivity(input = {}, { query = indexQuery } = {}) {
  const kind = input.activity_kind;
  if (!Object.hasOwn(PERMIT_ACTIVITY_KINDS, kind))
    throw new SourceError("Choose application, review, or inspection", 400);
  const type = exact(input.permit_type, "permit_type");
  if (!PERMIT_ACTIVITY_TYPES.some((value) => value.toUpperCase() === type))
    throw new SourceError(`This activity search covers ${PERMIT_ACTIVITY_TYPES.join(" and ")} permits`, 400);
  const criteria = { activity_kind: kind, permit_type: type,
    permit_status: exact(input.permit_status, "permit_status"),
    activity_type: exact(input.activity_type, "activity_type"),
    activity_status: exact(input.activity_status, "activity_status"),
    neighborhood: exact(input.neighborhood, "neighborhood", 80) };
  for (const name of ["permit_id", "city_parcel_id"]) {
    const value = input[name] == null ? null : String(input[name]);
    if (value != null && !/^[1-9]\d{0,11}$/.test(value)) throw new SourceError(`Invalid ${name}`, 400);
    criteria[name] = value;
  }
  for (const prefix of ["permit_date", "activity_date"]) {
    const from = `${prefix}_from`, to = `${prefix}_to`;
    criteria[from] = permitSearchDate(input[from], from);
    criteria[to] = permitSearchDate(input[to], to);
    if (criteria[from] && criteria[to] && criteria[from] > criteria[to])
      throw new SourceError(`Invalid ${prefix} range`, 400);
  }
  const limit = input.limit == null ? 25 : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new SourceError("limit must be 1–50", 400);
  const empty = (index_status, note) => ({ criteria, items: [], next_cursor: null,
    complete_for_query: false, coverage: { index_status, note } });
  if (!indexConfigured()) return empty("unconfigured", "The parcel search index is disconnected.");
  const wanted = [PERMIT_ACTIVITY_SOURCE, "parcels", ...(criteria.neighborhood ? ["neighborhoods"] : []), "municity"];
  const parentScope = RECENT_PERMIT_WINDOWS.find(({ days }) => days === 90).scope_key;
  let runs;
  try {
    runs = await query(`SELECT a.source_id, r.id AS run_id, r.status, r.finished_at, r.warning,
      r.coverage_date_from, r.coverage_date_to, to_jsonb(r)->'metadata' AS metadata,
      last.status AS latest_attempt_status
      FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
      LEFT JOIN LATERAL (SELECT status FROM search_source_runs
        WHERE source_id = a.source_id AND scope_key = a.scope_key
        ORDER BY started_at DESC, id DESC LIMIT 1) last ON true
      WHERE a.source_id = ANY($1::text[]) AND a.scope_key IN ('all', $2)`, [wanted, parentScope]);
  } catch { return empty("unavailable", "The activity index could not be checked."); }
  const active = Object.fromEntries(runs.map((run) => [run.source_id, run]));
  if (wanted.some((name) => !active[name]))
    return empty("partial", "An activity run or its parcel, permit, or requested City boundary source is absent.");
  const run = active[PERMIT_ACTIVITY_SOURCE];
  const bounds = { from: dateOnly(run.coverage_date_from), to: dateOnly(run.coverage_date_to) };
  const cohort = run.metadata?.by_type?.[type];
  const current = wanted.every((name) =>
    Date.now() - Date.parse(active[name].finished_at) <= 48 * 3600_000 &&
    active[name].latest_attempt_status === active[name].status &&
    (name === PERMIT_ACTIVITY_SOURCE || active[name].status === "complete")) &&
    Number(active.municity.run_id) === Number(run.metadata?.parent_run_id);
  const dateCovered = (!criteria.permit_date_from || criteria.permit_date_from >= bounds.from) &&
    (!criteria.permit_date_to || criteria.permit_date_to <= bounds.to) &&
    !criteria.activity_date_from && !criteria.activity_date_to;
  const complete = Boolean(cohort && cohort.parcel_link_gaps && current && dateCovered &&
    cohort.gaps[kind] === 0 && Object.values(cohort.parcel_link_gaps).every((count) => count === 0));
  const qHash = fingerprint(criteria);
  const sHash = fingerprint(wanted.map((source) => active[source].run_id));
  const { offset } = readSearchCursor(input.cursor, qHash, sHash);
  const values = [run.run_id, active.parcels.run_id, kind, type];
  const add = (value) => { values.push(value); return `$${values.length}`; };
  const filters = [];
  for (const [field, column] of Object.entries({ permit_status: "r.fields->>'permit_status'",
    activity_type: "r.published_type", activity_status: "r.published_status" })) {
    if (criteria[field]) filters.push(`upper(trim(${column})) = ${add(criteria[field])}`);
  }
  for (const [field, column] of Object.entries({ permit_id: "r.fields->>'permit_id'",
    city_parcel_id: "j.city_parcel_id::text" })) {
    if (criteria[field]) filters.push(`${column} = ${add(criteria[field])}`);
  }
  for (const [field, column] of Object.entries({ permit_date: "(r.fields->>'permit_date')::date",
    activity_date: "r.event_date" })) {
    if (criteria[`${field}_from`]) filters.push(`${column} >= ${add(criteria[`${field}_from`])}::date`);
    if (criteria[`${field}_to`]) filters.push(`${column} <= ${add(criteria[`${field}_to`])}::date`);
  }
  if (criteria.neighborhood) {
    const boundary = add(active.neighborhoods.run_id);
    const name = add(criteria.neighborhood);
    filters.push(`EXISTS (SELECT 1 FROM search_record_parcels b
      JOIN search_records n USING (run_id, source_id, record_id)
      WHERE b.run_id = ${boundary} AND b.source_id = 'neighborhoods' AND b.join_status = 'exact'
        AND b.city_parcel_id = j.city_parcel_id AND b.city_objectid = j.city_objectid
        AND ${name} IN (upper(n.fields->>'neighborhood'), upper(n.fields->>'neighborhood_label')))`);
  }
  try {
    const rows = await query(`SELECT j.city_parcel_id, j.city_objectid,
      p.fields->>'property_address' AS city_address, p.source_url AS city_parcel_source_url,
      r.record_id, r.source_url, r.published_type AS activity_type,
      r.published_status AS activity_status, r.event_date AS activity_date,
      r.fields, j.match_method
      FROM search_records r JOIN search_record_parcels j USING (run_id, source_id, record_id)
      JOIN search_records p ON p.run_id = $2 AND p.source_id = 'parcels'
        AND p.fields->>'parcel_id' = j.city_parcel_id::text AND p.fields->>'objectid' = j.city_objectid::text
      WHERE r.run_id = $1 AND r.source_id = '${PERMIT_ACTIVITY_SOURCE}' AND j.join_status = 'exact'
        AND r.fields->>'activity_kind' = $3 AND upper(trim(r.fields->>'permit_type')) = $4
        ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
      ORDER BY r.event_date DESC NULLS LAST, r.record_id, j.city_parcel_id
      OFFSET ${add(offset)} LIMIT ${add(limit + 1)}`, values);
    const hasMore = rows.length > limit;
    return { criteria, items: rows.slice(0, limit), complete_for_query: complete && !hasMore,
      next_cursor: hasMore ? makeSearchCursor({ v: 1, query: qHash, source: sHash,
        offset: offset + limit, expires: Date.now() + 30 * 60_000 }) : null,
      coverage: { index_status: complete ? "connected" : "partial", run_id: Number(run.run_id),
        parent_permit_run_id: run.metadata?.parent_run_id, last_refresh: run.finished_at,
        permit_date_from: bounds.from, permit_date_to: bounds.to,
        activity_date_field: PERMIT_ACTIVITY_KINDS[kind].date, type_inventory: cohort ?? null,
        note: "Activity is enumerated from linked permits in the published PermitDate window. Older permits may have activity within a requested activity-date range." } };
  } catch { return empty("unavailable", "The parcel activity query failed."); }
}
