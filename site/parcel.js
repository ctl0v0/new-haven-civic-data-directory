const $ = (id) => document.getElementById(id);
// Keep the future summary scaffold hidden while the source-by-source review defines it.
const SHOW_SNAPSHOT = false;
const groups = [
  ["property", "Building and addresses", "City parcel fields, assessment details, valuation rows, and address points on the parcel."],
  ["ownership", "Parcel owner and owner LLC", "City and assessor owner names, published sale fields, matched State LLC entity roles, and assessor ownership history."],
  ["business", "Businesses and occupants in records", "Municipal license and occupant rows associated with this parcel. The same LLC can also be named as owner; a license does not confirm that it occupies the building."],
  ["activity", "Permits, applications, and cases", "Municipal work records, documents, complaints, and other parcel activity."],
  ["geography", "Zoning and boundaries", "Mapped districts that intersect the parcel."],
  ["environment", "Environmental records", "State environmental inventory rows linked by an official parcel identifier."],
  ["representation", "Representation", "Ward and community management contacts shown by the checked sources."],
];
const sourceNames = {
  parcels: "City parcel layer",
  "parcel-owner": "City parcel owner fields",
  "parcel-assessment": "City parcel assessed fields",
  "parcel-sale": "City parcel sale fields",
  addresses: "City address points",
  "trash-pickup": "City trash pickup zones",
  "school-attendance": "NHPS attendance-zone schools",
  assessor: "Assessor card",
  "assessor-owner": "Assessor card owner",
  "assessor-sales": "Assessor ownership history",
  "assessor-valuations": "Assessor valuation history",
  "assessor-subareas": "Assessor building subareas",
  "assessor-land": "Assessor land use and measures",
  "assessor-buildings": "Assessor building sections",
  "assessor-extra-features": "Assessor extra features",
  "assessor-outbuildings": "Assessor outbuildings",
  "local-historic-districts": "City local historic districts",
  "state-historic-districts": "City hosted State historic districts",
  "ct-brownfields": "CT DEEP brownfields inventory",
  municity: "Municipal parcel service",
  "municipal-business-licenses": "Municipal licenses naming a business",
  "municipal-occupants": "Municipal occupants",
  "business-master": "CT registry: owner LLC",
  "business-principals": "CT owner LLC principals",
  "business-agents": "CT owner LLC agent",
  "state-licenses": "CT credentials",
  "lci-cases": "LCI cases",
  "managed-lots": "LCI managed lots",
  planning: "Planning cases",
  zoning: "City zoning",
  wards: "City wards",
  neighborhoods: "City neighborhoods",
  alders: "Board of Alders",
  cmt: "CMT districts",
  "cmt-contacts": "CMT contacts",
};
let selected = null;
let viewVersion = 0;
let searchedAddress = "";
const groupResponses = new Map();
const displayTargets = new WeakMap();
const municipalCategoryTitles = {
  Document: "Documents",
  Application: "Applications",
  Complaint: "Complaints",
  Contact: "Contacts",
  License: "Licenses",
  Permit: "Permits",
  Occupant: "Occupants",
  Certificate: "Certificates",
};
let parcelMap = null;
const AERIAL_TILES = "https://cteco.uconn.edu/ctraster/rest/services/images/Ortho_2023_tiled/ImageServer/tile/{z}/{y}/{x}";
const MAP_COLORS = {
  "parcel-addresses": "#dc5c32",
  zoning: "#195e9d",
  "transit-stops": "#2476ba",
};
async function api(path, options) {
  const r = await fetch(path, { credentials: "same-origin", ...options });
  const body = await r
    .json()
    .catch(() => ({ error: "Invalid server response" }));
  if (!r.ok) throw Error(body.error ?? `HTTP ${r.status}`);
  return body;
}
function el(tag, content, className) {
  const node = document.createElement(tag);
  if (content != null) node.textContent = String(content);
  if (className) node.className = className;
  return node;
}
function link(url, label) {
  const a = el("a", label);
  try {
    const u = new URL(url, location.href);
    if (u.protocol === "https:") {
      a.href = u.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  } catch {}
  return a;
}
function status(message) {
  $("status").textContent = message;
}
function resetMap() {
  if (parcelMap) {
    parcelMap.remove();
    parcelMap = null;
  }
  $("parcel-map").replaceChildren();
  $("parcel-map").hidden = true;
  $("parcel-map-section").hidden = true;
  $("parcel-map-status").textContent = "";
  $("map-layer-list").replaceChildren();
  $("map-context-notes").replaceChildren();
}
function shortDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return value ?? "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}
function brief(value, max = 170) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
function sourceName(id) {
  return sourceNames[id] ?? id.replaceAll("-", " ");
}
function recordStatus(item) {
  const a = item.attributes ?? {};
  if (item.source_id === "municipal-occupants")
    return a.inactive == null ? null : `Inactive flag: ${a.inactive ? "Yes" : "No"}`;
  return a.status ?? a.Status ?? a.record_status ?? a.PermStatus ?? a.PermitApplicationStatus ?? a.ApplicationStatus ?? a.CompStatus ?? a.registry_status ?? null;
}
function recordTitle(item) {
  const a = item.attributes ?? {};
  if (item.source_id === "addresses")
    return `${a.house_number ?? ""} ${a.full_street_name ?? `${a.street_name ?? ""} ${a.suffix_type ?? ""}`}`.trim() || "City address point";
  if (item.source_id === "trash-pickup")
    return `${a.address}${a.unit ? ` · unit ${a.unit}` : ""}: ${a.trash_day} trash pickup zone`;
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
function recordDescription(item) {
  const a = item.attributes ?? {};
  if (item.source_id === "alders") return null;
  if (item.source_id === "trash-pickup") {
    const ids = a.address_point_objectids ?? [a.address_point_objectid];
    return `City address point${ids.length === 1 ? "" : "s"} ${ids.join(", ")} · pickup zone ${a.zone_objectid}${a.source_last_edited ? ` · source last edited ${shortDate(a.source_last_edited)}` : ""}`;
  }
  if (item.source_id === "parcels") {
    const facts = [
      a.mblu ? `MBLU ${a.mblu}` : null,
      a.account_number ? `Account ${a.account_number}` : null,
      a.nh_ward != null ? `Ward field ${a.nh_ward}` : null,
    ];
    return facts.filter(Boolean).join(" · ");
  }
  if (item.source_id === "parcel-assessment")
    return [a.use_code ? `Use code ${a.use_code}` : null,
      a.year_building_built != null ? `Building year ${a.year_building_built}` : null,
      a.total_land_area_acres != null ? `${a.total_land_area_acres} acres listed` : null,
      a.zone_as_published ? `Parcel zone field ${a.zone_as_published}` : null]
      .filter(Boolean).join(" · ");
  if (item.source_id === "parcel-sale")
    return [a.sale_date_as_published ? `Sale date field ${a.sale_date_as_published}` : null,
      a.price != null ? `Price field ${a.price}` : null,
      a.book ? `Book ${a.book}` : null, a.page ? `Page ${a.page}` : null]
      .filter(Boolean).join(" · ");
  if (item.source_id === "assessor-sales")
    return [a.sale_price ? `Sale price listed: ${a.sale_price}` : null, a.book_page ? `Book and page ${a.book_page}` : null, a.instrument ? `Instrument ${a.instrument}` : null].filter(Boolean).join(" · ");
  if (item.source_id === "assessor-valuations") return null;
  if (item.source_id === "assessor-land")
    return [a.use_description_as_published, a.use_code ? `Use code ${a.use_code}` : null,
      a.assessor_zone_as_published ? `Assessor zone ${a.assessor_zone_as_published}` : null]
      .filter(Boolean).join(" · ");
  if (item.source_id === "assessor-buildings")
    return `${a.summary_rows?.length ?? 0} building summary fields · ${a.attribute_rows?.length ?? 0} building attributes`;
  if (["assessor-extra-features", "assessor-outbuildings"].includes(item.source_id))
    return [a.size_as_published, a.value_as_published ? `Value ${a.value_as_published}` : null,
      a.building_number_as_published ? `Building ${a.building_number_as_published}` : null]
      .filter(Boolean).join(" · ");
  if (item.source_id === "assessor-subareas")
    return [a.gross_area_sq_ft != null ? `${Number(a.gross_area_sq_ft).toLocaleString()} gross sq ft` : a.gross_area_as_published ? `Gross area as published: ${a.gross_area_as_published}` : null,
      a.living_area_sq_ft != null ? `${Number(a.living_area_sq_ft).toLocaleString()} living sq ft` : a.living_area_as_published ? `Living area as published: ${a.living_area_as_published}` : null,
      `Assessor subarea table ${a.table_number}`].filter(Boolean).join(" · ");
  if (item.source_id === "zoning")
    return [a.district_category ? `Category ${a.district_category}` : null,
      a.districts ? `Districts ${a.districts}` : null].filter(Boolean).join(" · ");
  if (item.source_id === "assessor") {
    const b = a.building_facts ?? {};
    return [b.building_count != null ? `${b.building_count} buildings listed` : null,
      b.year_built ? `Year built ${b.year_built}` : null,
      b.living_area_sq_ft != null ? `${Number(b.living_area_sq_ft).toLocaleString()} sq ft living area` : null,
      b.land_size_acres != null ? `${b.land_size_acres} acres listed` : null,
      b.land_use_code ? `Land use code ${b.land_use_code}` : null,
      b.model ? `Model ${b.model}` : null,
      b.style ? `Style ${b.style}` : null].filter(Boolean).join(" · ");
  }
  if (item.source_id === "ct-brownfields")
    return [a.site_address_as_published, a.site_parcel_as_published ? `Site Parcel ${a.site_parcel_as_published}` : null,
      a.program, a.inventory_updated ? `Inventory ${shortDate(a.inventory_updated)}` : null].filter(Boolean).join(" · ");
  if (["local-historic-districts", "state-historic-districts"].includes(item.source_id))
    return "City mapped district intersects the parcel; source boundary date and limits are listed in coverage.";
  if (item.source_id === "municipal-business-licenses")
    return [a.license_type, a.recorded_address, a.expiration_date ? `Expiration listed: ${shortDate(a.expiration_date)}` : null].filter(Boolean).join(" · ");
  if (item.source_id === "municipal-occupants")
    return [a.occupancy_type, a.recorded_address, a.inactive === true ? "Marked inactive" : null].filter(Boolean).join(" · ");
  if (item.source_id === "business-master")
    return [a.entity_type, a.alei ? `ALEI ${a.alei}` : null, a.registry_status ? `Registry status: ${a.registry_status}` : null].filter(Boolean).join(" · ");
  if (item.source_id === "business-principals")
    return `State-listed principal of ${a.entity_name}; this does not establish beneficial ownership of the parcel.`;
  if (item.source_id === "business-agents")
    return `Registered agent for ${a.entity_name}; the agent is a service contact, not identified as the parcel owner.`;
  return brief(a.Description ?? a.description ?? a.complaint_type ?? a.document_type ?? a.PermitType ?? a.ApplicationType ?? a.section ?? "", 190);
}
function fieldLabel(key) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")
    .replace(/\s+/g, " ").trim().replace(/^./, (first) => first.toUpperCase());
}
function sourceFields(value, prefix = "") {
  const fields = [];
  for (const [key, entry] of Object.entries(value ?? {})) {
    const label = prefix ? `${prefix} · ${fieldLabel(key)}` : fieldLabel(key);
    if (Array.isArray(entry))
      entry.forEach((row, index) => {
        const rowLabel = `${label} ${index + 1}`;
        if (row && typeof row === "object") fields.push(...sourceFields(row, rowLabel));
        else fields.push([rowLabel, row == null ? "Not provided" : String(row)]);
      });
    else if (entry && typeof entry === "object")
      fields.push(...sourceFields(entry, label));
    else fields.push([label, entry == null ? "Not provided" :
      String(entry)]);
  }
  return fields;
}
function fieldList(entries, className = "record-fields") {
  const list = el("dl", null, className);
  for (const [name, value] of entries) {
    list.append(el("dt", name));
    list.append(el("dd", value));
  }
  return list;
}
function valuationAmounts(attributes, className = "valuation-values") {
  const amounts = el("dl", null, className);
  for (const [label, value] of [["Land", attributes.land], ["Improvements", attributes.improvements], ["Total", attributes.total]]) {
    const entry = el("div");
    entry.append(el("dt", label));
    entry.append(el("dd", value ?? "Not listed"));
    amounts.append(entry);
  }
  return amounts;
}
function matchEvidence(item) {
  const match = item.match;
  if (match?.method !== "exact" || !match.parcel_field || !match.source_field || !match.value)
    return null;
  const fields = `${match.parcel_field.toUpperCase()} = source ${match.source_field} ${match.value}`;
  return match.address_confirmed ? `Parcel match: ${fields}; property address also matches` : `Parcel match: ${fields}`;
}
function permitDetailTitle(item) {
  const a = item.attributes;
  if (item.category === "Fee") return [a.FeeType ?? a.FeeCategory ?? "Fee", a.Amount != null ? `Amount ${a.Amount}` : null].filter(Boolean).join(" · ");
  if (item.category === "Task") return [a.Subject ?? a.TaskType ?? "Review task", a.ApprovalStatus].filter(Boolean).join(" · ");
  if (item.category === "Inspection") return [a.InspType ?? "Inspection", a.Status].filter(Boolean).join(" · ");
  if (item.category === "Document") return a.Name ?? "Public document";
  if (item.category === "Contact") return [a.Fullname ?? "Contact", a.ContactRole ?? a.ContactType].filter(Boolean).join(" · ");
  if (item.category === "Flag") return [a.FlagType ?? "Source flag", a.Description].filter(Boolean).join(" · ");
  return a.Title ?? "Communication";
}
function renderWorkDetails(parent, data) {
  parent.replaceChildren();
  if (data.partial) parent.append(el("p", data.warnings.join(" "), "source-warning"));
  const primary = data.entity === "Permit" ? data.permit : data.application;
  const a = primary.attributes;
  parent.append(fieldList((data.entity === "Permit" ? [
    ["Permit number", a.PermitNo], ["Permit type", a.PermitType],
    ["Department (permit field)", a.Department], ["Status", a.PermStatus],
    ["Recorded address", a.LegalAddress],
  ] : [
    ["Application number", a.ApplicaNo ?? a.ApplicationNumber],
    ["Application type", a.ApplicationType],
    ["Department (application field)", a.Department],
    ["Status", a.PermitApplicationStatus ?? a.ApplicationStatus],
    ["Recorded address", a.LegalAddress],
  ]).filter(([, value]) => value != null && value !== "")));
  const fields = el("details", null, "permit-entity-fields");
  fields.append(el("summary", `Full ${data.entity.toLowerCase()} fields as published`));
  fields.append(fieldList(sourceFields(a), "record-fields all-fields"));
  parent.append(fields);
  if (data.entity === "Permit" && data.application) {
    const application = el("details", null, "permit-entity-fields");
    application.append(el("summary", `Linked application ${data.application.attributes.ApplicaNo ?? data.application.attributes.ApplicationNumber ?? data.application.source_record_id}`));
    application.append(link(data.application.source_url, "Open application source"));
    application.append(fieldList(sourceFields(data.application.attributes), "record-fields all-fields"));
    parent.append(application);
  }
  for (const [category, title] of [["Task", "Review tasks"], ["Fee", "Fees"], ["Inspection", "Inspections"], ["Document", "Public documents"], ["Contact", "Contact roles"], ["Communication", "Communications"], ["Flag", "Source flags"]]) {
    const rows = data.items.filter((item) => item.category === category);
    const section = el("section", null, "permit-detail-section");
    section.append(el("h4", `${title} · ${data.category_counts[category] == null ? "not returned" : rows.length}`));
    if (data.category_counts[category] == null) section.append(el("p", "The source did not return this category.", "meta"));
    else if (!rows.length) section.append(el("p", "No public rows returned.", "meta"));
    for (const item of rows) {
      const row = el("div", null, "permit-detail-row");
      row.append(el("strong", permitDetailTitle(item)));
      if (item.event_date) row.append(el("span", shortDate(item.event_date), "record-date"));
      row.append(el("p", `Listed under ${item.linked_from.map((parent) => `${parent.entity} ${parent.entity_id}`).join(" and ")}.`, "record-meta"));
      const populated = sourceFields(item.attributes).filter(([, value]) => value !== "Not provided" && value !== "");
      row.append(fieldList(populated.slice(0, 5)));
      const all = el("details", null, "source-fields");
      all.append(el("summary", "All returned fields"));
      all.addEventListener("toggle", () => {
        if (all.open && !all.querySelector("dl")) all.append(fieldList(sourceFields(item.attributes), "record-fields all-fields"));
      });
      row.append(all);
      if (item.source_url) row.append(link(item.source_url, category === "Document" && item.source_url.includes("municitymedia.com") ? "Open public document" : "Open source"));
      section.append(row);
    }
    parent.append(section);
  }
  parent.append(el("p", data.note, "record-note"));
}
function appendRecord(parent, item) {
  const card = el("article", null, "record-card");
  const aside = el("div", null, "record-aside");
  aside.append(el("span", item.category ?? sourceName(item.source_id), "record-kind"));
  aside.append(el("span", sourceName(item.source_id), "record-source-name"));
  if (item.event_date) aside.append(el("time", shortDate(item.event_date), "record-date"));
  card.append(aside);
  const body = el("div", null, "record-body");
  const head = el("div", null, "record-head");
  head.append(el("h3", recordTitle(item)));
  const state = recordStatus(item);
  if (state) head.append(el("span", brief(state, 45), "status-pill"));
  if (item.address_evidence?.matches_query)
    head.append(el("span", "Source address matches search", "address-badge"));
  body.append(head);
  if (item.attributes?.period) body.append(el("p", item.attributes.period, "record-meta"));
  const description = recordDescription(item);
  if (description) body.append(el("p", description, "record-description"));
  if (item.source_id === "assessor-valuations") {
    body.append(el("p", `${fieldLabel(item.attributes.table_section ?? "valuation")} row`, "record-meta"));
    body.append(valuationAmounts(item.attributes, "valuation-values valuation-record-values"));
  }
  const preview = item.source_id === "alders"
    ? [
      ["Email", item.attributes.email ?? "Not listed"],
      ["Phone", item.attributes.phone ?? "Not listed"],
      ["Published mailing address", [item.attributes.address, item.attributes.city, item.attributes.state, item.attributes.zip_code].filter(Boolean).join(", ") || "Not listed"],
    ]
    : item.source_id === "cmt-contacts"
    ? [
      ["District manager", item.attributes.district_manager ?? "Not published"],
      ["Manager email", item.attributes.dm_email],
      ["Manager phone", item.attributes.dm_phone],
      ["Neighborhood specialist", item.attributes.neighborhood_specialist ?? "Not published"],
      ["Specialist email", item.attributes.ns_email],
      ["Specialist phone", item.attributes.ns_phone],
      ["CMT chair", item.attributes.cmt_chair ?? "Not published"],
      ["CMT email", item.attributes.cmt_email],
      ["CMT phone", item.attributes.cmt_phone],
    ].filter(([, value]) => value != null && value !== "")
    : item.source_id === "parcels" ? [
      ["Published address", item.attributes.property_address],
      ["MBLU", item.attributes.mblu],
      ["Account number", item.attributes.account_number],
      ["Ward field", item.attributes.nh_ward],
    ].filter(([, value]) => value != null && value !== "")
    : item.source_id === "parcel-owner" ? [
      ["Owner 1", item.attributes.owner_name_1],
      ["Owner 2 (City source field owwner_name_2)", item.attributes.owner_name_2],
      ["CO_LINE (City source field)", item.attributes.co_line],
      ["Mailing street", item.attributes.mailing_street],
      ["Mailing city", item.attributes.mailing_city],
      ["Mailing state", item.attributes.mailing_state],
      ["Mailing ZIP", item.attributes.mailing_zip],
    ].filter(([, value]) => value)
    : item.source_id === "parcel-assessment" ? [
      ["Commercial units field", item.attributes.units_commercial],
      ["Residential units field", item.attributes.units_residential],
      ["Condo units field", item.attributes.units_condo],
      ["Assessed improvements", item.attributes.total_assessed_improvements],
      ["Assessed land", item.attributes.total_assessed_land_value],
      ["Parcel value x field", item.attributes.total_assessed_parcel_value_x],
      ["Parcel value y field", item.attributes.total_assessed_parcel_value_y],
    ].filter(([, value]) => value != null && value !== "")
    : item.source_id === "parcel-sale" ? [
      ["Sale date as published", item.attributes.sale_date_as_published],
      ["Price field", item.attributes.price],
      ["Book", item.attributes.book],
      ["Page", item.attributes.page],
    ].filter(([, value]) => value != null && value !== "")
    : item.source_id === "assessor-owner" ? [
      ["Owner", item.attributes.owner_name],
      ["Co-owner", item.attributes.co_owner_name],
      ["Mailing address as published", item.attributes.mailing_address_lines?.join(" · ")],
    ].filter(([, value]) => value)
    : item.source_id === "assessor-land" ? [
      ["Use code", item.attributes.use_code],
      ["Use description", item.attributes.use_description_as_published],
      ["Assessor zone", item.attributes.assessor_zone_as_published],
      ["Neighborhood code", item.attributes.neighborhood_code_as_published],
      ...((item.attributes.land_measure_rows ?? []).filter((row) => row.value_as_published)
        .map((row) => [row.label_as_published, row.value_as_published])),
    ].filter(([, value]) => value)
    : item.source_id === "assessor-buildings" ? [
      ...((item.attributes.summary_rows ?? []).filter((row) => row.value_as_published)
        .map((row) => [row.label_as_published, row.value_as_published])),
      ...((item.attributes.attribute_rows ?? []).filter((row) =>
        ["Style:", "Model", "Grade", "Stories:", "Occupancy", "Bldg Use"].includes(row.label_as_published))
        .map((row) => [row.label_as_published, row.value_as_published])),
    ].filter(([, value]) => value)
    : item.source_id === "business-master" ? [
      ["ALEI", item.attributes.alei],
      ["Registry status", item.attributes.registry_status],
      ["Entity business email", item.attributes.business_email],
      ["City owner mailing address", item.attributes.city_owner_mailing_address],
    ].filter(([, value]) => value)
    : item.source_id === "business-principals" ? [
      ["Entity", item.attributes.entity_name],
      ["Principal", item.attributes.principal_name],
      ["Designation", item.attributes.designation],
      ["Principal business address", [item.attributes.principal_business_street, item.attributes.principal_business_city, item.attributes.principal_business_state].filter(Boolean).join(", ")],
    ].filter(([, value]) => value)
    : item.source_id === "business-agents" ? [
      ["Entity", item.attributes.entity_name],
      ["Agent", item.attributes.agent_name],
      ["Agent phone", item.attributes.agent_phone],
      ["Agent email", item.attributes.agent_email],
      ["Agent business address", item.attributes.agent_business_address],
    ].filter(([, value]) => value)
    : item.source_id === "municity" && item.category === "Permit" ? [
      ["Permit number", item.attributes.PermitNo],
      ["Permit type", item.attributes.PermitType],
      ["Department (permit field)", item.attributes.Department],
      ["Recorded address", item.attributes.LegalAddress],
    ].filter(([, value]) => value != null && value !== "")
    : item.source_id === "municity" && item.category === "Application" ? [
      ["Application number", item.attributes.ApplicaNo ?? item.attributes.ApplicationNumber],
      ["Application type", item.attributes.ApplicationType],
      ["Department (application field)", item.attributes.Department],
      ["Recorded address", item.attributes.LegalAddress],
    ].filter(([, value]) => value != null && value !== "")
    : item.source_id === "assessor-valuations" ? [] : sourceFields(item.attributes)
      .filter(([, value]) => value !== "Not provided" && value !== "" && value.length < 220)
      .slice(0, 4);
  if (preview.length) body.append(fieldList(preview));
  if (item.address_evidence)
    body.append(el("p", `Source ${item.address_evidence.source_field}: ${item.address_evidence.source_address}`, "record-note"));
  const evidence = matchEvidence(item);
  if (evidence) body.append(el("p", evidence, "record-note"));
  if (item.note) body.append(el("p", item.note, "record-note"));
  const actions = el("div", null, "record-actions");
  if (item.source_url) actions.append(link(item.source_url, item.category === "Document" && item.source_url.includes("municitymedia.com") ? "Open document" : "Open source"));
  const details = el("details", null, "source-fields");
  details.append(el("summary", "All source fields"));
  details.addEventListener("toggle", () => {
    if (details.open && !details.querySelector("dl"))
      details.append(fieldList(sourceFields(item.attributes), "record-fields all-fields"));
  });
  actions.append(details);
  const workKind = item.source_id === "municity" && ["Permit", "Application"].includes(item.category)
    ? item.category : null;
  const workId = workKind ? item.attributes?.[`${workKind}_ID`] : null;
  if (workKind && /^\d{1,12}$/.test(String(workId ?? ""))) {
    const permitDetails = el("details", null, "permit-details");
    permitDetails.append(el("summary", "Fees, reviews and related records"));
    const contents = el("div", null, "permit-details-content");
    permitDetails.append(contents);
    let loaded = false;
    let loading = false;
    permitDetails.addEventListener("toggle", async () => {
      if (!permitDetails.open || loaded || loading) return;
      loading = true;
      contents.replaceChildren(el("p", `Loading official ${workKind.toLowerCase()} details…`, "meta"));
      try {
        const qs = new URLSearchParams({ parcel_id: selected.parcel_id,
          [workKind === "Permit" ? "permit_id" : "application_id"]: workId });
        if (selected.objectid) qs.set("objectid", selected.objectid);
        const data = await api(`/api/v1/${workKind === "Permit" ? "permit" : "application"}-details?${qs}`);
        renderWorkDetails(contents, data);
        loaded = true;
      } catch (error) {
        contents.replaceChildren(el("p", `Could not load ${workKind.toLowerCase()} details: ${error.message}`, "source-warning"));
      } finally {
        loading = false;
      }
    });
    actions.append(permitDetails);
  }
  body.append(actions);
  card.append(body);
  parent.append(card);
}
function sourceLine(parent, source) {
  const row = el("div", null, "source-status");
  const top = el("div", null, "source-status-top");
  top.append(el("strong", sourceName(source.source_id)));
  top.append(el("span", `${source.count} ${source.count === 1 ? "record" : "records"}`, "source-count"));
  top.append(el("span", source.status.replaceAll("_", " "), `badge ${source.status}`));
  row.append(top);
  if (source.status === "unavailable" || source.status === "partial")
    row.append(el("p", source.warning ?? source.coverage, "source-warning"));
  if (source.category_counts)
    row.append(
      el(
        "p",
        Object.entries(source.category_counts)
          .map(([category, count]) => `${category} ${count == null ? "not returned" : source.truncated_categories?.includes(category) ? `${count} shown; truncated` : count}`)
          .join(" · "),
        "category-counts",
      ),
    );
  if (source.source_id === "municipal-business-licenses" && source.unnamed_license_count > 0)
    row.append(el("p", `${source.unnamed_license_count} other City License ${source.unnamed_license_count === 1 ? "row does" : "rows do"} not name a business. See Activity → Licenses; historical sections may be collapsed.`, "category-counts"));
  const info = el("details", null, "source-coverage");
  info.append(el("summary", "Coverage and source"));
  info.append(el("p", source.coverage, "meta"));
  if (source.warning && source.status !== "unavailable" && source.status !== "partial")
    info.append(el("p", source.warning, "meta"));
  if (source.source_url) info.append(link(source.source_url, "Open source"));
  if (source.verification_url) info.append(link(source.verification_url, "Confirm with city"));
  row.append(info);
  parent.append(row);
}
function prepareDisplayGroups(parent, data) {
  displayTargets.set(parent, {
    definitions: new Map((data.display_groups ?? []).map((entry) => [entry.key, entry])),
    counts: data.display_group_counts ?? {},
    sections: new Map(),
  });
}
function appendDisplayRecord(parent, item) {
  const targets = displayTargets.get(parent);
  const key = item.display_group?.key ?? "unclassified";
  let section = targets.sections.get(key);
  if (!section) {
    const definition = targets.definitions.get(key);
    const collapsed = ["owner_history", "older", "past", "unclassified"].includes(key);
    const container = el(collapsed ? "details" : "section", null, `display-section display-${key}`);
    const heading = el(collapsed ? "summary" : "div", null, "display-section-heading");
    heading.append(el(collapsed ? "strong" : "h3", definition?.title ?? "Status not established"));
    const count = targets.counts[key] ?? 0;
    heading.append(el("span", `${count} ${count === 1 ? "record" : "records"}`, "group-count"));
    container.append(heading);
    if (definition?.description) container.append(el("p", definition.description, "display-section-description"));
    parent.append(container);
    section = { container, categories: new Map() };
    targets.sections.set(key, section);
  }
  const categoryKey = item.category ?? item.source_id;
  let list = section.categories.get(categoryKey);
  if (!list) {
    const subgroup = el("section", null, "activity-subgroup");
    const heading = el("div", null, "activity-subgroup-heading");
    heading.append(el("h4", item.category ? municipalCategoryTitles[item.category] ?? item.category : sourceName(item.source_id)));
    subgroup.append(heading);
    list = el("div", null, "record-list");
    subgroup.append(list);
    section.container.append(subgroup);
    section.categories.set(categoryKey, list);
  }
  appendRecord(list, item);
}
function normalizedAddress(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/\b(AVENUE|AVE|AV)\b/g, "AVE")
    .replace(/\b(STREET|ST)\b/g, "ST")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function snapshotCard(title, id) {
  const card = el("article", null, "snapshot-card");
  card.append(el("h3", title));
  const body = el("div", null, "snapshot-body");
  card.append(body);
  const jump = el("a", "Review records →", "snapshot-link");
  jump.href = `#group-${id}`;
  card.append(jump);
  $("snapshot-grid").append(card);
  return body;
}
function renderSnapshot() {
  $("snapshot-grid").replaceChildren();
  const property = groupResponses.get("property");
  const building = snapshotCard("The building record", "property");
  if (!property) building.append(el("p", "Loading building facts…", "meta"));
  else {
    const parcel = property.items.find((item) => item.source_id === "parcels")?.attributes ?? {};
    const facts = [
      parcel.year_building_built ? `Built ${parcel.year_building_built}` : null,
      parcel.units_commercial ? `${parcel.units_commercial} commercial units listed` : null,
      parcel.use_code ? `Assessor use code ${parcel.use_code}` : null,
    ].filter(Boolean);
    building.append(el("p", facts.length ? facts.join(" · ") : "The city parcel record did not return a building description."));
    const zoningCodes = [...new Set((groupResponses.get("geography")?.items ?? [])
      .filter((item) => item.source_id === "zoning")
      .map((item) => item.attributes?.zone_code)
      .filter(Boolean))];
    if (zoningCodes.length) {
      building.append(el("p", "City mapped zoning", "snapshot-label"));
      building.append(el("p", zoningCodes.join(" · ")));
    }
    const assessorFacts = property.items.find((item) => item.source_id === "assessor")?.attributes?.building_facts ?? {};
    const assessorLines = [
      assessorFacts.building_count != null ? `${assessorFacts.building_count} buildings listed` : null,
      assessorFacts.year_built ? `Year built ${assessorFacts.year_built}` : null,
      assessorFacts.living_area_sq_ft != null ? `${Number(assessorFacts.living_area_sq_ft).toLocaleString()} sq ft living area` : null,
      assessorFacts.land_size_acres != null ? `${assessorFacts.land_size_acres} acres listed` : null,
      assessorFacts.land_use_code ? `Land use code ${assessorFacts.land_use_code}` : null,
    ].filter(Boolean);
    if (assessorLines.length) {
      building.append(el("p", "Assessor card", "snapshot-label"));
      building.append(el("p", assessorLines.join(" · ")));
    }
    const subareas = property.items.filter((item) => item.source_id === "assessor-subareas");
    if (subareas.length) {
      building.append(el("p", "Assessor building subareas", "snapshot-label"));
      const list = el("ul", null, "snapshot-list");
      for (const item of subareas.slice(0, 8)) {
        const a = item.attributes;
        const row = el("li");
        row.append(el("strong", recordTitle(item)));
        row.append(el("span", [a.gross_area_sq_ft != null ? `${Number(a.gross_area_sq_ft).toLocaleString()} gross sq ft` : null,
          a.living_area_sq_ft != null ? `${Number(a.living_area_sq_ft).toLocaleString()} living sq ft` : null].filter(Boolean).join(" · "), "snapshot-state"));
        list.append(row);
      }
      building.append(list);
      if (subareas.length > 8) building.append(el("p", `And ${subareas.length - 8} more returned subarea rows below.`, "meta"));
      building.append(el("p", "Assessment subareas do not establish retail lease area or permitted use.", "snapshot-caveat"));
    }
    const currentValues = property.items
      .filter((item) => item.source_id === "assessor-valuations" && item.attributes?.table_section === "current")
      .sort((a, b) => String(b.attributes?.valuation_year ?? "").localeCompare(String(a.attributes?.valuation_year ?? "")));
    if (currentValues.length) {
      building.append(el("p", "Current assessor valuation rows", "snapshot-label"));
      const list = el("ul", null, "snapshot-list valuation-list");
      for (const item of currentValues) {
        const a = item.attributes;
        const row = el("li");
        row.append(el("strong", `${a.valuation_year ?? "Year not listed"} · ${fieldLabel(a.valuation_type ?? "valuation")}`));
        row.append(valuationAmounts(a));
        list.append(row);
      }
      building.append(list);
    }
    const addresses = [...new Set(property.items
      .filter((item) => item.source_id === "addresses")
      .map((item) => recordTitle(item))
      .filter(Boolean))];
    addresses.sort((a, b) =>
      Number(normalizedAddress(b) === normalizedAddress(searchedAddress)) -
      Number(normalizedAddress(a) === normalizedAddress(searchedAddress)));
    if (addresses.length) {
      building.append(el("p", "City address points on this parcel", "snapshot-label"));
      const list = el("ul", null, "address-list");
      for (const address of addresses.slice(0, 12)) list.append(el("li", address));
      building.append(list);
      if (addresses.length > 12) building.append(el("p", `And ${addresses.length - 12} more in Building and addresses.`, "meta"));
    }
    const pickupZones = property.items
      .filter((item) => item.source_id === "trash-pickup")
      .sort((a, b) => Number(normalizedAddress(b.attributes.address) === normalizedAddress(searchedAddress)) -
        Number(normalizedAddress(a.attributes.address) === normalizedAddress(searchedAddress)));
    if (pickupZones.length) {
      building.append(el("p", "City trash pickup zones at address points", "snapshot-label"));
      const list = el("ul", null, "snapshot-list");
      for (const item of pickupZones.slice(0, 4)) list.append(el("li", recordTitle(item)));
      building.append(list);
      if (pickupZones.length > 4) building.append(el("p", `And ${pickupZones.length - 4} more pickup zone rows below.`, "meta"));
      building.append(el("p", `City layer last edited ${shortDate(pickupZones[0].attributes.source_last_edited) || "date unavailable"}. A mapped zone does not establish commercial collection eligibility.`, "snapshot-caveat"));
    }
    building.append(el("p", "Address points are spatial links; occupancy is not verified.", "snapshot-caveat"));
  }

  const ownership = groupResponses.get("ownership");
  const owner = snapshotCard("Parcel owner in records", "ownership");
  if (!ownership) owner.append(el("p", "Checking City, assessor, and State owner records…", "meta"));
  else {
    const cityOwner = ownership.items.find((item) => item.source_id === "parcel-owner");
    const assessorOwner = ownership.items.find((item) => item.source_id === "assessor-owner");
    const ownerEntity = ownership.items.find((item) => item.source_id === "business-master");
    const sales = ownership.items.filter((item) => item.source_id === "assessor-sales");
    if (cityOwner) {
      owner.append(el("p", "City GIS parcel owner", "snapshot-label"));
      owner.append(el("p", cityOwner.attributes.owner_name_1));
      if (cityOwner.attributes.owner_name_2)
        owner.append(el("p", `City GIS second owner: ${cityOwner.attributes.owner_name_2}`));
    }
    if (assessorOwner) {
      owner.append(el("p", "Assessor card owner", "snapshot-label"));
      if (assessorOwner.attributes.owner_name)
        owner.append(el("p", assessorOwner.attributes.owner_name));
      if (assessorOwner.attributes.co_owner_name)
        owner.append(el("p", `Co-owner: ${assessorOwner.attributes.co_owner_name}`));
    }
    if (ownerEntity) {
      owner.append(el("p", "Matched State LLC", "snapshot-label"));
      owner.append(el("p", `${ownerEntity.attributes.legal_name} · registry status ${ownerEntity.attributes.registry_status ?? "not supplied"}`));
    }
    if (sales.length) {
      const latest = sales[0];
      owner.append(el("p", "Latest published ownership row", "snapshot-label"));
      owner.append(el("p", [latest.attributes.owner, latest.event_date ? shortDate(latest.event_date) : null, latest.attributes.sale_price].filter(Boolean).join(" · ")));
      owner.append(el("p", `${ownership.display_group_counts?.owner_history ?? sales.length} assessor ownership history rows returned.`, "meta"));
    }
    if (!cityOwner && !assessorOwner && !ownerEntity && !sales.length)
      owner.append(el("p", "No owner row was returned by the checked sources. Review source coverage below."));
    owner.append(el("p", "An LLC principal or registered agent is a State registry role, not proof of direct real estate ownership.", "snapshot-caveat"));
  }

  const business = groupResponses.get("business");
  const businesses = snapshotCard("Municipal license and occupant names", "business");
  if (!business) businesses.append(el("p", "Loading business records…", "meta"));
  else {
    const named = business.items
      .filter((item) => ["municipal-business-licenses", "municipal-occupants"].includes(item.source_id))
      .filter((item) => item.attributes?.business_name || item.attributes?.occupant_name);
    const licenseCount = named.filter((item) => item.source_id === "municipal-business-licenses").length;
    const occupantCount = named.filter((item) => item.source_id === "municipal-occupants").length;
    if (!named.length) businesses.append(el("p", "No municipal business or occupant name was returned by checked sources."));
    else {
      businesses.append(el("p", `${licenseCount} ${licenseCount === 1 ? "license" : "licenses"} naming a business · ${occupantCount} ${occupantCount === 1 ? "occupant row" : "occupant rows"}. Names and inactive flags are shown as published.`, "meta"));
      const list = el("ul", null, "snapshot-list");
      for (const item of named.slice(0, 4)) {
        const row = el("li");
        row.append(el("strong", `${item.source_id === "municipal-occupants" ? "Occupant" : "License"} · ${recordTitle(item)}`));
        const state = recordStatus(item);
        row.append(el("span", [state, item.attributes?.expiration_date ? `Expires ${shortDate(item.attributes.expiration_date)}` : null].filter(Boolean).join(" · ") || "Status not established", "snapshot-state"));
        list.append(row);
      }
      businesses.append(list);
    }
    const unnamed = business.sources.find((source) => source.source_id === "municipal-business-licenses")?.unnamed_license_count ?? 0;
    if (unnamed > 0) {
      const note = el("p", `${unnamed} other City License ${unnamed === 1 ? "row does" : "rows do"} not name a business. See `, "snapshot-caveat");
      const activityLink = el("a", "Activity → Licenses");
      activityLink.href = "#group-activity";
      note.append(activityLink, "; expand historical sections to see older records.");
      businesses.append(note);
    }
    businesses.append(el("p", "A municipal occupant row or license does not establish a current storefront.", "snapshot-caveat"));
  }

  const activity = groupResponses.get("activity");
  const work = snapshotCard("Recent work and applications", "activity");
  if (!activity) work.append(el("p", "Checking work records…", "meta"));
  else {
    const issuedPermitNumbers = new Set(activity.items
      .filter((item) => item.category === "Permit")
      .map((item) => item.attributes?.PermitNo ?? item.attributes?.PermitNumber)
      .filter(Boolean));
    const recent = activity.items
      .filter((item) => ["Application", "Permit", "Complaint"].includes(item.category) || item.source_id === "lci-cases")
      .filter((item) => ["reported", "early"].includes(item.display_group?.key))
      .filter((item) => item.category !== "Application" || !issuedPermitNumbers.has(item.attributes?.ApplicationNumber));
    if (!recent.length) work.append(el("p", "No recent open, issued, draft or review-stage record surfaced in the returned records."));
    else {
      const list = el("ul", null, "snapshot-list");
      for (const item of recent.slice(0, 3)) {
        const row = el("li");
        row.append(el("strong", recordTitle(item)));
        row.append(el("span", `${item.display_group.key === "early" ? "Draft or review stage · " : "Reported open or issued · "}${recordStatus(item) ?? "Status not supplied"}${item.event_date ? ` · ${shortDate(item.event_date)}` : ""}`, "snapshot-state"));
        list.append(row);
      }
      work.append(list);
    }
    work.append(el("p", "Published status does not confirm that work is happening now or has been completed.", "snapshot-caveat"));
  }

  const environment = groupResponses.get("environment");
  const environmental = snapshotCard("Environmental inventory", "environment");
  if (!environment) environmental.append(el("p", "Checking the State inventory…", "meta"));
  else {
    const source = environment.sources.find((item) => item.source_id === "ct-brownfields");
    if (environment.items.length) {
      const list = el("ul", null, "snapshot-list");
      for (const item of environment.items.slice(0, 3)) list.append(el("li", recordTitle(item)));
      environmental.append(list);
    } else if (source?.status !== "unavailable" && source?.status !== "partial")
      environmental.append(el("p", "No DEEP brownfield row matched this parcel's published identifier."));
    if (source?.status === "unavailable" || source?.status === "partial")
      environmental.append(el("p", "The DEEP inventory check was incomplete. Review its source status below."));
    environmental.append(el("p", "Inventory updated February 2026. A listing or missing row does not establish present site conditions.", "snapshot-caveat"));
  }
}
async function choose(item, searchedQuery = null) {
  const version = ++viewVersion;
  resetMap();
  selected = item;
  searchedAddress = searchedQuery &&
    ["parcel-address", "address-point-intersection"].includes(item.match?.method)
    ? searchedQuery.trim() : "";
  groupResponses.clear();
  $("candidates").hidden = true;
  history.replaceState(
    null,
    "",
    `/parcel?parcel_id=${encodeURIComponent(item.parcel_id)}${item.objectid ? `&objectid=${encodeURIComponent(item.objectid)}` : ""}${searchedAddress ? `&query_address=${encodeURIComponent(searchedAddress)}` : ""}`,
  );
  $("groups").replaceChildren();
  $("group-nav").replaceChildren();
  $("feed").replaceChildren();
  $("parcel-summary").hidden = true;
  $("snapshot").hidden = true;
  $("feed-section").hidden = false;
  status("Loading parcel records…");
  try {
    const qs = new URLSearchParams({ parcel_id: item.parcel_id });
    if (item.objectid) qs.set("objectid", item.objectid);
    if (searchedAddress) qs.set("query_address", searchedAddress);
    const summary = await api(`/api/v1/parcel?${qs}`);
    if (version !== viewVersion) return;
    $("parcel-summary").hidden = false;
    $("snapshot").hidden = !SHOW_SNAPSHOT;
    $("parcel-title").textContent =
      summary.parcel.address ?? `Parcel ${summary.parcel.parcel_id}`;
    $("parcel-identifiers").textContent =
      `Parcel ID ${summary.parcel.parcel_id} · MBLU ${summary.parcel.mblu ?? "unavailable"} · Assessor account ${summary.parcel.account_number ?? "unavailable"}`;
    const alternateMatch =
      searchedAddress &&
      item.match?.method === "address-point-intersection" &&
      normalizedAddress(searchedAddress) !== normalizedAddress(summary.parcel.address);
    $("parcel-match").hidden = !searchedAddress;
    $("parcel-match").replaceChildren();
    if (searchedAddress) {
      $("parcel-match").append(document.createTextNode(
        alternateMatch
          ? `Address focus: ${searchedAddress}. A City address point for this address intersects the selected parcel, which lists ${summary.parcel.address ?? "another address"}. A badge below appears only when a record's own address field matches your search.`
          : `Address focus: ${searchedAddress}. The selected City parcel lists this address. A badge below appears only when a record's own address field matches your search.`,
      ));
    }
    if (SHOW_SNAPSHOT) renderSnapshot();
    status("Records are loading by source.");
    $("group-nav").hidden = false;
    const timelineLink = el("a", "Timeline");
    timelineLink.href = "#feed-section";
    $("group-nav").append(timelineLink);
    const tasks = [];
    tasks.push(loadMap(qs, version));
    for (const [id, title] of groups) {
      const section = el("section", null, "panel");
      section.id = `group-${id}`;
      section.append(el("h2", title));
      section.append(el("p", "Loading…", "meta"));
      $("groups").append(section);
      const a = el("a", title);
      a.href = `#group-${id}`;
      $("group-nav").append(a);
      tasks.push(loadGroup(id, section, qs, version));
    }
    tasks.push(loadFeed(qs, version));
    await Promise.allSettled(tasks);
    if (version === viewVersion) status("Records loaded. Open a record to inspect its source fields.");
  } catch (error) {
    status(error.message);
  }
}
async function loadMap(qs, version) {
  $("parcel-map-section").hidden = false;
  $("parcel-map-status").textContent = "Loading the City parcel boundary…";
  try {
    const feature = await api(`/api/v1/geometry?${qs}`);
    if (version !== viewVersion) return;
    const leaflet = window.L;
    if (!leaflet) throw Error("Map renderer unavailable");
    const container = $("parcel-map");
    container.hidden = false;
    const map = leaflet.map(container, { scrollWheelZoom: false, keyboard: true });
    parcelMap = map;
    let tileLoaded = false;
    let tileFailed = false;
    $("parcel-map-status").textContent = "Selected City parcel boundary shown. Loading 2023 aerial imagery…";
    const aerial = leaflet.tileLayer(AERIAL_TILES, {
      maxZoom: 21,
      maxNativeZoom: 21,
      attribution: '<a href="https://maps.cteco.uconn.edu/data/flight2023/" target="_blank" rel="noopener noreferrer">2023 aerial imagery · CT ECO</a>',
    });
    aerial.on("tileload", () => {
      if (version !== viewVersion) return;
      tileLoaded = true;
      $("parcel-map-status").textContent = tileFailed
        ? "Some aerial tiles did not load. The parcel boundary remains visible."
        : "Selected City parcel boundary over 2023 aerial imagery.";
    });
    aerial.on("tileerror", () => {
      if (version !== viewVersion) return;
      tileFailed = true;
      $("parcel-map-status").textContent = tileLoaded
        ? "Some aerial tiles did not load. The parcel boundary remains visible."
        : "Aerial imagery unavailable. The parcel boundary remains visible.";
    });
    aerial.addTo(map);
    const casing = leaflet.geoJSON(feature, {
      style: { color: "#173e35", weight: 8, fillOpacity: 0 },
    }).addTo(map);
    leaflet.geoJSON(feature, {
      style: { color: "#f8c547", weight: 4, fillColor: "#f8c547", fillOpacity: 0.15 },
    }).addTo(map);
    const bounds = casing.getBounds();
    if (!bounds.isValid()) throw Error("Parcel boundary has no map extent");
    const center = bounds.getCenter();
    const latOffset = 400 / 111195;
    const lonOffset = latOffset / Math.cos(center.lat * Math.PI / 180);
    map.fitBounds([
      [center.lat - latOffset, center.lng - lonOffset],
      [center.lat + latOffset, center.lng + lonOffset],
    ], { padding: [18, 18], maxZoom: 18 });
    leaflet.control.scale({ metric: false, imperial: true }).addTo(map);
    await loadMapContext(map, qs, version);
  } catch (error) {
    if (version !== viewVersion) return;
    if (parcelMap) {
      parcelMap.remove();
      parcelMap = null;
    }
    $("parcel-map").hidden = true;
    $("parcel-map-status").textContent = `Could not show the parcel map: ${error.message}`;
  }
}
function mapFeatureTitle(feature, layerId) {
  const p = feature.properties ?? {};
  if (layerId === "parcel-addresses") return `${p.house_number ?? ""} ${p.full_street_name ?? ""}`.trim() || "City address point";
  if (layerId === "zoning") return p.zone_code ? `Zoning ${p.zone_code}` : "City zoning district";
  if (layerId === "transit-stops") return p.StopName ?? "CT Transit stop";
  return "Mapped feature";
}
function mapFeaturePopup(feature, layer) {
  const popup = el("div", null, "map-popup");
  popup.append(el("strong", mapFeatureTitle(feature, layer.id)));
  const fields = Object.entries(feature.properties ?? {})
    .filter(([key, value]) => !["source_id", "source_record_id", "source_url", "scope"].includes(key) && value != null && value !== "")
    .slice(0, 5);
  if (fields.length) popup.append(fieldList(fields.map(([key, value]) => [fieldLabel(key), String(value)])));
  if (feature.properties?.source_url) popup.append(link(feature.properties.source_url, "Open City source"));
  popup.append(el("p", layer.scope === "nearby"
    ? "Nearby map context; not linked to the parcel."
    : layer.id === "parcel-addresses"
      ? "City address point; not a verified entrance."
      : "Mapped district intersects the selected parcel.", "meta"));
  return popup;
}
function mapFeatureLayer(layer) {
  const color = MAP_COLORS[layer.id] ?? "#315e4e";
  return window.L.geoJSON({ type: "FeatureCollection", features: layer.features }, {
    style: () => ({
      color,
      weight: 3,
      fillOpacity: 0.04,
    }),
    pointToLayer: (_feature, latlng) => window.L.circleMarker(latlng, {
      radius: layer.id === "parcel-addresses" ? 6 : 5,
      color: "#fff", weight: 2, fillColor: color, fillOpacity: 1,
    }),
    onEachFeature: (feature, leafletLayer) => leafletLayer.bindPopup(mapFeaturePopup(feature, layer)),
  });
}
async function loadMapContext(map, qs, version) {
  const list = $("map-layer-list");
  list.replaceChildren(el("p", "Loading official map layers…", "meta"));
  try {
    const context = await api(`/api/v1/map-context?${qs}`);
    if (version !== viewVersion || map !== parcelMap) return;
    list.replaceChildren();
    for (const layer of context.layers) {
      const row = el("div", null, "map-layer-row");
      const title = el("label", null, "map-layer-toggle");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.disabled = !layer.features.length;
      checkbox.checked = layer.features.length > 0 &&
        ["parcel-addresses", "zoning", "transit-stops"].includes(layer.id);
      const swatch = el("span", null, "map-layer-swatch");
      swatch.style.backgroundColor = MAP_COLORS[layer.id] ?? "#315e4e";
      swatch.setAttribute("aria-hidden", "true");
      const name = el("span", layer.title);
      title.append(checkbox, swatch, name);
      row.append(title);
      row.append(el("p", `${layer.scope === "nearby" ? "Nearby · " : "On parcel · "}${layer.features.length} mapped · ${layer.status.replaceAll("_", " ")}`, "map-layer-meta"));
      if (layer.source_updated_at)
        row.append(el("p", `Source data last edited ${shortDate(layer.source_updated_at)}`, "map-layer-meta"));
      else row.append(el("p", "Source update date unavailable", "map-layer-meta"));
      if (layer.warning) row.append(el("p", layer.warning, "map-layer-warning"));
      row.append(link(layer.source_url, "Open City GIS layer"));
      list.append(row);
      if (!layer.features.length) continue;
      const rendered = mapFeatureLayer(layer);
      if (checkbox.checked) rendered.addTo(map);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) rendered.addTo(map);
        else map.removeLayer(rendered);
      });
    }
    const notes = $("map-context-notes");
    notes.replaceChildren();
    notes.append(el("p", `Nearby transit stops cover 400 metres in a straight line from the parcel map center. They are not parcel-linked records.`, "meta"));
    const gaps = el("p", null, "meta");
    gaps.append(document.createTextNode("Loading zones and current parking availability are not mapped: no verified City or State GIS feed has been connected. "));
    gaps.append(link(context.gaps?.[0]?.source_url, "See City parking maps"));
    notes.append(gaps);
  } catch (error) {
    if (version !== viewVersion) return;
    list.replaceChildren(el("p", `Map context unavailable: ${error.message}. The selected parcel boundary remains visible.`, "map-layer-warning"));
  }
}
async function loadGroup(id, section, qs, version, cursor = null) {
  try {
    const p = new URLSearchParams(qs);
    p.set("group", id);
    p.set("limit", "50");
    if (cursor) p.set("cursor", cursor);
    const data = await api(`/api/v1/records?${p}`);
    if (version !== viewVersion) return;
    if (!cursor) {
      groupResponses.set(id, data);
      if (SHOW_SNAPSHOT) renderSnapshot();
      const definition = groups.find((group) => group[0] === id);
      section.replaceChildren();
      const heading = el("div", null, "group-heading");
      heading.append(el("h2", definition[1]));
      heading.append(el("span", `${data.total} ${data.total === 1 ? "record" : "records"}`, "group-count"));
      section.append(heading);
      section.append(el("p", definition[2], "group-intro"));
      const coverage = el("details", null, "sources-panel");
      const gaps = data.sources.filter((source) => ["partial", "unavailable"].includes(source.status)).length;
      coverage.append(el("summary", `Sources checked: ${data.sources.length}${gaps ? ` · ${gaps} with gaps` : ""}`));
      const sourceList = el("div", null, "source-list");
      for (const source of data.sources) sourceLine(sourceList, source);
      coverage.append(sourceList);
      section.append(coverage);
      const grouped = ["activity", "business", "ownership"].includes(id);
      const records = el("div", null, grouped ? "activity-sections" : "record-list");
      records.id = `records-${id}`;
      section.append(records);
      if (grouped) prepareDisplayGroups(records, data);
      if (!data.items.length)
        section.append(el("p", "No records returned by the checked sources. Open source coverage to see any gaps.", "empty-state"));
    }
    const records = $(`records-${id}`);
    for (const item of data.items) {
      if (["activity", "business", "ownership"].includes(id)) appendDisplayRecord(records, item);
      else appendRecord(records, item);
    }
    if (data.next_cursor) {
      const b = el("button", "Load more records", "load-more secondary");
      b.type = "button";
      b.addEventListener("click", () => {
        b.remove();
        void loadGroup(id, section, qs, version, data.next_cursor);
      });
      section.append(b);
    }
  } catch (error) {
    if (version !== viewVersion) return;
    section.append(
      el("p", `Could not load this group: ${error.message}`, "meta"),
    );
  }
}
function appendTimelineEvent(parent, item) {
  const entry = el("li", null, "timeline-entry");
  const date = el("time", shortDate(item.event_date), "timeline-date");
  date.dateTime = item.event_date;
  entry.append(date);
  const content = el("div", null, "timeline-content");
  const kind = item.category === "Document"
    ? "Document updated"
    : item.category === "Contact"
      ? "Contact record updated"
      : item.category === "Occupant"
        ? "Occupant record created"
      : item.source_id === "parcel-sale"
        ? "Sale date on City parcel record"
        : item.category ?? sourceName(item.source_id);
  content.append(el("p", kind, "timeline-type"));
  content.append(el("h3", recordTitle(item)));
  const state = recordStatus(item);
  if (state) content.append(el("span", state, "status-pill"));
  if (item.address_evidence?.matches_query)
    content.append(el("span", "Source address matches search", "address-badge"));
  if (item.address_evidence?.matches_query)
    content.append(el("p", `Source ${item.address_evidence.source_field}: ${item.address_evidence.source_address}`, "timeline-description"));
  const description = recordDescription(item);
  if (description) content.append(el("p", description, "timeline-description"));
  const source = el("p", null, "timeline-source");
  source.append(document.createTextNode(`${sourceName(item.source_id)} · `));
  if (item.source_url) source.append(link(item.source_url, "Open source"));
  content.append(source);
  entry.append(content);
  parent.append(entry);
}
async function loadFeed(qs, version, cursor = null) {
  try {
    const p = new URLSearchParams(qs);
    if (cursor) p.set("cursor", cursor);
    const data = await api(`/api/v1/feed?${p}`);
    if (version !== viewVersion) return;
    if (!cursor) {
      $("feed").replaceChildren();
      const gaps = data.sources.filter((source) => ["unavailable", "partial"].includes(source.status));
      if (gaps.length)
        $("feed").append(el("li", `${gaps.length} timeline sources have limited coverage. Review source status in the groups below.`, "timeline-note"));
    }
    for (const item of data.items) appendTimelineEvent($("feed"), item);
    if (!data.items.length && !cursor)
      $("feed").append(
        el("li", "No dated records were returned by the checked sources.", "timeline-note"),
      );
    const more = $("feed-more");
    more.hidden = !data.next_cursor;
    if (data.next_cursor)
      more.onclick = () => {
        more.hidden = true;
        void loadFeed(qs, version, data.next_cursor);
      };
  } catch (error) {
    if (version === viewVersion)
      $("feed").append(el("li", `Could not load the timeline: ${error.message}`, "timeline-note"));
  }
}
$("search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const version = ++viewVersion;
  selected = null;
  groupResponses.clear();
  resetMap();
  $("parcel-summary").hidden = true;
  $("snapshot").hidden = true;
  $("feed-section").hidden = true;
  $("group-nav").hidden = true;
  $("groups").replaceChildren();
  status("Searching…");
  $("candidates").hidden = true;
  try {
    const data = await api("/api/v1/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: $("query").value }),
    });
    if (version !== viewVersion) return;
    if (!data.candidates.length) {
      status(
        data.status === "unavailable"
          ? "Parcel source is temporarily unavailable."
          : "No parcel found. Try an official parcel ID or a more exact address.",
      );
      return;
    }
    $("candidate-list").replaceChildren();
    for (const item of data.candidates) {
      const button = el("button", null, "candidate-button");
      button.append(el("strong", item.address ?? `Parcel ${item.parcel_id}`));
      button.append(el("span", `Parcel ${item.parcel_id} · ${item.match.method === "address-point-intersection" ? "City address point" : "Parcel record"}`, "candidate-meta"));
      if (item.match.note) button.append(el("span", item.match.note, "candidate-note"));
      button.type = "button";
      button.onclick = () => choose(item, $("query").value);
      $("candidate-list").append(button);
    }
    if (data.candidates.length === 1 && !data.truncated) {
      void choose(data.candidates[0], $("query").value);
      return;
    }
    $("candidates").hidden = false;
    status(
      data.truncated
        ? "Search was truncated; refine your query."
        : "Choose the matching parcel.",
    );
  } catch (error) {
    if (version === viewVersion) status(error.message);
  }
});
const initial = new URL(location.href).searchParams;
if (initial.has("parcel_id")) {
  const restore = async () => {
    const startingVersion = viewVersion;
    const original = initial.get("query_address");
    if (original) {
      status("Checking the saved address against City parcel records…");
      try {
        const resolved = await api("/api/v1/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: original }),
        });
        const verified = resolved.candidates?.find((candidate) =>
          String(candidate.parcel_id) === initial.get("parcel_id") &&
          String(candidate.objectid) === initial.get("objectid") &&
          ["parcel-address", "address-point-intersection"].includes(candidate.match?.method));
        if (verified && startingVersion === viewVersion) {
          $("query").value = original;
          await choose(verified, original);
          return;
        }
      } catch { /* Load the parcel without an unverified address focus. */ }
    }
    if (startingVersion === viewVersion)
      await choose({ parcel_id: initial.get("parcel_id"), objectid: initial.get("objectid") });
  };
  void restore();
}
for (const example of document.querySelectorAll("[data-example]"))
  example.addEventListener("click", () => {
    $("query").value = example.dataset.example;
    $("search-form").requestSubmit();
  });
