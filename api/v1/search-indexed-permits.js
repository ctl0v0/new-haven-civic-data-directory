import { guarded } from "../../parcel/api.js";
import { searchIndexedPermits } from "../../search-index/permits.js";

export default guarded((request) => {
  const p = new URL(request.url).searchParams;
  return searchIndexedPermits({
    permit_types: p.getAll("permit_type"), scope: p.get("scope") ?? undefined,
    neighborhood: p.get("neighborhood") ?? undefined,
    ward: p.get("ward") ?? undefined,
    permit_status: p.get("permit_status") ?? undefined,
    permit_date_from: p.get("permit_date_from") ?? undefined,
    permit_date_to: p.get("permit_date_to") ?? undefined,
    limit: p.get("limit") ?? undefined, cursor: p.get("cursor") ?? undefined,
  });
});
