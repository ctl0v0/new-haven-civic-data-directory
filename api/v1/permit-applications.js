import { guarded } from "../../parcel/api.js";
import { listPermitApplications } from "../../parcel/permit-applications.js";

export default guarded((request) =>
  listPermitApplications(Object.fromEntries(new URL(request.url).searchParams)));
