import { getSourceRecords } from "../parcel/adapters.js";
import { addressEvidence, checkedQueryAddress } from "../parcel/address-evidence.js";
import { LAYERS } from "../parcel/config.js";
import { CHARITY_SOURCE } from "../parcel/charity-registrations.js";
import { parcelUseCodesForSearch, reviewedUseCodeValues } from "../parcel/data-context.js";
import { SourceError } from "../parcel/http.js";
import { nearbyFeatureCounts } from "../parcel/nearby-counts.js";
import { permitDetails } from "../parcel/permit-details.js";
import { parcelPhoto } from "../parcel/photo.js";
import { parcelQueryCatalog, queryDateFields, queryParcelDataSchema, relatedPermitFields } from "../parcel/query-contract.js";
import { loadParcel, normalizeAddress, resolveParcel } from "../parcel/resolve.js";
import { schoolAddress } from "../parcel/school-attendance.js";
import { fingerprint, makeSearchCursor, readSearchCursor } from "../parcel/search-cursor.js";
import { indexQuery } from "./db.js";
import { questionPermitCatalog } from "./ask.js";
import { municipalDate } from "./municity.js";
import { PERMIT_ACTIVITY_KINDS, PERMIT_ACTIVITY_SOURCE, PERMIT_ACTIVITY_TYPES } from "./permit-activity-source.js";
import { permitNumber } from "./question-routes.js";
import { PARCEL_QUERY_FIELDS, searchIndexedParcels } from "./search.js";

const DETAILS = {
  "permit-contacts": "Contact", "permit-applications": "Application",
  "permit-reviews": "Task", "permit-inspections": "Inspection",
  "permit-fees": "Fee", "permit-documents": "Document",
  "permit-communications": "Communication", "permit-flags": "Flag",
};
const DETAIL_DATES = { "permit-applications": "ApplicationDate", "permit-reviews": "DateCompleted",
  "permit-inspections": "CloseDate" };
const NEARBY = new Set(["metered-parking-spaces", "transit-stops"]);
const good = new Set(["complete", "ok", "no_records"]);
const normalized = (value) => String(value ?? "").trim().toUpperCase();
const unsupported = (reason, plan) => ({ status: "unsupported", reason, ...(plan ? { plan } : {}) });
const unavailable = (reason, plan) => ({ status: "unavailable", reason, plan });
const fieldsFor = (fields, wanted) => wanted
  ? Object.fromEntries(wanted.filter((key) => fields[key] != null).map((key) => [key, fields[key]]))
  : fields;
const workId = (value) => /^[1-9]\d{0,11}$/.test(String(value ?? "")) ? String(value) : null;
const pair = (value) => [value.parcel_id, value.objectid].map(String).join(":");

