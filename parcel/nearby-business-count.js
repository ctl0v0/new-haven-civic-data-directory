import { z } from "zod";
import businessCategoryCatalog from "../data/nearby-business-categories.json" with { type: "json" };
import { checkedQueryAddress } from "./address-evidence.js";
import { LAYERS } from "./config.js";
import { parcelFeatureToGeoJSON } from "./geometry.js";
import { arcgis, fetchJson, SourceError } from "./http.js";
import { loadParcel, normalizeAddress } from "./resolve.js";
import { fingerprint, makeSearchCursor, readSearchCursor } from "./search-cursor.js";

export const businessCategoryGroups = businessCategoryCatalog.groups;
export const businessCategories = Object.freeze(Object.assign({}, ...Object.values(businessCategoryGroups)));
export const businessRadii = Object.freeze({ 402: "¼ mile", 805: "½ mile", 1609: "1 mile", 3219: "2 miles" });
export const DEFAULT_BUSINESS_RADIUS = 1609;
export const STOREFRONT_RADII = Object.freeze([402, 805]);
export const DEFAULT_STOREFRONT_RADIUS = 402;
export const GOOGLE_BUSINESS_MATCH_LIMIT = 100;
export const BUSINESS_SEARCH_BODY_LIMIT = 8192;

const GOOGLE_URL = "https://areainsights.googleapis.com/v1:computeInsights";
export const GOOGLE_PLACES_SOURCE = "https://developers.google.com/maps/documentation/places-aggregate/overview";
const GOOGLE_DETAILS_URL = "https://places.googleapis.com/v1/";
const matchPageSize = 10;
const matchCursorLifetimeMs = 10 * 60 * 1000;
const placeNamePattern = /^places\/[a-zA-Z0-9_-]+$/;
const addressLimit = 200;
const businessType = z.enum(Object.keys(businessCategories));
const largestBusinessGroup = Math.max(...Object.values(businessCategoryGroups).map((group) => Object.keys(group).length));
const parcelIdentity = z.union([z.string().regex(/^\d{1,12}$/), z.number().int().min(0).max(999999999999)]);
const parcelInput = z.strictObject({
  parcel_id: parcelIdentity,
  objectid: parcelIdentity.optional(),
  query_address: z.string().optional(),
});
const countInput = parcelInput.extend({
  category: businessType.optional(),
  group: z.enum(Object.keys(businessCategoryGroups)).optional(),
  subcategories: z.array(businessType).max(largestBusinessGroup).optional(),
  radius_meters: z.number().int().refine((radius) => Object.hasOwn(businessRadii, radius)).default(DEFAULT_BUSINESS_RADIUS),
  origin: z.string().regex(/^(?:city-address-\d{1,12}|parcel-center)$/).optional(),
});
const matchInput = countInput.extend({ cursor: z.string().min(1).max(3000).optional() });

function originAddress(attributes) {
  const street = attributes.full_street_name || [attributes.street_name, attributes.suffix_type].filter(Boolean).join(" ");
  return attributes.house_number && street ? `${attributes.house_number} ${street}`.trim() : "";
}

async function cityAddressOrigins(parcel) {
  const data = await arcgis(LAYERS.addresses, {
    geometry: JSON.stringify(parcel.geometry), geometryType: "esriGeometryPolygon",
    inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", returnGeometry: "true",
    outFields: "objectid,house_number,full_street_name,street_name,suffix_type,unit",
    resultRecordCount: String(addressLimit + 1),
  });
  const wkid = data.spatialReference?.latestWkid ?? data.spatialReference?.wkid;
  if ((wkid && wkid !== 4326) || !Array.isArray(data.features) ||
      data.exceededTransferLimit || data.features.length > addressLimit)
    throw new SourceError("The City address points could not be verified for this parcel");

  const origins = new Map();
  for (const { attributes = {}, geometry } of data.features) {
    const { objectid } = attributes;
    const address = originAddress(attributes);
    const longitude = geometry?.x;
    const latitude = geometry?.y;
    const pointWkid = geometry?.spatialReference?.latestWkid ?? geometry?.spatialReference?.wkid;
    if (!address || !/^\d{1,12}$/.test(String(objectid)) || !Number.isFinite(longitude) ||
        !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90 || (pointWkid && pointWkid !== 4326))
      throw new SourceError("The City returned an incomplete address point for this parcel");
    const label = normalizeAddress(address);
    const key = `${label}:${longitude}:${latitude}`;
    if (!origins.has(key) || Number(objectid) < origins.get(key).objectid) {
      origins.set(key, { id: `city-address-${objectid}`, method: "city-address-point", address,
        objectid: Number(objectid), label, longitude, latitude, source_url: `${LAYERS.addresses}/${objectid}` });
    }
  }
  return [...origins.values()].sort((a, b) => a.address.localeCompare(b.address, "en-US", { numeric: true }) || a.objectid - b.objectid);
}

