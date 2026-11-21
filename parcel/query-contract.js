import { z } from "zod";
import { indexSourceCatalog } from "../search-index/catalog.js";
import { MUNICIPAL_LICENSE_SOURCE } from "../search-index/municipal-licenses.js";
import { PERMIT_ACTIVITY_KINDS, PERMIT_ACTIVITY_SOURCE, PERMIT_ACTIVITY_TYPES } from "../search-index/permit-activity-source.js";
import { NUMBER_FIELDS, PARCEL_QUERY_FIELDS } from "../search-index/search.js";
import { STATE_ADDRESS_SOURCES } from "../search-index/socrata.js";
import { SOURCES } from "./config.js";

export const QUERY_CATALOG_VERSION = 1;
export const queryDateFields = { parcels: "sale_date", municity: "PermitDate",
  [MUNICIPAL_LICENSE_SOURCE]: "IssueDate",
  ...Object.fromEntries(Object.entries(STATE_ADDRESS_SOURCES).map(([id, source]) => [id, source.event_date])) };

export const relatedPermitFields = {
  "permit-contacts": ["Contact_ID", "Fullname", "ContactRole", "ContactType", "CompanyName",
    "ContactLicenseNumber", "ContactLicenseExpirationDate", "Phone", "Email", "EMailAddress",
    "Addr1", "City", "State", "ZipCode"],
  "permit-applications": ["Application_ID", "ApplicationNumber", "ApplicaNo", "ApplicationType",
    "PermitApplicationStatus", "ApplicationStatus", "ApplicationDate", "Status", "Department"],
  "permit-reviews": ["Task_ID", "TaskType", "Subject", "ApprovalStatus", "Department", "AssignedTo", "DateCompleted"],
  "permit-inspections": ["Inspection_ID", "InspType", "Status", "Results", "Department",
    "SchedDate", "CloseDate", "NextInspDate"],
  "permit-fees": ["Fee_ID", "Amount", "Date", "FeeCategory", "FeeType", "FeePaid", "FeeVoided", "Status", "InvoiceNumber"],
  "permit-documents": ["Document_ID", "Name", "Description", "DocumentType", "Date", "Public", "public_document_url"],
  "permit-communications": ["Communication_ID", "CommunicationType_ID", "Title", "CreatedDate", "Modified"],
  "permit-flags": ["Flag_ID", "FlagType", "Description", "Status", "StartDate", "EndDate"],
};
const liveFields = {
  "parcel-photo": ["photo_url", "photo_source_id"],
  assessor: ["building_facts", "lblPID", "lblOwner", "lblCoOwner", "lblYearBuilt", "lblStyle", "building_photo_url"],
  "assessor-owner": ["owner_name", "co_owner_name", "mailing_address_lines", "parcel_id"],
  "assessor-subareas": ["code", "description_as_published", "gross_area_sq_ft", "living_area_sq_ft",
    "building_number", "section_number", "section_heading_as_published"],
  "assessor-sales": ["sale_date", "sale_price", "book_page"],
  "assessor-valuations": ["valuation_year", "valuation_type", "table_section", "improvements", "land", "total"],
  "metered-parking-spaces": ["mapped_count", "radius_meters", "origin", "nearest"],
  "transit-stops": ["mapped_count", "radius_meters", "origin", "nearest"],
};
const liveRelated = Object.keys(relatedPermitFields);