export function parcelQueryPlanProblem(plan, entries = new Map(parcelQueryCatalog().sources.map((source) => [source.source_id, source]))) {
  if (plan.scope.kind === "address") checkedQueryAddress(plan.scope.address);
  const requirementIds = plan.requirements.map(({ source_id }) => source_id);
  if (new Set(requirementIds).size !== requirementIds.length)
    return "Combine filters for a source into one requirement so they apply to the same record.";
  if (new Set(plan.include.map(({ source_id }) => source_id)).size !== plan.include.length)
    return "List each return source once.";
  if (plan.scope.kind === "city" && !plan.requirements.length && !plan.parcel_use_category)
    return "Choose at least one indexed source requirement for a citywide query.";
  for (const item of plan.requirements) {
    const definition = entries.get(item.source_id);
    if (!definition?.queryable) return `${item.source_id} is not available as an indexed parcel filter.`;
    for (const key of ["equals", "one_of", "number_gte", "number_lte"])
      if (Object.keys(item[key] ?? {}).some((field) => !definition.filters[key].includes(field)))
        return `Unsupported ${key} field for ${item.source_id}. Check the query catalog.`;
    if (item.date && (!definition.filters.date_fields.includes(item.date.field) ||
        !(item.date.from || item.date.to) || (item.date.from && item.date.to && item.date.from > item.date.to)))
      return `Choose a published date field and a valid date bound for ${item.source_id}.`;
    const permitTypes = item.one_of?.PermitType;
    if ((item.permit_group && item.source_id !== "municity") ||
        [item.permit_group, item.equals?.PermitType, permitTypes].filter(Boolean).length > 1)
      return "Choose a published permit group, one exact type, or a list of exact types.";
    if (item.source_id === "municity" && !(item.permit_group || item.equals?.PermitType || permitTypes ||
        permitNumber.test(item.equals?.PermitNo ?? "") ||
        (item.date?.from && item.date.to)))
      return "Choose a published permit number, exact permit types, a permit group, or a bounded recent PermitDate range.";
    if (item.source_id === PERMIT_ACTIVITY_SOURCE) {
      const kind = normalized(item.equals?.activity_kind).toLowerCase();
      const type = normalized(item.equals?.permit_type);
      if (!Object.hasOwn(PERMIT_ACTIVITY_KINDS, kind) ||
          !PERMIT_ACTIVITY_TYPES.some((candidate) => normalized(candidate) === type))
        return `Indexed work activity needs an activity kind and one of these exact permit types: ${PERMIT_ACTIVITY_TYPES.join(", ")}.`;
      if (item.date && item.date.field !== PERMIT_ACTIVITY_KINDS[kind].date)
        return `The indexed ${kind} date is ${PERMIT_ACTIVITY_KINDS[kind].date}.`;
    }
  }
  for (const item of plan.include) {
    const definition = entries.get(item.source_id);
    if (!definition?.projectable) return `${item.source_id} is not available as a parcel return source.`;
    if (item.fields?.some((field) => !definition.return_fields.includes(field)))
      return `Unknown return field for ${item.source_id}. Check the query catalog.`;
    if (item.record_category && item.source_id !== "municity") return "A Permit category applies only to municipal records.";
    if (item.source_id === PERMIT_ACTIVITY_SOURCE && !requirementIds.includes(PERMIT_ACTIVITY_SOURCE))
      return "Choose an indexed permit activity kind and type, or request live details on matching permits.";
  }
  if (plan.require_contact_role && !plan.contact_role) return "Specify the published contact role to require.";
  if (plan.radius_meters && !plan.include.some(({ source_id }) => NEARBY.has(source_id)))
    return "Choose a mapped point source when specifying a radius.";
  if ((plan.contact_role || plan.permit_description_terms || plan.include.some(({ source_id }) =>
      Object.hasOwn(DETAILS, source_id))) && !["parcel", "address"].includes(plan.scope.kind) &&
      !requirementIds.some((id) => ["municity", PERMIT_ACTIVITY_SOURCE].includes(id)))
    return "A cross-parcel permit detail request needs a matching municipal permit or permit activity filter.";
  return null;
}

async function indexedPermitNumber(number, query) {
  const rows = await query(`SELECT DISTINCT trim(r.published_type) AS permit_type, r.event_date
    FROM search_active_runs a JOIN search_records r ON r.run_id = a.run_id AND r.source_id = a.source_id
    WHERE a.source_id = 'municity' AND (a.scope_key LIKE 'permit-type:%' OR a.scope_key LIKE 'permit-window:%')
      AND upper(trim(r.fields->>'PermitNo')) = $1 AND nullif(trim(r.published_type), '') IS NOT NULL
      AND EXISTS (SELECT 1 FROM search_record_parcels j
        WHERE j.run_id = r.run_id AND j.source_id = r.source_id AND j.record_id = r.record_id
        GROUP BY j.record_id HAVING count(DISTINCT (j.city_parcel_id, j.city_objectid)) = 1
          AND bool_and(j.join_status = 'exact'))
    LIMIT 8`, [normalized(number)]);
  const types = [...new Map(rows.map(({ permit_type }) => [normalized(permit_type), permit_type])).values()];
  const dates = [...new Set(rows.map(({ event_date }) => event_date instanceof Date
    ? event_date.toISOString().slice(0, 10) : String(event_date ?? "").slice(0, 10)))];
  return { types, date: dates.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(dates[0]) ? dates[0] : null };
}

