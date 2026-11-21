export function shortDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return value ?? "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}
function sameSourceDate(value, eventDate) {
  if (value == null || value === "" || !eventDate) return false;
  const dotNet = typeof value === "string" ? value.match(/^\/Date\((\d+)/) : null;
  const parsed = typeof value === "number" || dotNet
    ? Number(dotNet?.[1] ?? value) : Date.parse(String(value));
  const time = new Date(parsed);
  return Number.isFinite(parsed) && !Number.isNaN(time.valueOf()) && time.toISOString().slice(0, 10) === eventDate;
}
export function eventDateLabel(item) {
  const a = item.attributes ?? {};
  if (["parcel-sale", "assessor-sales"].includes(item.source_id)) return "Sale date";
  if (item.source_id === "lci-cases") return "Filed date";
  if (["ct-liquor-permits", "ct-child-care-licenses"].includes(item.source_id)) return "Effective date";
  if (item.source_id === "ct-public-charities") return "Registration issue date";
  if (item.source_id === "ct-business-registrations") return "Formation or registration date";
  if (item.source_id === "municipal-business-licenses") return "Issue date";
  if (item.source_id === "municity") {
    const fields = {
      Permit: [["PermitDate", "Permit date"], ["CreatedDate", "Created date"]],
      Application: [["ApplicationDate", "Application date"], ["CreatedDate", "Created date"]],
      License: [["IssueDate", "Issue date"], ["CreatedDate", "Created date"]],
      Certificate: [["CertificateDate", "Certificate date"], ["CreatedDate", "Created date"]],
      Document: [["modified_date", "Modified date"]],
      Complaint: [["filed_date", "Complaint date"]],
      Occupant: [["created_date", "Created date"]],
    }[item.category] ?? [];
    for (const [field, label] of fields)
      if (sameSourceDate(a[field], item.event_date)) return label;
  }
  return "Source date";
}

export function brief(value, max = 170) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function recordStatus(item) {
  const a = item.attributes ?? {};
  if (item.source_id === "municipal-occupants")
    return a.inactive == null ? null : `Inactive flag: ${a.inactive ? "Yes" : "No"}`;
  return a.status ?? a.Status ?? a.record_status ?? a.PermStatus ?? a.PermitApplicationStatus ?? a.ApplicationStatus ?? a.CompStatus ?? a.registry_status ?? null;
}
export function recordTitle(item) {
  const a = item.attributes ?? {};
  if (item.source_id === "ct-liquor-permits")
    return brief([a.dba ?? a.backer ?? "State liquor permit", a.credential].filter(Boolean).join(" · "), 120);
  if (item.source_id === "ct-child-care-licenses")
    return brief([a.name ?? "Child care or youth camp license", a.licensenumber].filter(Boolean).join(" · "), 120);
  if (item.source_id === "ct-cannabis-retail")
    return brief([a.dba ?? a.business ?? "Cannabis retail location", a.license].filter(Boolean).join(" · "), 120);
  if (item.source_id === "ct-public-charities")
    return brief([a.dba || a.businessname || a.name || "State charity registration", a.fullcredentialcode]
      .filter(Boolean).join(" · "), 120);
  if (item.source_id === "ct-business-registrations") return brief(a.name || "State business registration", 120);
  if (item.category === "Permit")
    return brief([a.PermitType, a.PermitNo ?? a.PermitNumber].filter(Boolean).join(" · ") || "Permit record", 120);
  if (item.category === "Application")
    return brief([a.ApplicationType, a.ApplicationNumber ?? a.ApplicaNo].filter(Boolean).join(" · ") || "Application record", 120);
  if (item.category === "License" && item.source_id !== "municipal-business-licenses" && !a.business_name && !a.BusinessName && !a.name)
    return brief([a.LicenseType ?? a.license_type, a.LicenseNumber ?? a.license_number].filter(Boolean).join(" · ") || "License record", 120);
  if (item.source_id === "addresses")
    return `${a.house_number ?? ""} ${a.full_street_name ?? `${a.street_name ?? ""} ${a.suffix_type ?? ""}`}`.trim() || "City address point";
  if (item.source_id === "trash-pickup")
    return `${a.address}${a.unit ? ` · unit ${a.unit}` : ""}: ${a.trash_day} trash pickup zone`;
  if (item.source_id === "school-attendance")
    return `${a.address}: ${a.k8_attendance_zone_school} (K–8) · ${a.high_school_attendance_zone_school} (high school)`;
  if (item.source_id === "assessor-valuations")
    return `${a.valuation_year ?? "Unspecified year"} ${a.valuation_type ?? ""} valuation`;
  if (item.source_id === "assessor-subareas")
    return `${a.description_as_published ?? "Building subarea"}${a.code ? ` (${a.code})` : ""}`;
  if (item.source_id === "parcels") return a.property_address ?? `City parcel ${a.parcel_id ?? ""}`;
  if (item.source_id === "parcel-assessment") return "City parcel building and assessed fields";
  if (item.source_id === "parcel-sale") return "City parcel sale field set";
  if (item.source_id === "assessor-land") return "Assessor land use and measures";
  if (item.source_id === "assessor-buildings")
    return a.heading_as_published ?? `Building section ${a.section_id ?? ""}`;
  if (item.source_id === "assessor-extra-features")
    return `${a.description_as_published ?? "Extra feature"}${a.code ? ` (${a.code})` : ""}`;
  if (item.source_id === "assessor-outbuildings")
    return `${a.description_as_published ?? "Outbuilding"}${a.code ? ` (${a.code})` : ""}`;
  if (item.source_id === "alders") {
    const ward = a.ward_label
      ? /^ward\b/i.test(a.ward_label) ? a.ward_label : `Ward ${a.ward_label}`
      : a.ward ? `Ward ${a.ward}` : "Ward not listed";
    return `${ward} · ${a.alder_name ?? "Alder not listed"}`;
  }
  if (item.source_id === "zoning")
    return a.zone_code ? `Zoning district ${a.zone_code}` : "City zoning polygon";
  if (item.source_id === "assessor") return "Assessor building and land facts";
  if (item.source_id === "parcel-owner") return a.owner_name_1 ?? a.owner_name_2 ?? "City parcel owner name";
  if (item.source_id === "assessor-owner") return a.owner_name ?? a.co_owner_name ?? "Assessor owner name";
  if (item.source_id === "cmt-contacts")
    return `CMT contacts · ${a.district_name ?? a.district_num ?? item.source_record_id}`;
  if (item.source_id === "ct-brownfields") return a.site_name ?? "DEEP inventory site";
  if (item.source_id === "business-master") return a.legal_name ?? "Owner LLC in State registry";
  if (item.source_id === "business-principals") return a.principal_name ?? "State registry principal";
  if (item.source_id === "business-agents") return a.agent_name ?? "State registered agent";
  if (["local-historic-districts", "state-historic-districts"].includes(item.source_id))
    return a.HistoricDistrict ?? a.historicdistrict ?? "Historic district boundary";
  return brief(
    a.business_name ?? a.occupant_name ?? a.owner ?? a.BusinessName ?? a.name ?? a.document_name ??
      a.complaint_number ?? a.contact_name ?? a.title ?? a.PermitNo ??
      a.PermitNumber ?? a.ApplicationNumber ?? a.ApplicaNo ?? a.LicenseNumber ??
      a.CertificateNumber ?? a.property_address ?? a.LegalAddress ??
      a.PermitType ?? a.ApplicationType ?? item.source_record_id,
    120,
  );
}

export function fieldLabel(key) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")
    .replace(/\s+/g, " ").trim().replace(/^./, (first) => first.toUpperCase());
}
