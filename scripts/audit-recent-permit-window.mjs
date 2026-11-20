import { indexQuery } from "../search-index/db.js";
import { fetchJson } from "../parcel/http.js";
import { normalizeAddress } from "../parcel/resolve.js";

const writer = process.env.SEARCH_DATABASE_WRITE_URL;
const password = process.env.SEARCH_DATABASE_READER_PASSWORD;
const role = process.env.SEARCH_DATABASE_READER_ROLE ?? "search_index_reader";
if (!writer || !password || !/^[a-z][a-z0-9_]*$/.test(role))
  throw new Error("Index writer URL and existing read-only role settings are required");
const reader = new URL(writer);
reader.username = role;
reader.password = password;
process.env.SEARCH_DATABASE_URL = reader.toString();
const [identity] = await indexQuery("SELECT current_user AS role, " +
  "has_table_privilege(current_user, 'search_records', 'SELECT') AS can_read, " +
  "has_table_privilege(current_user, 'search_records', 'INSERT,UPDATE,DELETE,TRUNCATE') AS can_write");
if (identity?.role !== role || !identity.can_read || identity.can_write)
  throw new Error("The parcel-link audit requires a verified read-only index role");

const active = await indexQuery("SELECT r.id, r.source_id, r.scope_key, r.status, r.returned_count, " +
  "r.unlinked_count, r.coverage_date_from, r.coverage_date_to, to_jsonb(r)->'metadata' AS metadata FROM search_active_runs a " +
  "JOIN search_source_runs r ON r.id = a.run_id WHERE " +
  "(a.source_id = 'municity' AND a.scope_key = 'permit-window:90') " +
  "OR (a.source_id IN ('parcels','addresses','neighborhoods') AND a.scope_key = 'all')");
const permit = active.find((row) => row.source_id === "municity");
const city = active.find((row) => row.source_id === "parcels");
const addresses = active.find((row) => row.source_id === "addresses");
const neighborhoods = active.find((row) => row.source_id === "neighborhoods");
if ([permit, city, addresses, neighborhoods].some((row) => row?.status !== "complete"))
  throw new Error("Validated permit, City parcel, address and neighborhood source runs are required");
if (permit.metadata?.parcel_only) {
  console.log(JSON.stringify({ event: "recent_permit_linkage_audit_summary",
    run_id: permit.id, date_from: permit.coverage_date_from, date_to: permit.coverage_date_to,
    source_count: permit.returned_count, ...permit.metadata.parcel_link_summary }));
  process.exit(0);
}

const missing = await indexQuery("SELECT r.record_id, r.published_type, r.event_date, r.source_url, " +
  "r.fields->>'PermitNo' AS permit_number, r.fields->>'Parcel_ID' AS vendor_id, " +
  "r.fields->>'PrintKey' AS print_key, r.fields->>'PrintKey_Parcel' AS parent_key, " +
  "r.fields->>'VerifiedParentPrintKey' AS verified_key, r.fields->>'LegalAddress' AS legal_address " +
  "FROM search_records r WHERE r.run_id = $1 AND r.source_id = 'municity' " +
  "AND NOT EXISTS (SELECT 1 FROM search_record_parcels j WHERE j.run_id = r.run_id " +
  "AND j.source_id = r.source_id AND j.record_id = r.record_id) ORDER BY r.record_id", [permit.id]);
if (missing.length !== Number(permit.unlinked_count))
  throw new Error("Audited permits disagree with the run's unlinked record count");

const text = (value) => String(value ?? "").trim();
const key = (value) => text(value).replace(/[/\s]+/g, " ").trim().toUpperCase();
const placeholder = (value) => /^0+(?: 0+)*$|^-1$|^N A$|^NA$/.test(value);
const validVendorId = (value) => /^[1-9]\d{0,11}$/.test(text(value));
const uniq = (items) => [...new Set(items)];
const add = (map, name, row) => {
  if (name) map.set(name, [...(map.get(name) ?? []), row]);
};
function summarize(rows, field) {
  const counts = new Map();
  for (const row of rows) counts.set(row[field], (counts.get(row[field]) ?? 0) + 1);
  return [...counts.entries()].sort((a,b) => b[1] - a[1]);
}

