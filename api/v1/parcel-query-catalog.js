import { guarded } from "../../parcel/api.js";
import { parcelQueryCatalog } from "../../parcel/query-contract.js";

export default guarded(() => parcelQueryCatalog());
