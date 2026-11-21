import { z } from "zod";
import { getSourceRecords } from "./adapters.js";
import { markAddressEvidence } from "./address-evidence.js";
import { LAYERS } from "./config.js";
import { arcgis, cached, SourceError } from "./http.js";
import { nearbyTransitStops } from "./map-context.js";
import {
  businessCategoryGroups, countPlacesInWalkingArea, countPlacesWithinRadius, GOOGLE_PLACES_SOURCE, nearbyBusinessOrigins,
} from "./nearby-business-count.js";
import { loadParcel, normalizeAddress } from "./resolve.js";
import { walkingAreas, walkingAreaContains, WALK_MINUTES, WALK_SOURCE } from "./walking-areas.js";

const CITY_ZONING = "https://www.newhavenct.gov/government/departments-divisions/city-plan/zoning-and-regulations";
const USE_TABLE = "https://code.communityscale.io/new-haven-ct/zoning/";
const UNION_SQUARE_PLAN = "https://www.newhavenct.gov/home/showpublisheddocument/27692/639045055868170000";
const CITY_PROJECTS = "https://www.newhavenct.gov/government/departments-divisions/economic-development-administration/current-initiatives";
const CONNCAT_SITE = "https://newhaven-ct.legistar.com/LegislationDetail.aspx?GUID=B7F0A04D-2D48-4E6F-B552-FB3108FC376A&ID=8260857";
const districts = ["BA", "BA-1", "BA-2", "BD", "BD-1", "BD-2", "BD-3"];
const byRight = Object.fromEntries(districts.map((district) => [district, "R"]));

// Reviewed City ordinance §42, Table 3. Unreviewed uses and district codes are left open for City review.
export const storefrontConcepts = [
  { id: "fresh-food", label: "Fresh-food store", commercial: true,
    types: ["grocery_store", "supermarket", "discount_supermarket", "asian_grocery_store"],
    ordinance_row: "B. Food — Grocery, Delicatessen, Supermarket or other store carrying a variety of food and related goods",
    zoning: byRight, permit: /grocery|supermarket|delicatessen/i,
    check: "Confirm fresh-food supply, refrigeration, delivery access and the retail food licensing path." },
  { id: "pharmacy", label: "Pharmacy", commercial: true, types: ["pharmacy"],
    ordinance_row: "C. Retail and service — Pharmacy or Cosmetic store",
    zoning: byRight, permit: /pharmacy|drugstore/i,
    check: "Check Connecticut pharmacy licensing, secure storage and the operator’s space needs." },
  { id: "laundry", label: "Laundry service", commercial: true, types: ["laundry"],
    ordinance_row: "C. Retail and service — Laundry, cleaner, dyer or self-service laundromat serving retail trade on premises",
    zoning: { ...byRight, "BA-1": "SE", "BA-2": "SE" }, permit: /laundr|dry clean/i,
    check: "Verify whether nearby listings offer self-service and check water, drainage and utility capacity." },
  { id: "child-care", label: "Child care center", commercial: true,
    types: ["child_care_agency", "preschool"], permit: /child\s*care|day\s*care|preschool/i,
    check: "Check licensed seats, eligible ages, waitlists and State facility and staffing requirements." },
  { id: "cafe-bakery", label: "Café or bakery without alcohol", commercial: true,
    types: ["cafe", "coffee_shop", "bakery"],
    ordinance_row: "B. Food — Bakery and E. Eating and drinking places — Establishment selling food for immediate consumption",
    zoning: byRight, permit: /\bcaf[eé]\b|bakery|coffee shop|commercial hood/i,
    check: "Confirm the menu, cooking equipment, ventilation, grease handling and food service approvals." },
  { id: "community-space", label: "Community gathering space", commercial: false,
    types: ["community_center"], permit: /community (?:center|space)|assembly/i,
    check: "Confirm a local partner, program hours, accessible entry and the allowable assembly occupancy." },
];