async function exactScope(scope, resolve) {
  if (scope.kind !== "address" && (scope.kind !== "parcel" || scope.objectid)) return { scope };
  if (scope.kind === "address" && Boolean(scope.parcel_id) !== Boolean(scope.objectid))
    return unsupported("An address selection needs both the City parcel ID and object ID.");
  const resolved = await resolve(scope.kind === "address" ? scope.address : scope.parcel_id);
  const candidates = resolved.candidates.filter((item) => item.objectid != null &&
    (scope.kind !== "parcel" || String(item.parcel_id) === scope.parcel_id));
  const listedAddressMatches = scope.kind === "address" &&
    normalizeAddress(candidates[0]?.address) === normalizeAddress(scope.address);
  const chosen = scope.objectid ? candidates.find((item) => pair(item) === pair(scope))
    : !resolved.truncated && candidates.length === 1 &&
      (candidates[0].match?.method !== "address-point-intersection" || listedAddressMatches) ? candidates[0] : null;
  if (chosen) return { scope: { kind: "parcel", parcel_id: String(chosen.parcel_id), objectid: String(chosen.objectid) },
    address_match: scope.kind === "address" ? { searched_address: scope.address, ...chosen.match } : undefined };
  if (!candidates.length) {
    const incomplete = resolved.status === "unavailable" || resolved.warnings?.length > 0;
    return { status: incomplete ? "unavailable" : "not_found", reason: incomplete
      ? "The official City parcel lookup was incomplete." : "The official City parcel lookup returned no match." };
  }
  return { status: "clarify", clarification: { id: "parcel", question: "Which City parcel should the search use?",
    options: candidates.map((item) => ({ id: pair(item),
      label: `${item.address || "City parcel"} · ${pair(item)}`, match: item.match })) } };
}

async function neighborhoodName(name, query) {
  const rows = await query(`SELECT DISTINCT nullif(trim(r.fields->>'neighborhood'), '') AS name,
    nullif(trim(r.fields->>'neighborhood_label'), '') AS label
    FROM search_active_runs a JOIN search_records r ON r.run_id = a.run_id
    WHERE a.source_id = 'neighborhoods' AND a.scope_key = 'all' AND r.source_id = a.source_id
      AND (upper(trim(r.fields->>'neighborhood')) = upper($1)
        OR upper(trim(r.fields->>'neighborhood_label')) = upper($1))`, [name]);
  const names = [...new Set(rows.map((row) => row.name).filter(Boolean))];
  if (names.length === 1 && rows.every((row) => row.name === names[0]))
    return { field: "neighborhood", value: names[0] };
  if (rows.length === 1 && !rows[0].name && rows[0].label)
    return { field: "neighborhood_label", value: rows[0].label };
  return null;
}

async function applyUseCategory(category, requirements, query) {
  const codes = parcelUseCodesForSearch(category);
  if (!codes.length) return { reason: "Official City use-code definitions for this classification are unavailable." };
  const requirement = requirements.find(({ source_id }) => source_id === "parcels");
  if (requirement?.one_of?.use_code || requirement?.equals?.use_code)
    return { reason: "Choose an exact use code or a recorded-use classification." };
  if (requirement) requirement.one_of = { use_code: codes };
  else requirements.push({ source_id: "parcels", one_of: { use_code: codes } });
  try {
    const values = await query(`SELECT DISTINCT upper(trim(fields->>'use_code')) AS code
      FROM search_records WHERE source_id = 'parcels' AND run_id =
      (SELECT run_id FROM search_active_runs WHERE source_id = 'parcels' AND scope_key = 'all')
      AND nullif(trim(fields->>'use_code'), '') IS NOT NULL`);
    const reviewed = reviewedUseCodeValues() ?? new Set();
    const unreviewed = values.filter(({ code }) => !reviewed.has(code)).length;
    if (unreviewed) return { warning: `${unreviewed} City use codes have no reviewed classification. Results use the reviewed codes.` };
  } catch { return { warning: "The indexed City use codes could not be reconciled against reviewed definitions." }; }
  return {};
}

function indexedRecord(row, sourceId, wanted) {
  const dateField = sourceId === PERMIT_ACTIVITY_SOURCE
    ? PERMIT_ACTIVITY_KINDS[row.fields.activity_kind]?.date : queryDateFields[sourceId];
  const { fields, ...evidence } = row;
  return { ...evidence, fields: fieldsFor(fields, wanted),
    ...(sourceId === PERMIT_ACTIVITY_SOURCE ? { permit_id: fields.permit_id,
      permit_source_url: fields.permit_source_url, linked_from: fields.linked_from } : {}),
    ...(dateField && row.event_date ? { date_field: dateField, published_date: fields[dateField] ?? null } : {}) };
}

