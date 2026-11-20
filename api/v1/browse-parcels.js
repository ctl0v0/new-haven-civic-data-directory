import { guarded } from "../../parcel/api.js";
import { browseParcels } from "../../parcel/browse.js";

export default guarded((request) => {
  const params = new URL(request.url).searchParams;
  return browseParcels(params.get("bbox"), { zoom: params.get("zoom") });
});
