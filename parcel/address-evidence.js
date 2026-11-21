import { normalizeAddress } from "./resolve.js";
import { SourceError } from "./http.js";
import { CHARITY_SOURCE } from "./charity-registrations.js";
import { businessAddress, REGISTRATION_SOURCE } from "./business-registrations.js";

export function checkedQueryAddress(value) {
  if (value == null || value === "") return null;
  const query = String(value).trim();
  if (query.length > 160 || !/^\d{1,6}\s+\S/.test(query) || /[\x00-\x1f]/.test(query))
    throw new SourceError("Enter a valid street address for address focus", 400);
  return query;
}

function explicitAddress(item) {
  const a = item.attributes ?? {};
  if (item.source_id === "parcels" && a.property_address)
    return { field: "property_address", value: a.property_address };
  if (item.source_id === "addresses") {
    const street = a.full_street_name ?? `${a.street_name ?? ""} ${a.suffix_type ?? ""}`;
    const address = `${a.house_number ?? ""} ${street}`.trim();
    return address ? { field: "house_number + full_street_name", value: address } : null;
  }
  if (item.source_id === "trash-pickup" && a.address)
    return { field: "City address point house_number + full_street_name", value: a.address };
  if (item.source_id === "school-attendance" && a.address)
    return { field: "City address point or parcel address joined to NHPS street range", value: a.address };
  if (item.source_id === "municity" && a.LegalAddress &&
    ["Permit", "Application", "License", "Certificate"].includes(item.category))
    return { field: "LegalAddress", value: a.LegalAddress };
  if (["municity", "municipal-business-licenses", "municipal-occupants"].includes(item.source_id) &&
    a.recorded_address_field === "LegalAddress" && a.recorded_address)
    return { field: "LegalAddress", value: a.recorded_address };
  if (item.source_id === "ct-brownfields" && a.site_address_as_published)
    return { field: "site_address_as_published", value: a.site_address_as_published };
  if (item.source_id === CHARITY_SOURCE && a.registered_address_as_published)
    return { field: "address", value: a.registered_address_as_published };
  if (["ct-liquor-permits", "ct-child-care-licenses", "ct-cannabis-retail"].includes(item.source_id) &&
    a.site_address_as_published)
    return { field: a.site_address_source_field, value: a.site_address_as_published };
  return null;
}

export function addressEvidence(item, queryAddress) {
  const address = checkedQueryAddress(queryAddress);
  if (!address) return null;
  if (item.source_id === REGISTRATION_SOURCE && item.attributes?.billingstreet) {
    const query = businessAddress(address);
    return { source_field: "billingstreet", source_address: String(item.attributes.billingstreet),
      matches_query: businessAddress(item.attributes.billingstreet).address === query.address &&
        (!query.unit || query.unit === item.match?.verified_city_unit) };
  }
  const source = explicitAddress(item);
  if (!source || !normalizeAddress(source.value)) return null;
  return {
    source_field: source.field,
    source_address: String(source.value),
    matches_query: normalizeAddress(source.value) === normalizeAddress(address),
  };
}

export function markAddressEvidence(items, queryAddress) {
  const address = checkedQueryAddress(queryAddress);
  return address
    ? items.map((item) => ({ ...item, address_evidence: addressEvidence(item, address) }))
    : items;
}
