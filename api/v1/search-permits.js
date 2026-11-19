import { guarded } from "../../parcel/api.js";
import { searchMunicipalPermits } from "../../parcel/service.js";

export default guarded((request) => {
  const p = new URL(request.url).searchParams;
  return searchMunicipalPermits({
    neighborhood: p.get("neighborhood"), permit_type: p.get("permit_type"),
    permit_status: p.get("permit_status"), days_back: p.get("days_back"),
    permit_date_from: p.get("permit_date_from"),
    permit_date_through: p.get("permit_date_through"),
    application_status: p.get("application_status"),
    review_status: p.get("review_status"),
    review_completed_from: p.get("review_completed_from"),
    contact_role: p.get("contact_role"),
    require_contact_role: p.get("require_contact_role") === "true",
  });
});
