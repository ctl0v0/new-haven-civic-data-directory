import { guarded } from "../../parcel/api.js";
import { browseParcels } from "../../parcel/browse.js";

export default guarded((request) =>
  browseParcels(new URL(request.url).searchParams.get("bbox")));