const cityByKey = new Map();
const cityByAddress = new Map();
let last = "";
let cityCount = 0;
for (;;) {
  const page = await indexQuery("SELECT record_id, fields->>'mblu' AS mblu, " +
    "fields->>'parcel_id' AS pid, fields->>'objectid' AS objectid, fields->>'property_address' AS address " +
    "FROM search_records WHERE run_id = $1 AND source_id = 'parcels' AND record_id > $2 " +
    "ORDER BY record_id LIMIT 5000", [city.id, last]);
  for (const row of page) {
    add(cityByKey, key(row.mblu), row);
    add(cityByAddress, normalizeAddress(row.address), row);
  }
  cityCount += page.length;
  if (page.length < 5000) break;
  last = page.at(-1).record_id;
}
if (cityCount !== Number(city.returned_count)) throw new Error("City parcel inventory count disagrees with its source run");

const wantedAddresses = uniq(missing.map((row) => normalizeAddress(row.legal_address)).filter(Boolean));
const points = await indexQuery("SELECT a.fields->>'normalized_address' AS normalized, a.record_id AS address_id, " +
  "j.city_parcel_id, j.city_objectid, j.join_status " +
  "FROM search_records a LEFT JOIN search_record_parcels j ON j.run_id = a.run_id " +
  "AND j.source_id = a.source_id AND j.record_id = a.record_id WHERE a.run_id = $1 " +
  "AND a.source_id = 'addresses' AND a.fields->>'normalized_address' = ANY($2::text[])",
[addresses.id, wantedAddresses]);
const pointsByAddress = new Map();
for (const point of points) add(pointsByAddress, point.normalized, point);
const parcelKey = (pid, objectid) => pid && objectid ? pid + ":" + objectid : null;
const westville = await indexQuery("SELECT DISTINCT j.city_parcel_id, j.city_objectid " +
  "FROM search_records n JOIN search_record_parcels j ON j.run_id = n.run_id " +
  "AND j.source_id = n.source_id AND j.record_id = n.record_id " +
  "WHERE n.run_id = $1 AND n.source_id = 'neighborhoods' AND j.join_status = 'exact' " +
  "AND (upper(n.fields->>'neighborhood') = 'WESTVILLE' OR upper(n.fields->>'neighborhood_label') = 'WESTVILLE')",
[neighborhoods.id]);
const westvilleKeys = new Set(westville.map((row) => parcelKey(row.city_parcel_id, row.city_objectid)));

const reviewed = missing.map((row) => {
  const published = uniq([row.print_key, row.parent_key, row.verified_key].map(key).filter(Boolean));
  const keys = published.filter((value) => !placeholder(value));
  const matches = uniq(keys.flatMap((value) => (cityByKey.get(value) ?? [])
    .map((p) => parcelKey(p.pid, p.objectid))).filter(Boolean));
  const cityFeatureCount = keys.flatMap((value) => cityByKey.get(value) ?? []).length;
  let reason;
  if (!keys.length) reason = published.length ? "placeholder_keys_only" : "no_published_key";
  else if (keys.length > 1) reason = "published_keys_disagree";
  else if (matches.length > 1) reason = "key_matches_multiple_city_parcels";
  else if (matches.length === 1) reason = "exact_city_key_without_index_link";
  else reason = cityFeatureCount ? "city_key_lacks_parcel_id" : "key_absent_from_city_gis";

  const normalized = normalizeAddress(row.legal_address);
  const addressPoints = pointsByAddress.get(normalized) ?? [];
  const addressesMatched = uniq(addressPoints.map((p) =>
    parcelKey(p.city_parcel_id, p.city_objectid)).filter(Boolean));
  const situs = uniq((cityByAddress.get(normalized) ?? []).map((p) =>
    parcelKey(p.pid, p.objectid)).filter(Boolean));
  let addressStatus;
  if (!normalized) addressStatus = "no_published_legal_address";
  else if (addressPoints.length && addressesMatched.length === 1 &&
    addressPoints.every((p) => p.join_status === "exact")) addressStatus = "one_city_address_point_parcel";
  else if (addressPoints.length) addressStatus = "city_address_point_missing_or_ambiguous_link";
  else if (situs.length === 1) addressStatus = "one_city_situs_address_parcel";
  else if (situs.length > 1) addressStatus = "multiple_city_situs_address_parcels";
  else addressStatus = "legal_address_no_exact_city_match";
  return { ...row, reason, keys, matches, address_status: addressStatus,
    candidate: addressStatus === "one_city_address_point_parcel" ? addressesMatched[0]
      : addressStatus === "one_city_situs_address_parcel" ? situs[0] : null };
});

