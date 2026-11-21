import { LAYERS } from "../parcel/config.js";
import { SourceError } from "../parcel/http.js";
import { normalizeAddress } from "../parcel/resolve.js";
import { recordedParcelUse } from "../parcel/data-context.js";
import { indexConfigured, indexQuery } from "./db.js";

export const VACANCY_COLLECTION_ID = "civic-fit";
export const MAX_LISTING_ADDRESSES = 150;

export function listingAddressKey(value) {
  return normalizeAddress(String(value ?? "").split(/,\s*New Haven\b/i)[0]);
}

export function approvedListingAddresses(addresses) {
  if (!Array.isArray(addresses) || addresses.length < 1 || addresses.length > MAX_LISTING_ADDRESSES)
    throw new SourceError("Supply between 1 and 150 listing addresses.", 400);
  const entries = new Map();
  for (const value of addresses) {
    if (typeof value !== "string" || value.length > 160 || /[\x00-\x1f]/.test(value))
      throw new SourceError("The listing export contains an invalid address.", 400);
    const [street, locality] = value.trim().split(/,\s*New Haven\b/i);
    if (!/^\d{1,6}\s+[^\d\s,]/.test(street) ||
        (locality !== undefined && !/^\s*,?\s*(?:CT|Connecticut)(?:\s+\d{5}(?:-\d{4})?)?(?:,\s*(?:USA|United States))?$/i.test(locality)))
      throw new SourceError("Use New Haven street addresses in the Address column.", 400);
    const key = listingAddressKey(street);
    if (!entries.has(key)) entries.set(key, { id: key, address: street.trim() });
  }
  return [...entries.values()];
}

export function previewListingAddresses() {
  const stored = process.env.CIVIC_FIT_PREVIEW_LISTINGS;
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : parsed.addresses;
  } catch {
    throw new SourceError("The Preview listing export could not be read.", 503);
  }
}

const activeSql = `SELECT a.source_id, a.run_id, r.finished_at
  FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
  WHERE a.scope_key = 'all' AND a.source_id IN ('addresses', 'parcels', 'neighborhoods')`;

const candidatesSql = `WITH address_points AS (
    SELECT fields->>'normalized_address' AS key, record_id, run_id, source_id, source_url, geometry
    FROM search_records
    WHERE run_id = $1::bigint AND source_id = 'addresses'
      AND fields->>'normalized_address' = ANY($4::text[])
  ), candidates AS (
    SELECT a.key, a.record_id AS address_objectid, a.source_url AS location_source_url,
      a.geometry AS location, j.join_status, p.record_id AS objectid, p.fields, p.source_url AS parcel_source_url
    FROM address_points a
    LEFT JOIN search_record_parcels j USING (run_id, source_id, record_id)
    LEFT JOIN search_records p ON p.run_id = $2::bigint AND p.source_id = 'parcels'
      AND p.record_id = j.city_objectid::text AND p.fields->>'parcel_id' = j.city_parcel_id::text
      AND ST_Intersects(a.geometry, p.geometry)
    UNION ALL
    SELECT upper(trim(p.fields->>'property_address')), NULL, p.source_url,
      ST_PointOnSurface(p.geometry), 'exact', p.record_id, p.fields, p.source_url
    FROM search_records p
    WHERE p.run_id = $2::bigint AND p.source_id = 'parcels'
      AND nullif(p.fields->>'parcel_id', '') IS NOT NULL
      AND upper(trim(p.fields->>'property_address')) = ANY($4::text[])
      AND NOT EXISTS (SELECT 1 FROM address_points a WHERE a.key = upper(trim(p.fields->>'property_address')))
  )
  SELECT c.key, c.address_objectid, c.location_source_url, c.join_status, c.objectid,
    c.fields->>'parcel_id' AS parcel_id, c.fields->>'property_address' AS parcel_address,
    c.fields->>'mblu' AS mblu, c.fields->>'use_code' AS use_code, c.parcel_source_url,
    ST_AsGeoJSON(c.location, 8)::jsonb AS location, neighborhood.names AS neighborhoods,
    neighborhood.aliases AS neighborhood_aliases
  FROM candidates c
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT coalesce(nullif(trim(n.fields->>'neighborhood'), ''),
      nullif(trim(n.fields->>'neighborhood_label'), ''))) AS names,
      array_agg(DISTINCT nullif(trim(n.fields->>'neighborhood_label'), '')) AS aliases
    FROM search_record_parcels j JOIN search_records n USING (run_id, source_id, record_id)
    WHERE j.run_id = $3::bigint AND j.source_id = 'neighborhoods' AND j.join_status = 'exact'
      AND j.city_parcel_id = (c.fields->>'parcel_id')::bigint AND j.city_objectid = c.objectid::bigint
  ) neighborhood ON c.objectid IS NOT NULL
  ORDER BY c.key, c.address_objectid, c.objectid
  LIMIT 4001`;