const MAX_GOOGLE_COUNTS = 46;
const MAX_PARALLEL_COUNTS = 6;
const COUNT_BUDGET_MS = 32_000;
const HALF_MILE_METERS = 805;
const HALF_MILE_CATEGORIES = [
  { group: "Food and essentials", label: "Groceries", types: ["grocery_store", "supermarket", "discount_supermarket", "asian_grocery_store"] },
  { group: "Food and essentials", label: "Convenience stores", types: ["convenience_store"] },
  { group: "Food and essentials", label: "Pharmacies", types: ["pharmacy"] },
  { group: "Everyday services", label: "Laundry services", types: ["laundry"],
    note: "Includes listings such as laundromats and dry cleaners. Check individual services." },
  { group: "Everyday services", label: "Banks and credit unions", types: ["bank"],
    note: "Covers places Google classifies as banks. Credit unions have no separate Google type." },
  { group: "Everyday services", label: "Barbers and salons", types: ["barber_shop", "beauty_salon", "hair_salon", "nail_salon"] },
  { group: "Everyday services", label: "Hardware stores", types: ["hardware_store"] },
  { group: "Health and care", label: "Doctors and medical clinics", types: ["doctor", "medical_clinic"],
    note: "Check individual listings for primary care and whether they accept new patients." },
  { group: "Health and care", label: "Dentists", types: ["dentist", "dental_clinic"] },
  { group: "Health and care", label: "Child care and preschools", types: ["child_care_agency", "preschool"] },
  { group: "Food and gathering", label: "Cafés and bakeries", types: ["cafe", "coffee_shop", "bakery"] },
  { group: "Food and gathering", label: "Restaurants", types: ["restaurant"] },
  { group: "Public amenities", label: "Parks and playgrounds", types: ["park", "city_park", "state_park", "playground"] },
  { group: "Public amenities", label: "Libraries and community centers", types: ["library", "community_center"] },
];
const CITY_SCOPE = new Set(["HILL", "THE HILL", "HILL NORTH", "HILL SOUTH"]);
const conceptId = z.enum(storefrontConcepts.filter(({ commercial }) => commercial).map(({ id }) => id));
const parcelId = z.union([z.string().regex(/^\d{1,12}$/), z.number().int().nonnegative().max(999999999999)]);
const addressSubmission = z.strictObject({
  parcel_id: parcelId,
  objectid: parcelId.optional(),
  query_address: z.string().max(160).optional(),
  origin: z.string().regex(/^city-address-\d{1,12}$/).optional(),
  confirmed_vacancy: z.literal(true),
});
const submission = addressSubmission.extend({
  storefront_sq_ft: z.number().int().positive().max(1_000_000).optional(),
  space_checked_for: z.array(conceptId).max(5).default([]),
}).refine(({ storefront_sq_ft, space_checked_for }) => !space_checked_for.length || storefront_sq_ft);
const halfMileSubmission = addressSubmission.extend({ mode: z.literal("half_mile") });

export function opportunityAvailability(env = process.env) {
  const reason = !env.OPENROUTESERVICE_API_KEY?.trim()
    ? "Walking analysis is awaiting the Preview walking service key."
    : !env.GOOGLE_PLACES_AGGREGATE_API_KEY?.trim()
      ? "Walking analysis is awaiting the Preview Google Places Aggregate key."
      : env.VERCEL_ENV === "preview" && env.PARCEL_OPPORTUNITY_RATE_LIMIT_CONFIGURED !== "1"
        ? "Walking analysis is disabled until the Preview request limit is configured in Vercel."
        : null;
  return { configured: reason === null, reason };
}