console.log(JSON.stringify({ event: "recent_permit_link_audit", scope: permit.scope_key,
  from: permit.coverage_date_from, to: permit.coverage_date_to, permit_run_id: permit.id,
  city_run_id: city.id, address_run_id: addresses.id, permit_total: Number(permit.returned_count),
  unlinked_reviewed: reviewed.length, reasons: summarize(reviewed, "reason"),
  address_checks: summarize(reviewed, "address_status"),
  top_permit_types: summarize(reviewed, "published_type").slice(0, 16) }));
for (const [reason, count] of summarize(reviewed, "reason")) {
  const rows = reviewed.filter((row) => row.reason === reason);
  console.log(JSON.stringify({ event: "recent_permit_link_bucket", reason, count,
    positive_vendor_ids: rows.filter((row) => validVendorId(row.vendor_id)).length,
    unique_vendor_ids: uniq(rows.filter((row) => validVendorId(row.vendor_id)).map((row) => row.vendor_id)).length,
    at_least_one_exact_city_key: rows.filter((row) => row.matches.length > 0).length,
    one_exact_city_key: rows.filter((row) => row.matches.length === 1).length,
    two_or_more_exact_city_keys: rows.filter((row) => row.matches.length > 1).length,
    printed_keys: summarize(rows, "print_key").slice(0, 4),
    printed_parent_keys: summarize(rows, "parent_key").slice(0, 4),
    address_checks: summarize(rows, "address_status"),
    top_permit_types: summarize(rows, "published_type").slice(0, 7) }));
}
const heater = reviewed.filter((row) => row.published_type?.trim().toUpperCase() === "WATER HEATER");
console.log(JSON.stringify({ event: "recent_permit_link_water_heater", unlinked_citywide: heater.length,
  westville_address_candidates_not_joined: heater.filter((row) => westvilleKeys.has(row.candidate))
    .map(({ record_id, permit_number, source_url, reason, candidate }) =>
      ({ record_id, permit_number, source_url, reason, candidate })) }));

const catalog = await indexQuery("SELECT r.record_id, r.fields->>'group' AS group_name " +
  "FROM search_active_runs a JOIN search_records r ON r.run_id = a.run_id " +
  "AND r.source_id = a.source_id WHERE a.source_id = 'municity-permit-types' AND a.scope_key = 'all'");
const groups = new Map(catalog.map((row) => [text(row.record_id).toUpperCase(), row.group_name]));
const noKey = reviewed.filter((row) => row.reason === "no_published_key").map((row) => ({
  group: groups.get(text(row.published_type).toUpperCase()) ?? "No published catalog group",
  permit_number_prefix: text(row.permit_number).match(/^[A-Z]+(?=-)/i)?.[0] ?? "No prefix",
}));
console.log(JSON.stringify({ event: "recent_permit_link_no_key_groups",
  published_catalog_groups: summarize(noKey, "group"),
  published_permit_number_prefixes: summarize(noKey, "permit_number_prefix") }));

