import useCodes from "../data/city-use-codes.json" with { type: "json" };
import { SourceError } from "./http.js";

const parcelLayer = "https://gis.newhavenct.gov/server/rest/services/Hosted/New_Haven_Parcels_Authoritative_Parcel_Viewer/FeatureServer/0";
const vendor = "https://www.municityconnect.com/#/app/NewHavenCityCT/landing";
const neighborhoods = "https://gis.newhavenct.gov/server/rest/services/Hosted/Neighborhoods_(View)/FeatureServer/0";
const cmt = "https://www.newhavenct.gov/government/community-management-team";

// These are reviewed navigation notes. Source facts and this service's reading
// rules are kept separate so clients cannot mistake a query convention for a
// field definition published by the City.
export const DATA_CONTEXT = Object.freeze([
  { id: "city-parcel", term: "City parcel", source_id: "parcels",
    official_source_url: parcelLayer,
    source_fact: "The City parcel layer publishes parcel identifiers, property addresses, use codes and mapped parcel geometry.",
    reading_rule: "A parcel polygon is a land boundary, not a building footprint or proof of current occupancy." },
  { id: "city-use-code", term: "Parcel use code", source_id: "parcels", field: "use_code",
    official_source_url: parcelLayer,
    source_fact: "The City parcel layer publishes a use_code value for a parcel when available.",
    reading_rule: "Keep the published code. A commercial grouping requires an official code definition and a reviewed mapping; zoning is a different field." },
  { id: "commercial-parcel-query", term: "Commercial parcel search", source_id: "parcels", field: "use_code",
    official_source_url: parcelLayer,
    source_fact: "The City publishes parcel use codes and commercial-unit fields separately.",
    reading_rule: "This demo uses only a reviewed set of use codes describing business space. An unreviewed code stops a complete commercial result." },
  { id: "municipal-permit-type", term: "Permit type", source_id: "municity", field: "PermitType",
    official_source_url: vendor,
    source_fact: "The municipal permit service publishes a PermitType on permit records and a separate type catalog.",
    reading_rule: "A catalog entry alone does not establish that a permit exists. Search by one exact published type." },
  { id: "municipal-permit-date", term: "Permit date", source_id: "municity", field: "PermitDate",
    official_source_url: vendor,
    source_fact: "Municipal permit records publish PermitDate separately from PermStatus.",
    reading_rule: "In this demo, 'pulled' means the published PermitDate. It does not mean issued, approved, or work completed." },
  { id: "municipal-permit-status", term: "Permit status", source_id: "municity", field: "PermStatus",
    official_source_url: vendor,
    source_fact: "Municipal permit records publish PermStatus.",
    reading_rule: "Return the exact status. Do not infer it from PermitDate or a linked application's review task." },
  { id: "city-neighborhood", term: "City neighborhood", source_id: "neighborhoods",
    official_source_url: neighborhoods,
    source_fact: "The City hosts mapped neighborhood polygons.",
    reading_rule: "A spatially intersecting City parcel can be filtered by the published neighborhood polygon; the relationship is a map intersection." },
  { id: "community-management-team", term: "Community Management Team", source_id: "cmt",
    official_source_url: cmt,
    source_fact: "The City describes CMT meetings as a place for neighbors to discuss community events, public safety and neighborhood issues; meetings are open to all.",
    reading_rule: "A mapped CMT district identifies a community team area. Its contacts do not establish parcel ownership or municipal representation." },
  { id: "exact-parcel-join", term: "Exact parcel join", source_id: "municity",
    official_source_url: parcelLayer,
    source_fact: "The City parcel layer publishes parcel IDs and MBLUs; municipal permit rows can publish parcel keys.",
    reading_rule: "Cross-source matches require a unique published key relationship to the selected City parcel. A similar address alone is insufficient." },
  { id: "search-coverage", term: "Search coverage", source_id: "municity",
    official_source_url: vendor,
    source_fact: "The municipal service supplies rows and count information for its searches.",
    reading_rule: "A source limit, stale refresh, missing row, or unlinked permit makes an 'all parcels' answer incomplete; an empty result cannot be called zero." },
].map((entry) => Object.freeze({ ...entry, context_reviewed_on: "2026-11-19" })));

export function getDataContext(input = {}) {
  const term = String(input.term ?? "").trim().toLowerCase();
  const sourceId = String(input.source_id ?? "").trim();
  const field = String(input.field ?? "").trim();
  if (term.length > 100 || sourceId.length > 80 || field.length > 80)
    throw new SourceError("Context filter is too long", 400);
  const entries = DATA_CONTEXT.filter((item) =>
    (!term || `${item.id} ${item.term} ${item.source_fact} ${item.reading_rule}`.toLowerCase().includes(term)) &&
    (!sourceId || item.source_id === sourceId) && (!field || item.field === field));
  const useCodeDefinitions = (!sourceId || sourceId === "parcels") &&
    (!field || field === "use_code") ? useCodes.codes.filter((row) =>
      !term || `${row.code} ${row.published_label}`.toLowerCase().includes(term)) : [];
  return { entries, use_code_definitions: useCodeDefinitions, use_code_review: {
    status: useCodes.reviewed_on && useCodes.codes.length ? "reviewed" : "awaiting_official_definitions",
    source_url: useCodes.source_url, reviewed_on: useCodes.reviewed_on,
    reviewed_codes: useCodes.codes.length,
  } };
}

export function commercialUseCodes() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(useCodes.reviewed_on ?? "") || !Array.isArray(useCodes.codes) ||
      !useCodes.codes.length) return null;
  const seen = new Set();
  for (const row of useCodes.codes) {
    const code = String(row.code ?? "").trim().toUpperCase();
    if (!code || seen.has(code) || !row.published_label ||
        typeof row.business_space !== "boolean" ||
        !/^https:\/\/(?:[\w-]+\.)*(?:newhavenct\.gov|municityconnect\.com)\//i.test(row.official_source_url ?? ""))
      return null;
    seen.add(code);
  }
  return useCodes.codes.filter((row) => row.business_space)
    .map((row) => String(row.code).trim().toUpperCase());
}

export function reviewedUseCodeValues() {
  return commercialUseCodes() === null ? null : new Set(useCodes.codes.map((row) =>
    String(row.code).trim().toUpperCase()));
}
