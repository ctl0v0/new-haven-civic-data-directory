import { guarded } from "../../parcel/api.js";
import { auditMunicipalPermitLinks } from "../../search-index/linkage-audit.js";

export default guarded((request) => {
  const params = new URL(request.url).searchParams;
  return auditMunicipalPermitLinks({
    permit_type: params.get("permit_type"),
    sample_limit: params.get("sample_limit") ?? undefined,
  });
});
