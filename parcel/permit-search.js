import { LAYERS } from "./config.js";
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

async function vendorPermits(permitType) {
  return cached(`permit-type-search:v1:${normalized(permitType)}`, async () => {
    const url = new URL(VENDOR);
    for (const [key, value] of Object.entries({ Customer: "NewHavenCityCT", entity: "Permit",
      entity_id: "", fieldtype: "text", mapid: "", mapobject: "", module: "",
      numrecs: String(VENDOR_LIMIT), operator: "=", pid: "", searchfield: "PermitType",
      section: "", value: permitType })) url.searchParams.set(key, value);
    const data = await fetchJson(url, {
      headers: { SourceId: "2" }, timeout: 25000, maxBytes: 35_000_000,
    });
    if (!Array.isArray(data.rows)) {
      if (data.rows === "" && Number(data.total) === 0) return { rows: [], limit_reached: false };
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
    if (applicationStatus && !same(application?.PermitApplicationStatus ?? application?.ApplicationStatus, applicationStatus))
      return null;
    const tasks = detail.items.filter((item) => item.category === "Task" &&
      item.attributes.Entity === "Application" &&
      Number(item.attributes.Entity_ID) === linkedApplicationId &&
      (!reviewStatus || same(item.attributes.ApprovalStatus, reviewStatus)) &&
      (!reviewCompletedFrom || (sourceDate(item.attributes.DateCompleted) ?? "") >= reviewCompletedFrom));
    if ((reviewStatus || reviewCompletedFrom) && !tasks.length) return null;
    const contacts = detail.items.filter((item) => item.category === "Contact" &&
      (!contactRole || same(item.attributes.ContactRole, contactRole)));
    if (input.require_contact_role === true && !contacts.length) return null;
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
      city_parcel_source_url: `${LAYERS.parcels}/query?f=json&objectIds=${Number(parcel.attributes.objectid)}&outFields=*`,
    };
  }));
  const failures = checks.filter((check) => check.status === "rejected").length;
  const items = checks.flatMap((check) => check.status === "fulfilled" && check.value ? [check.value] : []);
  const partial = vendor.limit_reached || city.truncated || failures > 0 ||
    ambiguousParcelJoins > 0 || items.some((item) => item.detail_partial);
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
      returned_count: items.length,
    },
    partial, items, retrieved_at: new Date().toISOString(),
    note: "This search joins the municipal permit PrintKey to City parcel MBLU and City neighborhood geometry. An Approved review task is not the application status; both are reported separately. Contractor phone, email and address appear only where the municipal contact role is explicitly marked public. Results may be incomplete when partial is true.",
  };
}
