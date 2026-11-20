import { indexQuery } from "./db.js";
import { beginRun, failRun, finishRun, insertRecords, setRunInventory } from "./import.js";
import { RECENT_PERMIT_WINDOWS } from "./municity.js";
import { filteredPermitLinkGaps } from "./parcel-only-permits.js";
import { collectPermitActivity, PERMIT_ACTIVITY_SOURCE, PERMIT_ACTIVITY_TYPES } from "./permit-activity-source.js";

const write = (sql, values = []) => indexQuery(sql, values, { write: true });

export async function importMunicipalPermitActivity() {
  const [parent] = await write(`SELECT r.id, r.metadata, r.coverage_date_from::text AS date_from,
    r.coverage_date_to::text AS date_to
    FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
    WHERE a.source_id = 'municity' AND a.scope_key = $1 AND r.status = 'complete'
      AND r.metadata->>'parcel_only' = 'true' AND r.finished_at >= now() - interval '48 hours'`,
  [RECENT_PERMIT_WINDOWS.find(({ days }) => days === 90).scope_key]);
  if (!parent?.date_from || !parent.date_to)
    throw new Error("A fresh, validated 90-day parcel permit run is required");

  const range = { from: parent.date_from, to: parent.date_to };
  const runId = await beginRun(PERMIT_ACTIVITY_SOURCE, "all", null, null, range);
  try {
    const types = PERMIT_ACTIVITY_TYPES.map((type) => type.toUpperCase());
    const permits = await write(`SELECT record_id, published_type, published_status, fields
      FROM search_records WHERE run_id = $1 AND source_id = 'municity'
        AND upper(trim(published_type)) = ANY($2::text[]) ORDER BY record_id`, [parent.id, types]);
    const byType = Object.fromEntries(PERMIT_ACTIVITY_TYPES.map((type) => [type.toUpperCase(), {
      permits_checked: 0, permits_with_application_id: 0,
      counts: { application: 0, review: 0, inspection: 0 },
      gaps: { application: 0, review: 0, inspection: 0 },
      parcel_link_gaps: filteredPermitLinkGaps(parent.metadata, { types: [type.toUpperCase()], ...range }),
    }]));
    let total = 0;
    for (let offset = 0; offset < permits.length; offset += 3) {
      const batch = await Promise.all(permits.slice(offset, offset + 3).map(async (permit) => ({
        permit, ...await collectPermitActivity(permit),
      })));
      for (const { permit, records, gaps, has_application_id } of batch) {
        const diagnostics = byType[permit.published_type.trim().toUpperCase()];
        diagnostics.permits_checked++;
        if (has_application_id) diagnostics.permits_with_application_id++;
        for (const [kind, count] of Object.entries(gaps)) diagnostics.gaps[kind] += count;
        for (const { fields } of records) diagnostics.counts[fields.activity_kind]++;
      }
      const records = batch.flatMap((work) => work.records);
      await insertRecords(runId, PERMIT_ACTIVITY_SOURCE, records);
      total += records.length;
    }
    await setRunInventory(runId, total);
    const [links] = await write(`WITH linked AS (
      INSERT INTO search_record_parcels (run_id, source_id, record_id,
        city_parcel_id, city_objectid, city_address_objectid, match_method)
      SELECT r.run_id, r.source_id, r.record_id, j.city_parcel_id, j.city_objectid,
        j.city_address_objectid, 'municipal-work-via-permit'
      FROM search_records r JOIN search_record_parcels j ON j.run_id = $2
        AND j.source_id = 'municity' AND j.record_id = r.fields->>'permit_id'
        AND j.join_status = 'exact'
      WHERE r.run_id = $1 AND r.source_id = $3 RETURNING record_id
    ) SELECT count(DISTINCT record_id)::int AS n FROM linked`, [runId, parent.id, PERMIT_ACTIVITY_SOURCE]);
    if (links.n !== total) throw new Error("Permit activity parcel links did not reconcile");
    const partial = Object.values(byType).some((type) =>
      Object.values(type.gaps).some(Boolean) || !type.parcel_link_gaps ||
      Object.values(type.parcel_link_gaps).some(Boolean));
    if (partial && !total) throw new Error("Official permit activity checks were incomplete and yielded no records");
    const result = await finishRun(runId, PERMIT_ACTIVITY_SOURCE, total, {
      partial, sourceWarning: partial ? "Some permit activity checks or parent parcel links are incomplete" : null,
      metadata: { parent_run_id: Number(parent.id), by_type: byType },
    });
    return { ...result, status: partial ? "partial" : "complete",
      permit_date_from: range.from, permit_date_to: range.to, by_type: byType };
  } catch (error) {
    await failRun(runId, error);
    throw error;
  }
}
