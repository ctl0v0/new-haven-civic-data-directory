import { guarded } from "../../parcel/api.js";
import { pilotPreviewEnabled } from "../../parcel/auth.js";
import { readRequestText, SourceError } from "../../parcel/http.js";
import { BUSINESS_SEARCH_BODY_LIMIT, nearbyBusinessMatches } from "../../parcel/nearby-business-count.js";

export default guarded(async (request) => {
  if (!pilotPreviewEnabled()) throw new SourceError("Nearby business research is available in the private Preview.", 404);
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json"))
    throw new SourceError("Expected JSON", 415);
  const text = await readRequestText(request, BUSINESS_SEARCH_BODY_LIMIT);
  let input;
  try { input = JSON.parse(text); }
  catch { throw new SourceError("Invalid JSON", 400); }
  return nearbyBusinessMatches(input);
}, { methods: ["POST"] });
