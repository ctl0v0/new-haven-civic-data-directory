import { z } from "zod";
import { checkedQueryAddress } from "./address-evidence.js";
import { LAYERS } from "./config.js";
import { parcelFeatureToGeoJSON } from "./geometry.js";
import { arcgis, fetchJson, SourceError } from "./http.js";
import { loadParcel, normalizeAddress } from "./resolve.js";

export const businessCategories = Object.freeze({
  restaurant: "Restaurants",
  cafe: "Cafés",
  ice_cream_shop: "Ice cream shops",
  bakery: "Bakeries",
  grocery_store: "Grocery stores",
  convenience_store: "Convenience stores",
  pharmacy: "Pharmacies",
  barber_shop: "Barber shops",
  hair_salon: "Hair salons",
  hardware_store: "Hardware stores",
  plumber: "Plumbers",
  electrician: "Electricians",
});
export const businessRadii = Object.freeze({ 402: "¼ mile", 805: "½ mile", 1609: "1 mile", 3219: "2 miles" });
export const DEFAULT_BUSINESS_RADIUS = 1609;

const GOOGLE_URL = "https://areainsights.googleapis.com/v1:computeInsights";
const GOOGLE_SOURCE = "https://developers.google.com/maps/documentation/places-aggregate/overview";
const addressLimit = 200;
const parcelIdentity = z.union([z.string().regex(/^\d{1,12}$/), z.number().int().min(0).max(999999999999)]);
const parcelInput = z.strictObject({
  parcel_id: parcelIdentity,
  objectid: parcelIdentity.optional(),
  query_address: z.string().optional(),
});
const countInput = parcelInput.extend({
  category: z.enum(Object.keys(businessCategories)),
  radius_meters: z.number().int().refine((radius) => Object.hasOwn(businessRadii, radius)).default(DEFAULT_BUSINESS_RADIUS),
  origin: z.string().regex(/^(?:city-address-\d{1,12}|parcel-center)$/).optional(),
});

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

export async function nearbyBusinessCount(input, { env = process.env } = {}) {
  const parsed = countInput.safeParse(input);
  if (!parsed.success) throw new SourceError("Provide a valid parcel, business type, radius and search origin", 400);
  const apiKey = env.GOOGLE_PLACES_AGGREGATE_API_KEY?.trim();
  if (!apiKey) throw new SourceError("Nearby business research is awaiting a Places Aggregate API key for this Preview.", 503);

  const selected = await resolveOrigins(parsed.data);
  const origin = selected.origins.find(({ id }) => id === (parsed.data.origin ?? selected.default_origin));
  if (!origin) throw new SourceError("Choose a verified City address or an available parcel center before running the count.", 422);
  const { category, radius_meters: radius } = parsed.data;
  const { latitude, longitude } = origin;
  let data;
  try {
    data = await fetchJson(GOOGLE_URL, {
      method: "POST", timeout: 8000, maxBytes: 16_000,
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
      body: JSON.stringify({ insights: ["INSIGHT_COUNT"], filter: {
        locationFilter: { circle: { latLng: { latitude, longitude }, radius } },
        typeFilter: { includedTypes: [category] },
        operatingStatus: ["OPERATING_STATUS_OPERATIONAL"],
      } }),
    });
  } catch (error) {
    if (error.upstreamStatus === 429)
      throw new SourceError("Google Maps reached its request quota. Try again later.", 429);
    if ([401, 403].includes(error.upstreamStatus))
      throw new SourceError("Google Maps denied access. Check the Preview key and the Places Aggregate API settings.", 503);
    if (error.name === "TimeoutError") throw new SourceError("The Google Maps count timed out. Try again.", 504);
    throw new SourceError("Google Maps is unavailable for this count.");
  }
  const count = typeof data?.count === "string" && /^\d+$/.test(data.count) ? Number(data.count) : data?.count;
  if (!Number.isSafeInteger(count) || count < 0) throw new SourceError("Google Maps did not return a usable count.");
  return {
    parcel_id: selected.parcel_id, objectid: selected.objectid,
    category, category_label: businessCategories[category], radius_meters: radius, radius_label: businessRadii[radius],
    origin, count, retrieved_at: new Date().toISOString(),
    attribution: "Google Maps", source_url: GOOGLE_SOURCE,
  };
}
