import { guarded, params } from "../../parcel/api.js";
import { parcelSummary } from "../../parcel/service.js";
export default guarded((request) => {
  const p = params(request);
  return parcelSummary(p.id, p.objectid);
});
