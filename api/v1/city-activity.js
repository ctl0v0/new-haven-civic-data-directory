import { guarded } from "../../parcel/api.js";
import { pilotPreviewEnabled } from "../../parcel/auth.js";
import { readRequestText, SourceError } from "../../parcel/http.js";
import { listCityActivity } from "../../search-index/city-activity.js";

export default guarded(async (request) => {
  const input = Object.fromEntries(new URL(request.url).searchParams);
  if ((input.collection || request.method === "POST") && !pilotPreviewEnabled())
    throw new SourceError("Listing collection unavailable.", 404);
  if (input.limit !== undefined) input.limit = Number(input.limit);
  if (request.method === "POST") {
    const text = await readRequestText(request, 32_000);
    try { input.listing_addresses = JSON.parse(text).addresses; } catch {
      throw new SourceError("Expected a JSON list of listing addresses.", 400);
    }
    if (!Array.isArray(input.listing_addresses))
      throw new SourceError("Expected a JSON list of listing addresses.", 400);
  }
  return listCityActivity(input);
}, { methods: ["GET", "POST"] });