function liveRecord(item, wanted, dateField) {
  const fields = item.attributes ?? {};
  return { record_id: item.source_record_id, source_url: item.source_url,
    event_date: item.event_date ?? null, ...(item.match ? { match: item.match } : {}),
    ...(item.linked_from ? { linked_from: item.linked_from } : {}),
    ...(item.note ? { note: item.note } : {}),
    ...(dateField && item.event_date ? { date_field: dateField, published_date: fields[dateField] ?? null } : {}),
    fields: fieldsFor(fields, wanted) };
}

async function liveSource(sourceId, wanted, feature, plan, dependencies) {
  const { records, photo, nearby } = dependencies;
  const { parcel_id, objectid } = feature.attributes;
  if (sourceId === "parcels") {
    return { status: "complete", items: [liveRecord({ source_record_id: String(objectid),
      source_url: `${LAYERS.parcels}/${objectid}`, match: { method: "city-parcel-pair" },
      attributes: fieldsFor(feature.attributes, PARCEL_QUERY_FIELDS.parcels) }, wanted)] };
  }
  if (sourceId === "parcel-photo" || NEARBY.has(sourceId)) {
    const value = sourceId === "parcel-photo" ? await photo(parcel_id, objectid)
      : (await nearby(parcel_id, { objectid, source_ids: [sourceId], radius_meters: plan.radius_meters })).layers[0];
    return { status: value.status, warning: value.warning,
      items: value.status === "no_records" || value.status === "unavailable" ? [] :
        [liveRecord({ ...value, attributes: value,
          source_record_id: sourceId === "parcel-photo" ? String(parcel_id) : String(objectid) }, wanted)] };
  }
  const result = await records(sourceId, feature);
  const recordCategory = sourceId === "municity" ? plan.include.find(({ source_id }) => source_id === sourceId)?.record_category : null;
  const schoolFocus = sourceId === "school-attendance" && plan.scope.kind === "address"
    ? schoolAddress(plan.scope.address) : null;
  const charityFocus = sourceId === CHARITY_SOURCE && plan.scope.kind === "address";
  const selected = schoolFocus ? result.items.filter((item) =>
    schoolAddress(item.attributes.address)?.address === schoolFocus.address)
    : charityFocus ? result.items.filter((item) => addressEvidence(item, plan.scope.address)?.matches_query)
    : recordCategory ? result.items.filter(({ category }) => category === recordCategory) : result.items;
  const countEstablished = result.count_established ?? (recordCategory ?
    !result.omitted_categories?.includes(recordCategory) && !result.truncated_categories?.includes(recordCategory) : undefined);
  return { ...result,
    ...(countEstablished === false && good.has(result.status) ? { status: "partial",
      warning: result.warning || "The source did not establish the number of records in this category." } : {}),
    ...(countEstablished === undefined ? {} : { count_established: countEstablished }),
    ...(schoolFocus && !selected.length && good.has(result.status) ? { status: "not_linked",
      warning: "No official NHPS attendance-zone row could be linked to the exact searched address." } : {}),
    items: selected.map((item) => {
      const school = sourceId === "school-attendance";
      const attributes = school ? { ...item.attributes,
        street_name: item.attributes.street_name_as_published,
        k8_school: item.attributes.k8_attendance_zone_school,
        high_school: item.attributes.high_school_attendance_zone_school,
      } : item.attributes;
      const dateField = sourceId === "assessor-sales" ? "sale_date" :
        sourceId === "municity" ? (item.category === "Permit" ? "PermitDate" : null) : queryDateFields[sourceId];
      const evidence = plan.scope.kind === "address" ? addressEvidence(item, plan.scope.address) : null;
      return { ...liveRecord({ ...item, attributes }, wanted, dateField),
        ...(school ? { address: attributes.address, source_lookup_mode: attributes.source_lookup_mode,
          source_snapshot_retrieved_at: attributes.source_snapshot_retrieved_at } : {}),
        ...(evidence ? { address_evidence: evidence } : {}) };
    }) };
}

