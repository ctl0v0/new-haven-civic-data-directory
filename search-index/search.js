import { SourceError } from "../parcel/http.js";
import { fingerprint, makeSearchCursor, readSearchCursor } from "../parcel/search-cursor.js";
import { GIS_INDEX_FIELDS } from "./arcgis.js";
import { indexConfigured, indexQuery } from "./db.js";
import { STATE_ROSTERS } from "./socrata.js";

// Only published, indexed columns may be used as cross-source predicates.
// A source can be listed here before its first validated import; readiness is
// checked against the active run on every request.
export const SEARCH_FIELDS = Object.freeze({
  parcels: GIS_INDEX_FIELDS.parcels,
  addresses: GIS_INDEX_FIELDS.addresses,
  "trash-pickup": GIS_INDEX_FIELDS["trash-pickup"],
  zoning: GIS_INDEX_FIELDS.zoning,
  wards: GIS_INDEX_FIELDS.wards,
  neighborhoods: GIS_INDEX_FIELDS.neighborhoods,
  cmt: GIS_INDEX_FIELDS.cmt,
  "ct-brownfields": GIS_INDEX_FIELDS["ct-brownfields"],
  "ct-liquor-permits": STATE_ROSTERS["ct-liquor-permits"].fields,
  "ct-child-care-licenses": STATE_ROSTERS["ct-child-care-licenses"].fields,
  "ct-cannabis-retail": STATE_ROSTERS["ct-cannabis-retail"].fields,
  "school-attendance": ["street_name", "k8_school", "high_school"],
  municity: ["Permit_ID", "Application_ID", "PermitNo", "PermitType",
    "PermStatus", "PermitDate", "PrintKey", "LegalAddress"],
});
const ADDRESS_DEPENDENT = new Set(["trash-pickup", "ct-liquor-permits",
  "ct-child-care-licenses", "ct-cannabis-retail", "school-attendance"]);
export const NUMBER_FIELDS = Object.freeze({
  parcels: ["units_commercial", "units_residential", "units_condo",
    "year_building_built", "total_land_area_acres", "price",
    "total_assessed_bldg_value", "total_assessed_bldg_xf_value",
    "total_assessed_improvements", "total_assessed_land_value",
    "total_assessed_land_outbldg", "total_assessed_extra_features",
    "total_assessed_parcel_value_x", "total_assessed_parcel_value_y"],
});

