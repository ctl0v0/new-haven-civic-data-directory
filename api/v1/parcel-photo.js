import { guarded, params } from "../../parcel/api.js";
import { parcelPhoto } from "../../parcel/service.js";

export default guarded((request) => {
  const p = params(request);
  return parcelPhoto(p.id, p.objectid);
});
