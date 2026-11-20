import { LAYERS } from "./config.js";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { arcgis, cached, fetchJson, SourceError, sqlString } from "./http.js";
import { permitDetails } from "./permit-details.js";

const VENDOR = "https://services5.municity5.com/M5Services/M5Service.svc/GetM5Data";
const VENDOR_LIMIT = 2000;
const CANDIDATE_LIMIT = 50;

const normalized = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
const parcelKey = (value) => normalized(String(value ?? "").replaceAll("/", " "));
const same = (left, right) => normalized(left) === normalized(right);
function sourceDate(value) {
  const raw = String(value ?? "");
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : null;
}
function checkedDate(value, label) {
  if (value == null || value === "") return null;
  const date = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
    throw new SourceError(`Invalid ${label}`, 400);
  return date;
}
function checkedText(value, label, max = 100) {
  const text = String(value ?? "").trim();
  if (!text || text.length > max || /[\x00-\x1f]/.test(text))
    throw new SourceError(`Invalid ${label}`, 400);
  return text;
}
function checkedOptional(value, label, max = 100) {
  return value == null || value === "" ? null : checkedText(value, label, max);
}
function queryRelevantDetailWarnings(detail, { reviewStatus, reviewCompletedFrom, contactRole }) {
  return detail.warnings.filter((warning) =>
    /Full permit fields|Full application fields|linked application could not be verified|child records were unavailable/i.test(warning) ||
    ((reviewStatus || reviewCompletedFrom) && /\bTask\b.*(not returned|malformed|limit)/i.test(warning)) ||
    (contactRole && /\bContact\b.*(not returned|malformed|limit)/i.test(warning)));
}

async function vendorPermits(permitType) {
  return cached(`permit-type-search:v2:${normalized(permitType)}`, async () => {
    const url = new URL(VENDOR);
    for (const [key, value] of Object.entries({ Customer: "NewHavenCityCT", entity: "Permit",
      entity_id: "", fieldtype: "text", mapid: "", mapobject: "", module: "",
      numrecs: String(VENDOR_LIMIT), operator: "=", pid: "", searchfield: "PermitType",
      section: "", value: permitType })) url.searchParams.set(key, value);
    const data = await fetchJson(url, {
      headers: { SourceId: "2" }, timeout: 25000, maxBytes: 35_000_000,
    });
    if (!Array.isArray(data.rows)) {
      if (data.rows === "" && Number(data.total) === 0)
        return { rows: [], returned: 0, limit_reached: false, checked_at: new Date().toISOString() };
      throw new SourceError("Municipal permit search did not return a row list");
    }
    return {
      rows: data.rows.filter((row) => same(row.PermitType, permitType)).map((row) => ({
        Permit_ID: row.Permit_ID, Application_ID: row.Application_ID,
        PermitNo: row.PermitNo, PermitType: row.PermitType,
        PermStatus: row.PermStatus, PermitDate: row.PermitDate,
        PrintKey: row.PrintKey, LegalAddress: row.LegalAddress,
      })),
      returned: data.rows.length,
      limit_reached: data.rows.length >= VENDOR_LIMIT || Number(data.total) > data.rows.length,
      checked_at: new Date().toISOString(),
    };
  });
}

async function neighborhoodParcels(name) {
  return cached(`neighborhood-parcels:v1:${normalized(name)}`, async () => {
    const boundary = await arcgis(LAYERS.neighborhoods, {
      where: `UPPER(neighborhood) = '${sqlString(normalized(name))}' OR UPPER(neighborhood_label) = '${sqlString(normalized(name))}'`,
      outFields: "objectid,neighborhood,neighborhood_label", returnGeometry: "true",
      outSR: "4326", resultRecordCount: "20",
    });
    const zones = boundary.features ?? [];
    if (!zones.length) throw new SourceError("City neighborhood was not found", 404);
    if (boundary.exceededTransferLimit || zones.length >= 20)
      throw new SourceError("City neighborhood lookup was truncated");
    const features = new Map();
    let truncated = false;
    for (const zone of zones) {
      for (let offset = 0; offset < 10000; offset += 1000) {
        const page = await arcgis(LAYERS.parcels, {
          where: "1=1", geometry: JSON.stringify(zone.geometry),
          geometryType: "esriGeometryPolygon", inSR: "4326",
          spatialRel: "esriSpatialRelIntersects", returnGeometry: "false",
          outFields: "objectid,parcel_id,mblu,property_address",
          orderByFields: "objectid", resultOffset: String(offset), resultRecordCount: "1000",
        });
        for (const feature of page.features ?? []) {
          const a = feature.attributes ?? {};
          if (a.parcel_id != null && a.objectid != null)
            features.set(`${a.parcel_id}:${a.objectid}`, feature);
        }
        if (!page.exceededTransferLimit && (page.features ?? []).length < 1000) break;
        if (offset === 9000) truncated = true;
      }
    }
    return { zones: zones.map((zone) => zone.attributes), features: [...features.values()], truncated };
  });
}

