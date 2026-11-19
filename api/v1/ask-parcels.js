import { guarded } from "../../parcel/api.js";
import { readRequestText, SourceError } from "../../parcel/http.js";
import { askIndexedParcels } from "../../search-index/ask.js";

export default guarded(async (request) => {
  const raw = await readRequestText(request, 2048);
  let body;
  try { body = JSON.parse(raw); }
  catch { throw new SourceError("Invalid question JSON", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new SourceError("Question JSON must be an object", 400);
  const result = await askIndexedParcels(body);
  console.info(JSON.stringify({ event: "parcel_question_result",
    input_mode: body.filters ? "edited_filters" : "question",
    status: result.status,
    item_count: result.search_result?.items?.length ?? 0,
    index_status: result.search_result?.coverage?.index_status ?? null,
    source_checks: result.search_result?.coverage?.source_checks?.map((check) => ({
      source_id: check.source_id, status: check.status,
      run_id: check.run_id ?? null, date_covered: check.date_covered ?? null,
      latest_attempt_status: check.latest_attempt_status ?? null,
    })) ?? [],
  }));
  return result;
}, { methods: ["POST"] });
