import { z } from "zod";
import { addressEvidence, markAddressEvidence } from "../parcel/address-evidence.js";
import { getSourceRecords } from "../parcel/adapters.js";
import { businessAddress, normalizeBusinessUnit } from "../parcel/business-registrations.js";
import { pilotPreviewEnabled } from "../parcel/auth.js";
import { LAYERS } from "../parcel/config.js";
import { SourceError } from "../parcel/http.js";
import {
  businessCategories, businessRadii, DEFAULT_STOREFRONT_RADIUS, GOOGLE_BUSINESS_MATCH_LIMIT,
  GOOGLE_PLACES_SOURCE, nearbyBusinessCount, nearbyBusinessMatches, nearbyBusinessOrigins,
} from "../parcel/nearby-business-count.js";
import { listPermitApplications } from "../parcel/permit-applications.js";
import { permitDetails } from "../parcel/permit-details.js";
import { loadParcel, normalizeAddress, resolveParcel } from "../parcel/resolve.js";
import { parcelAddresses } from "../parcel/service.js";
import { fingerprint, makeSearchCursor, readSearchCursor } from "../parcel/search-cursor.js";
import { questionPermitCatalog } from "./ask.js";
import { searchIndexedPermits } from "./permits.js";
import { renterStorefrontSchema } from "./renter-question.js";
import { MAX_LISTING_ADDRESSES, previewListingAddresses, vacancyLayer } from "./vacancy-layer.js";

