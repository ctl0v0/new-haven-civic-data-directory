import { indexQuery } from "../search-index/db.js";
import { getSearchCoverage } from "../search-index/coverage.js";
import { searchIndexedPermits } from "../search-index/permits.js";

const writer = process.env.SEARCH_DATABASE_WRITE_URL;
const password = process.env.SEARCH_DATABASE_READER_PASSWORD;
const role = process.env.SEARCH_DATABASE_READER_ROLE ?? "search_index_reader";
if (!writer || !password || !/^[a-z][a-z0-9_]*$/.test(role))
  throw new Error("Search index writer, reader password, and valid role are required");

const reader = new URL(writer);
reader.username = role;
reader.password = password;
process.env.SEARCH_DATABASE_URL = reader.toString();

const [identity] = await indexQuery(`SELECT current_user AS role,
  has_table_privilege(current_user, 'search_records', 'SELECT') AS can_read,
  has_table_privilege(current_user, 'search_records', 'INSERT') AS can_insert`);
if (identity?.role !== role || !identity.can_read || identity.can_insert)
  throw new Error("Search index reader login or read-only permissions failed");

const coverage = await getSearchCoverage();
if (coverage.index_status !== "connected")
  throw new Error("Read-only index coverage check failed");
const parcel = coverage.sources.find((source) => source.index_source_id === "parcels");
if (!parcel?.indexed || Number(parcel.returned_count) < 1)
  throw new Error("City parcel baseline is absent");

const permit = await searchIndexedPermits({ permit_types: ["Hood - C"], limit: 5 });
if (permit.coverage.index_status === "unavailable" ||
    permit.coverage.source_checks.some((source) => source.status === "not_indexed"))
  throw new Error("Indexed Hood - C permit query is unavailable");

const addressRuns = await indexQuery(`SELECT run_id FROM search_active_runs
  WHERE source_id = 'addresses' AND scope_key = 'all'`);
const addressRun = addressRuns[0]?.run_id;
const addressSamples = addressRun ? await indexQuery(`SELECT a.record_id,
    a.fields->>'normalized_address' AS address, COUNT(j.record_id)::integer AS links,
    COUNT(j.record_id) FILTER (WHERE j.join_status = 'ambiguous')::integer AS ambiguous_links
    FROM search_records a JOIN search_record_parcels j
      ON j.run_id = a.run_id AND j.source_id = a.source_id AND j.record_id = a.record_id
    WHERE a.run_id = $1 AND a.source_id = 'addresses'
      AND a.fields->>'normalized_address' IN ('20 ELD ST', '486 ORANGE ST')
    GROUP BY a.record_id, a.fields->>'normalized_address'
    ORDER BY a.record_id LIMIT 12`, [addressRun]) : [];
const mostOverlappingAddresses = addressRun ? await indexQuery(`SELECT a.record_id,
    a.fields->>'normalized_address' AS address, COUNT(*)::integer AS links,
    COUNT(DISTINCT j.city_parcel_id)::integer AS parcel_ids
    FROM search_record_parcels j JOIN search_records a
      ON a.run_id = j.run_id AND a.source_id = j.source_id AND a.record_id = j.record_id
    WHERE j.run_id = $1 AND j.source_id = 'addresses'
    GROUP BY a.record_id, a.fields->>'normalized_address'
    ORDER BY links DESC, a.record_id LIMIT 5`, [addressRun]) : [];

const knownPermit = await indexQuery(`SELECT r.record_id, r.fields->>'PermitNo' AS permit_number,
    j.city_parcel_id, j.city_objectid, j.join_status
    FROM search_active_runs a JOIN search_records r ON r.run_id = a.run_id
      AND r.source_id = a.source_id
    LEFT JOIN search_record_parcels j ON j.run_id = r.run_id
      AND j.source_id = r.source_id AND j.record_id = r.record_id
    WHERE a.source_id = 'municity' AND a.scope_key = 'permit-type:HOOD - C'
      AND r.fields->>'PermitNo' = 'M-23-00357'
    ORDER BY j.city_parcel_id LIMIT 12`);

console.log(JSON.stringify({ reader_role_verified: true,
  parcel_baseline: { returned: parcel.returned_count, linked: parcel.linked_count,
    unlinked: parcel.unlinked_count, warning: parcel.warning },
  hood_permit_query: { returned_this_page: permit.items.length,
    complete_for_query: permit.complete_for_query,
    source_checks: permit.coverage.source_checks },
  known_permit: knownPermit, address_samples: addressSamples,
  most_overlapping_addresses: mostOverlappingAddresses }));
