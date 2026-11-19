import { SourceError } from "../parcel/http.js";
import { indexConfigured, indexQuery } from "./db.js";

// Diagnose only published permit-to-parcel keys. An address on an unlinked
// permit is evidence to review, not permission to attach it to a City parcel.
export async function auditMunicipalPermitLinks(input = {}, { query = indexQuery } = {}) {
  const permitType = String(input.permit_type ?? "").trim();
  const sampleLimit = input.sample_limit == null ? 5 : Number(input.sample_limit);
  if (!permitType || permitType.length > 100 || /[\x00-\x1f]/.test(permitType))
    throw new SourceError("Provide one exact published permit type", 400);
  if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 10)
    throw new SourceError("sample_limit must be 1–10", 400);
  const scopeKey = `permit-type:${permitType.toUpperCase()}`;
  const base = { permit_type: permitType, scope_key: scopeKey };
  if (!indexConfigured()) return { ...base, counts: null, samples: [],
    coverage: { index_status: "unconfigured" } };
  try {
    const [run] = await query(`SELECT r.id AS run_id, r.status, r.expected_count,
      r.returned_count, r.linked_count, r.ambiguous_count, r.unlinked_count,
      r.finished_at, last.status AS latest_attempt_status,
      last.warning AS latest_attempt_warning
      FROM search_active_runs a JOIN search_source_runs r ON r.id = a.run_id
      LEFT JOIN LATERAL (SELECT status, warning FROM search_source_runs
        WHERE source_id = 'municity' AND scope_key = a.scope_key
        ORDER BY started_at DESC, id DESC LIMIT 1) last ON true
      WHERE a.source_id = 'municity' AND a.scope_key = $1`, [scopeKey]);
    if (!run) {
      const [attempt] = await query(`SELECT status, warning, started_at
        FROM search_source_runs WHERE source_id = 'municity' AND scope_key = $1
        ORDER BY started_at DESC, id DESC LIMIT 1`, [scopeKey]);
      return { ...base, counts: null, samples: [], coverage: {
        index_status: "not_indexed",
        ...(attempt ? { latest_attempt_status: attempt.status === "failed" &&
          attempt.warning?.startsWith("MUNICIPAL_TYPE_CAP:") ? "blocked" : attempt.status,
        latest_attempt_warning: attempt.warning ?? null,
        latest_attempt_started_at: attempt.started_at } : {}),
      } };
    }
    const [counts] = await query(`WITH links AS (
      SELECT record_id, bool_or(join_status = 'exact') AS exact,
        bool_or(join_status = 'ambiguous') AS ambiguous
      FROM search_record_parcels WHERE run_id = $1 AND source_id = 'municity'
      GROUP BY record_id
    ) SELECT count(*)::integer AS indexed_records,
      count(*) FILTER (WHERE COALESCE(l.exact, false))::integer AS exact_records,
      count(*) FILTER (WHERE COALESCE(l.ambiguous, false))::integer AS ambiguous_records,
      count(*) FILTER (WHERE l.record_id IS NULL)::integer AS unlinked_records,
      count(*) FILTER (WHERE l.record_id IS NULL AND
        NULLIF(btrim(r.fields->>'PrintKey'), '') IS NULL)::integer AS missing_print_key,
      count(*) FILTER (WHERE l.record_id IS NULL AND
        NULLIF(btrim(r.fields->>'PrintKey'), '') IS NOT NULL)::integer AS unmatched_print_key,
      count(*) FILTER (WHERE l.record_id IS NULL AND
        NULLIF(btrim(r.fields->>'Parcel_ID'), '') IS NOT NULL)::integer AS unlinked_with_vendor_parcel_id,
      count(*) FILTER (WHERE l.record_id IS NULL AND
        NULLIF(btrim(r.fields->>'PrintKey'), '') IS NULL AND
        NULLIF(btrim(r.fields->>'Parcel_ID'), '') IS NOT NULL)::integer AS missing_print_key_with_vendor_parcel_id,
      count(*) FILTER (WHERE l.record_id IS NULL AND
        NULLIF(btrim(r.fields->>'PrintKey_Parcel'), '') IS NOT NULL)::integer AS unlinked_with_vendor_parcel_key,
      count(*) FILTER (WHERE l.record_id IS NULL AND
        NULLIF(btrim(r.fields->>'PrintKey'), '') IS NULL AND
        NULLIF(btrim(r.fields->>'PrintKey_Parcel'), '') IS NOT NULL)::integer AS missing_print_key_with_vendor_parcel_key,
      count(*) FILTER (WHERE l.record_id IS NULL AND
        NULLIF(btrim(r.fields->>'LegalAddress'), '') IS NOT NULL)::integer AS unlinked_with_legal_address
      FROM search_records r LEFT JOIN links l ON l.record_id = r.record_id
      WHERE r.run_id = $1 AND r.source_id = 'municity'`, [run.run_id]);
    if (Number(counts?.indexed_records) !== Number(run.returned_count) ||
        Number(counts?.unlinked_records) !== Number(run.unlinked_count) ||
        Number(counts?.missing_print_key) + Number(counts?.unmatched_print_key) !==
          Number(counts?.unlinked_records))
      throw new Error("Indexed permit linkage counts disagree with the active source run");
    const samples = await query(`WITH unlinked AS (
      SELECT r.record_id, r.source_url, r.fields->>'PermitNo' AS permit_number,
        r.fields->>'PrintKey' AS print_key,
        r.fields->>'PrintKey_Parcel' AS print_key_parcel,
        r.fields->>'Parcel_ID' AS vendor_parcel_id,
        r.fields->>'LegalAddress' AS legal_address,
        CASE WHEN NULLIF(btrim(r.fields->>'PrintKey'), '') IS NULL
          THEN 'missing_print_key' ELSE 'unmatched_print_key' END AS reason
      FROM search_records r WHERE r.run_id = $1 AND r.source_id = 'municity'
        AND NOT EXISTS (SELECT 1 FROM search_record_parcels j
          WHERE j.run_id = r.run_id AND j.source_id = r.source_id
            AND j.record_id = r.record_id)
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY reason ORDER BY record_id) AS rank
      FROM unlinked
    ) SELECT record_id, source_url, permit_number, print_key, print_key_parcel,
        vendor_parcel_id, legal_address, reason
      FROM ranked WHERE rank <= $2 ORDER BY reason, record_id`,
    [run.run_id, sampleLimit]);
    return { ...base, counts, samples,
      coverage: { index_status: "connected", active_run_id: Number(run.run_id),
        active_run_finished_at: run.finished_at,
        latest_attempt_status: run.latest_attempt_status === "failed" &&
          run.latest_attempt_warning?.startsWith("MUNICIPAL_TYPE_CAP:")
          ? "blocked" : run.latest_attempt_status,
        latest_attempt_warning: run.latest_attempt_warning ?? null,
        fresh: Date.now() - Date.parse(run.finished_at) <= 48 * 3600_000 },
      note: "These counts describe the selected indexed source run. A published legal address is not by itself a verified City parcel link." };
  } catch {
    return { ...base, counts: null, samples: [], coverage: {
      index_status: "unavailable",
      note: "Permit linkage audit failed; no zero count was asserted." } };
  }
}
