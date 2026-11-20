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
      r.finished_at, to_jsonb(r)->'metadata' AS metadata, last.status AS latest_attempt_status,
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
    const summary = run.metadata?.parcel_link_summary;
    if (!summary || summary.indexed_count + summary.ambiguous_count + summary.unlinked_count !== Number(run.returned_count))
      throw new Error("The aggregate permit linkage audit is unavailable");
    const { indexed_count, ambiguous_count, unlinked_count, ...diagnostics } = summary;
    const counts = { ...diagnostics, distinct_source_records: Number(run.returned_count),
      indexed_records: indexed_count, exact_records: indexed_count,
      ambiguous_records: ambiguous_count, unlinked_records: unlinked_count };
    return { ...base, counts, samples: [],
      coverage: { index_status: "connected", active_run_id: Number(run.run_id),
        active_run_finished_at: run.finished_at,
        latest_attempt_status: run.latest_attempt_status === "failed" &&
          run.latest_attempt_warning?.startsWith("MUNICIPAL_TYPE_CAP:")
          ? "blocked" : run.latest_attempt_status,
        latest_attempt_warning: run.latest_attempt_warning ?? null,
        fresh: Date.now() - Date.parse(run.finished_at) <= 48 * 3600_000 },
      note: "Only permits with verified parcel links are retained. These counts describe the coverage of the selected source run." };
  } catch {
    return { ...base, counts: null, samples: [], coverage: {
      index_status: "unavailable",
      note: "Permit linkage audit failed; no zero count was asserted." } };
  }
}
