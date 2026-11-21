import useCodes from "../data/city-use-codes.json" with { type: "json" };
import { SourceError } from "./http.js";
import { CHARITY_SOURCE, CHARITY_SOURCE_URL } from "./charity-registrations.js";

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
    reading_rule: "The recorded use category follows a reviewed official definition for the published code. Missing or unreviewed definitions stay unclassified. Mapped zoning is supplied separately." },
  { id: "commercial-parcel-query", term: "Commercial parcel search", source_id: "parcels", field: "use_code",
    official_source_url: parcelLayer,
    source_fact: "The City publishes parcel use codes and commercial-unit fields separately.",
    reading_rule: "This demo uses only a reviewed set of use codes describing business space. An unreviewed code stops a complete commercial result." },
  { id: "municipal-permit-type", term: "Permit type", source_id: "municity", field: "PermitType",
    official_source_url: vendor,
    source_fact: "The municipal permit service publishes a PermitType on permit records and a separate type catalog.",
    reading_rule: "A catalog entry alone does not establish that a permit exists. Search by one exact published type." },
  { id: "municipal-permit-group", term: "Permit group", source_id: "municity", field: "TypeGroup",
    official_source_url: "https://services5.municity5.com/M5Services/M5Service.svc/Customer/NewHavenCityCT/PermitTypes",
    source_fact: "The municipal permit type catalog groups named permit types. Electrical is a published group containing Electrical Permit and more specific wiring, service, alarm and other named types.",
    reading_rule: "A broad request for electrical permits uses the published Electrical group. The exact type Electrical Permit alone does not cover the group. Each returned permit keeps its own published PermitType." },
  { id: "municipal-permit-date", term: "Permit date", source_id: "municity", field: "PermitDate",
    official_source_url: vendor,
    source_fact: "Municipal permit records publish PermitDate separately from PermStatus.",
    reading_rule: "In this demo, 'pulled' means the published PermitDate. It does not mean issued, approved, or work completed." },
  { id: "municipal-permit-status", term: "Permit status", source_id: "municity", field: "PermStatus",
    official_source_url: vendor,
    source_fact: "Municipal permit records publish PermStatus.",
    reading_rule: "Return the exact status. Do not infer it from PermitDate or a linked application's review task." },
  { id: "municipal-permit-contact-role", term: "Permit contact role", source_id: "municity", field: "ContactRole",
    official_source_url: vendor,
    source_fact: "The City's permit and application records can list contacts under a published role such as Contractor.",
    reading_rule: "The search returns the listed role on the matched permit or its linked application. When the permit date is selected, the window uses PermitDate. Direct contractor details require a source-public role." },
  { id: "municipal-permit-activity-date", term: "Permit activity dates",
    source_id: "municity-permit-activity", official_source_url: vendor,
    source_fact: "The municipal service can publish ApplicationDate for an application, DateCompleted for a review task, and CloseDate for an inspection.",
    reading_rule: "Each date belongs to its own record. To search for a work completion date, first identify a published field that explicitly records completion of the work." },
  { id: "municipal-business-license-issue-date", term: "City business license issue date",
    source_id: "municipal-business-licenses", field: "IssueDate", official_source_url: vendor,
    source_fact: "New Haven's municipal license records can publish a business name, license type, status and IssueDate.",
    reading_rule: "A recent City business license search uses IssueDate. Creation timestamps, State effective dates and present business operation describe different facts." },
  { id: "city-neighborhood", term: "City neighborhood", source_id: "neighborhoods",
    official_source_url: neighborhoods,
    source_fact: "The City hosts mapped neighborhood polygons.",
    reading_rule: "A spatially intersecting City parcel can be filtered by the published neighborhood polygon; the relationship is a map intersection." },
  { id: "ct-public-charity-registration", term: "Connecticut public charity registration", source_id: CHARITY_SOURCE,
    official_source_url: CHARITY_SOURCE_URL, field: "address",
    source_fact: "Connecticut eLicense publishes public charity registrations, including organization names, DBAs, registered addresses, credential numbers, status and dates.",
    reading_rule: "Match the registered street address to City address points that resolve to one parcel. Return the State registration and registered address as published. A date filter uses the State issue date." },
  { id: "assessor-ownership-history", term: "Assessor ownership history", source_id: "assessor-sales",
    official_source_url: "https://gis.vgsi.com/newhavenct/",
    source_fact: "The City assessor property card can publish ownership history rows with a sale date, price, and book and page reference.",
    reading_rule: "Each returned history row is linked to the verified assessor card. A recorded price of zero remains the published value." },
  { id: "nhps-school-attendance", term: "NHPS School Choice attendance zone", source_id: "school-attendance",
    official_source_url: "https://www.newhavenmagnetschools.com/index.php/enrollment/find-schools-in-your-attendance-zone",
    source_fact: "New Haven Public Schools publishes attendance-zone school lookups by street and address range.",
    reading_rule: "Use the exact City address and published range. A published attendance zone gives a placement preference; enrollment depends on the NHPS process." },
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

const recordedUseCategories = new Set(["residential", "mixed_use", "commercial_only", "other"]);
const normalizeUseCode = (code) => String(code ?? "").trim().toUpperCase();

function reviewedUseCodeIndex(dictionary) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dictionary.reviewed_on ?? "") ||
      !Array.isArray(dictionary.codes) || !dictionary.codes.length) return null;
  const index = new Map();
  for (const row of dictionary.codes) {
    const code = normalizeUseCode(row?.code);
    if (!code || index.has(code) || typeof row.published_label !== "string" ||
        !row.published_label.trim() || (row.business_space !== null && typeof row.business_space !== "boolean") ||
        !/^https:\/\/(?:(?:[\w-]+\.)*(?:newhavenct\.gov|municityconnect\.com)|data\.ct\.gov)\//i.test(row.official_source_url ?? ""))
      return null;
    index.set(code, row);
  }
  return index;
}

const cityUseCodeIndex = reviewedUseCodeIndex(useCodes);

export function recordedParcelUse(value, dictionary = useCodes) {
  const publishedCode = String(value ?? "").trim() || null;
  const index = dictionary === useCodes ? cityUseCodeIndex : reviewedUseCodeIndex(dictionary);
  const definition = index?.get(normalizeUseCode(publishedCode));
  return {
    category: recordedUseCategories.has(definition?.category) ? definition.category : "unclassified",
    published_code: publishedCode,
    published_label: definition?.published_label ?? null,
    definition_source_url: definition?.official_source_url ?? null,
    reviewed_on: definition ? dictionary.reviewed_on : null,
  };
}

export function commercialUseCodes() {
  return cityUseCodeIndex && [...cityUseCodeIndex]
    .filter(([, row]) => row.business_space).map(([code]) => code);
}

export function parcelUseCodesForSearch(category) {
  if (category === "business_space") return commercialUseCodes() ?? [];
  // The mixed-use search requires a reviewed residential and business mix.
  // A general assessor mixed-use label is sufficient for the recorded-use map.
  return [...(cityUseCodeIndex ?? [])].filter(([, row]) => row.category === category &&
    (category !== "mixed_use" || row.business_space === true)).map(([code]) => code);
}

export function reviewedUseCodeValues() {
  // A published label can be shown on the map even if it cannot support the
  // commercial query. Keep those codes outside that query's reviewed set.
  return cityUseCodeIndex && new Set([...cityUseCodeIndex]
    .filter(([, row]) => typeof row.business_space === "boolean").map(([code]) => code));
}
