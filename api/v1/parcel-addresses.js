import { guarded, params } from "../../parcel/api.js";
import { parcelAddresses } from "../../parcel/service.js";

export default guarded((request) => {
  const { id, objectid } = params(request);
  return parcelAddresses(id, objectid);
});