function detailsIncomplete(work, category) {
  return (work.warnings ?? []).some((warning) => warning.includes("linked application could not") ||
    warning.includes("child records were unavailable") || warning.includes(` ${category} `) ||
    (category === "Application" && warning.includes("Full application fields")));
}

async function projectWork({ row, plan, includes, feature, permits, details, checks }) {
  const ids = new Set(row.matching_sources.flatMap(({ source_id, records }) => records.map((record) =>
    workId(source_id === "municity" ? record.record_id : source_id === PERMIT_ACTIVITY_SOURCE ? record.permit_id : null))
    .filter(Boolean)));
  const indexedWork = plan.requirements.some(({ source_id }) => ["municity", PERMIT_ACTIVITY_SOURCE].includes(source_id));
  if (!indexedWork) {
    const inventory = await permits("municity", feature);
    if (!good.has(inventory.status)) checks.set("municity", { status: inventory.status, warning: inventory.warning });
    for (const item of inventory.items) {
      const id = item.category === "Permit" && workId(item.attributes.Permit_ID);
      if (id) ids.add(id);
    }
  }
  const selected = [...ids].slice(0, 8);
  const matchingIds = new Set();
  const requested = [...includes.keys()].filter((id) => Object.hasOwn(DETAILS, id));
  const output = Object.fromEntries(requested.map((id) => [id, []]));
  const check = (id, status, warning) => checks.set(id, { status, warning });
  if (selected.length < ids.size) for (const id of requested)
    check(id, "partial", "Only eight matched permits per parcel were checked for live details. Open the official permit to inspect remaining records.");
  if (selected.length < ids.size && plan.permit_description_terms)
    check("municity", "partial", "Only eight matched permits per parcel were checked for the requested work description.");
  for (const id of selected) {
    let work;
    try { work = await details(feature, id); }
    catch {
      for (const sourceId of requested) check(sourceId, "unavailable", "The matched permit details could not be verified live.");
      if (plan.permit_description_terms)
        check("municity", "unavailable", "A matched permit description could not be verified live.");
      continue;
    }
    const description = work.permit?.attributes?.Description;
    if (plan.permit_description_terms && typeof description !== "string") {
      check("municity", "partial", "A matched permit had no readable published Description for the requested work filter.");
      continue;
    }
    if (plan.permit_description_terms && !plan.permit_description_terms.some((term) =>
      normalized(description).includes(normalized(term)))) continue;
    const roles = work.items.filter((item) => item.category === "Contact" &&
      (!plan.contact_role || normalized(item.attributes.ContactRole ?? item.attributes.ContactType) === normalized(plan.contact_role)));
    for (const sourceId of requested)
      if (detailsIncomplete(work, DETAILS[sourceId])) check(sourceId, "partial", "A requested category was incomplete on the permit or its linked application.");
    if (plan.require_contact_role && !roles.length) continue;
    matchingIds.add(id);
    for (const sourceId of requested) {
      const category = DETAILS[sourceId];
      const related = category === "Contact" ? roles : category === "Application" ? [work.application].filter(Boolean)
        : work.items.filter((item) => item.category === category);
      const dateField = DETAIL_DATES[sourceId];
      for (const item of related) {
        const dated = dateField ? { ...item, event_date: municipalDate(item.attributes?.[dateField]) } : item;
        output[sourceId].push({ ...liveRecord(dated, includes.get(sourceId), dateField),
          ...(category === "Contact" ? { published_role: item.attributes.ContactRole ?? item.attributes.ContactType ?? null } : {}),
          permit_id: id, permit_source_url: work.permit?.source_url,
          ...(plan.permit_description_terms ? { permit_description_as_published: description } : {}),
          permit_number: work.permit?.attributes?.PermitNo ?? null });
      }
    }
  }
  for (const [sourceId, records] of Object.entries(output)) {
    if (records.length > 50) check(sourceId, "partial", "Only 50 requested detail records per parcel are shown.");
    row.matching_sources.push({ source_id: sourceId, matching_record_count: records.length, records: records.slice(0, 50) });
    if (!checks.has(sourceId)) check(sourceId, "complete", null);
  }
  if (plan.require_contact_role || plan.permit_description_terms) {
    if (!matchingIds.size) return false;
    for (const group of row.matching_sources.filter(({ source_id }) => ["municity", PERMIT_ACTIVITY_SOURCE].includes(source_id))) {
      group.records = group.records.filter((item) => matchingIds.has(String(item.permit_id ?? item.record_id)));
      group.matching_record_count = group.records.length;
    }
  }
  return true;
}

