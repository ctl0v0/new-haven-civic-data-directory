import { guarded } from "../../parcel/api.js";
import { readRequestText, SourceError } from "../../parcel/http.js";
import { commercialRenterTools, requireRenterPreview } from "../../search-index/commercial-renter.js";

export default guarded(async (request) => {
  requireRenterPreview();
  const raw = await readRequestText(request, 32_000);
  let input;
  try { input = JSON.parse(raw); }
  catch { throw new SourceError("Invalid renter search JSON.", 400); }
  const name = input?.tool;
  if (typeof name !== "string" || !Object.hasOwn(commercialRenterTools, name))
    throw new SourceError("Choose a supported renter search.", 400);
  return commercialRenterTools[name].run(input.arguments);
}, { methods: ["POST"] });