const cityPlan = "https://www.newhavenct.gov/government/departments-divisions/city-plan";
const permitTypeIsHood = (type) => /\bhoods?\b/i.test(String(type ?? ""));
const parcelKey = (id, objectid) => `${id}:${objectid}`;
function dateText(value) {
  if (value == null || value === "") return null;
  const dotNet = typeof value === "string" && value.match(/^\/Date\((\d+)(?:[+-]\d{4})?\)\/$/);
  const date = new Date(dotNet ? Number(dotNet[1]) : value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}
const id = z.string().regex(/^\d{1,12}$/);
const text = z.string().trim().min(1).max(160).regex(/^[^\x00-\x1f]+$/);
const cursorSchema = z.string().max(3000);

export const vacancySearchSchema = z.strictObject({
  neighborhood: text.optional(),
  hood_permit: z.boolean().default(false),
  listing_addresses: z.array(text).min(1).max(MAX_LISTING_ADDRESSES).optional(),
  cursor: cursorSchema.optional(),
});

export const storefrontEvidenceSchema = z.strictObject({
  storefront: renterStorefrontSchema,
  section: z.enum(["hood", "history", "space", "zoning", "applications", "lease"]),
  permit_id: id.optional(),
});

export const nearbyPlaceSchema = z.strictObject({
  storefront: renterStorefrontSchema,
  category: z.enum(Object.keys(businessCategories)),
  radius_meters: z.number().int().refine((radius) => Object.hasOwn(businessRadii, radius))
    .default(DEFAULT_STOREFRONT_RADIUS),
  origin: z.string().regex(/^city-address-\d{1,12}$/).optional(),
});

export const nearbyPlaceMatchSchema = nearbyPlaceSchema.extend({
  count: z.number().int().min(1).max(GOOGLE_BUSINESS_MATCH_LIMIT),
  cursor: cursorSchema.optional(),
});

export function requireRenterPreview() {
  if (!pilotPreviewEnabled()) throw new SourceError("Commercial renter research is available in the private Preview.", 404);
}

function checked(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SourceError("Check the storefront and search parameters.", 400);
  return parsed.data;
}

function permitAddress(address, published) {
  return addressEvidence({ source_id: "municity", category: "Permit",
    attributes: { LegalAddress: published } }, address);
}

async function indexedHoods(parcelKeys, { catalog = questionPermitCatalog, search = searchIndexedPermits } = {}) {
  const official = await catalog().catch(() => null);
  const types = [...new Set((official?.groups ?? []).flatMap(({ types }) =>
    types.map(({ name }) => name).filter(permitTypeIsHood)))].sort();
  const coverage = {
    catalog: { status: !official ? "unavailable" : official.partial ? "partial" : "checked",
      source_url: official?.source_url ?? null, retrieved_at: official?.retrieved_at ?? null },
    permit_types: types, source_checks: [], complete: Boolean(types.length && official && !official.partial),
  };
  const rows = [];
  // The indexed permit search accepts six exact types at a time.
  for (let start = 0; start < types.length; start += 6) {
    const permit_types = types.slice(start, start + 6);
    let cursor;
    for (let page = 0; page < 5; page++) {
      const result = await search({ permit_types, limit: 50, cursor }, { parcelKeys });
      if (!page) coverage.source_checks.push(...result.coverage.source_checks);
      rows.push(...result.items);
      cursor = result.next_cursor;
      if (!cursor) {
        coverage.complete &&= result.complete_for_query;
        break;
      }
    }
    if (cursor) {
      coverage.complete = false;
      coverage.warning = "The indexed hood permit lookup reached its page limit.";
    }
  }
  return { rows, coverage };
}

function indexedPermit(row, address) {
  return {
    permit_id: String(row.permit_id), permit_number: row.permit_number, permit_type: row.permit_type,
    permit_status: row.permit_status, permit_date: dateText(row.permit_date), source_url: row.permit_source_url,
    address_evidence: permitAddress(address, row.published_legal_address),
  };
}

function newestPermit(a, b) {
  return Number(Boolean(b.address_evidence?.matches_query)) - Number(Boolean(a.address_evidence?.matches_query)) ||
    (b.permit_date ?? "").localeCompare(a.permit_date ?? "") || a.permit_id.localeCompare(b.permit_id);
}

export async function searchCommercialVacancies(input, { layer = vacancyLayer, ...dependencies } = {}) {
  const { neighborhood, hood_permit, listing_addresses, cursor } = checked(vacancySearchSchema, input);
  const inventory = await layer(listing_addresses ?? previewListingAddresses());
  const coverage = {
    listing_source: inventory.listing_source, inventory_status: inventory.status,
    total_listed: inventory.listings.length,
    unresolved_listings: inventory.listings.filter(({ status }) => status !== "linked").length,
    unmatched_neighborhood: inventory.listings.filter(({ status, neighborhoods }) =>
      status === "linked" && !neighborhoods.length).length,
    address_indexed_at: inventory.address_indexed_at ?? null,
    neighborhood_indexed_at: inventory.neighborhood_indexed_at ?? null,
  };
  if (["needs_import", "unavailable"].includes(inventory.status))
    return { status: inventory.status, coverage, items: [], next_cursor: null };
  if (neighborhood && !inventory.neighborhood_indexed_at)
    return { status: "unavailable", coverage, items: [], next_cursor: null,
      reason: "The City neighborhood index is unavailable." };
  const name = neighborhood?.toLowerCase();
  const candidates = inventory.listings.filter((item) => item.status === "linked" &&
    (!name || [...item.neighborhoods, ...item.neighborhood_aliases].some((label) => label.toLowerCase() === name)));
  const permitsByParcel = new Map();
  if (hood_permit && candidates.length) {
    const unique = new Map(candidates.map(({ parcel_id, objectid }) =>
      [parcelKey(parcel_id, objectid), { parcel_id, objectid }]));
    const hood = await indexedHoods([...unique.values()], dependencies);
    coverage.hood_permits = hood.coverage;
    for (const row of hood.rows) {
      const key = parcelKey(row.city_parcel_id, row.city_objectid);
      if (!permitsByParcel.has(key)) permitsByParcel.set(key, []);
      permitsByParcel.get(key).push(row);
    }
  }
  const results = candidates.flatMap(({ address, parcel_id, objectid, parcel_address,
    neighborhoods, parcel_source_url, location_source_url, match }) => {
    const hood = (permitsByParcel.get(parcelKey(parcel_id, objectid)) ?? [])
      .map((row) => indexedPermit(row, address)).sort(newestPermit)[0];
    if (hood_permit && !hood) return [];
    return [{ storefront: { address, parcel_id: String(parcel_id), objectid: String(objectid) },
      parcel_address, neighborhoods, parcel_source_url, location_source_url, match,
      availability: "unverified", ...(hood ? { hood_permit: hood } : {}) }];
  });
  const order = (a, b) => a.storefront.address.localeCompare(b.storefront.address, "en-US", { numeric: true });
  results.sort((a, b) => hood_permit ? newestPermit(a.hood_permit, b.hood_permit) || order(a, b) : order(a, b));
  const queryHash = fingerprint({ neighborhood, hood_permit });
  const sourceHash = fingerprint([results, coverage.address_indexed_at, coverage.neighborhood_indexed_at]);
  const { offset } = readSearchCursor(cursor, queryHash, sourceHash);
  const end = offset + 5;
  return {
    status: inventory.status === "partial" || (name && coverage.unmatched_neighborhood) ||
      coverage.hood_permits?.complete === false ? "partial" : "ok",
    coverage, items: results.slice(offset, end), total_matches: results.length,
    next_cursor: end < results.length ? makeSearchCursor({ v: 1, query: queryHash, source: sourceHash,
      offset: end, expires: Date.now() + 30 * 60_000 }) : null,
  };
}

async function resolveStorefront(storefront, { resolve = resolveParcel, addresses = parcelAddresses } = {}) {
  const { street, unit } = businessAddress(storefront.address);
  const resolved = await resolve(street);
  if (!["resolved", "ambiguous"].includes(resolved.status))
    return { status: resolved.status, reason: "A City parcel could not be verified for this address.", warnings: resolved.warnings };
  const selected = storefront.parcel_id
    ? resolved.candidates.find((item) => parcelKey(item.parcel_id, item.objectid) ===
      parcelKey(storefront.parcel_id, storefront.objectid))
    : resolved.status === "resolved" ? resolved.candidates[0] : null;
  if (!selected || resolved.truncated) return { status: "clarify", reason: "Choose the City parcel for this storefront.",
    candidates: resolved.truncated ? [] : resolved.candidates.map(({ parcel_id, objectid, address }) =>
      ({ parcel_id: String(parcel_id), objectid: String(objectid), address })) };
  const parcel_id = String(selected.parcel_id), objectid = String(selected.objectid);
  if (unit) {
    const city = await addresses(parcel_id, objectid);
    const site = city.addresses.find(({ address }) => normalizeAddress(address) === normalizeAddress(street));
    if (!site?.units.some((value) => normalizeBusinessUnit(value) === unit))
      return { status: "clarify", reason: "The City address records could not verify that storefront unit." };
  }
  return { status: "ok", storefront: { address: storefront.address, parcel_id, objectid },
    parcel_address: selected.address, parcel_source_url: `${LAYERS.parcels}/${objectid}`, street };
}

const evidenceSources = {
  history: ["municipal-occupants", "municipal-business-licenses", "ct-liquor-permits"],
  space: ["assessor", "assessor-subareas"],
  zoning: ["zoning"],
};

function sourceSummary({ source_id, status, source_url, warning, count_established, items }) {
  return { source_id, status, source_url, warning, count_established, returned: items.length };
}

function livePermit(item, address) {
  const a = item.attributes;
  return {
    permit_id: String(a.Permit_ID), permit_number: a.PermitNo, permit_type: a.PermitType,
    permit_status: a.PermStatus, permit_date: dateText(a.PermitDate), source_url: item.source_url,
    address_evidence: permitAddress(address, a.LegalAddress),
  };
}

async function hoodEvidence(feature, storefront, permit_id, dependencies) {
  const { records, details } = dependencies;
  const [municipal, index] = await Promise.all([
    records("municity", feature),
    indexedHoods([{ parcel_id: storefront.parcel_id, objectid: storefront.objectid }], dependencies),
  ]);
  const indexed = index.rows.map((row) => indexedPermit(row, storefront.address));
  const live = municipal.items.filter(({ category, attributes }) =>
    category === "Permit" && permitTypeIsHood(attributes.PermitType) && id.safeParse(String(attributes.Permit_ID)).success)
    .map((item) => livePermit(item, storefront.address));
  const permits = [...new Map([...indexed, ...live].map((permit) => [permit.permit_id, permit])).values()].sort(newestPermit);
  const chosen = permit_id ? permits.find((permit) => permit.permit_id === permit_id) : null;
  if (permit_id && !chosen) throw new SourceError("Choose a hood permit returned for this storefront.", 404);
  const checkedPermits = chosen ? [chosen] : permits.slice(0, 3);
  const work = await Promise.all(checkedPermits.map(async (permit) => {
    try {
      const result = await details(feature, permit.permit_id);
      return { permit_id: permit.permit_id, status: result.partial ? "partial" : "checked",
        application: result.application, warnings: result.warnings,
        inspections: result.items.filter(({ category }) => category === "Inspection")
          .map((item) => ({ ...item, closed_date: dateText(item.attributes.CloseDate),
            scheduled_date: dateText(item.attributes.SchedDate) })),
        reviews: result.items.filter(({ category }) => category === "Task") };
    } catch {
      return { permit_id: permit.permit_id, status: "unavailable",
        warnings: ["The City permit detail could not be verified."], inspections: [], reviews: [] };
    }
  }));
  return { permits, work, coverage: { live: sourceSummary(municipal), indexed: index.coverage },
    equipment_condition: "unverified" };
}

export async function getCommercialStorefrontEvidence(input, { records = getSourceRecords, load = loadParcel,
  details = permitDetails, applications = listPermitApplications, ...dependencies } = {}) {
  const { storefront, section, permit_id } = checked(storefrontEvidenceSchema, input);
  const target = await resolveStorefront(storefront, dependencies);
  if (target.status !== "ok") return target;
  const base = { status: target.status, storefront: target.storefront,
    parcel_address: target.parcel_address, parcel_source_url: target.parcel_source_url, section };
  if (section === "lease") return { ...base, lease_terms: null,
    reason: "Lease terms haven’t been supplied for this storefront." };
  if (section === "applications") {
    const [food, building] = await Promise.all(["food service establishment", "building department online permitting"]
      .map((q) => applications({ q, view: "directory", limit: 10 })));
    return { ...base, applications: [...food.items, ...building.items],
      coverage: { sources: [...new Map([...food.coverage.source_checks, ...building.coverage.source_checks]
        .map((source) => [source.id, source])).values()].filter(({ id }) =>
        ["food-service", "citysquared", "building", "contractors"].includes(id)),
      citysquared_menu: food.coverage.citysquared_menu } };
  }
  const feature = await load(target.storefront.parcel_id, target.storefront.objectid);
  if (section === "hood") {
    const evidence = await hoodEvidence(feature, target.storefront, permit_id, { records, details, ...dependencies });
    return { ...base, ...evidence };
  }
  const sources = await Promise.all(evidenceSources[section].map((source) => records(source, feature)));
  const addressItems = markAddressEvidence(sources.flatMap((source) => source.items), storefront.address);
  const items = section !== "history" ? addressItems : addressItems.map((item) => {
    const { attributes } = item;
    const sourceField = ["occupancy_type", "license_type", "credential"]
      .find((field) => /\b(?:restaurant|food service)\b/i.test(attributes[field] ?? ""));
    return sourceField ? { ...item, food_service_evidence: { field: sourceField, value: attributes[sourceField] } } : item;
  });
  return { ...base, items, coverage: sources.map(sourceSummary),
    ...(section === "zoning" ? { guidance: [
      { title: "City zoning and regulations", url: `${cityPlan}/zoning-and-regulations` },
      { title: "City Plan contact", url: cityPlan },
    ] } : {}) };
}

async function runNearby(input, matches, { origins = nearbyBusinessOrigins,
  countPlaces = nearbyBusinessCount, matchPlaces = nearbyBusinessMatches, ...dependencies } = {}) {
  const { storefront, origin, cursor, category, radius_meters } =
    checked(matches ? nearbyPlaceMatchSchema : nearbyPlaceSchema, input);
  const target = await resolveStorefront(storefront, dependencies);
  if (target.status !== "ok") return target;
  const { parcel_id, objectid } = target.storefront;
  const site = { parcel_id, objectid, query_address: target.street };
  const resolved = await origins(site);
  const options = resolved.origins.filter((item) => item.method === "city-address-point" &&
    normalizeAddress(item.address) === normalizeAddress(target.street));
  const selectedOrigin = origin ? options.find(({ id }) => id === origin) : options.length === 1 ? options[0] : null;
  if (!selectedOrigin) return { status: "clarify", storefront: target.storefront,
    reason: options.length ? "Choose a City address point for the radius." :
      "A verified City address point is unavailable for this storefront.", origins: options };
  const search = { ...site, category, radius_meters, origin: selectedOrigin.id };
  const result = await (matches ? matchPlaces({ ...search, cursor }) : countPlaces(search));
  return { status: "ok", storefront: target.storefront, category, radius_meters, category_label: businessCategories[category],
    operating_status: "OPERATIONAL", distance_method: "straight_line_radius",
    origin: selectedOrigin, retrieved_at: new Date().toISOString(), attribution: "Google Maps",
    source_url: GOOGLE_PLACES_SOURCE, ...result };
}

export const countNearbyPlaces = (input, dependencies) => runNearby(input, false, dependencies);
export const listNearbyPlaces = (input, dependencies) => runNearby(input, true, dependencies);

export const commercialRenterTools = {
  search_commercial_vacancies: {
    title: "Shortlist New Haven storefronts",
    description: "Search approved vacancy listings by City neighborhood and indexed hood permit evidence. Listings have unverified current availability. A hood permit records City activity. Equipment presence and condition require a site check. Pass the same filters and cursor for the next page.",
    schema: vacancySearchSchema, run: searchCommercialVacancies,
  },
  get_commercial_storefront_evidence: {
    title: "Inspect New Haven storefront records",
    description: "Read official hood, prior business, building subarea, zoning, application or lease information at the specified storefront. Keep the exact address and any confirmed City parcel IDs in each follow-up. Hood details include published inspections for the first three records or for the supplied permit ID.",
    schema: storefrontEvidenceSchema, run: getCommercialStorefrontEvidence,
  },
  count_nearby_places: {
    title: "Count nearby places at one City storefront",
    description: "On explicit request, run one live Google Places Aggregate count for a place type around a verified City address point. Defaults to a quarter-mile straight-line radius. Preserve Google Maps attribution and report the exact origin, category and radius. A result counts Google listings marked operational.",
    schema: nearbyPlaceSchema, run: countNearbyPlaces,
  },
  list_nearby_places: {
    title: "Show matching nearby places",
    description: "On explicit request after count_nearby_places returns 1 to 100 matches, list a page of Google Maps place names and links. Supply the prior count, origin, storefront, category and radius. Preserve the supplied attribution and report partial details where applicable.",
    schema: nearbyPlaceMatchSchema, run: listNearbyPlaces,
  },
};
