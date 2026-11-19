import { guarded, params } from "../../parcel/api.js";
import { parcelSchoolAttendance } from "../../parcel/service.js";

export default guarded((request) => {
  const p = params(request);
  return parcelSchoolAttendance(p.id, p);
});