export async function searchMunicipalPermits(input = {}) {
  const neighborhood = checkedText(input.neighborhood, "neighborhood", 80);
  const permitType = checkedText(input.permit_type, "permit type");
  const permitStatus = checkedOptional(input.permit_status, "permit status");
  const applicationStatus = checkedOptional(input.application_status, "application status");
  const reviewStatus = checkedOptional(input.review_status, "review status");
  const contactRole = checkedOptional(input.contact_role, "contact role");
  const daysBack = input.days_back == null || input.days_back === "" ? null : Number(input.days_back);
  if (daysBack != null && (!Number.isInteger(daysBack) || daysBack < 1 || daysBack > 365))
    throw new SourceError("Invalid days_back", 400);
  const dateFromDays = daysBack == null ? null : (() => {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() - daysBack);
    return day.toISOString().slice(0, 10);
  })();
  const permitDateFrom = checkedDate(input.permit_date_from, "permit_date_from") ?? dateFromDays;
  const reviewCompletedFrom = checkedDate(input.review_completed_from, "review_completed_from") ??
    (reviewStatus ? dateFromDays : null);
  if (!permitDateFrom) throw new SourceError("Provide permit_date_from or days_back to bound the municipal search", 400);
  const permitDateThrough = checkedDate(input.permit_date_through, "permit_date_through");
  if (permitDateThrough && permitDateThrough < permitDateFrom)
    throw new SourceError("Permit date range is reversed", 400);
  const [vendor, city] = await Promise.all([vendorPermits(permitType), neighborhoodParcels(neighborhood)]);
  const recent = [...new Map(vendor.rows.filter((row) =>
    (!permitStatus || same(row.PermStatus, permitStatus)) &&
    sourceDate(row.PermitDate) >= permitDateFrom &&
    (!permitDateThrough || sourceDate(row.PermitDate) <= permitDateThrough))
    .map((row) => [String(row.Permit_ID), row])).values()];
  const byKey = new Map();
  for (const feature of city.features) {
    const key = parcelKey(feature.attributes?.mblu);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(feature);
  }
  let ambiguousParcelJoins = 0;
  const candidates = recent.flatMap((row) => {
    const joined = byKey.get(parcelKey(row.PrintKey)) ?? [];
    if (joined.length > 1) ambiguousParcelJoins++;
    return joined.length === 1 ? [{ row, parcel: joined[0] }] : [];
  });
  if (candidates.length > CANDIDATE_LIMIT)
    throw new SourceError(`More than ${CANDIDATE_LIMIT} permits match the date and neighborhood. Narrow the permit date range.`, 400);
  const checks = await Promise.allSettled(candidates.map(async ({ row, parcel }) => {
    const detail = await permitDetails(parcel, row.Permit_ID);
    const application = detail.application?.attributes ?? null;
    const linkedApplicationId = Number(application?.Application_ID);
    const queryWarnings = queryRelevantDetailWarnings(detail, { reviewStatus, reviewCompletedFrom, contactRole });
    if (applicationStatus && !same(application?.PermitApplicationStatus ?? application?.ApplicationStatus, applicationStatus))
      return { excluded: true, queryWarnings };
    const tasks = detail.items.filter((item) => item.category === "Task" &&
      item.attributes.Entity === "Application" &&
      Number(item.attributes.Entity_ID) === linkedApplicationId &&
      (!reviewStatus || same(item.attributes.ApprovalStatus, reviewStatus)) &&
      (!reviewCompletedFrom || (sourceDate(item.attributes.DateCompleted) ?? "") >= reviewCompletedFrom));
    if ((reviewStatus || reviewCompletedFrom) && !tasks.length) return { excluded: true, queryWarnings };
    const contacts = detail.items.filter((item) => item.category === "Contact" &&
      (!contactRole || same(item.attributes.ContactRole, contactRole)));
    if (input.require_contact_role === true && !contacts.length) return { excluded: true, queryWarnings };
    return {
      city_parcel_id: Number(parcel.attributes.parcel_id),
      city_objectid: Number(parcel.attributes.objectid),
      city_address: parcel.attributes.property_address ?? null,
      permit_address: row.LegalAddress ?? null,
      mblu: parcel.attributes.mblu ?? null,
      permit: { Permit_ID: detail.permit.attributes.Permit_ID,
        PermitNo: detail.permit.attributes.PermitNo,
        PermitType: detail.permit.attributes.PermitType,
        PermStatus: detail.permit.attributes.PermStatus,
        PermitDate: detail.permit.attributes.PermitDate,
        Department: detail.permit.attributes.Department,
        source_url: detail.permit.source_url },
      application: application ? {
        Application_ID: application.Application_ID,
        ApplicationNumber: application.ApplicationNumber ?? application.ApplicaNo ?? null,
        PermitApplicationStatus: application.PermitApplicationStatus ?? application.ApplicationStatus ?? null,
        ApplicationDate: application.ApplicationDate ?? null,
        source_url: detail.application.source_url,
      } : null,
      review_tasks: tasks.map((item) => ({ source_record_id: item.source_record_id,
        TaskType: item.attributes.TaskType, ApprovalStatus: item.attributes.ApprovalStatus,
        DateCompleted: item.attributes.DateCompleted, AssignedTo: item.attributes.AssignedTo,
        source_url: item.source_url })),
      contacts: contacts.map((item) => ({ source_record_id: item.source_record_id,
        ...item.attributes, source_url: item.source_url })),
      match: { parcel: "municipal PrintKey equals City parcel MBLU",
        neighborhood: "City parcel polygon intersects City neighborhood polygon" },
      detail_partial: detail.partial,
      detail_warnings: detail.warnings,
      query_detail_partial: queryWarnings.length > 0,
      query_detail_warnings: queryWarnings,
      city_parcel_source_url: `${LAYERS.parcels}/query?f=json&objectIds=${Number(parcel.attributes.objectid)}&outFields=*`,
    };
  }));
  const failures = checks.filter((check) => check.status === "rejected").length;
  const checked = checks.flatMap((check) => check.status === "fulfilled" && check.value ? [check.value] : []);
  const items = checked.filter((item) => !item.excluded);
  const excludedQueryWarnings = checked.filter((item) => item.excluded)
    .flatMap((item) => item.queryWarnings);
  const partial = vendor.limit_reached || city.truncated || failures > 0 ||
    ambiguousParcelJoins > 0 || excludedQueryWarnings.length > 0 ||
    items.some((item) => item.query_detail_partial);
  return {
    criteria: { neighborhood, permit_type: permitType, permit_status: permitStatus,
      permit_date_from: permitDateFrom, permit_date_through: permitDateThrough,
      application_status: applicationStatus, review_status: reviewStatus,
      review_completed_from: reviewCompletedFrom, contact_role: contactRole,
      require_contact_role: input.require_contact_role === true,
      date_rule: "Date filters compare source calendar dates inclusively. days_back applies to permit dates and, when review_status is supplied, review completion dates." },
    coverage: { municipal_type_rows_returned: vendor.returned ?? 0,
      municipal_limit_reached: vendor.limit_reached,
      city_neighborhood_polygon_count: city.zones.length,
      city_neighborhood_source_url: LAYERS.neighborhoods,
      city_intersecting_parcels: city.features.length,
      city_parcel_query_truncated: city.truncated,
      recent_permits_after_source_filters: recent.length,
      joined_parcel_candidates: candidates.length,
      ambiguous_parcel_joins: ambiguousParcelJoins,
      detail_checks_failed: failures,
      excluded_query_detail_warning_count: excludedQueryWarnings.length,
      optional_detail_partial_count: items.filter((item) => item.detail_partial && !item.query_detail_partial).length,
      returned_count: items.length,
    },
    partial, items, retrieved_at: new Date().toISOString(),
    note: "This search joins the municipal permit PrintKey to City parcel MBLU and City neighborhood geometry. An Approved review task is not the application status; both are reported separately. Contractor phone, email and address appear only where the municipal contact role is explicitly marked public. The top-level partial flag covers the query criteria; optional child-detail gaps remain visible per item. Results may be incomplete when partial is true.",
  };
}