async function projectAddresses() {
  return cached("conncat-published-address-points", async () => {
    const data = await arcgis(LAYERS.addresses, {
      where: "house_number IN (150,200) AND UPPER(full_street_name) IN ('DIXWELL AVE','DIXWELL AVENUE')",
      outFields: "objectid,house_number,full_street_name", returnGeometry: "true", outSR: "4326",
      resultRecordCount: "25",
    });
    const wkid = data.spatialReference?.latestWkid ?? data.spatialReference?.wkid;
    if ((wkid && wkid !== 4326) || data.exceededTransferLimit) throw new Error("Project locations could not be checked.");
    return data.features.flatMap(({ attributes, geometry }) => {
      const address = normalizeAddress(`${attributes?.house_number} ${attributes?.full_street_name}`);
      return ["150 DIXWELL AVE", "200 DIXWELL AVE"].includes(address) &&
        /^\d{1,12}$/.test(String(attributes?.objectid)) &&
        [geometry?.x, geometry?.y].every(Number.isFinite)
        ? [{ coordinates: [geometry.x, geometry.y], source_url: `${LAYERS.addresses}/${attributes.objectid}` }]
        : [];
    });
  });
}

async function collectSite(parcel, origin) {
  const [zoning, neighborhood, assessor, permits, project] = await Promise.all([
    getSourceRecords("zoning", parcel),
    getSourceRecords("neighborhoods", parcel),
    getSourceRecords("assessor-subareas", parcel),
    getSourceRecords("municity", parcel),
    projectAddresses().then((items) => ({ items, status: items.length ? "ok" : "no_records" }), () => ({
      items: [], status: "unavailable", warning: "The City address points for ConnCAT Place could not be checked.",
    })),
  ]);
  const districtCodes = zoning.items.map(({ attributes }) => String(attributes?.zone_code ?? "").trim());
  const neighborhoods = [...new Set(neighborhood.items.map(({ attributes: a }) =>
    String(a?.neighborhood || a?.neighborhood_label || "").trim()).filter(Boolean))];
  const scopedNeed = neighborhood.status === "ok" && neighborhoods.length === 1 &&
    CITY_SCOPE.has(neighborhoods[0].toUpperCase()) && normalizeAddress(origin.address).endsWith(" CONGRESS AVE");
  return {
    zoning: {
      status: districtCodes.includes("") ? "partial" : zoning.status,
      district_codes: [...new Set(districtCodes.filter(Boolean))].sort(), source_url: zoning.source_url,
      ordinance_url: CITY_ZONING,
    },
    neighborhoods,
    priority: scopedNeed ? {
      label: "City priority for grocery access along Congress Avenue in The Hill",
      explanation: "Goal 3 promotes groceries and everyday services in The Hill and identifies Congress Avenue as a focus corridor.",
      source_url: UNION_SQUARE_PLAN,
    } : null,
    subareas: assessor.items.slice(0, 10).map(({ attributes: a, source_url }) => ({
      label: a?.description_as_published ?? a?.code, gross_area_sq_ft: a?.gross_area_sq_ft ?? null, source_url,
    })),
    permits: markAddressEvidence(permits.items.filter(({ category }) => category === "Permit"), origin.address)
      .filter(({ address_evidence }) => address_evidence?.matches_query)
      .sort((a, b) => String(b.event_date ?? "").localeCompare(String(a.event_date ?? ""))),
    project: project.items,
    source_checks: [...[zoning, neighborhood, assessor, permits].map(({ source_id, status, warning }) =>
      ({ source_id, status, warning })), {
      source_id: "City address points for ConnCAT Place", status: project.status, warning: project.warning,
    }],
  };
}

function ordinancePath(concept, { status, district_codes: codes }) {
  const district = codes.length === 1 ? codes[0] : null;
  const code = status === "ok" && concept.zoning && Object.hasOwn(concept.zoning, district)
    ? concept.zoning[district] : undefined;
  const statusByCode = { R: "by_right", SE: "special_exception" };
  return {
    status: statusByCode[code] ?? "review_needed",
    district,
    use_table_row: code ? concept.ordinance_row : null,
    source_url: code ? USE_TABLE : CITY_ZONING,
  };
}

function plannedGrocery(site, windows) {
  for (const { minutes, ring } of windows) {
    const address = ring && site.project.find(({ coordinates }) => walkingAreaContains(ring, coordinates));
    if (address) return {
      minutes, label: "ConnCAT Place grocery published as planned",
      explanation: "The City’s project page lists a full-service grocery in phase one. Verify its opening status and expected service area.",
      source_url: CITY_PROJECTS, site_url: CONNCAT_SITE, location_url: address.source_url,
    };
  }
  return null;
}

