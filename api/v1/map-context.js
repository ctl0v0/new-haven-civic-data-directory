import { guarded, params } from "../../parcel/api.js";
import { parcelMapContext } from "../../parcel/service.js";

export default guarded((request) => {
  const p = params(request);
  return parcelMapContext(p.id, p.objectid);
});
