import { guarded, params } from "../../parcel/api.js";
import { parcelZoning } from "../../parcel/service.js";

export default guarded((request) => {
  const { id, objectid } = params(request);
  return parcelZoning(id, objectid);
});
