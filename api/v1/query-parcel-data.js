import { guarded } from "../../parcel/api.js";
import { readRequestText, SourceError } from "../../parcel/http.js";
import { queryParcelData } from "../../search-index/parcel-query.js";

export default guarded(async (request) => {
  const raw = await readRequestText(request, 16000);
  let input;
  try { input = JSON.parse(raw); }
  catch { throw new SourceError("Invalid parcel query JSON", 400); }
  return queryParcelData(input);
}, { methods: ["POST"] });
