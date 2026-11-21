import { guarded, params } from "../../parcel/api.js";
import { pilotPreviewEnabled } from "../../parcel/auth.js";
import { readRequestText, SourceError } from "../../parcel/http.js";
import { nearbyBusinessOrigins } from "../../parcel/nearby-business-count.js";
import { analyzeStorefront, opportunityAvailability, storefrontConcepts } from "../../parcel/storefront-opportunity.js";

export default guarded(async (request) => {
  if (!pilotPreviewEnabled()) throw new SourceError("Storefront analysis is available in the private Preview.", 404);
  if (request.method === "GET") {
    const { id, objectid, query_address } = params(request);
    const { origins, default_origin, warning, configured: placesConfigured } = await nearbyBusinessOrigins({
      parcel_id: id, objectid: objectid ?? undefined, query_address: query_address ?? undefined,
    });
    const cityOrigins = origins.filter(({ method }) => method === "city-address-point");
    return {
      ...opportunityAvailability(), origins: cityOrigins,
      default_origin, warning,
      half_mile_available: placesConfigured && cityOrigins.length > 0,
      space_checks: storefrontConcepts.filter(({ commercial }) => commercial)
        .map(({ id, label }) => ({ id, label })),
    };
  }
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json"))
    throw new SourceError("Expected JSON", 415);
  const body = await readRequestText(request);
  let input;
  try { input = JSON.parse(body); }
  catch { throw new SourceError("Invalid JSON", 400); }
  return analyzeStorefront(input, { signal: request.signal });
}, { methods: ["GET", "POST"] });
