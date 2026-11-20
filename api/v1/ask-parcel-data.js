import { guarded } from "../../parcel/api.js";
import { readRequestText, SourceError } from "../../parcel/http.js";
import { askParcelData } from "../../search-index/parcel-question.js";

export default guarded(async (request) => {
  const raw = await readRequestText(request, 4000);
  let input;
  try { input = JSON.parse(raw); }
  catch { throw new SourceError("Invalid parcel question JSON", 400); }
  return askParcelData(input);
}, { methods: ["POST"] });
