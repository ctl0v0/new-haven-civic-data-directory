import { guarded } from "../../parcel/api.js";
import { searchParcels } from "../../parcel/service.js";

export default guarded((request) => {
  const p = new URL(request.url).searchParams;
  return searchParcels({
    scope: p.get("scope") ?? undefined,
    neighborhood: p.get("neighborhood") ?? undefined,
    ward: p.get("ward") ?? undefined,
    use_codes: p.getAll("use_code"),
    commercial_units_min: p.get("commercial_units_min") ?? undefined,
    sale_date_from: p.get("sale_date_from") ?? undefined,
    sale_date_to: p.get("sale_date_to") ?? undefined,
    scan_limit: p.get("scan_limit") ?? undefined,
    cursor: p.get("cursor") ?? undefined,
  });
});
