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
  return askIndexedParcels(body);
}, { methods: ["POST"] });
