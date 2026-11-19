import { guarded } from "../../parcel/api.js";
import { getSearchCoverage } from "../../search-index/coverage.js";

export default guarded(() => getSearchCoverage());