function permitHistory(concept, permits) {
  return permits.filter(({ attributes: a }) => concept.permit.test(`${a?.PermitType ?? ""} ${a?.Description ?? ""}`))
    .slice(0, 3).map(({ attributes: a, event_date, source_url, source_record_id }) => ({
      label: [a?.PermitType, a?.PermitNo ?? a?.PermitNumber ?? source_record_id].filter(Boolean).join(" · "),
      event_date, source_url,
    }));
}

export function storefrontShortlists(profiles, site, input, windows) {
  const project = plannedGrocery(site, windows);
  const candidates = storefrontConcepts.map((concept) => {
    const { id, label, commercial, check, types } = concept;
    const counts = profiles.find((row) => row.id === id).counts;
    const [short, long] = counts;
    const access = counts.every(({ status }) => status === "ok") && short.count <= long.count
      ? long.count === 0 ? "both_windows" : short.count === 0 ? "shorter_window" : "mapped_supply"
      : "incomplete";
    return {
      id, label, commercial, counts, access, types,
      priority: id === "fresh-food" ? site.priority : null,
      planned_project: id === "fresh-food" ? project : null,
      zoning: ordinancePath(concept, site.zoning),
      space_confirmed: Boolean(input.storefront_sq_ft && input.space_checked_for.includes(id)),
      next_check: check,
      prior_permits: permitHistory(concept, site.permits),
    };
  });
  const eligible = candidates.filter(({ priority, access, planned_project, zoning }) =>
    priority && ["both_windows", "shorter_window"].includes(access) && !planned_project && zoning.status !== "review_needed");
  const compareAccess = (a, b) => Number(b.access === "both_windows") - Number(a.access === "both_windows") ||
    a.label.localeCompare(b.label);
  const neighborhood = eligible.toSorted(compareAccess).slice(0, 3);
  const commercial = eligible.filter(({ commercial, space_confirmed }) => commercial && space_confirmed)
    .sort((a, b) => Number(b.zoning.status === "by_right") - Number(a.zoning.status === "by_right") || compareAccess(a, b))
    .slice(0, 3);
  return {
    neighborhood: neighborhood.map(({ id }) => id),
    commercial: commercial.map(({ id }) => id),
    candidates,
  };
}

async function countProfile(windows, key, signal) {
  const profiles = [
    ...storefrontConcepts.map(({ id, label, types }) => ({ id, label, types })),
    ...Object.entries(businessCategoryGroups).map(([label, types]) => ({ label, types: Object.keys(types) })),
  ].map((row) => ({
    ...row, counts: windows.map(({ minutes, reason }) => ({
      minutes, status: "unavailable", count: null, reason: reason ?? "The Google Maps count did not complete.",
    })),
  }));
  const tasks = profiles.flatMap(({ types, counts }) => windows.flatMap(({ ring }, index) =>
    ring ? [{ types, ring, result: counts[index] }] : []));
  if (tasks.length > MAX_GOOGLE_COUNTS) throw new SourceError("The analysis exceeds the Preview search limit.", 503);
  await collectCounts(tasks, ({ ring, types }, timeout) => countPlacesInWalkingArea(key, ring, types, timeout), {
    parallel: MAX_PARALLEL_COUNTS, signal,
  });
  return profiles;
}

async function collectCounts(tasks, count, { parallel, signal }) {
  const deadline = Date.now() + COUNT_BUDGET_MS;
  let next = 0;
  let stop;
  async function worker() {
    while (next < tasks.length) {
      const task = tasks[next++];
      const { result } = task;
      const remaining = deadline - Date.now();
      if (stop || remaining <= 0 || signal?.aborted) {
        result.reason = stop ?? "The analysis request ended before this count ran.";
        continue;
      }
      try {
        result.count = await count(task, Math.min(6000, remaining));
        result.status = "ok";
        result.reason = null;
      } catch (error) {
        result.reason = error.message;
        if ([429, 503].includes(error.status)) stop = error.message;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(tasks.length, parallel) }, worker));
}

