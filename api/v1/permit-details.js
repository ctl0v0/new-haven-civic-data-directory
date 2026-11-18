import { guarded, params } from "../../parcel/api.js";
import { parcelPermitDetails } from "../../parcel/service.js";

export default guarded((request) => {
  const p = params(request);
  return parcelPermitDetails(p.id, new URL(request.url).searchParams.get("permit_id"), p.objectid);
});