async function municipalRecord(entity, field, id) {
  const url = new URL("https://services5.municity5.com/M5Services/M5Service.svc/GetM5Data");
  for (const [name, value] of Object.entries({ Customer: "NewHavenCityCT",
    entity, entity_id: "", fieldtype: "text", mapid: "", mapobject: "",
    module: "", numrecs: "5", operator: "=", pid: "",
    searchfield: field, section: "", value: String(id) })) url.searchParams.set(name, value);
  try {
    const data = await fetchJson(url, { headers: { SourceId: "2" }, timeout: 12000, maxBytes: 8_000_000 });
    if (!Array.isArray(data.rows) || Number(data.total) !== 1 || text(data.rows[0]?.[field]) !== text(id))
      return { error: "The publisher did not return one exact " + field };
    return { row: data.rows[0] };
  } catch (error) { return { error: String(error?.message ?? error).slice(0, 140) }; }
}
function explicitParentKeys(row) {
  const notes = [row?.ParcelNote, row?.ParcelNote2].map(text).join(" ");
  return uniq([...notes.matchAll(/\b(?:PORTION\s+OF|PART\s+OF|P\/O)\s+(\d{3}[ /]+\d{4}[ /]+\d{5})\b/gi)]
    .map((match) => key(match[1])));
}
const samples = new Map();
for (const [reason] of summarize(reviewed, "reason")) {
  const rows = reviewed.filter((row) => row.reason === reason);
  const pickedTypes = new Set();
  for (const row of rows) {
    if (pickedTypes.size >= 3 || pickedTypes.has(row.published_type)) continue;
    samples.set(row.record_id, row);
    pickedTypes.add(row.published_type);
  }
  for (const row of rows.filter((item) => validVendorId(item.vendor_id) && item.candidate).slice(0, 2))
    samples.set(row.record_id, row);
}
for (const row of heater.slice(0, 3)) samples.set(row.record_id, row);
for (const id of ["590646", "590915", "590925", "590963"]) {
  const row = reviewed.find((item) => item.record_id === id);
  if (row) samples.set(row.record_id, row);
}
const vendorParcels = new Map();
for (const sample of [...samples.values()].slice(0, 28)) {
  const official = await municipalRecord("Permit", "Permit_ID", sample.record_id);
  const id = text(official.row?.Parcel_ID) || sample.vendor_id;
  if (validVendorId(id) && !vendorParcels.has(id))
    vendorParcels.set(id, await municipalRecord("Parcel", "Parcel_ID", id));
  const parent = vendorParcels.get(id);
  const parentFields = parent?.row ? Object.fromEntries(Object.entries(parent.row)
    .filter(([name, value]) => /^(?:Parent.*(?:ID|Key|MBLU)|PrintKey_Parcel|Parcel_ID|PrintKey)$/i.test(name) && text(value))) : null;
  console.log(JSON.stringify({ event: "recent_permit_link_official_sample",
    permit_id: sample.record_id, permit_number: sample.permit_number,
    permit_type: sample.published_type, reason: sample.reason, source_url: sample.source_url,
    permit_keys: sample.keys, vendor_id_from_date_search: sample.vendor_id,
    address_published: Boolean(text(sample.legal_address)), city_key_matches: sample.matches,
    address_status: sample.address_status, address_candidate_not_joined: sample.candidate,
    exact_permit: official.row ? { vendor_id: official.row.Parcel_ID ?? null,
      print_key: official.row.PrintKey ?? null, parent_key: official.row.PrintKey_Parcel ?? null,
      address_published: Boolean(text(official.row.LegalAddress)) } : { error: official.error },
    exact_vendor_parcel: parentFields, explicit_parent_keys_in_notes: explicitParentKeys(parent?.row),
    vendor_parcel_error: parent?.error ?? null }));
}

const missingByVendor = new Map();
for (const row of reviewed) if (validVendorId(row.vendor_id)) add(missingByVendor, row.vendor_id, row);
const parentChecks = [];
for (const [id, permits] of missingByVendor) {
  const lookup = vendorParcels.get(id) ?? await municipalRecord("Parcel", "Parcel_ID", id);
  const directKey = key(lookup.row?.PrintKey);
  const noteKeys = explicitParentKeys(lookup.row);
  const linkedKeys = noteKeys.map((noteKey) => ({ key: noteKey,
    matches: uniq((cityByKey.get(noteKey) ?? []).map((p) => parcelKey(p.pid, p.objectid)).filter(Boolean)) }));
  const candidate = linkedKeys.length === 1 && linkedKeys[0].matches.length === 1
    ? linkedKeys[0].matches[0] : null;
  const structured = Object.fromEntries(Object.entries(lookup.row ?? {})
    .filter(([name, value]) => /^(?:Parent.*(?:ID|Key|MBLU)|PrintKey_Parcel)$/i.test(name) && text(value)));
  const finding = { vendor_parcel_id: id, permit_count: permits.length,
    status: lookup.row ? "exact_vendor_parcel" : "unavailable_or_not_unique",
    ...(lookup.error ? { error: lookup.error } : {}),
    direct_key: directKey || null, structured_parent_fields: structured,
    note_parent_keys: linkedKeys, note_city_candidate: candidate,
    matching_address_candidates: candidate ? permits.filter((p) => p.candidate === candidate).length : 0,
    example_source: permits[0].source_url };
  parentChecks.push(finding);
  console.log(JSON.stringify({ event: "recent_permit_link_parent_check", ...finding }));
}
const noteMatches = parentChecks.filter((row) => row.note_city_candidate);
console.log(JSON.stringify({ event: "recent_permit_link_parent_summary", vendor_ids_checked: parentChecks.length,
  checks_by_status: summarize(parentChecks, "status"),
  vendor_ids_with_structured_parent: parentChecks.filter((row) => Object.keys(row.structured_parent_fields).length).length,
  vendor_ids_with_notes_naming_parent: parentChecks.filter((row) => row.note_parent_keys.length).length,
  vendor_ids_with_unique_city_note_parent: noteMatches.length,
  permits_on_those_vendor_ids: noteMatches.reduce((sum, row) => sum + row.permit_count, 0),
  permits_with_same_city_address_candidate: noteMatches.reduce((sum, row) => sum + row.matching_address_candidates, 0) }));
