import { normalizeAddress } from "../parcel/resolve.js";
import { indexQuery } from "./db.js";

// This is a diagnostic comparison of two official sources. An address match is
// never written to search_record_parcels or represented as a vendor parcel key.
export async function auditMunicipalAddressCandidates(permitTypes, { query = indexQuery,
  sampleLimit = 5 } = {}) {
  if (!Array.isArray(permitTypes) || !permitTypes.length ||
      permitTypes.some((type) => typeof type !== "string" || !type.trim()) ||
      !Number.isSafeInteger(sampleLimit) || sampleLimit < 0 || sampleLimit > 10)
    throw new Error("Provide published permit types and a sample limit of 0–10");
  const [addressRun] = await query(`SELECT r.id, r.status, r.returned_count,
    r.finished_at FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
    WHERE a.source_id = 'addresses' AND a.scope_key = 'all'`);
  if (!addressRun || addressRun.status !== "complete")
    throw new Error("A validated City address-point run is required for this audit");

  const byAddress = new Map();
  let lastId = 0;
  let addressPointsRead = 0;
  for (;;) {
    const page = await query(`WITH page AS (
      SELECT record_id, fields->>'normalized_address' AS normalized_address
      FROM search_records WHERE run_id = $1 AND source_id = 'addresses'
        AND record_id::bigint > $2 ORDER BY record_id::bigint LIMIT 5000
    ) SELECT p.record_id, p.normalized_address,
      COALESCE(jsonb_agg(jsonb_build_object('city_parcel_id', j.city_parcel_id,
        'city_objectid', j.city_objectid, 'join_status', j.join_status))
        FILTER (WHERE j.record_id IS NOT NULL), '[]'::jsonb) AS links
      FROM page p LEFT JOIN search_record_parcels j ON j.run_id = $1
        AND j.source_id = 'addresses' AND j.record_id = p.record_id
      GROUP BY p.record_id, p.normalized_address ORDER BY p.record_id::bigint`,
    [addressRun.id, lastId]);
    for (const row of page) {
      const id = Number(row.record_id);
      if (!Number.isSafeInteger(id) || id <= lastId)
        throw new Error("City address-point IDs are not ordered unique integers");
      lastId = id;
      addressPointsRead++;
      const key = row.normalized_address;
      if (!key) continue;
      const entry = byAddress.get(key) ?? { address_ids: [], parcel_keys: new Set(),
        all_exact: true };
      entry.address_ids.push(id);
      if (!row.links?.length) entry.all_exact = false;
      for (const link of row.links ?? []) {
        if (link.join_status !== "exact") entry.all_exact = false;
        entry.parcel_keys.add(`${link.city_parcel_id}:${link.city_objectid}`);
      }
      byAddress.set(key, entry);
    }
    if (page.length < 5000) break;
  }
  if (addressPointsRead !== Number(addressRun.returned_count))
    throw new Error("City address-point audit did not read the complete active run");

  const results = [];
  for (const permitType of permitTypes) {
    const scope = `permit-type:${permitType.toUpperCase()}`;
    const [run] = await query(`SELECT r.id, r.status, r.returned_count, r.finished_at,
      to_jsonb(r)->'metadata' AS metadata
      FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
      WHERE a.source_id = 'municity' AND a.scope_key = $1`, [scope]);
    if (!run || run.status !== "complete") {
      results.push({ permit_type: permitType, status: "not_indexed" });
      continue;
    }
    const rows = await query(`SELECT r.record_id,
      r.fields->>'LegalAddress' AS legal_address,
      r.fields->>'PrintKey' AS print_key,
      r.fields->>'Parcel_ID' AS vendor_parcel_id,
      COALESCE(jsonb_agg(jsonb_build_object('city_parcel_id', j.city_parcel_id,
        'city_objectid', j.city_objectid, 'join_status', j.join_status))
        FILTER (WHERE j.record_id IS NOT NULL), '[]'::jsonb) AS links
      FROM search_records r LEFT JOIN search_record_parcels j
        ON j.run_id = r.run_id AND j.source_id = r.source_id
        AND j.record_id = r.record_id
      WHERE r.run_id = $1 AND r.source_id = 'municity'
      GROUP BY r.record_id, r.fields ORDER BY r.record_id::bigint`, [run.id]);
    if (rows.length !== Number(run.metadata?.indexed_count ?? run.returned_count))
      throw new Error(`Municipal address audit did not read all ${permitType} records`);
    const counts = { indexed_records: rows.length, with_legal_address: 0,
      with_exact_city_address_candidate: 0, missing_city_address_point: 0,
      ambiguous_city_address_candidate: 0,
      exact_vendor_link_and_address_agree: 0,
      exact_vendor_link_and_address_conflict: 0,
      unlinked_missing_print_key_with_candidate: 0,
      unlinked_nonblank_print_key_with_candidate: 0,
      missing_print_key_with_vendor_parcel_id: 0 };
    const samples = { unlinked_missing_key_candidates: [],
      vendor_link_address_conflicts: [] };
    for (const row of rows) {
      const printKey = String(row.print_key ?? "").trim();
      const vendorParcelId = String(row.vendor_parcel_id ?? "").trim();
      if (!printKey && vendorParcelId) counts.missing_print_key_with_vendor_parcel_id++;
      const legalAddress = String(row.legal_address ?? "").trim();
      if (!legalAddress) continue;
      counts.with_legal_address++;
      const entry = byAddress.get(normalizeAddress(legalAddress));
      if (!entry) { counts.missing_city_address_point++; continue; }
      if (!entry.all_exact || entry.parcel_keys.size !== 1) {
        counts.ambiguous_city_address_candidate++;
        continue;
      }
      counts.with_exact_city_address_candidate++;
      const [candidate] = entry.parcel_keys;
      const exactLinks = row.links.filter((link) => link.join_status === "exact")
        .map((link) => `${link.city_parcel_id}:${link.city_objectid}`);
      if (exactLinks.length) {
        if (exactLinks.length === 1 && exactLinks[0] === candidate)
          counts.exact_vendor_link_and_address_agree++;
        else {
          counts.exact_vendor_link_and_address_conflict++;
          if (samples.vendor_link_address_conflicts.length < sampleLimit)
            samples.vendor_link_address_conflicts.push({ record_id: row.record_id,
              legal_address: legalAddress, vendor_link: exactLinks,
              city_address_candidate: candidate, city_address_objectids: entry.address_ids });
        }
      } else if (!row.links.length) {
        if (printKey) counts.unlinked_nonblank_print_key_with_candidate++;
        else {
          counts.unlinked_missing_print_key_with_candidate++;
          if (samples.unlinked_missing_key_candidates.length < sampleLimit)
            samples.unlinked_missing_key_candidates.push({ record_id: row.record_id,
              legal_address: legalAddress, city_address_candidate: candidate,
              city_address_objectids: entry.address_ids });
        }
      }
    }
    results.push({ permit_type: permitType, status: "audited",
      run_id: Number(run.id), run_finished_at: run.finished_at, counts, samples });
  }
  return { city_address_run_id: Number(addressRun.id),
    city_address_run_finished_at: addressRun.finished_at,
    city_address_points_read: addressPointsRead, results,
    note: "City address-point candidates are diagnostic only. They do not establish a vendor parcel relationship or change citywide search results." };
}
