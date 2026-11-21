import { SourceError } from "../parcel/http.js";
import { normalizeAddress } from "../parcel/resolve.js";
import { withTrashPickupDayName } from "../parcel/trash-pickup-days.js";
import { fingerprint, makeSearchCursor, readSearchCursor } from "../parcel/search-cursor.js";
import { GIS_INDEX_FIELDS } from "./arcgis.js";
import { indexConfigured, indexQuery } from "./db.js";
import { registryJoinIsCurrent, STATE_ADDRESS_SOURCES } from "./socrata.js";
import { businessAddress, REGISTRATION_SOURCE } from "../parcel/business-registrations.js";
import { recentPermitRun, RECENT_PERMIT_SCOPES } from "./municity.js";
import { MUNICIPAL_LICENSE_FIELDS, MUNICIPAL_LICENSE_SOURCE } from "./municipal-licenses.js";
import { filteredPermitLinkGaps } from "./parcel-only-permits.js";
import { PERMIT_ACTIVITY_SOURCE } from "./permit-activity-source.js";

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
  "managed-lots": GIS_INDEX_FIELDS["managed-lots"],
  ...Object.fromEntries(Object.entries(STATE_ADDRESS_SOURCES).map(([id, { fields }]) => [id, fields])),
  [MUNICIPAL_LICENSE_SOURCE]: MUNICIPAL_LICENSE_FIELDS,
  "school-attendance": ["street_name", "k8_school", "high_school"],
  municity: ["Permit_ID", "Application_ID", "PermitNo", "PermitType",
    "PermStatus", "PermitDate", "Parcel_ID", "PrintKey", "PrintKey_Parcel",
    "LegalAddress"],
});
// The unified query contract checks the activity cohort and date semantics
// before passing this physical index source to the shared SQL.
export const PARCEL_QUERY_FIELDS = Object.freeze({ ...SEARCH_FIELDS,
  [PERMIT_ACTIVITY_SOURCE]: ["activity_kind", "permit_type", "permit_status", "permit_number",
    "permit_id", "application_id", "Application_ID", "ApplicationType",
    "PermitApplicationStatus", "ApplicationStatus", "ApplicationNumber", "Department",
    "Task_ID", "TaskType", "ApprovalStatus", "Inspection_ID", "InspType", "Status", "Results"],
});
const ADDRESS_DEPENDENT = new Set(["trash-pickup", ...Object.keys(STATE_ADDRESS_SOURCES),
  "school-attendance", MUNICIPAL_LICENSE_SOURCE]);
const DATE_ORDERED_BUSINESS = new Set([MUNICIPAL_LICENSE_SOURCE, ...Object.keys(STATE_ADDRESS_SOURCES)]);
const ONE_OF_FIELDS = Object.freeze({ parcels: ["use_code"] });
export const NUMBER_FIELDS = Object.freeze({
  parcels: ["units_commercial", "units_residential", "units_condo",
    "year_building_built", "total_land_area_acres", "price",
    "total_assessed_bldg_value", "total_assessed_bldg_xf_value",
    "total_assessed_improvements", "total_assessed_land_value",
    "total_assessed_land_outbldg", "total_assessed_extra_features",
    "total_assessed_parcel_value_x", "total_assessed_parcel_value_y"],
});

const sourceAge = () => 48 * 3600_000;
const dateOnly = (value) => value instanceof Date ? value.toISOString().slice(0, 10)
  : String(value ?? "").slice(0, 10);
function dateCoverage(run, requirement) {
  if ((requirement?.event_date_from || requirement?.event_date_to) &&
      (run.metadata?.named_licenses_without_issue_date || run.metadata?.without_filing_date)) return false;
  if (!run.coverage_date_from && !run.coverage_date_to) return true;
  return Boolean(requirement?.event_date_from && requirement?.event_date_to &&
    requirement.event_date_from >= dateOnly(run.coverage_date_from) &&
    requirement.event_date_to <= dateOnly(run.coverage_date_to));
}