// A bounded, stateless cross-parcel scan. Its cursor records cumulative gaps,
// so the final page cannot describe an earlier failed check as complete.
const SCAN_LIMIT = 12;
const MAX_TYPES = 6;
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const checkedRange = (from, to, name) => {
  const start = checkedDate(from, `${name}_from`);
  const end = checkedDate(to, `${name}_to`);
  if (start && end && start > end) throw new SourceError(`Invalid ${name} range`, 400);
  return [start, end];
};
const inRange = (value, from, to) => (!from || value >= from) && (!to || value <= to);
const searchGap = () => ({ scanned: 0, matched: 0, unjoined: 0, ambiguous: 0,
  detail_failed: 0, criteria_unverified: 0, city_truncated: 0 });

function cursorKey() {
  const key = process.env.PILOT_COOKIE_SECRET;
  if (!key || key.length < 24) throw new SourceError("Pilot cursor signing is not configured");
  return key;
}
function encodeSearchCursor(state) {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = createHmac("sha256", cursorKey()).update(body).digest("base64url");
  return `${body}.${signature}`;
}
function decodeSearchCursor(value, queryHash, sourceHash) {
  if (!value) return { offset: 0, cumulative: searchGap() };
  const raw = String(value);
  if (raw.length > 1500 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw))
    throw new SourceError("Invalid search cursor", 400);
  const [body, signature] = raw.split(".");
  const expected = createHmac("sha256", cursorKey()).update(body).digest("base64url");
  const left = Buffer.from(signature), right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right))
    throw new SourceError("Invalid search cursor", 400);
  let state;
  try { state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); }
  catch { throw new SourceError("Invalid search cursor", 400); }
  if (state?.v !== 1 || state.query !== queryHash ||
    !Number.isSafeInteger(state.offset) || state.offset < 0 ||
    !state.cumulative || Object.keys(searchGap()).some((key) =>
      !Number.isSafeInteger(state.cumulative[key]) || state.cumulative[key] < 0))
    throw new SourceError("Search cursor does not match these criteria", 400);
  if (state.source !== sourceHash)
    throw new SourceError("Municipal search results changed; restart without the cursor", 409);
  return state;
}

