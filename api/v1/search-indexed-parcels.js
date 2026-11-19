import { guarded } from "../../parcel/api.js";
import { readRequestText, SourceError } from "../../parcel/http.js";
import { searchIndexedParcels } from "../../search-index/search.js";

export default guarded(async (request) => {
  const raw = await readRequestText(request, 8192);
  let body;
  try { body = JSON.parse(raw); }
  catch { throw new SourceError("Invalid search JSON", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new SourceError("Search JSON must be an object", 400);
  return searchIndexedParcels(body);
}, { methods: ["POST"] });
