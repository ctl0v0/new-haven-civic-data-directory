import { guarded, params } from "../../parcel/api.js";
import { parcelRecords } from "../../parcel/service.js";
export default guarded((request) => {
  const p = params(request);
  return parcelRecords(p.id, p.group, p);
});