export function parcelQueryCatalog() {
  const coverage = indexSourceCatalog();
  const entries = coverage.map((source) => {
    const official = SOURCES.find(({ id }) => id === source.source_id);
    const exact = PARCEL_QUERY_FIELDS[source.source_id] ?? [];
    return {
      ...source, title: official?.title ?? ({
        [PERMIT_ACTIVITY_SOURCE]: "Indexed permit applications, reviews and inspections",
        "municity-permit-types": "Official permit type catalog",
        "metered-parking-spaces": "Mapped metered parking spaces",
        "transit-stops": "Mapped transit stops",
      })[source.source_id] ?? source.source_id,
      group: official?.group ?? "activity",
      queryable: Object.hasOwn(PARCEL_QUERY_FIELDS, source.source_id),
      projectable: Object.hasOwn(PARCEL_QUERY_FIELDS, source.source_id) ||
        Boolean(liveFields[source.source_id]) ||
        (official?.mode === "live" && source.search_mode !== "excluded_from_search"),
      filters: {
        equals: exact, one_of: source.source_id === "parcels" ? ["use_code"] : source.source_id === "municity" ? ["PermitType"] : [],
        number_gte: NUMBER_FIELDS[source.source_id] ?? [],
        number_lte: NUMBER_FIELDS[source.source_id] ?? [],
        date_fields: source.source_id === PERMIT_ACTIVITY_SOURCE
          ? Object.values(PERMIT_ACTIVITY_KINDS).map(({ date }) => date)
          : [queryDateFields[source.source_id]].filter(Boolean),
      },
      return_fields: exact.length ? [...new Set([...exact, queryDateFields[source.source_id],
        ...(source.source_id === "trash-pickup" ? ["trash_day_name"] : []),
        ...(source.source_id === PERMIT_ACTIVITY_SOURCE
          ? Object.values(PERMIT_ACTIVITY_KINDS).flatMap(({ date, fields }) => [date, ...fields]) : []),
      ].filter(Boolean))] : liveFields[source.source_id] ?? [],
      ...(source.source_id === PERMIT_ACTIVITY_SOURCE ? { indexed_permit_types: PERMIT_ACTIVITY_TYPES,
        activity_dates: Object.fromEntries(Object.entries(PERMIT_ACTIVITY_KINDS).map(([kind, { date }]) => [kind, date])) } : {}),
    };
  });
  return {
    version: QUERY_CATALOG_VERSION, result_grain: "parcel", default_limit: 25, maximum_limit: 50,
    plan_fields: {
      scope: ["city", "parcel", "address", "neighborhood", "ward"],
      parcel_use_category: ["business_space", "commercial_only", "residential", "mixed_use"],
      sort: ["parcel_asc", "parcel_desc"],
    },
    sources: [...entries, ...[...liveRelated, "parcel-photo"].map((id) => ({
      source_id: id, title: id.replaceAll("-", " "), group: "activity",
      source_url: SOURCES.find((source) => source.id === "municity").url,
      search_mode: "live_projection",
      queryable: false,
      projectable: true,
      return_fields: relatedPermitFields[id] ?? liveFields[id] ?? [],
      ...(id === "permit-contacts" ? { filters: { equals: ["ContactRole"] },
        coverage: "Published contacts on the matched permit or its verified application. Direct Contractor details require a source-public role." } : {}),
    }))],
  };
}

const label = z.string().trim().min(1).max(160).regex(/^[^\x00-\x1f]+$/);
const id = z.string().regex(/^\d{1,12}$/);
const field = z.string().min(1).max(100);
const date = z.iso.date();
const exact = z.record(field, z.union([label, z.number()])).optional();
const numeric = z.record(field, z.number()).optional();
const requirement = z.strictObject({
  source_id: field, equals: exact, number_gte: numeric, number_lte: numeric,
  one_of: z.record(field, z.array(label).min(1).max(250)).optional(), permit_group: label.optional(),
  date: z.strictObject({ field, from: date.optional(), to: date.optional() }).optional(),
});

export const parcelQueryPlanSchema = z.strictObject({
  scope: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("city") }),
    z.strictObject({ kind: z.literal("parcel"), parcel_id: id, objectid: id.optional() }),
    z.strictObject({ kind: z.literal("address"), address: label, parcel_id: id.optional(), objectid: id.optional(),
      address_mode: z.literal("whole_parcel").optional() }),
    z.strictObject({ kind: z.literal("neighborhood"), name: label }),
    z.strictObject({ kind: z.literal("ward"), ward: z.number().int().min(1).max(99) }),
  ]).default({ kind: "city" }),
  requirements: z.array(requirement).max(5).default([]),
  include: z.array(z.strictObject({ source_id: field, fields: z.array(field).min(1).max(30).optional(),
    record_category: z.literal("Permit").optional() })).max(12).default([]),
  contact_role: label.optional(),
  parcel_use_category: z.enum(["business_space", "commercial_only", "residential", "mixed_use"]).optional(),
  require_contact_role: z.boolean().optional(),
  permit_description_terms: z.array(label).min(1).max(6).optional(),
  radius_meters: z.number().int().min(25).max(1000).optional(),
  sort: z.enum(["parcel_asc", "parcel_desc"]).default("parcel_asc"),
  limit: z.number().int().min(1).max(50).default(25),
});

export const queryParcelDataSchema = z.strictObject({
  plan: parcelQueryPlanSchema, cursor: z.string().max(3000).optional(),
});
export const askParcelDataSchema = z.strictObject({
  question: z.string().trim().min(1).max(1000),
  plan_only: z.boolean().optional(),
  clarification: z.strictObject({
    id: z.enum(["work_date", "parcel"]), choice: label,
  }).optional(),
});
