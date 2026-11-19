import { guarded } from "../../parcel/api.js";
import { parcelManifest } from "../../parcel/service.js";

export default guarded((request) => {
  const p = new URL(request.url).searchParams;
  return parcelManifest(p.get("parcel_id"), p.get("objectid"));
});
