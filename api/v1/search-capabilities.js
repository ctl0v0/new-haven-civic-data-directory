import { guarded } from "../../parcel/api.js";
import { indexedQueryValues, searchCapabilities } from "../../parcel/search-capabilities.js";

export default guarded((request) => {
  const params = new URL(request.url).searchParams;
  return params.has("values") ? indexedQueryValues(params.get("source_id"), params.get("field")) : searchCapabilities();
});
