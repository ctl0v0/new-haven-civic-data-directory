import { guarded } from "../../parcel/api.js";
import { searchIndexedPermitActivity } from "../../search-index/permit-activity.js";

export default guarded((request) => searchIndexedPermitActivity(
  Object.fromEntries(new URL(request.url).searchParams)));