async function resolveOrigins({ parcel_id, objectid, query_address }) {
  const searched = checkedQueryAddress(query_address);
  const parcel = await loadParcel(parcel_id, objectid ?? null);
  const { parcel_id: id, objectid: gisId, property_address: address } = parcel.attributes;
  let warning = null;
  const origins = await cityAddressOrigins(parcel).catch(() => {
    warning = "City address points are unavailable for this parcel.";
    return [];
  });
  const label = normalizeAddress(searched ?? address);
  const matching = origins.filter((point) => point.label === label);
  const defaultOrigin = matching.length === 1 ? matching[0].id : null;
  if (!defaultOrigin && !searched) {
    const [west, south, east, north] = parcelFeatureToGeoJSON(parcel).bbox;
    origins.push({ id: "parcel-center", method: "city-parcel-extent-center", address: null,
      longitude: (west + east) / 2, latitude: (south + north) / 2,
      source_url: `${LAYERS.parcels}/${gisId}` });
  }
  return { parcel_id: Number(id), objectid: Number(gisId), origins, default_origin: defaultOrigin, warning };
}

export async function nearbyBusinessOrigins(input, env = process.env) {
  const parsed = parcelInput.safeParse(input);
  if (!parsed.success) throw new SourceError("Provide a valid City parcel and optional searched address", 400);
  return { ...await resolveOrigins(parsed.data), configured: Boolean(env.GOOGLE_PLACES_AGGREGATE_API_KEY?.trim()) };
}

function selectBusinessTypes({ category, group, subcategories }) {
  if (category && !group && subcategories === undefined)
    return { includedTypes: [category], category_label: businessCategories[category] };
  if (!group || category) throw new SourceError("Choose one business category or a single business type.", 400);
  const entries = businessCategoryGroups[group];
  const requested = new Set(subcategories);
  if ([...requested].some((type) => !Object.hasOwn(entries, type)))
    throw new SourceError("Choose subcategories from the selected business category.", 400);
  const allTypes = Object.keys(entries);
  const selected = allTypes.filter((type) => requested.has(type));
  return {
    includedTypes: selected.length ? selected : allTypes,
    subcategories: selected,
    category_label: group,
  };
}

async function businessSearch(input, schema, env) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new SourceError("Provide a valid parcel, business category, radius and search origin", 400);
  const types = selectBusinessTypes(parsed.data);
  const apiKey = env.GOOGLE_PLACES_AGGREGATE_API_KEY?.trim();
  if (!apiKey) throw new SourceError("Nearby business research is awaiting a Places Aggregate API key for this Preview.", 503);

  const selected = await resolveOrigins(parsed.data);
  const origin = selected.origins.find(({ id }) => id === (parsed.data.origin ?? selected.default_origin));
  if (!origin) throw new SourceError("Choose a verified City address or an available parcel center before running the count.", 422);
  return { ...parsed.data, ...types, apiKey, origin, parcel_id: selected.parcel_id, objectid: selected.objectid };
}

function googleError(error, apiName) {
  if (error.upstreamStatus === 429)
    return new SourceError("Google Maps reached its request quota. Try again later.", 429);
  if ([401, 403].includes(error.upstreamStatus))
    return new SourceError(`Google Maps denied access. Check the Preview key and ${apiName} settings.`, 503);
  if (error.name === "TimeoutError") return new SourceError("The Google Maps request timed out. Try again.", 504);
  return new SourceError("Google Maps is unavailable for this search.");
}

async function businessInsights({ apiKey, origin, includedTypes, radius_meters: radius }, insights, timeout) {
  const { latitude, longitude } = origin;
  return placeInsights(apiKey, { circle: { latLng: { latitude, longitude }, radius } }, includedTypes, insights, timeout);
}

async function placeInsights(apiKey, locationFilter, includedTypes, insights, timeout = 8000) {
  let data;
  try {
    data = await fetchJson(GOOGLE_URL, {
      method: "POST", timeout, maxBytes: 48_000,
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
      body: JSON.stringify({ insights, filter: {
        locationFilter,
        typeFilter: { includedTypes },
        operatingStatus: ["OPERATING_STATUS_OPERATIONAL"],
      } }),
    });
  } catch (error) {
    throw googleError(error, "Places Aggregate API");
  }
  const count = typeof data?.count === "string" && /^\d+$/.test(data.count) ? Number(data.count) : data?.count;
  if (!Number.isSafeInteger(count) || count < 0) throw new SourceError("Google Maps did not return a usable count.");
  return { count, placeInsights: data?.placeInsights };
}

