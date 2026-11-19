import { guarded, params } from "../../parcel/api.js";
import { parcelApplicationDetails } from "../../parcel/service.js";

export default guarded((request) => {
  const p = params(request);
  return parcelApplicationDetails(p.id, new URL(request.url).searchParams.get("application_id"), p.objectid);
});
