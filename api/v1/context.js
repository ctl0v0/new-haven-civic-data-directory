import { guarded, params } from "../../parcel/api.js";
import { parcelContext } from "../../parcel/service.js";

export default guarded((request) => {
  const p = params(request);
  return parcelContext(p.id, { objectid: p.objectid, cursor: p.cursor });
});
