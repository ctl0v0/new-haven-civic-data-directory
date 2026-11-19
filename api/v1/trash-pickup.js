import { guarded, params } from "../../parcel/api.js";
import { parcelTrashPickup } from "../../parcel/service.js";

export default guarded((request) => {
  const p = params(request);
  return parcelTrashPickup(p.id, p);
});