async function projectParcel(row, plan, entries, dependencies) {
  const includes = new Map(plan.include.map(({ source_id, fields }) => [source_id, fields]));
  if (plan.contact_role && !includes.has("permit-contacts")) includes.set("permit-contacts", undefined);
  if (plan.permit_description_terms && !includes.has("municity") && !plan.requirements.some(({ source_id }) =>
    ["municity", PERMIT_ACTIVITY_SOURCE].includes(source_id))) includes.set("municity", undefined);
  const checks = new Map();
  for (const group of row.matching_sources) {
    if (group.matching_record_count > group.records.length) checks.set(group.source_id, { status: "partial",
      warning: "Only the first 50 matching records per source and parcel are shown." });
    group.records = group.records.map((record) => indexedRecord(record, group.source_id, includes.get(group.source_id)));
  }
  const work = plan.permit_description_terms || [...includes.keys()].some((id) => Object.hasOwn(DETAILS, id));
  const live = [...includes].filter(([id]) => !Object.hasOwn(DETAILS, id) &&
    !row.matching_sources.some(({ source_id }) => source_id === id) &&
    (["parcel", "address"].includes(plan.scope.kind) || !entries.get(id).queryable || id === "municity"));
  if (!work && !live.length) return { row, checks };
  let feature;
  try { feature = await dependencies.load(String(row.city_parcel_id), String(row.city_objectid)); }
  catch {
    const attempted = [...live.map(([id]) => id), ...[...includes.keys()].filter((id) => Object.hasOwn(DETAILS, id))];
    if (work && !attempted.length) attempted.push("municity");
    for (const id of attempted) checks.set(id, { status: "unavailable", warning: "City parcel could not be verified live." });
    return { row: (plan.require_contact_role || plan.permit_description_terms) ? null : row, checks };
  }
  // Keep the live source fanout bounded even when many return groups were requested.
  for (const [sourceId, wanted] of live) {
    try {
      const result = await liveSource(sourceId, wanted, feature, plan, dependencies);
      row.matching_sources.push({ source_id: sourceId, matching_record_count: result.items.length,
        records: result.items.slice(0, 50) });
      checks.set(sourceId, result.items.length > 50 ? { status: "partial",
        warning: "Only the first 50 records from this live source are shown." } : {
        status: result.status, warning: result.warning, source_url: entries.get(sourceId).source_url,
        retrieved_at: result.retrieved_at,
        ...(result.count_established === undefined ? {} : { count_established: result.count_established }),
      });
    } catch { checks.set(sourceId, { status: "unavailable", warning: "The official parcel source could not be checked." }); }
  }
  const keep = !work || await projectWork({ row, plan, includes, feature, permits: dependencies.records,
    details: dependencies.details, checks });
  return { row: keep ? row : null, checks };
}