export async function countPlacesInWalkingArea(apiKey, ring, includedTypes, timeout) {
  const locationFilter = {
    customArea: { polygon: { coordinates: ring.map(([longitude, latitude]) => ({ latitude, longitude })) } },
  };
  const { count } = await placeInsights(apiKey, locationFilter, includedTypes, ["INSIGHT_COUNT"], timeout);
  return count;
}

export async function countPlacesWithinRadius(apiKey, origin, radius, includedTypes, timeout) {
  const { count } = await businessInsights({ apiKey, origin, radius_meters: radius, includedTypes }, ["INSIGHT_COUNT"], timeout);
  return count;
}

export async function nearbyBusinessCount(input, { env = process.env } = {}) {
  const search = await businessSearch(input, countInput, env);
  const { origin, category, group, subcategories, category_label, radius_meters: radius } = search;
  const { count } = await businessInsights(search, ["INSIGHT_COUNT"]);
  return {
    parcel_id: search.parcel_id, objectid: search.objectid,
    ...(group ? { group, subcategories } : { category }), category_label,
    radius_meters: radius, radius_label: businessRadii[radius],
    origin, count, retrieved_at: new Date().toISOString(),
    attribution: "Google Maps", source_url: GOOGLE_PLACES_SOURCE,
  };
}

function googleMapsLink(raw, place, name) {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && (url.hostname === "maps.google.com" ||
      (url.hostname === "www.google.com" && /^\/maps(?:\/|$)/.test(url.pathname)))) return url.href;
  } catch { /* Use a Maps URL for the verified Place ID. */ }
  const query = new URLSearchParams({ api: "1", query: name, query_place_id: place.slice("places/".length) });
  return `https://www.google.com/maps/search/?${query}`;
}

async function businessDetails(place, apiKey) {
  const data = await fetchJson(`${GOOGLE_DETAILS_URL}${place}`, {
    timeout: 8000, maxBytes: 16_000,
    headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "displayName,formattedAddress,googleMapsUri" },
  });
  const name = data?.displayName?.text;
  if (typeof name !== "string" || !name.trim()) throw new SourceError("Google did not return a business name for this match.");
  return { name, address: typeof data.formattedAddress === "string" ? data.formattedAddress : null,
    maps_url: googleMapsLink(data.googleMapsUri, place, name) };
}

export async function nearbyBusinessMatches(input, { env = process.env } = {}) {
  const search = await businessSearch(input, matchInput, env);
  const { apiKey, parcel_id, objectid, origin, category, includedTypes, radius_meters, cursor } = search;
  const { count, placeInsights } = await businessInsights(search, ["INSIGHT_COUNT", "INSIGHT_PLACES"]);
  if (count > GOOGLE_BUSINESS_MATCH_LIMIT) {
    if (cursor) throw new SourceError("Google Maps matches changed. Run the count again to refresh the results.", 409);
    return { status: "above_limit", count, results: [], next_cursor: null };
  }
  const placeResources = (Array.isArray(placeInsights) ? placeInsights : []).map((match) => match?.place)
    .filter((place) => typeof place === "string" && placeNamePattern.test(place));
  const places = [...new Set(placeResources)].sort();
  if (places.length > count) throw new SourceError("Google Maps returned more matches than its count.");
  const query = fingerprint(["nearby-business-matches", parcel_id, objectid, origin.id, origin.latitude, origin.longitude,
    category ?? includedTypes, radius_meters]);
  const source = fingerprint([count, places]);
  const { offset } = readSearchCursor(cursor, query, source);
  const page = places.slice(offset, offset + matchPageSize);
  const checked = await Promise.allSettled(page.map((place) => businessDetails(place, apiKey)));
  const results = checked.filter((result) => result.status === "fulfilled").map(({ value }) => value);
  const unavailable = page.length - results.length;
  if (unavailable && !results.length) {
    const authError = checked.find(({ reason }) => [401, 403, 429].includes(reason?.upstreamStatus));
    if (authError) throw googleError(authError.reason, "Places API (New)");
  }
  const nextOffset = offset + page.length;
  const next_cursor = nextOffset < places.length ? makeSearchCursor({ v: 1, query, source,
    offset: nextOffset, expires: Date.now() + matchCursorLifetimeMs }) : null;
  return { status: "ok", count, results, next_cursor, unavailable, missing_matches: count - places.length };
}
