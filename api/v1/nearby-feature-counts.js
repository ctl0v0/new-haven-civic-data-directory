import { guarded } from "../../parcel/api.js";
import { nearbyFeatureCounts } from "../../parcel/service.js";

export default guarded((request) => {
  const p = new URL(request.url).searchParams;
  return nearbyFeatureCounts(p.get("parcel_id"), {
    objectid: p.get("objectid") ?? undefined,
    radius_meters: p.get("radius_meters") ?? undefined,
    source_ids: p.getAll("source_id").length ? p.getAll("source_id") : undefined,
  });
});
