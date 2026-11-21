export const CHARITY_SOURCE = "ct-public-charities";
export const CHARITY_DATASET = "ngch-56tr";
export const CHARITY_SOURCE_URL = "https://data.ct.gov/d/ngch-56tr";

const types = ["PUBLIC CHARITY", "PUBLIC CHARITY - EXEMPT"];
export const CHARITY_WHERE = "upper(credential) IN (" + types.map((type) => "'" + type + "'").join(", ") + ")";
export const CHARITY_FIELDS = Object.freeze([
  "credentialid", "fullcredentialcode", "credential", "name", "businessname", "dba",
  "address", "city", "status", "statusreason", "issuedate", "expirationdate",
]);

export function isCharityRegistration(row) {
  return types.includes(String(row?.credential ?? "").toUpperCase()) &&
    /^[1-9]\d*$/.test(String(row?.credentialid ?? ""));
}
