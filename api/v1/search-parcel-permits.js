import { guarded } from "../../parcel/api.js";
import { searchParcelPermits } from "../../parcel/service.js";

export default guarded((request) => {
  const p = new URL(request.url).searchParams;
  return searchParcelPermits({
    scope: p.get("scope") ?? undefined,
    neighborhood: p.get("neighborhood") ?? undefined,
    permit_types: p.getAll("permit_type"),
    permit_status: p.get("permit_status"),
    permit_date_from: p.get("permit_date_from"),
    permit_date_to: p.get("permit_date_to"),
    application_status: p.get("application_status"),
    review_type: p.get("review_type"),
    review_status: p.get("review_status"),
    review_completed_from: p.get("review_completed_from"),
    review_completed_to: p.get("review_completed_to"),
    contact_role: p.get("contact_role"),
    permit_description_terms: p.getAll("permit_description_term"),
    require_contact_role: p.has("require_contact_role")
      ? p.get("require_contact_role") === "true" ? true
        : p.get("require_contact_role") === "false" ? false : p.get("require_contact_role")
      : undefined,
    scan_limit: p.get("scan_limit"),
    cursor: p.get("cursor"),
  });
});