function matchListing(listing, candidates) {
  const parcels = new Set(candidates.filter(({ objectid }) => objectid)
    .map(({ parcel_id, objectid }) => `${parcel_id}:${objectid}`));
  if (parcels.size > 1 || candidates.some(({ join_status }) => join_status === "ambiguous"))
    return { ...listing, status: "ambiguous" };
  if (!parcels.size || candidates.some(({ objectid, join_status }) => !objectid || join_status !== "exact"))
    return { ...listing, status: "unmatched" };
  const first = candidates[0];
  const points = new Set(candidates.map(({ location }) => JSON.stringify(location)));
  const geometry = points.size === 1 && first.location?.type === "Point" ? first.location : null;
  return {
    ...listing, status: "linked",
    match: first.address_objectid ? "city-address-point" : "city-parcel-address",
    parcel_id: first.parcel_id, objectid: first.objectid, parcel_address: first.parcel_address,
    mblu: first.mblu, recorded_use: recordedParcelUse(first.use_code), parcel_source_url: first.parcel_source_url,
    location_source_url: geometry ? first.location_source_url : null,
    neighborhoods: (first.neighborhoods ?? []).filter(Boolean).sort(),
    neighborhood_aliases: (first.neighborhood_aliases ?? []).filter(Boolean).sort(),
    geometry,
  };
}

export async function vacancyLayer(addresses = null, { query = indexQuery, configured = indexConfigured } = {}) {
  const meta = { type: "FeatureCollection", collection: VACANCY_COLLECTION_ID, listing_source: "Civic Fit address export",
    city_sources: [LAYERS.addresses, LAYERS.parcels, LAYERS.neighborhoods] };
  if (addresses === null) return { ...meta, status: "needs_import", listings: [], features: [] };
  const listings = approvedListingAddresses(addresses);
  const unavailable = { ...meta, status: "unavailable",
    listings: listings.map((listing) => ({ ...listing, status: "unavailable" })), features: [] };
  if (!configured()) return unavailable;
  let runs, rows;
  try {
    runs = Object.fromEntries((await query(activeSql)).map((row) => [row.source_id, row]));
    if (!runs.addresses || !runs.parcels) return unavailable;
    rows = await query(candidatesSql, [runs.addresses.run_id, runs.parcels.run_id,
      runs.neighborhoods?.run_id ?? null, listings.map(({ id }) => id)]);
  } catch {
    return unavailable;
  }
  // A clipped result set could silently hide a competing parcel match.
  if (rows.length > 4000) return unavailable;
  const candidates = new Map();
  for (const row of rows) {
    if (!candidates.has(row.key)) candidates.set(row.key, []);
    candidates.get(row.key).push(row);
  }
  const results = listings.map((listing) => matchListing(listing, candidates.get(listing.id) ?? []));
  const features = results.flatMap(({ geometry, ...properties }) => geometry
    ? [{ type: "Feature", id: properties.id, properties, geometry }] : []);
  return {
    ...meta, status: results.some(({ status }) => status !== "linked") ? "partial" : "ok",
    address_indexed_at: runs.addresses.finished_at,
    neighborhood_indexed_at: runs.neighborhoods?.finished_at ?? null,
    listings: results, features,
  };
}
