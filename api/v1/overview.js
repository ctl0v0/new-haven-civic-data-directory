import { guarded, params } from "../../parcel/api.js";
import { parcelOverview } from "../../parcel/service.js";

export default guarded((request) => {
  const p = params(request);
  return parcelOverview(p.id, p.objectid);
});
