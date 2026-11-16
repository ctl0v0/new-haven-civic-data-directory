import { guarded, params } from "../../parcel/api.js";
import { parcelFeed } from "../../parcel/service.js";
export default guarded((request) => {
  const p = params(request);
  return parcelFeed(p.id, p);
});
