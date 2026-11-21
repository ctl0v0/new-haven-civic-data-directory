import { guarded } from "../../parcel/api.js";
import { pilotPreviewEnabled } from "../../parcel/auth.js";
import { readRequestText, SourceError } from "../../parcel/http.js";
import { previewListingAddresses, vacancyLayer } from "../../search-index/vacancy-layer.js";

export default guarded(async (request) => {
  if (!pilotPreviewEnabled()) throw new SourceError("Listing collection unavailable.", 404);
  if (request.method === "GET") return vacancyLayer(previewListingAddresses());
  const text = await readRequestText(request, 32_000);
  let input;
  try { input = JSON.parse(text); } catch {
    throw new SourceError("Expected a JSON list of listing addresses.", 400);
  }
  if (!Array.isArray(input?.addresses))
    throw new SourceError("Expected a JSON list of listing addresses.", 400);
  return vacancyLayer(input.addresses);
}, { methods: ["GET", "POST"] });
