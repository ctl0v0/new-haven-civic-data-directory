import { guarded, params } from "../../parcel/api.js";
import { parcelGeometry } from "../../parcel/service.js";

export default guarded((request) => {
  const p = params(request);
  return parcelGeometry(p.id, p.objectid);
});