async function resolveStorefront({ parcel_id, objectid, query_address, origin: originId }, env) {
  const addresses = await nearbyBusinessOrigins({ parcel_id, objectid, query_address }, env);
  const origin = addresses.origins.find(({ id, method }) =>
    id === (originId ?? addresses.default_origin) && method === "city-address-point");
  if (!origin) throw new SourceError("Choose a verified City street address for this storefront.", 422);
  return { parcel_id: addresses.parcel_id, objectid: addresses.objectid, origin, vacancy: "user_confirmed" };
}

export async function analyzeHalfMile(input, { env = process.env, signal } = {}) {
  const parsed = halfMileSubmission.safeParse(input);
  if (!parsed.success)
    throw new SourceError("Confirm a vacant storefront and provide one valid parcel and City address.", 400);
  const key = env.GOOGLE_PLACES_AGGREGATE_API_KEY?.trim();
  if (!key) throw new SourceError("Half-mile analysis is awaiting the Preview Google Places Aggregate key.", 503);
  const storefront = await resolveStorefront(parsed.data, env);
  const { origin } = storefront;
  const categories = HALF_MILE_CATEGORIES.map((category) => ({
    ...category, status: "unavailable", count: null, reason: null,
    source_url: GOOGLE_PLACES_SOURCE, attribution: "Google Maps",
  }));
  const [transit] = await Promise.all([
    nearbyTransitStops(origin, HALF_MILE_METERS),
    collectCounts(categories.map((result) => ({ result })),
      ({ result }, timeout) => countPlacesWithinRadius(key, origin, HALF_MILE_METERS, result.types, timeout),
      { parallel: 3, signal }),
  ]);
  const transitOk = ["ok", "no_records"].includes(transit.status);
  categories.push({
    group: "Public amenities", label: "Mapped CT Transit bus stops",
    status: transitOk ? "ok" : "unavailable", count: transitOk ? transit.features.length : null,
    source_url: transit.source_url, attribution: "City GIS", reason: transit.warning,
    note: "Counts mapped stops. Check CT Transit for routes and current service.",
  });
  return { ...storefront, radius_meters: HALF_MILE_METERS, checked_at: new Date().toISOString(), categories };
}

export async function analyzeStorefront(input, { env = process.env, signal } = {}) {
  const parsed = submission.safeParse(input);
  if (!parsed.success)
    throw new SourceError("Confirm a vacant storefront and provide a valid parcel, address and optional storefront area.", 400);
  const availability = opportunityAvailability(env);
  if (!availability.configured) throw new SourceError(availability.reason, 503);
  const storefront = await resolveStorefront(parsed.data, env);
  const { origin } = storefront;
  const parcel = await loadParcel(parsed.data.parcel_id, parsed.data.objectid ?? null);
  const windows = await walkingAreas(origin, env.OPENROUTESERVICE_API_KEY.trim());
  const [site, profiles] = await Promise.all([
    collectSite(parcel, origin),
    countProfile(windows, env.GOOGLE_PLACES_AGGREGATE_API_KEY.trim(), signal),
  ]);
  const { neighborhoods, zoning, subareas, source_checks } = site;
  return {
    ...storefront, storefront_sq_ft: parsed.data.storefront_sq_ft ?? null,
    walking: {
      source_url: WALK_SOURCE, attribution: "openrouteservice by HeiGIT · OpenStreetMap contributors",
      areas: windows.map(({ minutes, status, reason }) => ({ minutes, status, reason: reason ?? null })),
    },
    google_maps: { source_url: GOOGLE_PLACES_SOURCE, attribution: "Google Maps", checked_at: new Date().toISOString() },
    categories: profiles.filter(({ id }) => !id).map(({ label, counts }) => ({ label, counts })),
    site: { neighborhoods, zoning, subareas, source_checks },
    ...storefrontShortlists(profiles, site, parsed.data, windows),
  };
}