async function cityParcelsForPermitKeys(rows) {
  const keys = [...new Set(rows.map((row) => parcelKey(row.PrintKey)).filter(Boolean))];
  if (!keys.length) return { features: [], truncated: false };
  const variants = [...new Set(keys.flatMap((key) => [key, key.replaceAll(" ", "/")]))];
  const data = await arcgis(LAYERS.parcels, {
    where: `UPPER(mblu) IN (${variants.map((key) => `'${sqlString(key)}'`).join(",")})`,
    outFields: "objectid,parcel_id,mblu,property_address",
    returnGeometry: "false", resultRecordCount: "1000",
  });
  return { features: data.features ?? [],
    truncated: Boolean(data.exceededTransferLimit || (data.features ?? []).length >= 1000) };
}

export async function searchParcelPermits(input = {}) {
  const scope = input.scope ?? "city";
  if (!["city", "neighborhood"].includes(scope)) throw new SourceError("Invalid search scope", 400);
  const neighborhood = scope === "neighborhood" ? checkedText(input.neighborhood, "neighborhood", 80) : null;
  if (scope === "city" && input.neighborhood) throw new SourceError("Neighborhood requires neighborhood scope", 400);
  const rawTypes = Array.isArray(input.permit_types) ? input.permit_types : [];
  if (!rawTypes.length || rawTypes.length > MAX_TYPES) throw new SourceError("Provide one to six exact permit types", 400);
  const types = [...new Map(rawTypes.map((value) => {
    const name = checkedText(value, "permit type");
    return [normalized(name), name];
  })).values()].sort((a, b) => a.localeCompare(b));
  const permitStatus = checkedOptional(input.permit_status, "permit status");
  const applicationStatus = checkedOptional(input.application_status, "application permit status");
  const reviewStatus = checkedOptional(input.review_status, "review status");
  const reviewType = checkedOptional(input.review_type, "review type");
  const contactRole = checkedOptional(input.contact_role, "contact role");
  const rawTerms = input.permit_description_terms ?? [];
  if (!Array.isArray(rawTerms) || rawTerms.length > 6)
    throw new SourceError("Provide up to six permit description terms", 400);
  const descriptionTerms = [...new Set(rawTerms.map((term) => checkedText(term, "description term", 80)))];
  if (input.require_contact_role != null && typeof input.require_contact_role !== "boolean")
    throw new SourceError("Invalid require_contact_role", 400);
  if (input.require_contact_role && !contactRole)
    throw new SourceError("A required contact role must be named", 400);
  const [permitFrom, permitTo] = checkedRange(input.permit_date_from, input.permit_date_to, "permit_date");
  const [reviewFrom, reviewTo] = checkedRange(input.review_completed_from, input.review_completed_to, "review_completed");
  const scanLimit = input.scan_limit == null ? 8 : Number(input.scan_limit);
  if (!Number.isSafeInteger(scanLimit) || scanLimit < 1 || scanLimit > SCAN_LIMIT)
    throw new SourceError(`scan_limit must be 1–${SCAN_LIMIT}`, 400);
  const criteria = {
    scope, neighborhood, permit_types: types, permit_status: permitStatus,
    permit_date_from: permitFrom, permit_date_to: permitTo,
    application_status: applicationStatus, review_type: reviewType,
    review_status: reviewStatus, review_completed_from: reviewFrom,
    review_completed_to: reviewTo, contact_role: contactRole,
    require_contact_role: input.require_contact_role === true,
    ...(descriptionTerms.length ? { permit_description_terms: descriptionTerms } : {}),
  };
  const queryHash = digest(criteria);
  const settled = await Promise.allSettled(types.map((type) => vendorPermits(type)));
  const sourceChecks = types.map((type, index) => {
    const check = settled[index];
    return check.status === "fulfilled"
      ? { permit_type: type, status: check.value.limit_reached ? "partial" : "ok",
        returned: check.value.returned, limit_reached: check.value.limit_reached,
        checked_at: check.value.checked_at, source_url: VENDOR }
      : { permit_type: type, status: "unavailable", returned: null,
        warning: check.reason instanceof SourceError ? check.reason.message : "Municipal type search failed",
        source_url: VENDOR };
  });
  const sourceRows = settled.flatMap((check) => check.status === "fulfilled" ? check.value.rows : []);
  const distinct = new Map();
  let conflictingIds = 0;
  for (const row of sourceRows) {
    const id = Number(row.Permit_ID);
    if (!Number.isSafeInteger(id) || id <= 0) { conflictingIds++; continue; }
    const prior = distinct.get(id);
    if (prior && (parcelKey(prior.PrintKey) !== parcelKey(row.PrintKey) ||
      !same(prior.PermitType, row.PermitType))) {
      distinct.set(id, null);
      conflictingIds++;
    } else if (!prior && !distinct.has(id)) distinct.set(id, row);
  }
  let missingFilterFields = 0;
  const candidates = [...distinct.values()].filter(Boolean).filter((row) => {
    if (permitStatus) {
      if (!row.PermStatus) { missingFilterFields++; return false; }
      if (!same(row.PermStatus, permitStatus)) return false;
    }
    if (permitFrom || permitTo) {
      const date = sourceDate(row.PermitDate);
      if (!date) { missingFilterFields++; return false; }
      if (!inRange(date, permitFrom, permitTo)) return false;
    }
    return true;
  }).sort((a, b) => (sourceDate(b.PermitDate) ?? "").localeCompare(sourceDate(a.PermitDate) ?? "") ||
    Number(b.Permit_ID) - Number(a.Permit_ID));
  const sourceHash = digest({ checks: sourceChecks.map(({ permit_type, status, returned }) =>
    [permit_type, status, returned]), missingFilterFields, conflictingIds,
    candidates: candidates.map((row) =>
    [row.Permit_ID, row.Application_ID, row.PermitType, row.PermStatus,
      row.PermitDate, row.PrintKey, row.LegalAddress]) });
  const cursor = decodeSearchCursor(input.cursor, queryHash, sourceHash);
  if (cursor.offset > candidates.length) throw new SourceError("Search cursor is beyond current results", 400);
  const page = candidates.slice(cursor.offset, cursor.offset + scanLimit);
  const city = scope === "city"
    ? await cityParcelsForPermitKeys(page)
    : await neighborhoodParcels(neighborhood);
  const cityFeatures = city.features ?? [];
  const byKey = new Map();
  for (const feature of cityFeatures) {
    const key = parcelKey(feature.attributes?.mblu);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(feature);
  }
  const cumulative = { ...cursor.cumulative };
  const pageCoverage = searchGap();
  if (city.truncated) pageCoverage.city_truncated++;
  const verified = [];
  for (const row of page) {
    pageCoverage.scanned++;
    const matches = byKey.get(parcelKey(row.PrintKey)) ?? [];
    if (matches.length !== 1) {
      if (matches.length > 1) pageCoverage.ambiguous++;
      else if (scope === "city") pageCoverage.unjoined++;
      continue;
    }
    verified.push({ row, parcel: matches[0] });
  }
  const reviewFilter = Boolean(reviewStatus || reviewType || reviewFrom || reviewTo);
  const items = [];
  // Each detail read verifies the municipal parcel child and linked application.
  // Bound concurrency because one detail can require several official calls.
  for (let at = 0; at < verified.length; at += 3) {
    const batch = await Promise.allSettled(verified.slice(at, at + 3).map(async ({ row, parcel }) => ({
      row, parcel, detail: await permitDetails(parcel, row.Permit_ID),
    })));
    for (const check of batch) {
      if (check.status === "rejected") { pageCoverage.detail_failed++; continue; }
      const { row, parcel, detail } = check.value;
      const application = detail.application?.attributes ?? null;
      const applicationId = Number(application?.Application_ID);
      const relevantWarnings = queryRelevantDetailWarnings(detail, {
        reviewStatus, reviewCompletedFrom: reviewFrom, contactRole,
      });
      if ((reviewType || reviewTo) && detail.warnings.some((warning) =>
        /\bTask\b.*(not returned|malformed|limit)/i.test(warning)))
        relevantWarnings.push("Review task category was incomplete.");
      if (applicationStatus && detail.warnings.some((warning) =>
        /Full application fields|linked application could not be verified/i.test(warning)))
        relevantWarnings.push("Linked application status was not fully checked.");
      const missingApplicationStatus = Boolean(applicationStatus && !application?.PermitApplicationStatus);
      const description = detail.permit?.attributes?.Description;
      const missingDescription = descriptionTerms.length > 0 && !normalized(description);
      if (relevantWarnings.length || missingApplicationStatus || missingDescription) pageCoverage.criteria_unverified++;
      if (descriptionTerms.length && !descriptionTerms.some((term) => normalized(description).includes(normalized(term))))
        continue;
      if (applicationStatus && !same(application?.PermitApplicationStatus, applicationStatus)) {
        continue;
      }
      const applicableTasks = detail.items.filter((item) => item.category === "Task" &&
        item.attributes.Entity === "Application" &&
        Number(item.attributes.Entity_ID) === applicationId &&
        (!reviewType || same(item.attributes.TaskType, reviewType)) &&
        (!reviewStatus || same(item.attributes.ApprovalStatus, reviewStatus)));
      const missingReviewDate = Boolean((reviewFrom || reviewTo) &&
        applicableTasks.some((item) => !sourceDate(item.attributes.DateCompleted)));
      if (missingReviewDate && !relevantWarnings.length && !missingApplicationStatus)
        pageCoverage.criteria_unverified++;
      const tasks = applicableTasks.filter((item) => {
        if (!reviewFrom && !reviewTo) return true;
        const completed = sourceDate(item.attributes.DateCompleted);
        return Boolean(completed && inRange(completed, reviewFrom, reviewTo));
      });
      if (reviewFilter && !tasks.length) continue;
      const contacts = detail.items.filter((item) => item.category === "Contact" &&
        (!contactRole || same(item.attributes.ContactRole, contactRole)));
      if (input.require_contact_role === true && !contacts.length) {
        if (detail.warnings.some((warning) => /\bContact\b.*(not returned|malformed|limit)/i.test(warning)) &&
          !relevantWarnings.length)
          pageCoverage.criteria_unverified++;
        continue;
      }
      pageCoverage.matched++;
      items.push({
        city_parcel_id: Number(parcel.attributes.parcel_id),
        city_objectid: Number(parcel.attributes.objectid),
        city_address: parcel.attributes.property_address ?? null,
        permit_address: row.LegalAddress ?? null,
        mblu: parcel.attributes.mblu ?? null,
        permit: {
          Permit_ID: detail.permit.attributes.Permit_ID,
          PermitNo: detail.permit.attributes.PermitNo,
          PermitType: detail.permit.attributes.PermitType,
          PermStatus: detail.permit.attributes.PermStatus,
          PermitDate: detail.permit.attributes.PermitDate,
          Department: detail.permit.attributes.Department,
          ...(descriptionTerms.length ? { Description: description } : {}),
          source_url: detail.permit.source_url,
        },
        application: application ? {
          Application_ID: application.Application_ID,
          ApplicationNumber: application.ApplicationNumber ?? application.ApplicaNo ?? null,
          Status: application.Status ?? null,
          PermitApplicationStatus: application.PermitApplicationStatus ?? null,
          ApplicationDate: application.ApplicationDate ?? null,
          source_url: detail.application.source_url,
        } : null,
        review_tasks: tasks.map((item) => ({
          source_record_id: item.source_record_id,
          TaskType: item.attributes.TaskType,
          ApprovalStatus: item.attributes.ApprovalStatus,
          DateCompleted: item.attributes.DateCompleted,
          AssignedTo: item.attributes.AssignedTo,
          source_url: item.source_url,
        })),
        contacts: contacts.map((item) => ({
          source_record_id: item.source_record_id, ...item.attributes,
          source_url: item.source_url,
        })),
        match: {
          method: "municipal-printkey-city-mblu-exact",
          municipal_printkey: row.PrintKey,
          city_mblu: parcel.attributes.mblu,
          ...(scope === "neighborhood" ? { geography: "City parcel polygon intersects City neighborhood polygon" } : {}),
        },
        detail_partial: detail.partial,
        detail_warnings: detail.warnings,
        query_detail_partial: relevantWarnings.length > 0,
        city_parcel_source_url: `${LAYERS.parcels}/query?f=json&objectIds=${Number(parcel.attributes.objectid)}&outFields=*`,
      });
    }
  }
  for (const key of Object.keys(cumulative)) cumulative[key] += pageCoverage[key];
  const nextOffset = cursor.offset + page.length;
  const nextCursor = nextOffset < candidates.length
    ? encodeSearchCursor({ v: 1, query: queryHash, source: sourceHash,
      offset: nextOffset, cumulative })
    : null;
  const sourceIncomplete = sourceChecks.some((check) => check.status !== "ok") ||
    missingFilterFields > 0 || conflictingIds > 0;
  return {
    criteria,
    items,
    next_cursor: nextCursor,
    complete_for_query: !nextCursor && !sourceIncomplete &&
      cumulative.unjoined === 0 && cumulative.ambiguous === 0 &&
      cumulative.detail_failed === 0 && cumulative.criteria_unverified === 0 &&
      cumulative.city_truncated === 0,
    coverage: {
      source_checks: sourceChecks,
      municipal_rows_returned: sourceRows.length,
      municipal_source_limit: VENDOR_LIMIT,
      candidate_permits_after_source_filters: candidates.length,
      source_rows_with_missing_filter_fields: missingFilterFields,
      conflicting_or_missing_permit_ids: conflictingIds,
      city_scope: scope,
      city_parcel_source_url: LAYERS.parcels,
      ...(scope === "neighborhood" ? {
        neighborhood_source_url: LAYERS.neighborhoods,
        city_intersecting_parcels: cityFeatures.length,
      } : {}),
      city_parcel_query_truncated: Boolean(city.truncated),
      page: pageCoverage,
      cumulative,
      remaining_candidate_permits: candidates.length - nextOffset,
      returned_count: items.length,
      distinct_city_parcels_on_page: new Set(items.map((item) =>
        `${item.city_parcel_id}:${item.city_objectid}`)).size,
    },
    retrieved_at: new Date().toISOString(),
    note: "This is one bounded candidate-scan page. PermitDate and linked application review DateCompleted are separate published fields. Only exact municipal PrintKey-to-City MBLU joins are returned. Follow next_cursor until absent before treating complete_for_query as a whole-query claim; partial source checks and unverified joins remain visible in coverage.",
  };
}