export async function queryParcelData(input, { search = searchIndexedParcels, query = indexQuery,
  catalog = questionPermitCatalog, resolve = resolveParcel, load = loadParcel,
  records = getSourceRecords, details = permitDetails, photo = parcelPhoto, nearby = nearbyFeatureCounts } = {}) {
  const parsed = queryParcelDataSchema.safeParse(input);
  if (!parsed.success) throw new SourceError("Invalid parcel query plan or cursor", 400);
  const { plan, cursor } = parsed.data;
  const registry = parcelQueryCatalog();
  const entries = new Map(registry.sources.map((source) => [source.source_id, source]));
  const invalid = parcelQueryPlanProblem(plan, entries);
  if (invalid) return unsupported(invalid, plan);

  const location = await exactScope(plan.scope, resolve);
  if (!location.scope) return { ...location, plan };
  const isParcel = location.scope.kind === "parcel";
  const requirements = plan.requirements.map(({ date, ...item }) => ({ ...item,
    ...(date ? { event_date_from: date.from, event_date_to: date.to } : {}) }));
  if (location.scope.kind === "neighborhood" || location.scope.kind === "ward") {
    const neighborhood = location.scope.kind === "neighborhood";
    const sourceId = neighborhood ? "neighborhoods" : "wards";
    let match;
    if (neighborhood) {
      try { match = await neighborhoodName(location.scope.name, query); }
      catch { return unavailable("The official City neighborhood index could not be checked.", plan); }
      if (!match) return unsupported("Choose an exact name or label from the official City neighborhood layer.", plan);
    }
    const { field, value } = match ?? { field: "ward", value: location.scope.ward };
    const existing = requirements.find(({ source_id }) => source_id === sourceId);
    if (existing) {
      if (existing.equals?.[field] != null && normalized(existing.equals[field]) !== normalized(value))
        return unsupported("The location scope conflicts with the source filter.", plan);
      existing.equals = { ...existing.equals, [field]: value };
    } else requirements.push({ source_id: sourceId, equals: { [field]: value } });
  }
  const classification = plan.parcel_use_category ? await applyUseCategory(plan.parcel_use_category, requirements, query) : {};
  if (classification.reason) return unsupported(classification.reason, plan);
  if (requirements.length > 5) return unsupported("Use up to five source requirements including the location scope.", plan);
  if (!requirements.length && !isParcel)
    return unsupported("Choose at least one indexed source requirement for a cross-parcel query.", plan);
  const municipal = requirements.find(({ source_id }) => source_id === "municity");
  if (municipal?.equals?.PermitNo && !municipal.equals.PermitType && !municipal.permit_group && !municipal.one_of?.PermitType) {
    if (!permitNumber.test(municipal.equals.PermitNo))
      return unsupported("Enter the published permit number or pair it with an exact permit type.", plan);
    let found;
    try { found = await indexedPermitNumber(municipal.equals.PermitNo, query); }
    catch { return unavailable("The published permit number could not be checked against the private permit index.", plan); }
    if (found.types.length > 1) return { status: "clarify", plan,
      reason: `The index lists that number under ${found.types.join(", ")}. Specify the exact published permit type.` };
    if (!found.types.length) return { status: "coverage_limited", plan, items: [], complete_for_query: false,
      coverage: { index_status: "partial", source_checks: [{ source_id: "municity", status: "partial",
        warning: "The active index returned no exact City parcel link for this permit number." }] } };
    municipal.equals = { ...municipal.equals, PermitType: found.types[0] };
    if (!municipal.event_date_from && !municipal.event_date_to && found.date) {
      municipal.event_date_from = found.date;
      municipal.event_date_to = found.date;
    }
  }
  let permitTypes;
  if (municipal?.equals?.PermitType || municipal?.permit_group || municipal?.one_of?.PermitType) {
    let listed;
    try { listed = await catalog(); } catch { /* Report unavailable below. */ }
    if (!listed || listed.partial) return unavailable("The official City permit type catalog could not be checked.", plan);
    const known = municipal.permit_group ? listed.groups.map(({ name }) => name)
      : listed.groups.flatMap(({ types }) => types.map(({ name }) => name));
    const selected = municipal.one_of?.PermitType ?? [municipal.permit_group ?? municipal.equals.PermitType];
    const available = new Set(known.filter(Boolean).map(normalized));
    if (selected.some((type) => !available.has(normalized(type))))
      return unsupported("Choose an exact type or group from the official City permit catalog.", plan);
    if (municipal.permit_group) permitTypes = [...new Set(listed.groups.filter(({ name }) =>
      normalized(name) === normalized(municipal.permit_group))
      .flatMap(({ types }) => types.map(({ name }) => normalized(name))))].sort();
  }

  if (!requirements.length && !plan.include.length) plan.include = [{ source_id: "parcels" }];
  const hash = fingerprint(plan);
  const sourceHash = fingerprint({ version: registry.version, location });
  const state = readSearchCursor(cursor, hash, sourceHash);
  const indexedSources = plan.include.filter(({ source_id }) => entries.get(source_id).queryable &&
    source_id !== "municity").map(({ source_id }) => source_id);
  // A municipal requirement already supplies the matched permit rows from the index.
  const live = plan.contact_role || plan.permit_description_terms || plan.include.some(({ source_id }) =>
    !indexedSources.includes(source_id) && !(source_id === "municity" && municipal));
  const filtersLive = Boolean(plan.require_contact_role || plan.permit_description_terms);
  const searchPage = (indexCursor) => search({ requirements,
    limit: live ? Math.min(3, plan.limit) : plan.limit, cursor: indexCursor }, { query,
    projection: { sources: indexedSources, parcel: isParcel ? location.scope : null,
      descending: plan.sort === "parcel_desc", permit_types: permitTypes } });
  let result;
  if (requirements.length) result = await searchPage(state.index_cursor);
  else {
    let feature;
    try { feature = await load(location.scope.parcel_id, location.scope.objectid); }
    catch (error) {
      if (error instanceof SourceError && error.status === 404) return { status: "not_found", reason: error.message, plan };
      return unavailable("The exact City parcel could not be loaded.", plan);
    }
    const a = feature.attributes;
    const loaded = load;
    load = (id, objectid) => String(a.parcel_id) === String(id) && String(a.objectid) === String(objectid)
      ? feature : loaded(id, objectid);
    result = { items: [{ city_parcel_id: a.parcel_id, city_objectid: a.objectid,
      city_address: a.property_address, city_parcel_source_url: `${LAYERS.parcels}/${a.objectid}`,
      matching_sources: [] }], coverage: { source_checks: [] }, complete_for_query: true };
  }

  const items = [];
  const sourceChecks = new Map();
  let candidatesChecked = 0;
  const scanDeadline = Date.now() + 20_000;
  let nextIndexCursor;
  do {
    const page = await Promise.all(result.items.map(async (row) => ({ row,
      projected: await projectParcel(row, plan, entries, { load, records, details, photo, nearby }),
    })));
    candidatesChecked += page.length;
    for (const { row, projected } of page) {
      if (projected.row) items.push(projected.row);
      row.source_checks = [...projected.checks].map(([source_id, status]) => ({ source_id, ...status }));
      for (const [id, check] of projected.checks) {
        if (!sourceChecks.has(id) || !good.has(check.status)) sourceChecks.set(id, check);
      }
    }
    nextIndexCursor = result.next_cursor;
    if (!filtersLive || items.length || !nextIndexCursor || candidatesChecked >= 12 ||
        Date.now() >= scanDeadline) break;
    result = await searchPage(nextIndexCursor);
  } while (true);
  if (requirements.some(({ source_id }) => source_id === PERMIT_ACTIVITY_SOURCE)) sourceChecks.set(PERMIT_ACTIVITY_SOURCE,
    { status: "partial", warning: "The activity index covers a bounded parent PermitDate cohort. Matching activity on older or other permits may be outside that cohort." });
  const liveChecks = [...sourceChecks].map(([source_id, status]) => ({ source_id, ...status }));
  const pagePartial = liveChecks.some(({ status }) => !good.has(status));
  const incomplete = state.incomplete || pagePartial || Boolean(classification.warning);
  const nextCursor = nextIndexCursor ? makeSearchCursor({ v: 1, query: hash, source: sourceHash,
    offset: state.offset + candidatesChecked, index_cursor: nextIndexCursor,
    incomplete: Boolean(incomplete), expires: Date.now() + 30 * 60_000 }) : null;
  const complete = Boolean(result.complete_for_query && !incomplete);
  const coverageLimited = incomplete || ["partial", "unavailable", "unconfigured"].includes(result.coverage.index_status);
  return { status: complete ? "ready" : coverageLimited || !nextCursor ? "coverage_limited" : "paging",
    plan, result_grain: "parcel", resolved_scope: location.scope, address_match: location.address_match,
    ...(plan.parcel_use_category ? { use_category: plan.parcel_use_category } : {}),
    items, next_cursor: nextCursor, complete_for_query: complete,
    coverage: { ...result.coverage, live_source_checks: liveChecks, earlier_page_incomplete: Boolean(state.incomplete),
      ...(filtersLive ? { candidate_parcels_checked: candidatesChecked } : {}),
      ...(classification.warning ? { interpretation_warning: classification.warning } : {}),
      returned_this_page: items.length },
    retrieved_at: new Date().toISOString() };
}