function verifiedRegistrationUnit(row, point, unit) {
  return `${row}.fields->>'normalized_business_unit' = ${unit}
    AND upper(regexp_replace(trim(${point}.fields->>'unit'), '^(SUITE|STE[.]?|UNIT|APT[.]?|APARTMENT)[[:space:]]+|^#[[:space:]]*', '', 'i')) = ${unit}`;
}
async function missingAttempt(sourceId, scopeKey, query) {
  if (!scopeKey) return null;
  try {
    const rows = await query(`SELECT status, warning, started_at
      FROM search_source_runs WHERE scope_key = $1 AND source_id = $2
      ORDER BY started_at DESC, id DESC LIMIT 1`, [scopeKey, sourceId]);
    const latest = rows[0];
    return latest ? {
      latest_attempt_status: latest.status === "failed" &&
        /^MUNICIPAL_(?:TYPE_CAP|LICENSE_UNVERIFIED):/.test(latest.warning ?? "") ? "blocked" : latest.status,
      latest_attempt_warning: latest.warning ?? null,
      latest_attempt_started_at: latest.started_at,
    } : null;
  } catch { return null; }
}
const checkedDate = (value, key) => {
  if (value == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
    throw new SourceError(`Invalid ${key}`, 400);
  return value;
};

function checkedRequirements(input, fields = SEARCH_FIELDS) {
  if (!Array.isArray(input) || !input.length || input.length > 5)
    throw new SourceError("Provide 1–5 indexed source requirements", 400);
  return input.map((item) => {
    const sourceId = String(item?.source_id ?? "");
    if (!Object.hasOwn(fields, sourceId)) throw new SourceError(`Source ${sourceId} is not supported for indexed cross-search`, 400);
    const equals = item.equals ?? {};
    if (!equals || typeof equals !== "object" || Array.isArray(equals) ||
        Object.keys(equals).length > 5)
      throw new SourceError("Each source requirement needs at most five exact field filters", 400);
    for (const [key, value] of Object.entries(equals)) {
      if (!fields[sourceId].includes(key) ||
          !["string", "number"].includes(typeof value) ||
          !String(value).trim() || String(value).length > 160)
        throw new SourceError(`Unsupported ${sourceId} exact field filter`, 400);
    }
    const oneOf = item.one_of ?? {};
    if (!oneOf || typeof oneOf !== "object" || Array.isArray(oneOf) ||
        Object.keys(oneOf).length > 1)
      throw new SourceError("Invalid one_of filter", 400);
    for (const [key, values] of Object.entries(oneOf)) {
      const permitTypes = sourceId === "municity" && key === "PermitType" && fields === PARCEL_QUERY_FIELDS;
      if ((!permitTypes && !ONE_OF_FIELDS[sourceId]?.includes(key)) || key in equals ||
          !Array.isArray(values) || !values.length || values.length > 250 ||
          values.some((value) => typeof value !== "string" || !value.trim() || value.length > (permitTypes ? 100 : 40)))
        throw new SourceError(`Unsupported ${sourceId} one_of filter`, 400);
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
    const permitGroup = item.permit_group == null ? null : String(item.permit_group).trim();
    if (item.permit_group != null &&
        (typeof item.permit_group !== "string" || !permitGroup ||
         sourceId !== "municity" || permitGroup.length > 100 ||
         /[\x00-\x1f]/.test(permitGroup)))
      throw new SourceError("Permit group is only valid for municipal records", 400);
    return { source_id: sourceId, equals: Object.fromEntries(Object.entries(equals).sort()),
      one_of: Object.fromEntries(Object.entries(oneOf).map(([key, values]) =>
        [key, [...new Set(values.map((value) => value.trim().toUpperCase()))].sort()])),
      ...ranges,
      event_date_from: eventDateFrom, event_date_to: eventDateTo,
      permit_group: permitGroup };
  });
}

function conditions(requirement, alias, add) {
  const parts = [];
  for (const [field, value] of Object.entries(requirement.equals)) {
    const fieldRef = add(field), valueRef = add(String(value).trim());
    parts.push(`upper(trim(${alias}.fields->>${fieldRef})) = upper(${valueRef})`);
  }
  for (const [field, values] of Object.entries(requirement.one_of ?? {})) {
    const fieldRef = add(field), valuesRef = add(values);
    parts.push(`upper(trim(${alias}.fields->>${fieldRef})) = ANY(${valuesRef}::text[])`);
  }
  for (const [operator, sign] of [["number_gte", ">="], ["number_lte", "<="]])
    for (const [field, value] of Object.entries(requirement[operator] ?? {})) {
      const fieldRef = add(field), valueRef = add(value);
      parts.push(`(CASE
        WHEN jsonb_typeof(${alias}.fields->${fieldRef}) = 'number'
          THEN (${alias}.fields->>${fieldRef})::numeric
        WHEN jsonb_typeof(${alias}.fields->${fieldRef}) = 'string'
          AND trim(${alias}.fields->>${fieldRef}) ~ '^[-+]?[0-9]+([.][0-9]+)?$'
          THEN trim(${alias}.fields->>${fieldRef})::numeric
        END) ${sign} ${valueRef}::numeric`);
    }
  if (requirement.event_date_from) parts.push(`${alias}.event_date >= ${add(requirement.event_date_from)}::date`);
  if (requirement.event_date_to) parts.push(`${alias}.event_date <= ${add(requirement.event_date_to)}::date`);
  return parts;
}

export function buildIndexedSearchQuery(requirements, runs, offset, limit, projection = null) {
  const values = [];
  const add = (value) => { values.push(value); return `$${values.length}`; };
  const parcelRun = add(runs.parcels);
  const permitRequirement = requirements.find(({ source_id }) => source_id === "municity");
  const activityRequirement = requirements.find(({ source_id }) => source_id === PERMIT_ACTIVITY_SOURCE);
  const permitTypes = permitRequirement?.permit_group && projection?.permit_types;
  const runCondition = (column, sourceId) => Array.isArray(runs[sourceId])
    ? `${column} = ANY(${add(runs[sourceId])}::bigint[])` : `${column} = ${add(runs[sourceId])}`;
  function sourceConditions(requirement, alias) {
    const filters = conditions(requirement, alias, add);
    if (requirement.source_id === "municity") {
      if (permitTypes?.length) filters.push(`upper(trim(${alias}.published_type)) = ANY(${add(permitTypes)}::text[])`);
      if (Array.isArray(runs.municity) && runs.municity.length > 1) {
        // A permit can be recategorized between type refreshes. Read its latest retained copy once.
        filters.push(`NOT EXISTS (SELECT 1 FROM search_records newer WHERE ${runCondition("newer.run_id", "municity")}
          AND newer.source_id = 'municity' AND newer.record_id = ${alias}.record_id AND newer.run_id > ${alias}.run_id)`);
      }
    }
    return filters;
  }
  function rowConditions(requirement, alias) {
    const filters = sourceConditions(requirement, alias);
    if (requirement.source_id === REGISTRATION_SOURCE && projection?.registration_address) {
      const { address, unit } = projection.registration_address;
      filters.push(`${alias}.fields->>'normalized_site_address' = ${add(address)}`);
      if (unit) filters.push(`EXISTS (SELECT 1 FROM search_records a
        WHERE a.run_id = ${add(runs.addresses)} AND a.source_id = 'addresses'
          AND a.record_id = j.city_address_objectid::text AND ${verifiedRegistrationUnit(alias, "a", add(unit))})`);
    }
    if (!projection || !permitRequirement || !activityRequirement ||
        !["municity", PERMIT_ACTIVITY_SOURCE].includes(requirement.source_id)) return filters;
    const isPermit = requirement.source_id === "municity";
    const related = isPermit ? activityRequirement : permitRequirement;
    const relatedFilters = sourceConditions(related, "related");
    filters.push(`EXISTS (SELECT 1 FROM search_records related
      JOIN search_record_parcels link USING (run_id, source_id, record_id)
      WHERE ${runCondition("related.run_id", related.source_id)} AND related.source_id = ${add(related.source_id)}
        AND link.city_parcel_id = (p.fields->>'parcel_id')::bigint
        AND link.city_objectid = (p.fields->>'objectid')::bigint AND link.join_status = 'exact'
        AND ${isPermit ? `related.fields->>'permit_id' = ${alias}.record_id`
          : `related.record_id = ${alias}.fields->>'permit_id'`}
        ${relatedFilters.length ? `AND ${relatedFilters.join(" AND ")}` : ""})`);
    return filters;
  }
  const checks = requirements.map((requirement) => {
    const sourceRun = runCondition("j.run_id", requirement.source_id);
    const filters = rowConditions(requirement, "r");
    return `EXISTS (SELECT 1 FROM search_record_parcels j
      JOIN search_records r ON r.run_id = j.run_id AND r.source_id = j.source_id
        AND r.record_id = j.record_id
      WHERE ${sourceRun} AND j.source_id = ${add(requirement.source_id)}
        AND j.city_parcel_id = (p.fields->>'parcel_id')::bigint
        AND j.city_objectid = (p.fields->>'objectid')::bigint
        AND j.join_status = 'exact'${filters.length ? ` AND ${filters.join(" AND ")}` : ""})`;
  });
  if (projection?.parcel) {
    checks.push(`p.fields->>'parcel_id' = ${add(projection.parcel.parcel_id)}
      AND p.record_id = ${add(projection.parcel.objectid)}`);
  }
  // A source can have several matching records. The result is one parcel,
  // with one official record link per requirement and an exact match count.
  const evidenceRequirements = projection
    ? [...requirements, ...projection.sources.filter((id) => runs[id] != null &&
      !requirements.some((item) => item.source_id === id))
      .map((source_id) => ({ source_id, equals: {} }))]
    : requirements;
  const evidence = evidenceRequirements.map((requirement) => {
    const sourceRun = runCondition("j.run_id", requirement.source_id);
    const filters = rowConditions(requirement, "r");
    const dateOrder = (alias) => DATE_ORDERED_BUSINESS.has(requirement.source_id) ? `${alias}.event_date DESC NULLS LAST, ` : "";
    if (projection) {
      const source = add(requirement.source_id);
      return `(SELECT jsonb_build_object('source_id', ${source}::text,
        'matching_record_count', coalesce(max(m.total), 0),
        'records', coalesce(jsonb_agg(to_jsonb(m) - 'total' ORDER BY ${dateOrder("m")}m.record_id), '[]'::jsonb))
        FROM (SELECT r.record_id, r.source_url, r.published_type, r.published_status,
            r.event_date, r.fields, array_agg(DISTINCT j.match_method ORDER BY j.match_method) AS match_methods,
            array_agg(DISTINCT j.city_address_objectid ORDER BY j.city_address_objectid) FILTER (WHERE j.city_address_objectid IS NOT NULL)
              AS city_address_objectids, count(*) OVER () AS total
          FROM search_record_parcels j JOIN search_records r USING (run_id, source_id, record_id)
          WHERE ${sourceRun} AND j.source_id = ${source}
            AND j.city_parcel_id = (p.fields->>'parcel_id')::bigint
            AND j.city_objectid = (p.fields->>'objectid')::bigint AND j.join_status = 'exact'
            ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
          GROUP BY r.run_id, r.source_id, r.record_id ORDER BY ${dateOrder("r")}r.record_id LIMIT 50) m)`;
    }
    return `(SELECT jsonb_build_object('source_id', ${add(requirement.source_id)}::text,
      'matching_record_count', count(DISTINCT r.record_id),
      'example_record', (jsonb_agg(jsonb_build_object(
        'record_id', r.record_id, 'source_url', r.source_url,
        'published_type', r.published_type, 'published_status', r.published_status,
        'event_date', r.event_date,
        'city_address_objectid', j.city_address_objectid)
        ORDER BY ${dateOrder("r")}r.record_id, j.city_address_objectid)->0))
      FROM search_record_parcels j JOIN search_records r
        ON r.run_id = j.run_id AND r.source_id = j.source_id AND r.record_id = j.record_id
      WHERE ${sourceRun} AND j.source_id = ${add(requirement.source_id)}
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
    ORDER BY (p.fields->>'parcel_id')::bigint ${projection?.descending ? "DESC" : "ASC"},
      (p.fields->>'objectid')::bigint ${projection?.descending ? "DESC" : "ASC"}
    OFFSET ${add(offset)} LIMIT ${add(limit + 1)}`;
  return { query, values };
}

export async function searchIndexedParcels(input = {}, { query = indexQuery,
  configured = indexConfigured, projection = null } = {}) {
  const requirements = checkedRequirements(input.requirements, projection ? PARCEL_QUERY_FIELDS : SEARCH_FIELDS);
  const municipalRequirements = requirements.filter((item) => item.source_id === "municity");
  if (municipalRequirements.length > 1)
    throw new SourceError("Use one municipal permit type or group requirement per cross-source query", 400);
  const municipalType = municipalRequirements[0]?.equals?.PermitType;
  const municipalGroup = municipalRequirements[0]?.permit_group;
  const municipalTypeList = municipalRequirements[0]?.one_of?.PermitType ?? [];
  const typeScopes = municipalTypeList.map((type) => `permit-type:${type}`);
  const boundedAllTypes = projection && municipalRequirements[0]?.event_date_from &&
    municipalRequirements[0]?.event_date_to && !municipalType && !municipalGroup && !typeScopes.length;
  const selections = [municipalType, municipalGroup, typeScopes.length, boundedAllTypes].filter(Boolean).length;
  if (municipalRequirements.length &&
      (selections !== 1 ||
       (municipalType && (typeof municipalType !== "string" ||
         !municipalType.trim() || municipalType.length > 100))))
    throw new SourceError("Municipal search requires one exact PermitType or published permit group", 400);
  let municipalScope = municipalType ? `permit-type:${municipalType.trim().toUpperCase()}`
    : municipalGroup ? `permit-group:${municipalGroup.toUpperCase()}` : boundedAllTypes ? "permit-window:90" : null;
  const permit = municipalRequirements[0];
  const windowScopes = (municipalType || typeScopes.length || boundedAllTypes || (municipalGroup && projection?.permit_types?.length)) &&
    permit.event_date_from && permit.event_date_to
    ? RECENT_PERMIT_SCOPES : [];
  const limit = input.limit == null ? 25 : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new SourceError("limit must be 1–100", 400);
  const requiredSources = [...new Set(["parcels", ...requirements.map((item) => item.source_id),
    ...(requirements.some((item) => ADDRESS_DEPENDENT.has(item.source_id)) ? ["addresses"] : [])])];
  const wantedSources = [...new Set([...requiredSources, ...(projection?.sources ?? []),
    ...(projection?.sources.some((id) => ADDRESS_DEPENDENT.has(id)) ? ["addresses"] : [])])];
  const criteria = { requirements, ...(projection ? { projection } : {}) };
  if (!configured()) return { criteria, items: [], next_cursor: null,
    complete_for_query: false, coverage: { index_status: "unconfigured",
      source_checks: wantedSources.map((source_id) => ({ source_id, status: "unconfigured" })) } };
  let active;
  try {
    active = await query(`SELECT a.source_id, a.scope_key, r.id AS run_id, r.status, r.finished_at,
      r.expected_count, r.returned_count, r.ambiguous_count, r.unlinked_count, r.warning,
      r.coverage_date_from, r.coverage_date_to,
      to_jsonb(r)->'metadata' AS metadata,
      last.status AS latest_attempt_status, last.warning AS latest_attempt_warning
      FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
      LEFT JOIN LATERAL (SELECT status, warning FROM search_source_runs
        WHERE source_id = a.source_id AND scope_key = a.scope_key
        ORDER BY started_at DESC, id DESC LIMIT 1) last ON true
      WHERE (a.scope_key = 'all' AND a.source_id = ANY($1::text[]))
        OR (a.source_id = 'municity' AND (a.scope_key = $2 OR a.scope_key = ANY($3::text[])))`,
    [wantedSources, municipalScope, [...windowScopes, ...typeScopes]]);
  } catch (error) {
    console.warn(JSON.stringify({ event: "indexed_search_failed", stage: "active_runs",
      code: error?.code ?? null, name: error?.name ?? null }));
    return { criteria, items: [], next_cursor: null, complete_for_query: false,
      coverage: { index_status: "unavailable", source_checks: wantedSources.map((source_id) =>
        ({ source_id, status: "unavailable" })) } };
  }
  const byId = new Map(active.filter((row) => row.scope_key === "all")
    .map((row) => [row.source_id, row]));
  const activeMunicipalScopes = new Map(active.filter(({ source_id }) => source_id === "municity")
    .map((row) => [row.scope_key, row]));
  const recent = windowScopes.length ? recentPermitRun(active, permit.event_date_from, permit.event_date_to) : null;
  const historicalTypeScopes = recent ? [] : typeScopes;
  const typeRuns = historicalTypeScopes.map((scope) => activeMunicipalScopes.get(scope)).filter(Boolean);
  if (recent) municipalScope = recent.scope_key;
  const municipal = recent ?? (!boundedAllTypes ? activeMunicipalScopes.get(municipalScope) : null);
  if (municipal) byId.set("municity", municipal);
  const absentMunicipal = municipalScope && !byId.has("municity")
    ? await missingAttempt("municity", municipalScope, query) : null;
  const absentLicenses = requiredSources.includes(MUNICIPAL_LICENSE_SOURCE) && !byId.has(MUNICIPAL_LICENSE_SOURCE)
    ? await missingAttempt(MUNICIPAL_LICENSE_SOURCE, "all", query) : null;
  const checkSource = (source_id, run, scope = municipalScope) => {
    if (!run) return { source_id, status: "not_indexed",
      ...(source_id === "municity" ? { scope_key: scope,
        ...(scope === municipalScope ? absentMunicipal : {}) } : source_id === MUNICIPAL_LICENSE_SOURCE ? absentLicenses : {}) };
    if (source_id === REGISTRATION_SOURCE && !registryJoinIsCurrent(run, byId))
      return { source_id, status: "not_indexed", warning: "State business registrations need to be linked to the current City parcel and address index." };
    const fresh = Number.isFinite(Date.parse(run.finished_at)) &&
      Date.now() - Date.parse(run.finished_at) <= sourceAge(source_id);
    const dateCovered = dateCoverage(run, requirements.find((item) => item.source_id === source_id));
    const gaps = source_id === "municity" ? filteredPermitLinkGaps(run.metadata, {
      types: municipalType ? [municipalType.trim().toUpperCase()] :
        municipalTypeList.length ? municipalTypeList : projection?.permit_types ?? [],
      status: permit?.equals?.PermStatus, from: permit?.event_date_from, to: permit?.event_date_to,
    }) : null;
    const complete = run.status === "complete" && fresh && run.latest_attempt_status !== "failed" &&
      Number(run.expected_count) === Number(run.returned_count) &&
      Number(gaps?.ambiguous_count ?? run.ambiguous_count) === 0 &&
      Number(gaps?.unlinked_count ?? run.unlinked_count) === 0 && dateCovered;
    return { source_id, ...(source_id === "municity" ? { scope_key: scope } : {}),
      status: complete ? "complete" : "partial",
      ...(run.coverage_date_from || ["municity", MUNICIPAL_LICENSE_SOURCE].includes(source_id) ? { date_covered: dateCovered,
        coverage_date_from: run.coverage_date_from ? dateOnly(run.coverage_date_from) : null,
        coverage_date_to: run.coverage_date_to ? dateOnly(run.coverage_date_to) : null } : {}),
      run_id: Number(run.run_id), fresh, expected_count: Number(run.expected_count),
      returned_count: Number(run.returned_count), ambiguous_count: Number(run.ambiguous_count),
      unlinked_count: Number(run.unlinked_count), finished_at: run.finished_at,
      ...(gaps ? { filtered_parcel_link_gaps: gaps } : {}),
      ...([MUNICIPAL_LICENSE_SOURCE, REGISTRATION_SOURCE].includes(source_id) ? { inventory: run.metadata } : {}),
      warning: run.warning ?? null,
      latest_attempt_status: run.latest_attempt_status === "failed" &&
        run.latest_attempt_warning?.startsWith("MUNICIPAL_TYPE_CAP:")
        ? "blocked" : run.latest_attempt_status,
      latest_attempt_warning: run.latest_attempt_warning ?? null };
  };
  const sourceChecks = wantedSources.flatMap((source_id) =>
    source_id === "municity" && historicalTypeScopes.length
      ? historicalTypeScopes.map((scope) => checkSource(source_id, activeMunicipalScopes.get(scope), scope))
      : [checkSource(source_id, byId.get(source_id))]);
  // Some City features have no parcel ID, MBLU, address, or use code. They
  // cannot match a query explicitly limited to reviewed use codes. Verify that
  // exclusion against the active official rows before calling this particular
  // City-classified query complete; keep the global unlinked count visible.
  const parcelUseCodes = requirements.find((item) => item.source_id === "parcels" &&
    item.one_of?.use_code?.length)?.one_of.use_code;
  const parcelCheck = sourceChecks.find((item) => item.source_id === "parcels");
  const parcelRun = byId.get("parcels");
  if (parcelUseCodes && parcelCheck?.status === "partial" && parcelRun &&
      parcelCheck.fresh && parcelRun.status === "complete" &&
      parcelRun.latest_attempt_status !== "failed" &&
      Number(parcelRun.expected_count) === Number(parcelRun.returned_count) &&
      Number(parcelRun.ambiguous_count) === 0 &&
      Number(parcelRun.unlinked_count) > 0) {
    try {
      const [row] = await query(`SELECT count(*)::integer AS count
        FROM search_records p WHERE p.run_id = $1 AND p.source_id = 'parcels'
          AND upper(trim(p.fields->>'use_code')) = ANY($2::text[])
          AND NOT EXISTS (SELECT 1 FROM search_record_parcels j
            WHERE j.run_id = p.run_id AND j.source_id = p.source_id
              AND j.record_id = p.record_id AND j.join_status = 'exact')`,
      [parcelRun.run_id, parcelUseCodes]);
      if (Number(row?.count) === 0) {
        parcelCheck.status = "complete";
        parcelCheck.unlinked_outside_filter = Number(parcelRun.unlinked_count);
      }
    } catch { /* Unknown scope stays partial. */ }
  }
  if (sourceChecks.some((check) => check.status === "not_indexed" && requiredSources.includes(check.source_id) &&
      !(check.source_id === "municity" && typeRuns.length)))
    return { criteria, items: [], next_cursor: null, complete_for_query: false,
      coverage: { index_status: "partial", source_checks: sourceChecks,
        note: "A required source has no validated indexed run. No cross-source result was asserted." } };
  const allComplete = sourceChecks.every((check) => check.status === "complete");
  const runs = Object.fromEntries(sourceChecks.map((check) => [check.source_id, check.run_id]));
  if (typeRuns.length) runs.municity = typeRuns.map(({ run_id }) => Number(run_id));
  const sourceHash = fingerprint(runs);
  const cursor = readSearchCursor(input.cursor, fingerprint(criteria), sourceHash);
  const { query: statement, values } = buildIndexedSearchQuery(requirements, runs, cursor.offset, limit, projection);
  let rows;
  try { rows = await query(statement, values); }
  catch (error) {
    console.warn(JSON.stringify({ event: "indexed_search_failed", stage: "parcel_matches",
      code: error?.code ?? null, name: error?.name ?? null }));
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
  const permitGroup = requirement.permit_group;
  if (sourceId === "municity" &&
      ((Boolean(permitType) === Boolean(permitGroup)) ||
        (permitType && (typeof permitType !== "string" ||
          !permitType.trim() || permitType.length > 100))))
    throw new SourceError("Municipal record search requires exact PermitType or published permit group", 400);
  let municipalScope = sourceId === "municity"
    ? permitType ? `permit-type:${permitType.trim().toUpperCase()}`
      : `permit-group:${permitGroup.toUpperCase()}` : null;
  const windowScopes = municipalScope && permitType && requirement.event_date_from && requirement.event_date_to
    ? RECENT_PERMIT_SCOPES : [];
  const parcelId = input.city_parcel_id == null ? null : String(input.city_parcel_id);
  const objectId = input.city_objectid == null ? null : String(input.city_objectid);
  if ((parcelId == null) !== (objectId == null) ||
      (parcelId != null && (!/^\d{1,12}$/.test(parcelId) || !/^\d{1,12}$/.test(objectId))))
    throw new SourceError("Provide both City parcel ID and object ID, or neither", 400);
  const neighborhood = input.neighborhood == null ? null : String(input.neighborhood).trim();
  if (neighborhood != null && (!neighborhood || neighborhood.length > 80 ||
      /[\x00-\x1f]/.test(neighborhood))) throw new SourceError("Invalid City neighborhood", 400);
  const licenseAddress = sourceId === MUNICIPAL_LICENSE_SOURCE || Object.hasOwn(STATE_ADDRESS_SOURCES, sourceId);
  const rawAddress = input.site_address;
  const registrationSite = sourceId === REGISTRATION_SOURCE && rawAddress != null ? businessAddress(rawAddress) : null;
  const siteAddress = rawAddress == null ? null : registrationSite?.address ?? normalizeAddress(rawAddress);
  if (rawAddress != null && (!licenseAddress || typeof rawAddress !== "string" || rawAddress.length > 160 ||
      /[\x00-\x1f]/.test(rawAddress) || !/^\d+ [A-Z0-9]/.test(siteAddress)))
    throw new SourceError("Provide a street address for a linked City or State business or credential source", 400);
  const limit = input.limit == null ? 25 : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new SourceError("limit must be 1–50", 400);
  const requiredSources = [...new Set(["parcels", sourceId,
    ...(neighborhood ? ["neighborhoods"] : []),
    ...(ADDRESS_DEPENDENT.has(sourceId) ? ["addresses"] : [])])];
  const criteria = { ...requirement, city_parcel_id: parcelId,
    city_objectid: objectId, ...(neighborhood ? { neighborhood } : {}),
    ...(siteAddress ? { site_address: siteAddress } : {}),
    ...(registrationSite?.unit ? { site_unit: registrationSite.unit } : {}) };
  if (!indexConfigured()) return { criteria, items: [], next_cursor: null,
    complete_for_query: false, coverage: { index_status: "unconfigured",
      source_checks: requiredSources.map((source_id) => ({ source_id, status: "unconfigured" })) } };
  let active;
  try {
    active = await query(`SELECT a.source_id, a.scope_key, r.id AS run_id, r.status,
      r.finished_at, r.expected_count, r.returned_count,
      r.ambiguous_count, r.unlinked_count, r.warning,
      r.coverage_date_from, r.coverage_date_to,
      to_jsonb(r)->'metadata' AS metadata,
      last.status AS latest_attempt_status, last.warning AS latest_attempt_warning
      FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
      LEFT JOIN LATERAL (SELECT status, warning FROM search_source_runs
        WHERE source_id = a.source_id AND scope_key = a.scope_key
        ORDER BY started_at DESC, id DESC LIMIT 1) last ON true
      WHERE (a.scope_key = 'all' AND a.source_id = ANY($1::text[]))
        OR (a.source_id = 'municity' AND (a.scope_key = $2 OR a.scope_key = ANY($3::text[])))`,
    [requiredSources, municipalScope, windowScopes]);
  } catch {
    return { criteria, items: [], next_cursor: null, complete_for_query: false,
      coverage: { index_status: "unavailable", source_checks: requiredSources.map((source_id) =>
        ({ source_id, status: "unavailable" })) } };
  }
  const byId = new Map(active.filter((row) => row.scope_key === "all")
    .map((row) => [row.source_id, row]));
  if (municipalScope) {
    const recent = windowScopes.length
      ? recentPermitRun(active, requirement.event_date_from, requirement.event_date_to) : null;
    const municipal = recent ?? active.find((row) => row.source_id === "municity" && row.scope_key === municipalScope);
    if (recent) municipalScope = recent.scope_key;
    if (municipal) byId.set("municity", municipal);
  }
  const absentMunicipal = municipalScope && !byId.has("municity")
    ? await missingAttempt("municity", municipalScope, query) : null;
  const absentLicenses = sourceId === MUNICIPAL_LICENSE_SOURCE && !byId.has(MUNICIPAL_LICENSE_SOURCE)
    ? await missingAttempt(MUNICIPAL_LICENSE_SOURCE, "all", query) : null;
  const sourceChecks = requiredSources.map((source_id) => {
    const run = byId.get(source_id);
    if (!run) return { source_id, status: "not_indexed",
      ...(source_id === "municity" ? { scope_key: municipalScope,
        ...absentMunicipal } : source_id === MUNICIPAL_LICENSE_SOURCE ? absentLicenses : {}) };
    if (source_id === REGISTRATION_SOURCE && !registryJoinIsCurrent(run, byId))
      return { source_id, status: "not_indexed", warning: "State business registrations need to be linked to the current City parcel and address index." };
    const fresh = Number.isFinite(Date.parse(run.finished_at)) &&
      Date.now() - Date.parse(run.finished_at) <= sourceAge(source_id);
    const dateCovered = dateCoverage(run, source_id === sourceId ? requirement : null);
    const gaps = source_id === "municity" ? filteredPermitLinkGaps(run.metadata, {
      types: permitType ? [permitType.trim().toUpperCase()] : [],
      status: requirement.equals.PermStatus, from: requirement.event_date_from, to: requirement.event_date_to,
    }) : null;
    const complete = run.status === "complete" && fresh &&
      run.latest_attempt_status !== "failed" &&
      Number(run.expected_count) === Number(run.returned_count) &&
      Number(gaps?.ambiguous_count ?? run.ambiguous_count) === 0 &&
      Number(gaps?.unlinked_count ?? run.unlinked_count) === 0 && dateCovered;
    return { source_id, ...(source_id === "municity" ? { scope_key: municipalScope } : {}),
      status: complete ? "complete" : "partial", run_id: Number(run.run_id),
      ...(run.coverage_date_from || ["municity", MUNICIPAL_LICENSE_SOURCE].includes(source_id) ? { date_covered: dateCovered,
        coverage_date_from: run.coverage_date_from ? dateOnly(run.coverage_date_from) : null,
        coverage_date_to: run.coverage_date_to ? dateOnly(run.coverage_date_to) : null } : {}),
      fresh, expected_count: Number(run.expected_count),
      returned_count: Number(run.returned_count),
      ambiguous_count: Number(run.ambiguous_count),
      unlinked_count: Number(run.unlinked_count), finished_at: run.finished_at,
      ...(gaps ? { filtered_parcel_link_gaps: gaps } : {}),
      ...([MUNICIPAL_LICENSE_SOURCE, REGISTRATION_SOURCE].includes(source_id) ? { inventory: run.metadata } : {}),
      warning: run.warning ?? null,
      latest_attempt_status: run.latest_attempt_status === "failed" &&
        run.latest_attempt_warning?.startsWith("MUNICIPAL_TYPE_CAP:")
        ? "blocked" : run.latest_attempt_status,
      latest_attempt_warning: run.latest_attempt_warning ?? null };
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
  if (neighborhood) {
    const boundaryRun = add(runs.neighborhoods);
    const name = add(neighborhood);
    filters.push(`EXISTS (SELECT 1 FROM search_record_parcels b
      JOIN search_records n USING (run_id, source_id, record_id)
      WHERE b.run_id = ${boundaryRun} AND b.source_id = 'neighborhoods' AND b.join_status = 'exact'
        AND b.city_parcel_id = j.city_parcel_id AND b.city_objectid = j.city_objectid
        AND upper(${name}) IN (upper(n.fields->>'neighborhood'), upper(n.fields->>'neighborhood_label')))`);
  }
  const parcelRun = add(runs.parcels);
  const addressRun = ADDRESS_DEPENDENT.has(sourceId) ? add(runs.addresses) : null;
  const publishedAddressField = sourceId === MUNICIPAL_LICENSE_SOURCE
    ? "NormalizedLegalAddress" : "normalized_site_address";
  const validLicensePoint = licenseAddress ? `
        AND a.fields->>'normalized_address' = r.fields->>'${publishedAddressField}'
        AND EXISTS (SELECT 1 FROM search_record_parcels ap
          WHERE ap.run_id = a.run_id AND ap.source_id = a.source_id AND ap.record_id = a.record_id
            AND ap.join_status = 'exact' AND ap.city_parcel_id = j.city_parcel_id
            AND ap.city_objectid = j.city_objectid)
        AND NOT EXISTS (SELECT 1 FROM search_records other
          LEFT JOIN search_record_parcels op USING (run_id, source_id, record_id)
          WHERE other.run_id = a.run_id AND other.source_id = 'addresses'
            AND other.fields->>'normalized_address' = a.fields->>'normalized_address'
            AND (op.join_status IS DISTINCT FROM 'exact'
              OR op.city_parcel_id IS DISTINCT FROM j.city_parcel_id
              OR op.city_objectid IS DISTINCT FROM j.city_objectid))` : "";
  if (siteAddress) filters.push(`EXISTS (SELECT 1 FROM search_records a
      WHERE a.run_id = ${addressRun} AND a.source_id = 'addresses'
        AND a.record_id = j.city_address_objectid::text
        AND a.fields->>'normalized_address' = ${add(siteAddress)}${validLicensePoint}
        ${registrationSite?.unit ? `AND ${verifiedRegistrationUnit("r", "a", add(registrationSite.unit))}` : ""})`);
  const addressJoin = addressRun == null ? "" : `
      LEFT JOIN search_records a ON a.run_id = ${addressRun}
        AND a.source_id = 'addresses'
        AND a.record_id = j.city_address_objectid::text${validLicensePoint}`;
  const addressEvidence = addressRun == null ? "'[]'::jsonb" : `COALESCE(
        jsonb_agg(DISTINCT jsonb_build_object(
          'objectid', a.record_id, 'house_number', a.fields->>'house_number',
          'full_street_name', a.fields->>'full_street_name',
          'unit', a.fields->>'unit', 'source_url', a.source_url))
          FILTER (WHERE a.record_id IS NOT NULL), '[]'::jsonb)`;
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
    links.city_address_objectids, links.city_address_points, links.match_methods
    FROM page JOIN search_records r ON r.run_id = ${recordRun}
      AND r.source_id = ${sourceRef} AND r.record_id = page.record_id
    JOIN search_records p ON p.run_id = ${parcelRun} AND p.source_id = 'parcels'
      AND p.fields->>'parcel_id' = page.city_parcel_id::text
      AND p.fields->>'objectid' = page.city_objectid::text
    LEFT JOIN LATERAL (
      SELECT array_agg(DISTINCT j.city_address_objectid)
        FILTER (WHERE ${licenseAddress ? "a.record_id" : "j.city_address_objectid"} IS NOT NULL) AS city_address_objectids,
        ${addressEvidence} AS city_address_points,
        array_agg(DISTINCT j.match_method) AS match_methods
      FROM search_record_parcels j${addressJoin} WHERE j.run_id = ${recordRun}
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
  const items = rows.slice(0, limit);
  return { criteria, items: sourceId === "trash-pickup"
    ? items.map((row) => ({ ...row, fields: withTrashPickupDayName(row.fields) })) : items,
    next_cursor: hasMore ? makeSearchCursor({ v: 1, query: fingerprint(criteria),
      source: sourceHash, offset: cursor.offset + limit,
      expires: Date.now() + 30 * 60_000 }) : null,
    complete_for_query: !hasMore && allComplete,
    coverage: { index_status: allComplete ? "connected" : "partial",
      source_checks: sourceChecks, returned_this_page: Math.min(rows.length, limit),
      note: "Only exact City parcel links are returned. Ambiguous and unlinked source rows remain coverage gaps. Source fields and dates are published values, not current occupancy or activity claims." },
    retrieved_at: new Date().toISOString() };
}