const sourceAge = () => 48 * 3600_000;
const checkedDate = (value, key) => {
  if (value == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
    throw new SourceError(`Invalid ${key}`, 400);
  return value;
};

function checkedRequirements(input) {
  if (!Array.isArray(input) || !input.length || input.length > 5)
    throw new SourceError("Provide 1–5 indexed source requirements", 400);
  return input.map((item) => {
    const sourceId = String(item?.source_id ?? "");
    if (!SEARCH_FIELDS[sourceId]) throw new SourceError(`Source ${sourceId} is not supported for indexed cross-search`, 400);
    const equals = item.equals ?? {};
    if (!equals || typeof equals !== "object" || Array.isArray(equals) ||
        Object.keys(equals).length > 5)
      throw new SourceError("Each source requirement needs at most five exact field filters", 400);
    for (const [key, value] of Object.entries(equals)) {
      if (!SEARCH_FIELDS[sourceId].includes(key) ||
          !["string", "number"].includes(typeof value) ||
          !String(value).trim() || String(value).length > 160)
        throw new SourceError(`Unsupported ${sourceId} exact field filter`, 400);
    }
    const ranges = {};
    for (const operator of ["number_gte", "number_lte"]) {
      const values = item[operator] ?? {};
      if (!values || typeof values !== "object" || Array.isArray(values) ||
          Object.keys(values).length > 5)
        throw new SourceError(`Invalid ${operator} filters`, 400);
      for (const [key, value] of Object.entries(values))
        if (!NUMBER_FIELDS[sourceId]?.includes(key) || typeof value !== "number" ||
            !Number.isFinite(value))
          throw new SourceError(`Unsupported ${sourceId} numeric field filter`, 400);
      ranges[operator] = Object.fromEntries(Object.entries(values).sort());
    }
    for (const key of Object.keys(ranges.number_gte))
      if (key in ranges.number_lte && ranges.number_gte[key] > ranges.number_lte[key])
        throw new SourceError(`Reversed ${sourceId} numeric range`, 400);
    const eventDateFrom = checkedDate(item.event_date_from, "event_date_from");
    const eventDateTo = checkedDate(item.event_date_to, "event_date_to");
    if (eventDateFrom && eventDateTo && eventDateFrom > eventDateTo)
      throw new SourceError("Event date range is reversed", 400);
    return { source_id: sourceId, equals: Object.fromEntries(Object.entries(equals).sort()),
      ...ranges,
      event_date_from: eventDateFrom, event_date_to: eventDateTo };
  });
}

function conditions(requirement, alias, add) {
  const parts = [];
  for (const [field, value] of Object.entries(requirement.equals)) {
    const fieldRef = add(field), valueRef = add(String(value).trim());
    parts.push(`upper(trim(${alias}.fields->>${fieldRef})) = upper(${valueRef})`);
  }
  for (const [operator, sign] of [["number_gte", ">="], ["number_lte", "<="]])
    for (const [field, value] of Object.entries(requirement[operator] ?? {})) {
      const fieldRef = add(field), valueRef = add(value);
      parts.push(`(CASE WHEN jsonb_typeof(${alias}.fields->${fieldRef}) = 'number'
        THEN (${alias}.fields->>${fieldRef})::numeric END) ${sign} ${valueRef}::numeric`);
    }
  if (requirement.event_date_from) parts.push(`${alias}.event_date >= ${add(requirement.event_date_from)}::date`);
  if (requirement.event_date_to) parts.push(`${alias}.event_date <= ${add(requirement.event_date_to)}::date`);
  return parts;
}

export function buildIndexedSearchQuery(requirements, runs, offset, limit) {
  const values = [];
  const add = (value) => { values.push(value); return `$${values.length}`; };
  const parcelRun = add(runs.parcels);
  const checks = requirements.map((requirement) => {
    const sourceRun = add(runs[requirement.source_id]);
    const filters = conditions(requirement, "r", add);
    return `EXISTS (SELECT 1 FROM search_record_parcels j
      JOIN search_records r ON r.run_id = j.run_id AND r.source_id = j.source_id
        AND r.record_id = j.record_id
      WHERE j.run_id = ${sourceRun} AND j.source_id = ${add(requirement.source_id)}
        AND j.city_parcel_id = (p.fields->>'parcel_id')::bigint
        AND j.city_objectid = (p.fields->>'objectid')::bigint
        AND j.join_status = 'exact'${filters.length ? ` AND ${filters.join(" AND ")}` : ""})`;
  });
  // A source can have several matching records. The result is one parcel,
  // with one official record link per requirement and an exact match count.
  const evidence = requirements.map((requirement) => {
    const sourceRun = add(runs[requirement.source_id]);
    const filters = conditions(requirement, "r", add);
    return `(SELECT jsonb_build_object('source_id', ${add(requirement.source_id)}::text,
      'matching_record_count', count(DISTINCT r.record_id),
      'example_record', (jsonb_agg(jsonb_build_object(
        'record_id', r.record_id, 'source_url', r.source_url,
        'published_type', r.published_type, 'published_status', r.published_status,
        'event_date', r.event_date,
        'city_address_objectid', j.city_address_objectid)
        ORDER BY r.record_id, j.city_address_objectid)->0))
      FROM search_record_parcels j JOIN search_records r
        ON r.run_id = j.run_id AND r.source_id = j.source_id AND r.record_id = j.record_id
      WHERE j.run_id = ${sourceRun} AND j.source_id = ${add(requirement.source_id)}
        AND j.city_parcel_id = (p.fields->>'parcel_id')::bigint
        AND j.city_objectid = (p.fields->>'objectid')::bigint
        AND j.join_status = 'exact'${filters.length ? ` AND ${filters.join(" AND ")}` : ""})`;
  });
  const query = `SELECT (p.fields->>'parcel_id')::bigint AS city_parcel_id,
    (p.fields->>'objectid')::bigint AS city_objectid,
    p.fields->>'property_address' AS city_address,
    p.source_url AS city_parcel_source_url,
    jsonb_build_array(${evidence.join(", ")}) AS matching_sources
    FROM search_records p WHERE p.run_id = ${parcelRun} AND p.source_id = 'parcels'
      AND ${checks.join(" AND ")}
    ORDER BY (p.fields->>'parcel_id')::bigint, (p.fields->>'objectid')::bigint
    OFFSET ${add(offset)} LIMIT ${add(limit + 1)}`;
  return { query, values };
}

export async function searchIndexedParcels(input = {}, { query = indexQuery } = {}) {
  const requirements = checkedRequirements(input.requirements);
  const municipalRequirements = requirements.filter((item) => item.source_id === "municity");
  if (municipalRequirements.length > 1)
    throw new SourceError("Use one exact municipal permit type requirement per cross-source query", 400);
  const municipalType = municipalRequirements[0]?.equals?.PermitType;
  if (municipalRequirements.length && (typeof municipalType !== "string" ||
      !municipalType.trim() || municipalType.length > 100))
    throw new SourceError("Municipal cross-source search requires exact PermitType", 400);
  const municipalScope = municipalType ? `permit-type:${municipalType.trim().toUpperCase()}` : null;
  const limit = input.limit == null ? 25 : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new SourceError("limit must be 1–100", 400);
  const requiredSources = [...new Set(["parcels", ...requirements.map((item) => item.source_id),
    ...(requirements.some((item) => ADDRESS_DEPENDENT.has(item.source_id)) ? ["addresses"] : [])])];
  const criteria = { requirements };
  if (!indexConfigured()) return { criteria, items: [], next_cursor: null,
    complete_for_query: false, coverage: { index_status: "unconfigured",
      source_checks: requiredSources.map((source_id) => ({ source_id, status: "unconfigured" })) } };
  let active;
  try {
    active = await query(`SELECT a.source_id, a.scope_key, r.id AS run_id, r.status, r.finished_at,
      r.expected_count, r.returned_count, r.ambiguous_count, r.unlinked_count, r.warning,
      last.status AS latest_attempt_status
      FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
      LEFT JOIN LATERAL (SELECT status FROM search_source_runs
        WHERE source_id = a.source_id AND scope_key = a.scope_key
        ORDER BY started_at DESC, id DESC LIMIT 1) last ON true
      WHERE (a.scope_key = 'all' AND a.source_id = ANY($1::text[]))
        OR (a.source_id = 'municity' AND a.scope_key = $2)`, [requiredSources, municipalScope]);
  } catch {
    return { criteria, items: [], next_cursor: null, complete_for_query: false,
      coverage: { index_status: "unavailable", source_checks: requiredSources.map((source_id) =>
        ({ source_id, status: "unavailable" })) } };
  }
  const byId = new Map(active.filter((row) => row.scope_key === "all")
    .map((row) => [row.source_id, row]));
  if (municipalScope) {
    const municipal = active.find((row) => row.source_id === "municity" &&
      row.scope_key === municipalScope);
    if (municipal) byId.set("municity", municipal);
  }
  const sourceChecks = requiredSources.map((source_id) => {
    const run = byId.get(source_id);
    if (!run) return { source_id, status: "not_indexed" };
    const fresh = Number.isFinite(Date.parse(run.finished_at)) &&
      Date.now() - Date.parse(run.finished_at) <= sourceAge(source_id);
    const complete = run.status === "complete" && fresh && run.latest_attempt_status !== "failed" &&
      Number(run.expected_count) === Number(run.returned_count) &&
      Number(run.ambiguous_count) === 0 && Number(run.unlinked_count) === 0;
    return { source_id, ...(source_id === "municity" ? { scope_key: municipalScope } : {}),
      status: complete ? "complete" : "partial",
      run_id: Number(run.run_id), fresh, expected_count: Number(run.expected_count),
      returned_count: Number(run.returned_count), ambiguous_count: Number(run.ambiguous_count),
      unlinked_count: Number(run.unlinked_count), finished_at: run.finished_at,
      warning: run.warning ?? null };
  });
  if (sourceChecks.some((check) => check.status === "not_indexed"))
    return { criteria, items: [], next_cursor: null, complete_for_query: false,
      coverage: { index_status: "partial", source_checks: sourceChecks,
        note: "A required source has no validated indexed run. No cross-source result was asserted." } };
  const allComplete = sourceChecks.every((check) => check.status === "complete");
  const runs = Object.fromEntries(sourceChecks.map((check) => [check.source_id, check.run_id]));
  const sourceHash = fingerprint(runs);
  const cursor = readSearchCursor(input.cursor, fingerprint(criteria), sourceHash);
  const { query: statement, values } = buildIndexedSearchQuery(requirements, runs, cursor.offset, limit);
  let rows;
  try { rows = await query(statement, values); }
  catch {
    return { criteria, items: [], next_cursor: null, complete_for_query: false,
      coverage: { index_status: "unavailable", source_checks: sourceChecks,
        note: "The indexed search query failed; no zero result was asserted." } };
  }
  const hasMore = rows.length > limit;
  const nextCursor = hasMore ? makeSearchCursor({ v: 1, query: fingerprint(criteria),
    source: sourceHash, offset: cursor.offset + limit, expires: Date.now() + 30 * 60_000 }) : null;
  return { criteria, items: rows.slice(0, limit), next_cursor: nextCursor,
    complete_for_query: !hasMore && allComplete, coverage: { index_status: allComplete ? "connected" : "partial",
      source_checks: sourceChecks, returned_this_page: Math.min(rows.length, limit),
      scanned_through: cursor.offset + Math.min(rows.length, limit),
      note: "Results are parcels with exact published indexed-source joins. A stale or incomplete source leaves the answer incomplete, including a zero-row page. Matching counts and source links are published evidence; the index does not infer vacancies or current occupancy." },
    retrieved_at: new Date().toISOString() };
}

// Page source records and their exact City parcel links. This is the drilldown
// for a cross-source match; source rows with no verified parcel join remain in
// coverage rather than being assigned to a parcel by address similarity.
export async function searchIndexedRecords(input = {}, { query = indexQuery } = {}) {
  const requirement = checkedRequirements([input])[0];
  const sourceId = requirement.source_id;
  const permitType = requirement.equals.PermitType;
  if (sourceId === "municity" &&
      (typeof permitType !== "string" || !permitType.trim() || permitType.length > 100))
    throw new SourceError("Municipal record search requires exact PermitType", 400);
  const municipalScope = sourceId === "municity"
    ? `permit-type:${permitType.trim().toUpperCase()}` : null;
  const parcelId = input.city_parcel_id == null ? null : String(input.city_parcel_id);
  const objectId = input.city_objectid == null ? null : String(input.city_objectid);
  if ((parcelId == null) !== (objectId == null) ||
      (parcelId != null && (!/^\d{1,12}$/.test(parcelId) || !/^\d{1,12}$/.test(objectId))))
    throw new SourceError("Provide both City parcel ID and object ID, or neither", 400);
  const limit = input.limit == null ? 25 : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new SourceError("limit must be 1–50", 400);
  const requiredSources = [...new Set(["parcels", sourceId,
    ...(ADDRESS_DEPENDENT.has(sourceId) ? ["addresses"] : [])])];
  const criteria = { ...requirement, city_parcel_id: parcelId,
    city_objectid: objectId };
  if (!indexConfigured()) return { criteria, items: [], next_cursor: null,
    complete_for_query: false, coverage: { index_status: "unconfigured",
      source_checks: requiredSources.map((source_id) => ({ source_id, status: "unconfigured" })) } };
  let active;
  try {
    active = await query(`SELECT a.source_id, a.scope_key, r.id AS run_id, r.status,
      r.finished_at, r.expected_count, r.returned_count,
      r.ambiguous_count, r.unlinked_count, r.warning,
      last.status AS latest_attempt_status
      FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
      LEFT JOIN LATERAL (SELECT status FROM search_source_runs
        WHERE source_id = a.source_id AND scope_key = a.scope_key
        ORDER BY started_at DESC, id DESC LIMIT 1) last ON true
      WHERE (a.scope_key = 'all' AND a.source_id = ANY($1::text[]))
        OR (a.source_id = 'municity' AND a.scope_key = $2)`,
    [requiredSources, municipalScope]);
  } catch {
    return { criteria, items: [], next_cursor: null, complete_for_query: false,
      coverage: { index_status: "unavailable", source_checks: requiredSources.map((source_id) =>
        ({ source_id, status: "unavailable" })) } };
  }
  const byId = new Map(active.filter((row) => row.scope_key === "all")
    .map((row) => [row.source_id, row]));
  if (municipalScope) {
    const municipal = active.find((row) => row.source_id === "municity" &&
      row.scope_key === municipalScope);
    if (municipal) byId.set("municity", municipal);
  }
  const sourceChecks = requiredSources.map((source_id) => {
    const run = byId.get(source_id);
    if (!run) return { source_id, status: "not_indexed" };
    const fresh = Number.isFinite(Date.parse(run.finished_at)) &&
      Date.now() - Date.parse(run.finished_at) <= sourceAge(source_id);
    const complete = run.status === "complete" && fresh &&
      run.latest_attempt_status !== "failed" &&
      Number(run.expected_count) === Number(run.returned_count) &&
      Number(run.ambiguous_count) === 0 && Number(run.unlinked_count) === 0;
    return { source_id, ...(source_id === "municity" ? { scope_key: municipalScope } : {}),
      status: complete ? "complete" : "partial", run_id: Number(run.run_id),
      fresh, expected_count: Number(run.expected_count),
      returned_count: Number(run.returned_count),
      ambiguous_count: Number(run.ambiguous_count),
      unlinked_count: Number(run.unlinked_count), finished_at: run.finished_at,
      warning: run.warning ?? null };
  });
  if (sourceChecks.some((check) => check.status === "not_indexed"))
    return { criteria, items: [], next_cursor: null, complete_for_query: false,
      coverage: { index_status: "partial", source_checks: sourceChecks,
        note: "A required source has no validated indexed run. No matching record was asserted." } };
  const allComplete = sourceChecks.every((check) => check.status === "complete");
  const runs = Object.fromEntries(sourceChecks.map((check) => [check.source_id, check.run_id]));
  const sourceHash = fingerprint(runs);
  const cursor = readSearchCursor(input.cursor, fingerprint(criteria), sourceHash);
  const values = [];
  const add = (value) => { values.push(value); return `$${values.length}`; };
  const recordRun = add(runs[sourceId]);
  const sourceRef = add(sourceId);
  const filters = conditions(requirement, "r", add);
  if (parcelId != null) {
    filters.push(`j.city_parcel_id = ${add(parcelId)}::bigint`);
    filters.push(`j.city_objectid = ${add(objectId)}::bigint`);
  }
  const parcelRun = add(runs.parcels);
  const statement = `WITH page AS MATERIALIZED (
    SELECT DISTINCT r.record_id, r.event_date, j.city_parcel_id, j.city_objectid
    FROM search_records r JOIN search_record_parcels j
      ON j.run_id = r.run_id AND j.source_id = r.source_id AND j.record_id = r.record_id
    WHERE r.run_id = ${recordRun} AND r.source_id = ${sourceRef}
      AND j.join_status = 'exact'${filters.length ? ` AND ${filters.join(" AND ")}` : ""}
    ORDER BY r.event_date DESC NULLS LAST, r.record_id,
      j.city_parcel_id, j.city_objectid
    OFFSET ${add(cursor.offset)} LIMIT ${add(limit + 1)}
  ) SELECT page.city_parcel_id, page.city_objectid,
    p.fields->>'property_address' AS city_address,
    p.source_url AS city_parcel_source_url,
    r.source_id, r.record_id, r.source_url, r.published_type, r.published_status,
    r.event_date, r.fields,
    links.city_address_objectids, links.match_methods
    FROM page JOIN search_records r ON r.run_id = ${recordRun}
      AND r.source_id = ${sourceRef} AND r.record_id = page.record_id
    JOIN search_records p ON p.run_id = ${parcelRun} AND p.source_id = 'parcels'
      AND p.fields->>'parcel_id' = page.city_parcel_id::text
      AND p.fields->>'objectid' = page.city_objectid::text
    LEFT JOIN LATERAL (
      SELECT array_agg(DISTINCT j.city_address_objectid)
        FILTER (WHERE j.city_address_objectid IS NOT NULL) AS city_address_objectids,
        array_agg(DISTINCT j.match_method) AS match_methods
      FROM search_record_parcels j WHERE j.run_id = ${recordRun}
        AND j.source_id = ${sourceRef} AND j.record_id = page.record_id
        AND j.city_parcel_id = page.city_parcel_id
        AND j.city_objectid = page.city_objectid AND j.join_status = 'exact'
    ) links ON true
    ORDER BY page.event_date DESC NULLS LAST, page.record_id,
      page.city_parcel_id, page.city_objectid`;
  let rows;
  try { rows = await query(statement, values); }
  catch {
    return { criteria, items: [], next_cursor: null, complete_for_query: false,
      coverage: { index_status: "unavailable", source_checks: sourceChecks,
        note: "Indexed record search failed; no zero result was asserted." } };
  }
  const hasMore = rows.length > limit;
  return { criteria, items: rows.slice(0, limit),
    next_cursor: hasMore ? makeSearchCursor({ v: 1, query: fingerprint(criteria),
      source: sourceHash, offset: cursor.offset + limit,
      expires: Date.now() + 30 * 60_000 }) : null,
    complete_for_query: !hasMore && allComplete,
    coverage: { index_status: allComplete ? "connected" : "partial",
      source_checks: sourceChecks, returned_this_page: Math.min(rows.length, limit),
      note: "Only exact City parcel links are returned. Ambiguous and unlinked source rows remain coverage gaps. Source fields and dates are published values, not current occupancy or activity claims." },
    retrieved_at: new Date().toISOString() };
}
