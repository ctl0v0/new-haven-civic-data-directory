import { guarded, params } from "../../parcel/api.js";
import { pilotPreviewEnabled } from "../../parcel/auth.js";
import { readRequestText, SourceError } from "../../parcel/http.js";
import { nearbyBusinessCount, nearbyBusinessOrigins } from "../../parcel/nearby-business-count.js";

export default guarded(async (request) => {
  if (!pilotPreviewEnabled()) throw new SourceError("Nearby business research is available in the private Preview.", 404);
  if (request.method === "GET") {
    const { id, objectid, query_address } = params(request);
    return nearbyBusinessOrigins({ parcel_id: id, objectid: objectid ?? undefined, query_address: query_address ?? undefined });
  }
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json"))
    throw new SourceError("Expected JSON", 415);
  const text = await readRequestText(request, 2048);
  let input;
  try { input = JSON.parse(text); }
  catch { throw new SourceError("Invalid JSON", 400); }
  return nearbyBusinessCount(input);
}, { methods: ["GET", "POST"] });
