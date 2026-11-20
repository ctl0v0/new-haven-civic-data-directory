import { guarded } from "../../parcel/api.js";
import { municipalPermitTypes } from "../../parcel/permit-types.js";
import { questionPermitCatalog } from "../../search-index/ask.js";

export default guarded((request) => new URL(request.url).searchParams.get("prefer") === "index"
  ? questionPermitCatalog() : municipalPermitTypes());
