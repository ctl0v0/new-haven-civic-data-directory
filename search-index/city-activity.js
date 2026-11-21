import { z } from "zod";
import { LAYERS } from "../parcel/config.js";
import { SourceError } from "../parcel/http.js";
import { fingerprint, makeSearchCursor, readSearchCursor } from "../parcel/search-cursor.js";
import { recentCalendarDates } from "./ask.js";
import { indexConfigured, indexQuery } from "./db.js";
import { MUNICIPAL_LICENSE_SOURCE } from "./municipal-licenses.js";
import { recentPermitRun, RECENT_PERMIT_SCOPES } from "./municity.js";
import { PERMIT_ACTIVITY_KINDS, PERMIT_ACTIVITY_SOURCE, PERMIT_ACTIVITY_TYPES } from "./permit-activity-source.js";
import { STATE_ROSTERS } from "./socrata.js";
import { listingAddressKey, MAX_LISTING_ADDRESSES, previewListingAddresses, vacancyLayer, VACANCY_COLLECTION_ID } from "./vacancy-layer.js";

const kinds = ["sale", "permit", "license", "application", "review", "inspection"];
export const cityActivitySchema = z.strictObject({
  neighborhood: z.string().trim().min(1).max(100).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  activity: z.enum(kinds).optional(),
  permit_type: z.string().trim().min(1).max(100).optional(),
  collection: z.literal(VACANCY_COLLECTION_ID).optional(),
  listing_query: z.string().trim().min(1).max(100).optional(),
  listing_addresses: z.array(z.string().max(160)).min(1).max(MAX_LISTING_ADDRESSES).optional(),
  cursor: z.string().min(1).max(3000).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
const cityPortal = "https://www.municityconnect.com/#/app/NewHavenCityCT/search";
const childKinds = Object.keys(PERMIT_ACTIVITY_KINDS);
const sources = {
  parcels: { label: "City parcel sales", kinds: ["sale"], url: LAYERS.parcels,
    note: "The parcel layer publishes one sale date and price per parcel. Earlier transfers may be missing." },
  municity: { label: "City permits", kinds: ["permit"], url: cityPortal },
  [MUNICIPAL_LICENSE_SOURCE]: { label: "City business licenses", kinds: ["license"], url: cityPortal,
    note: "The City license index covers a subset of parcels. A record needs a published issue date to appear." },
  "ct-liquor-permits": { label: "Connecticut liquor permits", kinds: ["license"],
    note: "The State roster supplies effective dates for the permits it currently publishes." },
  "ct-child-care-licenses": { label: "Connecticut child care licenses", kinds: ["license"],
    note: "The State roster supplies effective dates for the licenses it currently publishes." },
  [PERMIT_ACTIVITY_SOURCE]: { label: "City permit applications, reviews and inspections",
    kinds: childKinds, url: cityPortal,
    note: `The index checks a limited set of parent permits for ${PERMIT_ACTIVITY_TYPES.join(", ")}. Events need a published date.` },
  neighborhoods: { label: "City neighborhood boundaries", kinds: [], url: LAYERS.neighborhoods },
};

const day = (value) => value instanceof Date ? value.toISOString().slice(0, 10)
  : String(value ?? "").slice(0, 10) || null;
const cityNeighborhood = "coalesce(nullif(trim(n.fields->>'neighborhood'), ''), nullif(trim(n.fields->>'neighborhood_label'), ''))";

const activeRunsSql = `SELECT a.source_id, a.scope_key, a.run_id, r.status, r.finished_at,
    r.coverage_date_from, r.coverage_date_to, r.unlinked_count, r.ambiguous_count,
    last.status AS latest_attempt_status
  FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
  LEFT JOIN LATERAL (SELECT status FROM search_source_runs
    WHERE source_id = a.source_id AND scope_key = a.scope_key
    ORDER BY started_at DESC, id DESC LIMIT 1) last ON true
  WHERE (a.scope_key = 'all' AND a.source_id = ANY($1::text[]))
    OR (a.source_id = 'municity' AND a.scope_key = ANY($2::text[]))`;

const activitySql = `WITH dated AS (
    SELECT r.*, CASE r.source_id
      WHEN 'parcels' THEN 'sale'
      WHEN 'municity' THEN 'permit'
      WHEN 'municity-permit-activity' THEN r.fields->>'activity_kind'
      ELSE 'license' END AS kind
    FROM jsonb_to_recordset($1::jsonb) AS active(source_id text, run_id bigint)
    JOIN search_records r USING (run_id, source_id)
    WHERE r.event_date BETWEEN $2::date AND $3::date
  ), wanted AS (
    SELECT * FROM dated WHERE kind = ANY($4::text[])
      AND ($10::text IS NULL OR (kind = 'permit' AND lower(trim(published_type)) = lower($10::text)))
  ), verified AS (
    SELECT w.*, j.parcel_id, j.objectid
    FROM wanted w
    JOIN LATERAL (
      SELECT min(city_parcel_id)::text AS parcel_id, min(city_objectid)::text AS objectid
      FROM search_record_parcels
      WHERE (run_id, source_id, record_id) = (w.run_id, w.source_id, w.record_id)
      HAVING count(DISTINCT (city_parcel_id, city_objectid)) = 1 AND bool_and(join_status = 'exact')
    ) j ON true
    WHERE w.kind <> 'sale'
    UNION ALL
    SELECT w.*, w.fields->>'parcel_id', w.record_id FROM wanted w WHERE w.kind = 'sale'
      AND w.fields->>'parcel_id' ~ '^[1-9][0-9]{0,11}$' AND w.record_id ~ '^[1-9][0-9]{0,11}$'
  ), projects AS (
    SELECT parcel_id, objectid,
      CASE WHEN kind = 'permit' THEN 'permit:' || record_id
        WHEN source_id = 'municity-permit-activity' AND fields->>'permit_id' ~ '^[0-9]+$'
          THEN 'permit:' || (fields->>'permit_id')
        ELSE source_id || ':' || record_id END AS project_id,
      max(event_date) AS event_date,
      jsonb_agg(jsonb_build_object('source_id', source_id, 'record_id', record_id,
        'source_url', source_url, 'activity', kind, 'event_date', event_date,
        'published_type', published_type, 'published_status', published_status, 'fields', fields)
        ORDER BY event_date DESC, kind, source_id, record_id) AS events
    FROM verified
    GROUP BY parcel_id, objectid, project_id
  )
  SELECT projects.*, p.fields->>'property_address' AS city_address, p.source_url AS parcel_source_url,
    neighborhood.names AS neighborhoods
  FROM projects
  JOIN search_records p ON p.run_id = $5::bigint AND p.source_id = 'parcels'
    AND p.record_id = projects.objectid AND p.fields->>'parcel_id' = projects.parcel_id
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT ${cityNeighborhood} ORDER BY ${cityNeighborhood})
      FILTER (WHERE ${cityNeighborhood} IS NOT NULL) AS names,
      bool_or(lower($7::text) IN (lower(n.fields->>'neighborhood'), lower(n.fields->>'neighborhood_label'),
        lower(${cityNeighborhood}))) AS matches_filter
    FROM search_record_parcels b JOIN search_records n USING (run_id, source_id, record_id)
    WHERE b.run_id = $6::bigint AND b.source_id = 'neighborhoods' AND b.join_status = 'exact'
      AND b.city_parcel_id = projects.parcel_id::bigint AND b.city_objectid = projects.objectid::bigint
  ) neighborhood ON true
  WHERE ($7::text IS NULL OR neighborhood.matches_filter)
    AND ($11::jsonb IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_to_recordset($11::jsonb) AS l(parcel_id text, objectid text)
      WHERE l.parcel_id = projects.parcel_id AND l.objectid = projects.objectid
    ))
  ORDER BY projects.event_date DESC, projects.objectid, projects.parcel_id, projects.project_id
  LIMIT $8 OFFSET $9`;

function overlappingPermitRun(active, from, to) {
  return active.filter(({ source_id, scope_key, status, coverage_date_from, coverage_date_to }) =>
    source_id === "municity" && RECENT_PERMIT_SCOPES.includes(scope_key) && status === "complete" &&
    day(coverage_date_from) && day(coverage_date_from) <= to && day(coverage_date_to) >= from)
    .sort((a, b) => {
      const overlap = (run) => Date.parse(day(run.coverage_date_to) < to ? day(run.coverage_date_to) : to)
        - Date.parse(day(run.coverage_date_from) > from ? day(run.coverage_date_from) : from);
      return overlap(b) - overlap(a) || Date.parse(b.finished_at) - Date.parse(a.finished_at);
    })[0];
}

function sourceCheck(source_id, run, filters, now) {
  const { label, note, url } = sources[source_id];
  const parcelIdentityOnly = source_id === "parcels" && filters.activity && filters.activity !== "sale";
  const roster = STATE_ROSTERS[source_id];
  const info = { source_id, label: parcelIdentityOnly ? "City parcel identities" : label,
    source_url: url ?? `https://data.ct.gov/resource/${roster.dataset}.json` };
  if (!run) return { ...info, status: "not_indexed", note: source_id === "municity"
    ? "No verified citywide permit index window overlaps these dates."
    : "No active index run for this source." };

  const coverage_from = day(run.coverage_date_from), coverage_to = day(run.coverage_date_to);
  const latestRefreshFailed = run.latest_attempt_status === "failed";
  const olderThanTwoDays = now.getTime() - Date.parse(run.finished_at) > 2 * 86400_000;
  const skippedLinks = Number(run.unlinked_count ?? 0) + Number(run.ambiguous_count ?? 0);
  const notes = [parcelIdentityOnly ? null : note,
    source_id === "municity" && (coverage_from > filters.from || coverage_to < filters.to)
      ? "The indexed permit window covers only part of the selected dates." : null,
    skippedLinks && source_id !== "parcels" && source_id !== "neighborhoods"
      ? `${skippedLinks} records in this index run lack a unique verified parcel link.` : null,
    latestRefreshFailed ? "The latest refresh failed. Results use the previous active run."
      : olderThanTwoDays ? "The active run is more than two days old." : null,
    run.status === "partial" ? "The index run is partial." : null,
  ].filter(Boolean);
  return { ...info, status: notes.length ? "partial" : "indexed", indexed_at: run.finished_at,
    coverage_from, coverage_to, note: notes.join(" ") || null };
}

function publicEvent(row) {
  const { fields, ...event } = row;
  const roster = STATE_ROSTERS[event.source_id];
  if (event.activity === "sale")
    return { ...event, date_field: "sale_date", price: fields.price ?? null,
      book: fields.book ?? null, page: fields.page ?? null };
  if (event.activity === "permit")
    return { ...event, date_field: "PermitDate", permit_number: fields.PermitNo ?? null,
      address: fields.LegalAddress ?? null };
  if (event.activity === "license")
    return { ...event, date_field: roster?.event_date ?? "IssueDate",
      business_name: fields.BusinessName ?? fields.dba ?? fields.name ?? null,
      license_number: fields.LicenseNumber ?? (roster ? fields[roster.credential] : null) ?? null,
      address: fields.LegalAddress ?? fields.Addr1 ?? (roster ? fields[roster.site] : null) ?? null };
  return { ...event, date_field: PERMIT_ACTIVITY_KINDS[event.activity].date,
    permit_number: fields.permit_number ?? null, permit_type: fields.permit_type ?? null,
    department: fields.Department ?? null, results: fields.Results ?? null };
}

export async function listCityActivity(input = {}, { query = indexQuery,
  configured = indexConfigured, now = new Date(), resolveListings = vacancyLayer } = {}) {
  const parsed = cityActivitySchema.safeParse(input);
  if (!parsed.success) throw new SourceError("Invalid city activity filters", 400);
  const { permit_type, neighborhood = null, cursor, limit = 25,
    collection, listing_query, listing_addresses } = parsed.data;
  if (!collection && (listing_query || listing_addresses))
    throw new SourceError("Choose the Civic Fit collection to filter by listing.", 400);
  const activity = parsed.data.activity ?? (permit_type ? "permit" : null);
  if (permit_type && activity !== "permit")
    throw new SourceError("A permit type can only filter permit activity", 400);
  const defaults = recentCalendarDates(7, now);
  const to = parsed.data.to ?? defaults.to;
  const from = parsed.data.from ?? (parsed.data.to
    ? new Date(Date.parse(to) - 6 * 86400_000).toISOString().slice(0, 10) : defaults.from);
  if (from > to) throw new SourceError("The start date must be on or before the through date", 400);
  const filters = { from, to, activity, neighborhood, ...(permit_type ? { permit_type } : {}),
    ...(collection ? { collection } : {}), ...(listing_query ? { listing_query } : {}) };
  const sourceIds = Object.keys(sources).filter((id) => !activity || sources[id].kinds.includes(activity) ||
    ["parcels", "neighborhoods"].includes(id));
  const layer = collection ? await resolveListings(listing_addresses ?? previewListingAddresses(), { query, configured }) : null;
  const listings = layer?.listings.filter(({ address, neighborhoods, neighborhood_aliases = [], status }) => status === "linked"
    && (!listing_query || address.toLowerCase().includes(listing_query.toLowerCase()))
    && (!neighborhood || [...neighborhoods, ...neighborhood_aliases].some((name) => name.toLowerCase() === neighborhood.toLowerCase())));
  const members = new Map();
  for (const entry of listings ?? []) {
    const key = `${entry.parcel_id}:${entry.objectid}`;
    if (!members.has(key)) members.set(key, []);
    members.get(key).push(entry);
  }
  const scope = layer ? { collection: { id: collection, status: layer.status,
    listing_count: layer.listings.length, linked_count: layer.listings.filter(({ status }) => status === "linked").length,
    matching_listings: listings.length, matching_parcels: members.size } } : {};
  const empty = { filters, ...scope, neighborhoods: [], items: [], next_cursor: null };
  if (layer && ["needs_import", "unavailable"].includes(layer.status))
    return { ...empty, coverage: { status: "unavailable", sources: [] } };
  if (!configured()) return { ...empty, coverage: { status: "unconfigured", sources: [] } };

  const active = await query(activeRunsSql, [sourceIds.filter((id) => id !== "municity"),
    sourceIds.includes("municity") ? RECENT_PERMIT_SCOPES : []]);
  const runs = new Map(active.filter((row) => row.scope_key === "all").map((row) => [row.source_id, row]));
  if (sourceIds.includes("municity")) {
    const permits = recentPermitRun(active, from, to) ?? overlappingPermitRun(active, from, to);
    if (permits) runs.set("municity", permits);
  }
  const checks = sourceIds.map((id) => sourceCheck(id, runs.get(id), filters, now));
  const parcelRun = runs.get("parcels")?.run_id;
  const neighborhoodRun = runs.get("neighborhoods")?.run_id;
  const coverage = { status: !parcelRun || (neighborhood && !neighborhoodRun) ? "unavailable"
    : layer?.status === "partial" || checks.some((check) => check.status !== "indexed") ? "partial" : "indexed", sources: checks };
  const parcelScope = layer ? [...members.values()].map(([{ parcel_id, objectid }]) => ({ parcel_id, objectid })) : null;
  const queryHash = fingerprint({ filters, limit, ...(layer ? { listings: listings.map(({ id, parcel_id, objectid }) =>
    [id, parcel_id, objectid]).sort() } : {}) });
  const sourceHash = fingerprint(sourceIds.map((id) => [id, String(runs.get(id)?.run_id ?? "")]));
  const { offset } = readSearchCursor(cursor, queryHash, sourceHash);
  const names = neighborhoodRun ? await query(`SELECT DISTINCT ${cityNeighborhood} AS name,
      nullif(trim(n.fields->>'neighborhood_label'), '') AS alias
    FROM search_records n WHERE n.run_id = $1 AND n.source_id = 'neighborhoods'
      AND ${cityNeighborhood} IS NOT NULL ORDER BY name, alias`, [neighborhoodRun]) : [];
  const neighborhoods = [...new Set(names.map(({ name }) => name))];
  if (neighborhood && neighborhoodRun &&
      !names.some(({ name, alias }) => [name, alias].some((value) =>
        value?.toLowerCase() === neighborhood.toLowerCase())))
    throw new SourceError("Select a name from the City neighborhood layer", 400);
  if (coverage.status === "unavailable" || (layer && !parcelScope.length)) return { ...empty, neighborhoods, coverage };
  const dataRuns = sourceIds.filter((id) => id !== "neighborhoods" && (id !== "parcels" || !activity || activity === "sale") &&
    runs.has(id)).map((source_id) => ({ source_id, run_id: String(runs.get(source_id).run_id) }));
  const rows = await query(activitySql, [JSON.stringify(dataRuns), from, to, activity ? [activity] : kinds,
    parcelRun, neighborhoodRun ?? null, neighborhood, limit + 1, offset, permit_type ?? null,
    parcelScope ? JSON.stringify(parcelScope) : null]);
  const items = rows.slice(0, limit).map((row) => {
    const matchedListings = members.get(`${row.parcel_id}:${row.objectid}`) ?? [];
    return {
      id: `${row.parcel_id}:${row.objectid}:${row.project_id}`,
      city_parcel_id: row.parcel_id, city_objectid: row.objectid,
      city_address: row.city_address, parcel_source_url: row.parcel_source_url,
      neighborhoods: row.neighborhoods ?? [], event_date: day(row.event_date),
      ...(layer ? { listing_addresses: matchedListings.map(({ address }) => address) } : {}),
      events: row.events.map((event) => {
        if (!layer) return publicEvent(event);
        const roster = STATE_ROSTERS[event.source_id];
        const explicit = roster ? event.fields[roster.site] : event.fields.LegalAddress;
        const exact = explicit ? matchedListings.filter(({ id }) => id === listingAddressKey(explicit)) : [];
        return { ...publicEvent(event), matched_listing_addresses: exact.map(({ address }) => address) };
      }),
    };
  });
  return { filters, ...scope, neighborhoods, items, coverage, next_cursor: rows.length > limit
    ? makeSearchCursor({ v: 1, query: queryHash, source: sourceHash, offset: offset + limit,
      expires: Date.now() + 30 * 60_000 }) : null };
}
