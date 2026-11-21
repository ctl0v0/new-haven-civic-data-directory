const $ = (id) => document.getElementById(id);
const groups = [
  ["property", "Building and addresses", "City parcel fields, assessor detail, address points, and address-level NHPS School Choice attendance zones."],
  ["ownership", "Parcel owner and owner LLC", "City and assessor owner names, published sale fields, matched State LLC entity roles, and assessor ownership history."],
  ["business", "Businesses and occupants in records", "Municipal parcel records and State licensed locations joined through City address points. A license does not prove current occupancy or operation."],
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
  "school-attendance": "NHPS School Choice attendance zones",
  "tax-bills": "City real estate tax bills",
  "land-records": "City Clerk land records",
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
  "ct-liquor-permits": "CT liquor permits",
  "ct-child-care-licenses": "CT child care and youth camps",
  "ct-cannabis-retail": "CT cannabis retail locations",
  "lci-cases": "LCI cases",
  "managed-lots": "LCI managed lots",
  planning: "Planning cases",
  inspections: "Inspections and enforcement",
  zoning: "City zoning",
  wards: "City wards",
  neighborhoods: "City neighborhoods",
  alders: "Board of Alders",
  cmt: "CMT districts",
  "cmt-contacts": "CMT contacts",
  "municity-permit-activity": "Indexed permit activity",
  "permit-contacts": "Permit contacts",
  "permit-applications": "Linked applications",
  "permit-reviews": "Permit reviews",
  "permit-inspections": "Permit inspections",
  "permit-fees": "Permit fees",
  "permit-documents": "Public permit documents",
  "permit-communications": "Permit communication metadata",
  "permit-flags": "Permit flags",
};
let selected = null;
let maplessRecords = false;
let nearbyBusinessRequest = null;
let nearbyBusinessConfigured = false;
let viewVersion = 0;
let searchedAddress = "";
const displayTargets = new WeakMap();
const groupFilters = new Map();
const groupLoadVersions = new Map();
const loadedGroups = new Set();
let feedLoaded = false;
let timelineFilters = { category: [], record_type: [], source_id: [], source_status: [], event_date_from: "", event_date_to: "", address_match: false };
let feedLoadVersion = 0;
let activeDataSection = "overview";
let activeRecordGroup = null;
let guideData = null;
let guideSection = "home";
let queryModule = null;
let askMode = "language";
let askMethod = "parcels";
let askVersion = 0;
let askCriteria = null;
let askCursor = null;
let overviewGroups = [];
let parcelNeighborhoods = [];
let timelineReturnedCount = null;
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
let browseMap = null;
let browseLayer = null;
let browseRenderer = null;
let browsePaths = new Map();
let browseSelectedLayer = null;
let browseContextLayers = [];
let browseTimer = null;
let browseRequest = null;
let browseCoverage = null;
let browseSelectionVersion = 0;
let selectedBrowseParcel = null;
let requestedParcelKey = null;
const AERIAL_TILES = "https://cteco.uconn.edu/ctraster/rest/services/images/Ortho_2023_tiled/ImageServer/tile/{z}/{y}/{x}";
const STREET_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const MAP_COLORS = {
  "parcel-addresses": "#dc5c32",
  zoning: "#195e9d",
  "transit-stops": "#2476ba",
  "metered-parking-spaces": "#7550a4",
};
function addMapBackgrounds(map) {
  const leaflet = window.L;
  const streets = leaflet.tileLayer(STREET_TILES, {
    maxZoom: 23, maxNativeZoom: 23,
    attribution: '<a href="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer" target="_blank" rel="noopener noreferrer">Street map · Esri and contributors</a>',
  }).addTo(map);
  const aerial = leaflet.tileLayer(AERIAL_TILES, {
    maxZoom: 21, maxNativeZoom: 21,
    attribution: '<a href="https://maps.cteco.uconn.edu/data/flight2023/" target="_blank" rel="noopener noreferrer">2023 aerial imagery · CT ECO</a>',
  });
  leaflet.control.layers({ "Street map": streets, "2023 aerial imagery": aerial }, null,
    { position: "topright", collapsed: false }).addTo(map);
  return { streets, aerial };
}
async function api(path, options) {
  const r = await fetch(path, { credentials: "same-origin", ...options });
  const body = await r
    .json()
    .catch(() => ({ error: r.status === 429 ? "Too many requests. Try again in a minute." : "Invalid server response" }));
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
  $("browse-data-status").textContent = message;
}
function parcelKey(item) {
  return `${item?.parcel_id ?? ""}:${item?.objectid ?? ""}`;
}
function selectedQuery() {
  const qs = new URLSearchParams({ parcel_id: selected.parcel_id });
  if (selected.objectid) qs.set("objectid", selected.objectid);
  if (searchedAddress) qs.set("query_address", searchedAddress);
  return qs;
}
function placeRecordContent(browsing) {
  (browsing ? $("browse-data-slot") : $("record-content-home"))
    .append($("record-content"));
}
const filterKeys = ["category", "record_type", "source_id", "display_group", "source_status", "event_date_from", "event_date_to", "address_match"];
function saveDataUrl() {
  if (!selected) return;
  const url = new URL(location.href);
  if (activeDataSection === "overview") url.searchParams.delete("section");
  else url.searchParams.set("section", activeDataSection);
  for (const key of filterKeys) url.searchParams.delete(key);
  const filters = activeDataSection === "timeline" ? timelineFilters : groupFilters.get(activeDataSection);
  if (filters) addFilterParams(url.searchParams, filters);
  history.replaceState(null, "", `${url.pathname}${url.search}`);
}
function restoredFilters(params) {
  return {
    category: params.getAll("category"), record_type: params.getAll("record_type"), source_id: params.getAll("source_id"),
    display_group: params.getAll("display_group"), source_status: params.getAll("source_status"),
    event_date_from: params.get("event_date_from") ?? "",
    event_date_to: params.get("event_date_to") ?? "",
    address_match: params.get("address_match") === "true",
  };
}
function showDataSection(id, updateUrl = true) {
  if (!(["overview", "timeline"].includes(id) || groups.some(([key]) => key === id))) id = "overview";
  activeDataSection = id;
  if (id !== "overview") {
    closeNearbyBusinessResearch();
    closeStorefrontOpportunity();
  }
  $("record-detail").hidden = true;
  $("parcel-map-section").hidden = id !== "overview" || maplessRecords;
  $("school-attendance-summary").hidden = id !== "overview";
  $("snapshot").hidden = id !== "overview";
  $("parcel-summary").classList.toggle("parcel-hero-compact", id !== "overview");
  $("feed-section").hidden = id !== "timeline";
  for (const [key] of groups) {
    const section = $(`group-${key}`);
    if (section) section.hidden = key !== id;
  }
  if (id === "overview" && parcelMap && !maplessRecords && !document.body.classList.contains("browse-mode"))
    requestAnimationFrame(() => parcelMap?.invalidateSize());
  for (const button of $("group-nav").querySelectorAll("button")) {
    const current = button.dataset.section === id;
    button.setAttribute("aria-current", current ? "page" : "false");
  }
  const sectionPicker = $("mobile-section-picker");
  if (sectionPicker) sectionPicker.value = id;
  if (updateUrl) saveDataUrl();
  if (selected && requestedParcelKey === parcelKey(selected)) {
    if (id === "timeline" && !feedLoaded) {
      feedLoaded = true;
      void loadFeed(selectedQuery(), viewVersion);
    } else if (groups.some(([key]) => key === id) && !loadedGroups.has(id)) {
      loadedGroups.add(id);
      void loadGroup(id, $(`group-${id}`), selectedQuery(), viewVersion);
    }
  }
}
function scrollToDataSection(id, focus = false) {
  if ($("records-view").hidden) return;
  const target = id === "overview" ? $("parcel-title") : id === "timeline" ? $("feed-section") : $(`group-${id}`);
  if (!target || target.closest("[hidden]")) return;
  if (focus) {
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
  target.scrollIntoView({ behavior: "auto", block: "start" });
}
function navigateDataSection(id, focus = false) {
  showDataSection(id);
  requestAnimationFrame(() => scrollToDataSection(id, focus));
}
function updateRelatedPermitLinks(root) {
  const neighborhood = parcelNeighborhoods.length === 1 ? parcelNeighborhoods[0] : null;
  for (const link of root.querySelectorAll("[data-related-permit-type]")) {
    link.hidden = !neighborhood;
    if (!neighborhood) continue;
    const permitType = link.dataset.relatedPermitType;
    const params = new URLSearchParams({ view: "activity", neighborhood, activity: "permit", permit_type: permitType });
    link.href = `/parcel?${params}`;
    link.textContent = `More permits of this type in ${neighborhood}`;
    link.setAttribute("aria-label", `See recent ${permitType} records in ${neighborhood}`);
  }
}
function updateDataNavCounts() {
  const nav = $("group-nav");
  for (const button of nav.querySelectorAll(".data-nav-button")) {
    const id = button.dataset.section;
    const group = overviewGroups.find((entry) => entry.id === id);
    const count = id === "timeline" ? timelineReturnedCount : group?.record_count;
    const badge = button.querySelector(".nav-record-count");
    if (badge) {
      badge.textContent = count == null ? "" : String(count);
      badge.hidden = count == null;
    }
    const title = id === "overview" ? "Overview" : id === "timeline" ? "Timeline" : groups.find(([key]) => key === id)?.[1];
    button.setAttribute("aria-label", count == null ? title : `${title}, ${count} returned rows`);
    const option = nav.querySelector(`#mobile-section-picker option[value="${id}"]`);
    if (option) option.textContent = count == null ? title : `${title} · ${count} returned`;
  }
}
function renderDataNav() {
  const nav = $("group-nav");
  nav.replaceChildren();
  nav.append(
    el("p", "Explore this parcel", "eyebrow record-nav-label"),
    el("h2", "Record sections", "record-nav-title"),
    el("p", "Counts are returned rows; groups can overlap. Choose a section to inspect or filter it.", "record-nav-hint"),
  );
  const pickerLabel = el("label", "Record section", "mobile-section-label");
  const picker = el("select", null, "mobile-section-picker");
  picker.id = "mobile-section-picker";
  picker.addEventListener("change", () => navigateDataSection(picker.value));
  pickerLabel.append(picker);
  nav.append(pickerLabel);
  for (const [id, title] of [["overview", "Overview"], ["timeline", "Timeline"], ...groups.map(([id, title]) => [id, title])]) {
    const option = el("option", title);
    option.value = id;
    picker.append(option);
    const button = el("button", null, "data-nav-button");
    button.type = "button";
    button.dataset.section = id;
    button.append(el("span", title), el("span", null, "nav-record-count"));
    button.addEventListener("click", () => navigateDataSection(id));
    nav.append(button);
  }
  nav.hidden = false;
  updateDataNavCounts();
  showDataSection(activeDataSection, false);
}
async function loadOverview(qs, version) {
  try {
    const data = await api(`/api/v1/overview?${qs}`);
    if (version !== viewVersion) return;
    overviewGroups = data.groups;
    parcelNeighborhoods = data.neighborhoods ?? [];
    updateRelatedPermitLinks($("record-content"));
    updateDataNavCounts();
    const counts = $("overview-counts");
    counts.replaceChildren();
    const needsReview = data.groups.filter(({ sources }) => sources.some(({ status }) =>
      ["partial", "unavailable", "not_integrated", "not_linked"].includes(status)));
    if (needsReview.length) {
      const details = el("details", null, "overview-known-gaps");
      details.append(el("summary", `Source coverage · ${needsReview.length} sections with gaps`));
      const list = el("ul");
      for (const { id, sources } of needsReview) {
        const row = el("li");
        const open = el("button", groups.find(([key]) => key === id)?.[1] ?? id, "overview-link");
        open.type = "button";
        open.addEventListener("click", () => navigateDataSection(id, true));
        row.append(open, el("span", sources.filter(({ status }) =>
          ["partial", "unavailable", "not_integrated", "not_linked"].includes(status))
          .map((source) => `${sourceName(source.source_id)} · ${sourceIssueReason(source)}`).join(" · "), "meta"));
        list.append(row);
      }
      details.append(list);
      counts.append(details);
    }
    const grid = $("snapshot-grid");
    grid.replaceChildren();
    const first = ["activity", "business", "geography", "ownership", "property", "representation", "environment"];
    for (const id of first) {
      const group = data.groups.find((entry) => entry.id === id);
      if (!group?.record_count) continue;
      const section = el("section", null, "overview-group");
      const heading = el("div", null, "overview-group-heading");
      const open = el("button", groups.find(([key]) => key === id)[1], "overview-link");
      open.type = "button";
      open.addEventListener("click", () => navigateDataSection(id, true));
      heading.append(open, el("span", `${group.record_count} returned`, "group-count"));
      section.append(heading);
      const items = data.highlights?.[id] ?? [];
      if (items.length) {
        const list = el("ul", null, "overview-highlights");
        for (const item of items.slice(0, 2)) {
          const row = el("li");
          row.append(el("span", `${item.label}${item.event_date ? ` · ${shortDate(item.event_date)}` : ""}`));
          if (item.source_url) row.append(link(item.source_url, "Source"));
          list.append(row);
        }
        section.append(list);
      }
      grid.append(section);
    }
    if (!grid.childElementCount)
      grid.append(el("p", "No parcel records were returned. Check source coverage for details.", "meta"));
  } catch (error) {
    if (version === viewVersion) $("overview-counts").replaceChildren(el("p", `Overview unavailable: ${error.message}`, "source-warning"));
  }
}
function clearBrowseDataMap() {
  if (browseMap) {
    if (browseSelectedLayer) browseMap.removeLayer(browseSelectedLayer);
    for (const layer of browseContextLayers) browseMap.removeLayer(layer);
  }
  browseSelectedLayer = null;
  browseContextLayers = [];
  $("browse-map-layers").hidden = true;
  $("browse-map-layer-list").replaceChildren();
  $("browse-map-context-notes").replaceChildren();
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
function setVerifiedPhoto(figure, image, sourceLink, data) {
  figure.hidden = true;
  image.removeAttribute("src");
  if (data?.status !== "ok" || !data.photo_url || !data.source_url) return false;
  try {
    const photo = new URL(data.photo_url);
    const source = new URL(data.source_url);
    const municipal = data.photo_source_id === "municity" &&
      photo.origin === "https://www.municitymedia.com" &&
      source.origin === "https://www.municityconnect.com";
    const assessor = data.photo_source_id === "assessor" &&
      photo.origin === "https://gis.vgsi.com" && source.origin === photo.origin;
    if (!municipal && !assessor) return false;
    const label = municipal ? "Municipal street-view photo" : "Assessor building photo";
    image.alt = `${label} for the selected City parcel`;
    sourceLink.textContent = municipal ? "View municipal parcel" : "View assessor card";
    figure.querySelector("figcaption")?.replaceChildren(
      document.createTextNode(`${label} · date not published. `), sourceLink,
    );
    image.onerror = () => { figure.hidden = true; };
    image.src = photo.href;
    sourceLink.href = source.href;
    figure.hidden = false;
    return true;
  } catch { return false; }
}
async function loadHeroPhoto(qs, version) {
  const figure = $("parcel-photo");
  try {
    const data = await api(`/api/v1/parcel-photo?${qs}`);
    if (version !== viewVersion) return;
    setVerifiedPhoto(figure, $("parcel-photo-image"), $("parcel-photo-source"), data);
  } catch { if (version === viewVersion) figure.hidden = true; }
}
function shortDate(value) {
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
function eventDateLabel(item) {
  const a = item.attributes ?? {};
  if (["parcel-sale", "assessor-sales"].includes(item.source_id)) return "Sale date";
  if (item.source_id === "lci-cases") return "Filed date";
  if (["ct-liquor-permits", "ct-child-care-licenses"].includes(item.source_id)) return "Effective date";
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
function eventDateBlock(item, extraClass = "") {
  const block = el("div", null, `event-date${extraClass ? ` ${extraClass}` : ""}`);
  block.append(el("span", eventDateLabel(item), "event-date-label"));
  const time = el("time", shortDate(item.event_date), "event-date-value");
  time.dateTime = item.event_date;
  block.append(time);
  return block;
}
function brief(value, max = 170) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
function sourceName(id) {
  return sourceNames[id] ?? id.replaceAll("-", " ");
}
function incompleteSources(sources) {
  return (sources ?? []).filter((source) => ["partial", "unavailable"].includes(source.status));
}
function sourceIssueReason(source) {
  const truncated = source.truncated_categories ?? [];
  if (source.source_id === "municity" && truncated.length)
    return `${truncated.join(", ")} ${truncated.length === 1 ? "category exceeded" : "categories exceeded"} the 500-row display limit`;
  return source.warning ?? source.coverage ?? source.status;
}
function sourceIssueLabels(sources) {
  const assessorIds = new Set(["assessor", "assessor-owner", "assessor-sales", "assessor-valuations",
    "assessor-subareas", "assessor-land", "assessor-buildings", "assessor-extra-features", "assessor-outbuildings"]);
  const assessor = sources.filter((source) => assessorIds.has(source.source_id));
  const sameCheck = assessor.length > 1 && assessor.every((source) =>
    source.status === assessor[0].status && sourceIssueReason(source) === sourceIssueReason(assessor[0]));
  let shownAssessor = false;
  return sources.flatMap((source) => {
    if (sameCheck && assessorIds.has(source.source_id)) {
      if (shownAssessor) return [];
      shownAssessor = true;
      return [`Vision assessor card check (${source.status}; ${assessor.length} affected sources): ${sourceIssueReason(source)}`];
    }
    return [`${sourceName(source.source_id)} (${source.status}): ${sourceIssueReason(source)}`];
  }).join("; ");
}
function recordStatus(item) {
  const a = item.attributes ?? {};
  if (item.source_id === "municipal-occupants")
    return a.inactive == null ? null : `Inactive flag: ${a.inactive ? "Yes" : "No"}`;
  return a.status ?? a.Status ?? a.record_status ?? a.PermStatus ?? a.PermitApplicationStatus ?? a.ApplicationStatus ?? a.CompStatus ?? a.registry_status ?? null;
}
function recordTitle(item) {
  const a = item.attributes ?? {};
  if (item.source_id === "ct-liquor-permits")
    return brief([a.dba ?? a.backer ?? "State liquor permit", a.credential].filter(Boolean).join(" · "), 120);
  if (item.source_id === "ct-child-care-licenses")
    return brief([a.name ?? "Child care or youth camp license", a.licensenumber].filter(Boolean).join(" · "), 120);
  if (item.source_id === "ct-cannabis-retail")
    return brief([a.dba ?? a.business ?? "Cannabis retail location", a.license].filter(Boolean).join(" · "), 120);
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
function recordDescription(item) {
  const a = item.attributes ?? {};
  if (item.source_id === "alders") return null;
  if (item.source_id === "trash-pickup") {
    const ids = a.address_point_objectids ?? [a.address_point_objectid];
    return `City address point${ids.length === 1 ? "" : "s"} ${ids.join(", ")} · pickup zone ${a.zone_objectid}${a.source_last_edited ? ` · source last edited ${shortDate(a.source_last_edited)}` : ""}`;
  }
  if (item.source_id === "school-attendance")
    return `NHPS School Choice attendance-zone preference · ${a.source_lookup_mode === "official_snapshot" ? `official export retrieved ${shortDate(a.source_snapshot_retrieved_at)}` : "live NHPS lookup"} · NHPS rows ${(a.nhps_source_row_ids ?? []).join(", ")}`;
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
  if (item.source_id === "ct-liquor-permits")
    return [a.permit_address, a.status, a.expire_date ? `Expires ${a.expire_date}` : null].filter(Boolean).join(" · ");
  if (item.source_id === "ct-child-care-licenses")
    return [a.licensetype, a.address2, a.status, a.expirationdate ? `Expires ${shortDate(a.expirationdate)}` : null].filter(Boolean).join(" · ");
  if (item.source_id === "ct-cannabis-retail")
    return [a.type, a.street, "State operating-location roster; no row-level status published"].filter(Boolean).join(" · ");
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
      if (item.event_date) row.append(eventDateBlock(item, "child-date"));
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
async function openRecordDetail(item, trigger) {
  const version = viewVersion;
  activeRecordGroup = activeDataSection;
  for (const [id] of groups) $(`group-${id}`).hidden = true;
  $("snapshot").hidden = true;
  $("feed-section").hidden = true;
  const detail = $("record-detail");
  detail.replaceChildren();
  detail.hidden = false;
  if (document.body.classList.contains("browse-mode")) {
    document.body.classList.add("browse-expanded");
    $("browse-panel-toggle").setAttribute("aria-expanded", "true");
    $("browse-panel-toggle").textContent = "Narrow panel";
    requestAnimationFrame(() => browseMap?.invalidateSize());
  }
  const back = el("button", `← Back to ${groups.find(([id]) => id === activeRecordGroup)?.[1] ?? "records"}`, "detail-back secondary");
  back.type = "button";
  back.onclick = () => {
    showDataSection(activeRecordGroup);
    if (trigger.isConnected) trigger.focus();
  };
  detail.append(back, el("p", `${item.category ?? sourceName(item.source_id)} · ${sourceName(item.source_id)}`, "record-kind"), el("h2", recordTitle(item)));
  const state = recordStatus(item);
  if (state) detail.append(el("p", `Published status: ${state}`, "record-meta"));
  if (item.event_date) detail.append(eventDateBlock(item, "detail-date"));
  if (item.address_evidence?.matches_query)
    detail.append(el("p", `Source ${item.address_evidence.source_field}: ${item.address_evidence.source_address}`, "address-badge"));
  if (item.source_url) detail.append(link(item.source_url, "Open official record"));
  const contents = el("div", null, "focused-record-content");
  detail.append(contents);
  const kind = item.category;
  const id = item.attributes?.[`${kind}_ID`];
  if (!["Permit", "Application"].includes(kind) || !/^\d{1,12}$/.test(String(id ?? ""))) {
    contents.append(fieldList(sourceFields(item.attributes), "record-fields all-fields"));
    back.focus();
    return;
  }
  contents.append(el("p", `Loading official ${kind.toLowerCase()} details…`, "meta"));
  back.focus();
  try {
    const qs = new URLSearchParams({ parcel_id: selected.parcel_id,
      [kind === "Permit" ? "permit_id" : "application_id"]: id });
    if (selected.objectid) qs.set("objectid", selected.objectid);
    const data = await api(`/api/v1/${kind === "Permit" ? "permit" : "application"}-details?${qs}`);
    if (version === viewVersion && !detail.hidden) renderWorkDetails(contents, data);
  } catch (error) {
    if (version === viewVersion && !detail.hidden)
      contents.replaceChildren(el("p", `Could not load ${kind.toLowerCase()} details: ${error.message}`, "source-warning"));
  }
}
function appendRecord(parent, item) {
  const card = el("article", null, "record-card");
  const aside = el("div", null, "record-aside");
  if (item.event_date) aside.append(eventDateBlock(item, "record-event-date"));
  aside.append(el("span", item.category ?? sourceName(item.source_id), "record-kind"));
  aside.append(el("span", sourceName(item.source_id), "record-source-name"));
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
    : item.source_id === "ct-liquor-permits" ? [
      ["Permit location", item.attributes.permit_address],
      ["Credential", item.attributes.credential],
      ["Published status", item.attributes.status],
      ["Effective date", item.attributes.effective_date],
      ["Expiration date", item.attributes.expire_date],
    ].filter(([, value]) => value)
    : item.source_id === "ct-child-care-licenses" ? [
      ["Program location", item.attributes.address2],
      ["License type", item.attributes.licensetype],
      ["License number", item.attributes.licensenumber],
      ["Published status", item.attributes.status],
      ["Expiration date", shortDate(item.attributes.expirationdate)],
    ].filter(([, value]) => value)
    : item.source_id === "ct-cannabis-retail" ? [
      ["Retail location", item.attributes.street],
      ["Retailer type", item.attributes.type],
      ["License", item.attributes.license],
      ["Business", item.attributes.business],
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
    const open = el("button", `Open full ${workKind.toLowerCase()}`, "detail-open secondary");
    open.type = "button";
    open.addEventListener("click", () => { void openRecordDetail(item, open); });
    actions.append(open);
  }
  const permitType = typeof item.attributes?.PermitType === "string" ? item.attributes.PermitType.trim() : "";
  if (workKind === "Permit" && permitType && permitType.length <= 100 && !$("activity-tab").hidden) {
    const related = el("a", null, "related-permit-link");
    related.dataset.relatedPermitType = permitType;
    related.hidden = true;
    actions.append(related);
    updateRelatedPermitLinks(actions);
  }
  body.append(actions);
  card.append(body);
  parent.append(card);
}
function sourceLine(parent, source) {
  const row = el("div", null, "source-status");
  const top = el("div", null, "source-status-top");
  top.append(el("strong", sourceName(source.source_id)));
  const count = source.status === "not_integrated" ? "Not queried"
    : source.status === "not_linked" ? "No verified link"
      : source.status === "unavailable" ? "Check unavailable"
        : source.status === "partial" ? `${source.count} shown`
          : source.status === "no_records" ? "0 returned"
            : `${source.count} ${source.count === 1 ? "record" : "records"}`;
  top.append(el("span", count, "source-count"));
  top.append(el("span", source.status.replaceAll("_", " "), `badge ${source.status}`));
  row.append(top);
  if (source.status === "unavailable" || source.status === "partial" ||
    (source.source_id === "school-attendance" && source.warning))
    row.append(el("p", sourceIssueReason(source), "source-warning"));
  if (source.status === "not_linked")
    row.append(el("p", source.warning, "source-note"));
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
    row.append(el("p", `${source.unnamed_license_count} other City License ${source.unnamed_license_count === 1 ? "row does" : "rows do"} not name a business. See Activity → Licenses.`, "category-counts"));
  const info = el("details", null, "source-coverage");
  info.append(el("summary", "Coverage and source"));
  info.append(el("p", source.coverage, "meta"));
  if (source.warning && source.source_id !== "school-attendance" &&
    !["unavailable", "partial", "not_linked"].includes(source.status))
    info.append(el("p", source.warning, "meta"));
  if (source.source_url) info.append(link(source.source_url, "Open source"));
  if (source.verification_url) info.append(link(source.verification_url, "Confirm with city"));
  row.append(info);
  parent.append(row);
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
async function choose(item, searchedQuery = null, viewer = "records", restoreState = false) {
  const version = ++viewVersion;
  closeNearbyBusinessResearch();
  closeStorefrontOpportunity();
  const priorParams = restoreState ? new URL(location.href).searchParams : null;
  const browsing = viewer === "browse";
  $("browse-record-actions").hidden = true;
  resetMap();
  clearBrowseDataMap();
  placeRecordContent(browsing);
  $("record-content").hidden = false;
  $("parcel-photo").hidden = true;
  $("parcel-photo-image").removeAttribute("src");
  selected = item;
  requestedParcelKey = null;
  activeDataSection = "overview";
  overviewGroups = [];
  parcelNeighborhoods = [];
  timelineReturnedCount = null;
  groupFilters.clear();
  groupLoadVersions.clear();
  loadedGroups.clear();
  feedLoaded = false;
  timelineFilters = { category: [], record_type: [], source_id: [], source_status: [], event_date_from: "", event_date_to: "", address_match: false };
  ++feedLoadVersion;
  searchedAddress = searchedQuery &&
    ["parcel-address", "address-point-intersection"].includes(item.match?.method)
    ? searchedQuery.trim() : "";
  if (priorParams) {
    const savedSection = priorParams.get("section");
    if (savedSection === "timeline") {
      activeDataSection = "timeline";
      timelineFilters = restoredFilters(priorParams);
    } else if (groups.some(([key]) => key === savedSection)) {
      activeDataSection = savedSection;
      groupFilters.set(savedSection, restoredFilters(priorParams));
    }
    if (!searchedAddress) {
      timelineFilters.address_match = false;
      for (const filters of groupFilters.values()) filters.address_match = false;
    }
  }
  $("candidates").hidden = true;
  history.replaceState(
    null,
    "",
    `/parcel?parcel_id=${encodeURIComponent(item.parcel_id)}${item.objectid ? `&objectid=${encodeURIComponent(item.objectid)}` : ""}${searchedAddress ? `&query_address=${encodeURIComponent(searchedAddress)}` : ""}${browsing ? "&view=map" : maplessRecords ? "&view=records" : ""}`,
  );
  saveDataUrl();
  $("groups").replaceChildren();
  $("group-nav").replaceChildren();
  $("record-detail").hidden = true;
  $("overview-counts").replaceChildren();
  $("snapshot-grid").replaceChildren(el("p", "Loading source-linked overview…", "meta"));
  $("school-attendance-results").replaceChildren(el("p", "Loading official school attendance zones…", "meta"));
  $("school-attendance-summary").hidden = true;
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
    requestedParcelKey = parcelKey(summary.parcel);
    if (browsing) {
      $("browse-intro").textContent = "Official records for the selected parcel are below.";
      $("browse-record-actions").hidden = false;
    }
    $("parcel-summary").hidden = false;
    $("records-view").classList.add("has-parcel");
    $("snapshot").hidden = activeDataSection !== "overview";
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
      $("parcel-match").append(el("strong", "Searched address"), document.createTextNode(` ${searchedAddress}`));
      if (alternateMatch)
        $("parcel-match").append(el("span", "Matched to this parcel by a City address point.", "parcel-match-evidence"));
    }
    status("Records are loading by source.");
    const tasks = [];
    if (!browsing) tasks.push(loadHeroPhoto(qs, version));
    if (browsing) tasks.push(loadBrowseSelectedMap(qs, version));
    else if (!maplessRecords) tasks.push(loadMap(qs, version));
    tasks.push(loadSchoolAttendance(qs, version));
    tasks.push(loadOverview(qs, version));
    for (const [id, title] of groups) {
      const section = el("section", null, "panel");
      section.id = `group-${id}`;
      section.append(el("h2", title));
      section.append(el("p", "Loading…", "meta"));
      $("groups").append(section);
    }
    renderDataNav();
    if (!browsing) requestAnimationFrame(() => {
      if (version === viewVersion) scrollToDataSection(activeDataSection, true);
    });
    await Promise.allSettled(tasks);
    if (version === viewVersion) status("");
  } catch (error) {
    if (version === viewVersion) status(error.message);
  }
}
function schoolAttendanceRow(item) {
  const a = item.attributes ?? {};
  const row = el("li", null, "school-attendance-row");
  row.append(el("strong", a.address ?? "Address unavailable", "school-attendance-address"));
  const schools = el("dl", null, "school-attendance-schools");
  for (const [label, value] of [
    ["K–8 attendance zone", a.k8_attendance_zone_school],
    ["High school attendance zone", a.high_school_attendance_zone_school],
  ]) {
    schools.append(el("dt", label), el("dd", value ?? "Not published"));
  }
  row.append(schools);
  if (item.source_url) row.append(link(item.source_url, "Open NHPS source row"));
  return row;
}
async function loadSchoolAttendance(qs, version) {
  const section = $("school-attendance-summary");
  const results = $("school-attendance-results");
  try {
    const data = await api(`/api/v1/school-attendance?${qs}`);
    if (version !== viewVersion) return;
    results.replaceChildren();
    section.hidden = activeDataSection !== "overview";
    const matches = searchedAddress
      ? data.items.filter((item) => item.address_evidence?.matches_query)
      : [];
    const primary = searchedAddress ? matches : data.items.slice(0, 2);
    const other = data.items.filter((item) => !primary.includes(item));
    if (searchedAddress && !matches.length)
      results.append(el("p", `No verified NHPS attendance-zone row matched ${searchedAddress}. Other addresses on this parcel may have results below.`, "source-note"));
    if (primary.length) {
      if (searchedAddress) results.append(el("p", `Matched searched address: ${searchedAddress}`, "school-attendance-focus"));
      const list = el("ul", null, "school-attendance-list");
      primary.forEach((item) => list.append(schoolAttendanceRow(item)));
      results.append(list);
    }
    if (other.length) {
      const details = el("details", null, "school-attendance-other");
      details.append(el("summary", `${other.length} other ${other.length === 1 ? "address" : "addresses"} on this parcel`));
      const list = el("ul", null, "school-attendance-list");
      other.forEach((item) => list.append(schoolAttendanceRow(item)));
      details.append(list);
      results.append(details);
    }
    if (!data.items.length && !searchedAddress)
      results.append(el("p", "No verified NHPS attendance-zone rows were returned for this parcel's checked addresses.", "source-note"));
    const snapshot = data.items.find((item) => item.attributes?.source_lookup_mode === "official_snapshot");
    if (snapshot) results.append(el("p", `Official NHPS export retrieved ${shortDate(snapshot.attributes.source_snapshot_retrieved_at)}; the live lookup was unavailable.`, "school-attendance-provenance"));
    else if (data.items.length) results.append(el("p", "Checked against the live NHPS attendance-zone search.", "school-attendance-provenance"));
    if (data.source.warning) results.append(el("p", data.source.warning, "source-warning"));
    results.append(el("p", "NHPS describes these as School Choice placement preferences, not guaranteed enrollment.", "source-note"));
    const actions = el("p", null, "school-attendance-actions");
    const open = el("button", "Review all school source records", "secondary");
    open.type = "button";
    open.addEventListener("click", () => {
      groupFilters.set("property", { ...filterState("property"), source_id: ["school-attendance"] });
      loadedGroups.delete("property");
      navigateDataSection("property");
    });
    actions.append(open);
    if (data.source.source_url) actions.append(link(data.source.source_url, "NHPS attendance-zone search"));
    results.append(actions);
  } catch (error) {
    if (version !== viewVersion) return;
    section.hidden = activeDataSection !== "overview";
    results.replaceChildren(el("p", `Could not check school attendance zones: ${error.message}`, "source-warning"));
  }
}
async function loadMap(qs, version) {
  $("parcel-map-section").hidden = activeDataSection !== "overview";
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
    let activeBackground = "Street map";
    $("parcel-map-status").textContent = "Selected City parcel boundary shown. Loading street map…";
    const { streets, aerial } = addMapBackgrounds(map);
    streets.on("tileload", () => {
      if (version !== viewVersion) return;
      if (activeBackground === "Street map")
        $("parcel-map-status").textContent = "Selected City parcel boundary over a street map. Aerial imagery is available in the map switcher.";
    });
    streets.on("tileerror", () => {
      if (version !== viewVersion) return;
      if (activeBackground === "Street map")
        $("parcel-map-status").textContent = "Some street tiles did not load. The City parcel boundary remains visible.";
    });
    aerial.on("tileload", () => {
      if (version === viewVersion && activeBackground === "2023 aerial imagery")
        $("parcel-map-status").textContent = "Selected City parcel boundary over 2023 aerial imagery.";
    });
    aerial.on("tileerror", () => {
      if (version === viewVersion && activeBackground === "2023 aerial imagery")
        $("parcel-map-status").textContent = "Some aerial tiles did not load. The City parcel boundary remains visible.";
    });
    map.on("baselayerchange", ({ name }) => {
      activeBackground = name;
      $("parcel-map-status").textContent = `Loading ${name.toLowerCase()} behind the City parcel boundary…`;
    });
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
    await loadMapContext(map, qs, version, bounds);
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
async function loadBrowseSelectedMap(qs, version, recenter = false) {
  const layersPanel = $("browse-map-layers");
  layersPanel.hidden = false;
  layersPanel.open = false;
  const list = $("browse-map-layer-list");
  list.replaceChildren(el("p", "Loading the selected City parcel boundary…", "meta"));
  try {
    const feature = await api(`/api/v1/geometry?${qs}`);
    if (version !== viewVersion || !browseMap) return;
    if (parcelKey(selectedBrowseParcel) !== parcelKey(feature.properties))
      void selectBrowseParcel(feature);
    if (!browseMap.getPane("selected-boundary")) {
      browseMap.createPane("selected-boundary");
      browseMap.getPane("selected-boundary").style.zIndex = 390;
    }
    browseSelectedLayer = window.L.geoJSON(feature, {
      pane: "selected-boundary", interactive: false,
      style: { color: "#00a8ad", weight: 4, fillColor: "#00d5d8", fillOpacity: .1 },
    }).addTo(browseMap);
    const bounds = browseSelectedLayer.getBounds();
    if (!bounds.isValid()) throw Error("City parcel boundary has no map extent");
    if (recenter) browseMap.fitBounds(bounds.pad(2), { maxZoom: 18 });
    browseContextLayers = await loadMapContext(browseMap, qs, version, bounds, {
      list, notes: $("browse-map-context-notes"),
    });
  } catch (error) {
    if (version !== viewVersion) return;
    list.replaceChildren(el("p", `Could not show selected parcel layers: ${error.message}`, "map-layer-warning"));
  }
}
function mapFeatureTitle(feature, layerId) {
  const p = feature.properties ?? {};
  if (layerId === "parcel-addresses") return `${p.house_number ?? ""} ${p.full_street_name ?? ""}`.trim() || "City address point";
  if (layerId === "zoning") return p.zone_code ? `Zoning ${p.zone_code}` : "City zoning district";
  if (layerId === "transit-stops") return p.StopName ?? "CT Transit stop";
  if (layerId === "metered-parking-spaces") return p.facilityid ? `Mapped meter ${p.facilityid}` : "Mapped metered space";
  return "Mapped feature";
}
function mapFeaturePopup(feature, layer) {
  const popup = el("div", null, "map-popup");
  popup.append(el("strong", mapFeatureTitle(feature, layer.id)));
  const fields = layer.id === "metered-parking-spaces"
    ? [["Meter number", feature.properties?.meternum], ["Facility ID", feature.properties?.facilityid],
      ["Post number", feature.properties?.post_num], ["Space number", feature.properties?.spacenum],
      ["City zone field", feature.properties?.zone_], ["Meter specification as published", feature.properties?.meterspec]]
      .filter(([, value]) => value != null && value !== "")
    : Object.entries(feature.properties ?? {})
      .filter(([key, value]) => !["source_id", "source_record_id", "source_url", "scope"].includes(key) && value != null && value !== "")
      .slice(0, 5).map(([key, value]) => [fieldLabel(key), value]);
  if (fields.length) popup.append(fieldList(fields.map(([key, value]) => [key, String(value)])));
  if (feature.properties?.source_url) popup.append(link(feature.properties.source_url, "Open City source"));
  popup.append(el("p", layer.id === "metered-parking-spaces"
    ? "Nearby mapped meter inventory; not linked to the parcel or an open-space indicator. Check posted rules and rates."
    : layer.scope === "nearby"
    ? "Nearby map context; not linked to the parcel."
    : layer.id === "parcel-addresses"
      ? "City address point; not a verified entrance."
      : "Mapped district intersects the selected parcel.", "meta"));
  return popup;
}
function mapFeatureLayer(layer, { interactive = true } = {}) {
  const color = MAP_COLORS[layer.id] ?? "#315e4e";
  return window.L.geoJSON({ type: "FeatureCollection", features: layer.features }, {
    interactive,
    style: () => ({
      color,
      weight: 3,
      fillOpacity: 0.04,
    }),
    pointToLayer: (_feature, latlng) => window.L.circleMarker(latlng, {
      radius: layer.id === "parcel-addresses" ? 6 : layer.id === "metered-parking-spaces" ? 4 : 5,
      color: "#fff", weight: 2, fillColor: color, fillOpacity: 1,
    }),
    onEachFeature: (feature, leafletLayer) => {
      if (interactive) leafletLayer.bindPopup(mapFeaturePopup(feature, layer));
    },
  });
}
async function loadMapContext(map, qs, version, parcelBounds, targets = {}) {
  const list = targets.list ?? $("map-layer-list");
  const notes = targets.notes ?? $("map-context-notes");
  list.replaceChildren(el("p", "Loading official map layers…", "meta"));
  try {
    const context = await api(`/api/v1/map-context?${qs}`);
    if (version !== viewVersion || (map !== parcelMap && map !== browseMap)) return [];
    list.replaceChildren();
    const renderedLayers = [];
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
      const extent = layer.scope === "nearby"
        ? `Within ${(layer.search_radius_m ?? context.nearby_radius_m).toLocaleString()} m · `
        : "On parcel · ";
      row.append(el("p", `${extent}${layer.features.length} mapped · ${layer.status.replaceAll("_", " ")}`, "map-layer-meta"));
      if (layer.id === "metered-parking-spaces" && layer.status === "no_records")
        row.append(el("p", "No City mapped meters within 400 m of this parcel; there are no markers to turn on.", "map-layer-meta"));
      if (layer.source_updated_at)
        row.append(el("p", `Source data last edited ${shortDate(layer.source_updated_at)}`, "map-layer-meta"));
      else row.append(el("p", "Source update date unavailable", "map-layer-meta"));
      if (layer.note) row.append(el("p", layer.note, "map-layer-meta"));
      if (layer.warning) row.append(el("p", layer.warning, "map-layer-warning"));
      row.append(link(layer.source_url, "Open City GIS layer"));
      list.append(row);
      if (!layer.features.length) continue;
      // A zoning polygon can cover neighboring parcels. Let Browse clicks reach the parcel canvas.
      const rendered = mapFeatureLayer(layer, { interactive: map !== browseMap || layer.id !== "zoning" });
      renderedLayers.push(rendered);
      if (checkbox.checked) rendered.addTo(map);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          rendered.addTo(map);
          if (layer.id === "metered-parking-spaces")
            map.fitBounds(rendered.getBounds().extend(parcelBounds), { padding: [18, 18], maxZoom: 18 });
        }
        else map.removeLayer(rendered);
      });
    }
    notes.replaceChildren();
    notes.append(el("p", "Nearby transit stops and mapped metered spaces cover 400 metres in a straight line from the parcel map center. They are not parcel-linked records.", "meta"));
    const gaps = el("p", null, "meta");
    gaps.append(document.createTextNode("Mapped meters do not show current availability, rates, or restrictions. Loading zones and available spaces are not mapped. "));
    gaps.append(link(context.gaps?.[0]?.source_url, "See City parking maps"));
    notes.append(gaps);
    return renderedLayers;
  } catch (error) {
    if (version !== viewVersion) return [];
    list.replaceChildren(el("p", `Map context unavailable: ${error.message}. The selected parcel boundary remains visible.`, "map-layer-warning"));
    return [];
  }
}
let cityActivityModule;
function loadCityActivity() {
  cityActivityModule ??= import("/city-activity.js").then(({ initCityActivity }) =>
    initCityActivity({ api, el, link }));
  void cityActivityModule.then((open) => {
    if (!$("activity-view").hidden) open();
  }).catch(() => {
    cityActivityModule = null;
    $("activity-status").textContent = "The activity feed could not load. Try opening the tab again.";
  });
}
function showExplorerTab(tab, { noMap = false, section = guideSection } = {}) {
  const browsing = tab === "browse";
  const guiding = tab === "guide";
  const asking = tab === "ask" && !$('ask-tab').hidden;
  const activity = tab === "activity" && !$("activity-tab").hidden;
  const readingRecords = !browsing && !guiding && !asking && !activity;
  maplessRecords = readingRecords && noMap;
  if (!maplessRecords) {
    closeNearbyBusinessResearch();
    closeStorefrontOpportunity();
  }
  document.body.classList.toggle("browse-mode", browsing);
  document.body.classList.toggle("record-only-mode", maplessRecords);
  const url = new URL(location.href);
  if (browsing) url.searchParams.set("view", "map");
  else if (guiding) url.searchParams.set("view", "guide");
  else if (asking) url.searchParams.set("view", "ask");
  else if (activity) url.searchParams.set("view", "activity");
  else if (maplessRecords) url.searchParams.set("view", "records");
  else url.searchParams.delete("view");
  if (guiding && section !== "home" &&
      (!["query-explorer", "permit-applications"].includes(section) || !$("ask-tab").hidden))
    url.searchParams.set("guide", section);
  else url.searchParams.delete("guide");
  history.replaceState(null, "", `${url.pathname}${url.search}`);
  $("records-view").hidden = !readingRecords;
  $("browse-view").hidden = !browsing;
  $("guide-view").hidden = !guiding;
  $("ask-view").hidden = !asking;
  $("activity-view").hidden = !activity;
  if (readingRecords || browsing) placeRecordContent(browsing);
  $("records-tab").setAttribute("aria-selected", String(readingRecords));
  $("activity-tab").setAttribute("aria-selected", String(activity));
  if (activity) loadCityActivity();
  $("browse-tab").setAttribute("aria-selected", String(browsing));
  $("guide-tab").setAttribute("aria-selected", String(guiding));
  $("ask-tab").setAttribute("aria-selected", String(asking));
  if (guiding) void loadGuide(section);
  if (browsing) requestAnimationFrame(() => {
    if (!browseMap) initBrowseMap();
    else {
      browseMap.invalidateSize();
      void loadBrowseParcels();
    }
    if (selected && requestedParcelKey === parcelKey(selected) && !browseSelectedLayer) {
      void loadBrowseSelectedMap(selectedQuery(), viewVersion, true);
    }
  });
  else if (readingRecords && !maplessRecords && selected && requestedParcelKey === parcelKey(selected)) requestAnimationFrame(() => {
    if (parcelMap) parcelMap.invalidateSize();
    else void loadMap(selectedQuery(), viewVersion);
  });
}
function guideFieldTable(parent, fields) {
  const table = el("table", null, "guide-field-table");
  const head = el("thead");
  const heading = el("tr");
  for (const title of ["Field", "Meaning", "Origin"]) heading.append(el("th", title));
  head.append(heading);
  table.append(head);
  const body = el("tbody");
  for (const field of fields) {
    const row = el("tr");
    row.append(el("th", field.key), el("td", field.meaning), el("td", field.origin));
    body.append(row);
  }
  table.append(body);
  parent.append(table);
}
function renderGuideSection(key) {
  if (!guideData) return;
  guideSection = key;
  const url = new URL(location.href);
  if (key === "home") url.searchParams.delete("guide");
  else url.searchParams.set("guide", key);
  history.replaceState(null, "", `${url.pathname}${url.search}`);
  const content = $("guide-content");
  const example = $("guide-example");
  content.replaceChildren();
  example.replaceChildren();
  for (const button of $("guide-nav").querySelectorAll("button"))
    button.setAttribute("aria-current", button.dataset.guide === key ? "page" : "false");
  if (key === "query-explorer" && !$("ask-tab").hidden) {
    const reference = el("div");
    const sidebar = el("div");
    content.append(reference);
    example.append(sidebar);
    void queryExplorer().then(({ explorer }) => explorer.renderGuide(reference, sidebar))
      .catch((error) => reference.replaceChildren(el("p", error.message, "source-warning")));
  } else if (key === "permit-applications" && !$("ask-tab").hidden) {
    const menu = el("div");
    const sidebar = el("div");
    content.append(menu);
    example.append(sidebar);
    void import("/permit-applications.js").then(({ renderPermitApplications }) =>
      renderPermitApplications(menu, sidebar, { api, el, link }))
      .catch((error) => menu.replaceChildren(el("p", error.message, "source-warning")));
  } else if (key === "home") {
    content.append(el("p", "Official source records · private preview", "eyebrow"),
      el("h2", "How to read this parcel feed"));
    const steps = el("ol", null, "guide-steps");
    for (const step of ["Resolve an address to a City parcel ID and object ID.",
      "Read the overview and source coverage before interpreting an empty result.",
      "Open one group, filter the returned records, then inspect the original source.",
      "Use the dated feed for source dates; follow a permit ID for its public child records."])
      steps.append(el("li", step));
    content.append(steps, el("h3", "Reading rules"));
    for (const rule of guideData.rules) content.append(el("p", rule, "guide-rule"));
    example.append(el("h3", "REST and MCP"), el("p", "Each method below shows the protected REST path and the matching MCP tool. Example responses are requested only when you press the button."));
  } else if (key === "fields") {
    content.append(el("p", "Response schema", "eyebrow"), el("h2", "Field guide"),
      el("p", "These service fields appear around record attributes returned by each source adapter. Coverage explains omitted fields and unavailable checks."));
    guideFieldTable(content, guideData.fields);
    example.append(el("h3", "Source fields"), el("p", "The attributes object contains fields returned by this adapter. Open the official source and review its coverage note for field limits. An unlabeled key has not been assigned a new meaning here."));
  } else if (key === "sources") {
    content.append(el("p", "Provenance", "eyebrow"), el("h2", "Official sources and gaps"));
    for (const group of guideData.groups) {
      const section = el("section", null, "guide-source-group");
      section.append(el("h3", group.title));
      for (const source of guideData.sources.filter((entry) => entry.group === group.id)) {
        const row = el("div", null, "guide-source-row");
        row.append(el("h4", source.title), el("p", `${source.mode} · ${source.coverage}`, "meta"), link(source.url, "Open official source"));
        if (source.verification_url) row.append(link(source.verification_url, "Verification page"));
        section.append(row);
      }
      content.append(section);
    }
  } else {
    const method = guideData.methods.find((entry) => entry.id === key);
    if (!method) return;
    content.append(el("p", "API and MCP method", "eyebrow"), el("h2", method.title), el("p", method.description));
    const contract = el("dl", null, "guide-contract");
    for (const [name, value] of [["REST", method.rest], ["MCP tool", method.mcp], ["Inputs", method.inputs]]) {
      const row = el("div");
      row.append(el("dt", name), el("dd", value));
      contract.append(row);
    }
    content.append(contract);
    if (["records", "feed"].includes(key)) {
      content.append(el("h3", "Filters"));
      for (const filter of guideData.filters.filter((entry) => entry.applies_to.includes(key)))
        content.append(el("p", `${filter.key} · ${filter.label}${filter.multiple ? " · repeat in REST or pass an array to MCP" : ""}`, "guide-rule"));
      content.append(el("p", "Filter before paging. Facets count returned records before filters; total counts filtered returned records. Keep the same filters with next_cursor.", "meta"));
    }
    content.append(el("h3", "Response fields"));
    guideFieldTable(content, guideData.fields);
    example.append(el("h3", "Example request"));
    const path = method.rest.split(" ")[1];
    const qs = new URLSearchParams();
    if (!["resolve", "catalog", "permit-search"].includes(key) && selected && requestedParcelKey === parcelKey(selected)) {
      qs.set("parcel_id", selected.parcel_id);
      if (selected.objectid) qs.set("objectid", selected.objectid);
    } else if (!["resolve", "catalog", "permit-search"].includes(key)) qs.set("parcel_id", "<City parcel ID>");
    if (key === "permit-search") { qs.set("neighborhood", "<City neighborhood>"); qs.set("permit_type", "<exact type>"); }
    if (key === "records") qs.set("group", "property");
    if (key === "permit") qs.set("permit_id", "<published permit ID>");
    if (key === "application") qs.set("application_id", "<published application ID>");
    const request = `${method.rest}${qs.size ? `?${qs}` : ""}`;
    example.append(el("pre", request));
    const mcp = el("pre", JSON.stringify({ tool: method.mcp, arguments: Object.fromEntries(qs) }, null, 2));
    example.append(mcp);
    if (method.rest.startsWith("GET") && !["permit", "application", "permit-search"].includes(key) &&
      (key === "catalog" || (selected && requestedParcelKey === parcelKey(selected)))) {
      const load = el("button", "Request live example");
      load.type = "button";
      load.onclick = async () => {
        load.disabled = true;
        const output = el("pre", "Loading official records…", "guide-live-response");
        example.append(output);
        try { output.textContent = JSON.stringify(await api(`${path}${qs.size ? `?${qs}` : ""}`), null, 2); }
        catch (error) { output.textContent = `Request failed: ${error.message}`; }
        finally { load.disabled = false; }
      };
      example.append(load);
    }
  }
}
async function loadGuide(section) {
  if (!guideData) {
    $("guide-content").replaceChildren(el("p", "Loading the protected data guide…", "meta"));
    try { guideData = await api("/api/v1/schema"); }
    catch (error) {
      $("guide-content").replaceChildren(el("p", `Data guide unavailable: ${error.message}`, "source-warning"));
      return;
    }
  }
  const nav = $("guide-nav");
  nav.replaceChildren();
  const sections = [["home", "How to read the data"],
    ...(!$("ask-tab").hidden ? [["query-explorer", "Query explorer"], ["permit-applications", "Permit applications"]] : []),
    ...guideData.methods.filter(({ id }) => id !== "permit-applications").map((item) => [item.id, item.title]),
    ["fields", "Field guide"], ["sources", "Sources and gaps"]];
  for (const [id, title] of sections) {
    const button = el("button", title, "guide-nav-button");
    button.type = "button";
    button.dataset.guide = id;
    button.onclick = () => renderGuideSection(id);
    nav.append(button);
  }
  if (!$("guide-view").hidden)
    renderGuideSection(sections.some(([id]) => id === section) ? section : "home");
}
const browseUseStyles = new Map([
  ["residential", { label: "Residential", color: "#286eae", opacity: .40 }],
  ["mixed_use", { label: "Mixed-use", color: "#ca820b", opacity: .47 }],
  ["commercial_only", { label: "Commercial only", color: "#863db4", opacity: .40 }],
  ["other", { label: "Other", color: "#696e7d", opacity: .28 }],
  ["unclassified", { label: "Unclassified", color: "#b0b7bc", opacity: .15 }],
]);
const MIN_BROWSE_ZOOM = 15;
const BROWSE_REUSE_MS = 60_000;
const BROWSE_MAX_SPLIT_DEPTH = 2;
const BROWSE_SPLIT_AREA = .001;

function browseUseStyle(category) {
  return browseUseStyles.get(category) ?? browseUseStyles.get("unclassified");
}

function browseParcelStyle(feature) {
  const p = feature.properties ?? {};
  const active = selectedBrowseParcel &&
    String(p.parcel_id) === String(selectedBrowseParcel.parcel_id) &&
    String(p.objectid) === String(selectedBrowseParcel.objectid);
  const use = browseUseStyle(p.recorded_use?.category);
  const useMode = $("browse-parcel-display").value === "use";
  return { color: active ? "#00d5d8" : "#173e35", weight: active ? 4 : 1.25, opacity: .92,
    fillColor: useMode ? use.color : active ? "#00d5d8" : "#f8c547",
    fillOpacity: useMode ? use.opacity : active ? .22 : .04 };
}

function browseUseDetail(use) {
  const detail = el("dd", browseUseStyle(use?.category).label);
  const published = [use?.published_label, use?.published_code && `Code ${use.published_code}`].filter(Boolean);
  if (published.length) detail.append(el("span", ` · ${published.join(" · ")}`));
  if (use?.definition_source_url) detail.append(document.createTextNode(" · "),
    link(use.definition_source_url, "Use definition"));
  return detail;
}

async function loadBrowseZoning(qs, version, detail) {
  try {
    const data = await api(`/api/v1/parcel-zoning?${qs}`);
    if (version !== browseSelectionVersion) return;
    detail.textContent = data.district_codes.length ? data.district_codes.join(", ")
      : data.status === "no_records" ? "No intersecting districts returned" : "Zoning unavailable";
    if (data.status === "partial") {
      detail.append(el("span", data.district_codes.length ? " · Partial coverage" : " · Check incomplete"));
    }
    if (data.warning) detail.append(el("span", ` · ${data.warning}`));
    if (data.source_url) detail.append(document.createTextNode(" · "), link(data.source_url, "City zoning layer"));
  } catch {
    if (version === browseSelectionVersion) detail.textContent = "Zoning unavailable";
  }
}
async function selectBrowseParcel(feature) {
  const p = feature.properties ?? {};
  if (p.parcel_id == null || p.objectid == null) return;
  const key = parcelKey(p);
  if (selected && parcelKey(selected) !== key) {
    ++viewVersion;
    selected = null;
    requestedParcelKey = null;
    $("record-content").hidden = true;
    $("browse-data-status").textContent = "";
    $("browse-record-actions").hidden = true;
    $("browse-intro").textContent = "Select Request parcel data to load the full records for this parcel.";
    clearBrowseDataMap();
    resetMap();
  }
  const version = ++browseSelectionVersion;
  const previous = browsePaths.get(parcelKey(selectedBrowseParcel));
  selectedBrowseParcel = { parcel_id: p.parcel_id, objectid: p.objectid,
    address: p.address, source_url: p.source_url };
  previous?.setStyle(browseParcelStyle(previous.feature));
  const path = browsePaths.get(key);
  path?.setStyle(browseParcelStyle(feature)).bringToFront();
  const aside = $("browse-selection");
  if (window.matchMedia("(max-width: 44rem)").matches)
    aside.scrollIntoView({ behavior: "smooth", block: "start" });
  const title = p.address?.trim() || `City parcel ${p.parcel_id}`;
  const zoning = el("dd", "Checking City zoning districts…");
  const facts = el("dl", null, "browse-selection-facts");
  facts.append(el("dt", "Recorded use"), browseUseDetail(p.recorded_use), el("dt", "Mapped zoning"), zoning);
  const photoStatus = el("p", "Checking official parcel photo sources…", "meta");
  aside.replaceChildren(el("p", "Selected City parcel", "eyebrow"), el("h2", title),
    el("p", `Parcel ID ${p.parcel_id}${p.mblu ? ` · MBLU ${p.mblu}` : ""}`, "meta"),
    facts, photoStatus);
  aside.append(link(p.source_url, "Open City parcel source"));
  const button = el("button", requestedParcelKey === key ? "Refresh parcel data" : "Request parcel data");
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Loading parcel data…";
    try {
      const saved = new URL(location.href).searchParams;
      await choose({ parcel_id: p.parcel_id, objectid: p.objectid,
        address: p.address, match: { method: "map-selection" } }, null, "browse",
      saved.get("parcel_id") === String(p.parcel_id) && saved.get("objectid") === String(p.objectid));
      setMobileBrowseView("records");
    } finally {
      if (version === browseSelectionVersion) {
        button.disabled = false;
        button.textContent = requestedParcelKey === key ? "Refresh parcel data" : "Request parcel data";
      }
    }
  });
  aside.append(button);
  const qs = new URLSearchParams({ parcel_id: p.parcel_id, objectid: p.objectid });
  void loadBrowseZoning(qs, version, zoning);
  try {
    const data = await api(`/api/v1/parcel-photo?${qs}`);
    if (version !== browseSelectionVersion) return;
    if (data.status !== "ok") {
      photoStatus.textContent = "No verified municipal or assessor photo was returned for this parcel.";
      return;
    }
    const figure = el("figure", null, "parcel-photo");
    const image = document.createElement("img");
    image.alt = "Verified parcel photo";
    const caption = el("figcaption", "Official parcel photo · date not published. ");
    const source = el("a", "View source");
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    caption.append(source);
    figure.append(image, caption);
    if (setVerifiedPhoto(figure, image, source, data)) photoStatus.replaceWith(figure);
    else photoStatus.textContent = "No verified municipal or assessor photo was returned for this parcel.";
  } catch {
    if (version === browseSelectionVersion)
      photoStatus.textContent = "Photo sources unavailable; the City parcel selection remains available.";
  }
}
async function fetchBrowseViewport(bounds, zoom, signal, depth = 0) {
  const west = bounds.getWest();
  const south = bounds.getSouth();
  const east = bounds.getEast();
  const north = bounds.getNorth();
  const longitude = (west + east) / 2;
  const latitude = (south + north) / 2;
  const width = (east - west) * Math.cos(latitude * Math.PI / 180);
  // Wide screens at the first browse zoom can exceed one response's capacity.
  // Split these views up front so the request does not download a partial copy.
  let data;
  if (width * (north - south) <= BROWSE_SPLIT_AREA || depth >= BROWSE_MAX_SPLIT_DEPTH) {
    const bbox = [west, south, east, north].join(",");
    data = await api(`/api/v1/browse-parcels?${new URLSearchParams({ bbox, zoom })}`, { signal });
    for (const { properties } of data.features) {
      if (data.recorded_uses) properties.recorded_use = data.recorded_uses[properties.use_code];
      if (data.source_url) properties.source_url = `${data.source_url}/${properties.objectid}`;
    }
    if (!data.viewport_limited || depth >= BROWSE_MAX_SPLIT_DEPTH) return data;
  }
  const sections = width >= north - south
    ? [[[south, west], [north, longitude]], [[south, longitude], [north, east]]]
    : [[[south, west], [latitude, east]], [[latitude, west], [north, east]]];
  const parts = await Promise.allSettled(sections.map((section) =>
    fetchBrowseViewport(window.L.latLngBounds(section), zoom, signal, depth + 1)));
  signal.throwIfAborted();
  const available = parts.flatMap((part) => part.status === "fulfilled" ? [part.value] : []);
  if (!data && !available.length) throw parts[0].reason;
  const limited = available.length < sections.length || available.some((part) => part.viewport_limited);
  const features = new Map();
  for (const part of limited && data ? [data, ...available] : available)
    for (const feature of part.features) features.set(parcelKey(feature.properties), feature);
  return {
    features: [...features.values()],
    viewport_limited: limited,
    warning: limited ? "Some City parcel outlines could not be loaded for this view. Zoom in to retry."
      : available.some((part) => part.warning) ? "Some City parcel geometries could not be displayed." : null,
  };
}

async function loadBrowseParcels() {
  if (!browseMap || $("browse-view").hidden || !$("browse-map").clientWidth) return;
  const status = $("browse-map-status");
  const zoom = browseMap.getZoom();
  if (zoom < MIN_BROWSE_ZOOM) {
    browseRequest?.controller.abort();
    browseRequest = browseCoverage = null;
    browseLayer?.remove();
    browseLayer = null;
    browsePaths.clear();
    status.textContent = "Zoom in to see parcel outlines.";
    return;
  }
  const view = browseMap.getBounds();
  const coversView = (entry) => entry && Math.abs(entry.zoom - zoom) < 2 && entry.bounds.contains(view);
  if (coversView(browseRequest)) return;
  if (coversView(browseCoverage) && Date.now() < browseCoverage.expires) {
    browseRequest?.controller.abort();
    browseRequest = null;
    status.textContent = browseCoverage.message;
    return;
  }
  browseRequest?.controller.abort();
  const bounds = view.pad(.14);
  const controller = new AbortController();
  const request = { zoom, bounds, controller };
  browseRequest = request;
  status.textContent = "Loading City parcel outlines for this map view…";
  try {
    const data = await fetchBrowseViewport(bounds, zoom, controller.signal);
    if (request !== browseRequest) return;
    const paths = new Map();
    const layer = window.L.geoJSON({ type: "FeatureCollection", features: data.features }, {
      renderer: browseRenderer, style: browseParcelStyle,
      onEachFeature: (feature, path) => {
        if (feature.properties.parcel_id == null || feature.properties.objectid == null) {
          path.options.interactive = false;
          return;
        }
        paths.set(parcelKey(feature.properties), path);
        path.on("click", () => { void selectBrowseParcel(feature); });
      },
    });
    browseLayer?.remove();
    browseLayer = layer.addTo(browseMap);
    browsePaths = paths;
    browsePaths.get(parcelKey(selectedBrowseParcel))?.bringToFront();
    const message = data.warning ?? (data.features.length
      ? "City parcel outlines loaded. Select one to preview it."
      : "No City parcel outlines returned for this view.");
    status.textContent = message;
    browseCoverage = { zoom, bounds: data.viewport_limited ? view : bounds,
      message, expires: Date.now() + BROWSE_REUSE_MS };
  } catch (error) {
    if (request === browseRequest)
      status.textContent = `Could not load City parcel outlines: ${error.message}`;
  } finally {
    if (request === browseRequest) browseRequest = null;
  }
}
function initBrowseMap() {
  if (browseMap) return;
  const leaflet = window.L;
  if (!leaflet) {
    $("browse-map-status").textContent = "Map renderer unavailable.";
    return;
  }
  const legend = $("browse-use-legend");
  for (const { label, color } of browseUseStyles.values()) {
    const entry = el("li");
    const swatch = el("span", null, "browse-use-swatch");
    swatch.style.backgroundColor = color;
    swatch.setAttribute("aria-hidden", "true");
    entry.append(swatch, document.createTextNode(label));
    legend.append(entry);
  }
  $("browse-parcel-display").addEventListener("change", (event) => {
    $("browse-use-key").hidden = event.currentTarget.value !== "use";
    browseLayer?.setStyle(browseParcelStyle);
  });
  browseMap = leaflet.map($("browse-map"), { scrollWheelZoom: false, keyboard: true });
  browseRenderer = leaflet.canvas({ padding: .2 });
  addMapBackgrounds(browseMap);
  browseMap.setView([41.3083, -72.9279], MIN_BROWSE_ZOOM);
  browseMap.on("moveend", () => {
    clearTimeout(browseTimer);
    browseTimer = setTimeout(() => { void loadBrowseParcels(); }, 75);
  });
  leaflet.control.scale({ metric: false, imperial: true }).addTo(browseMap);
  void loadBrowseParcels();
}
function filterState(id) {
  return groupFilters.get(id) ?? {
    category: [], record_type: [], source_id: [], display_group: [], source_status: [],
    event_date_from: "", event_date_to: "", address_match: false,
  };
}
function quickFilterSelect(parent, title, allLabel, values, selected, label, onChange) {
  if (!Object.keys(values ?? {}).length && !selected.length) return;
  const wrapper = el("label", null, "quick-filter");
  wrapper.append(el("span", title));
  const select = document.createElement("select");
  const all = el("option", allLabel);
  all.value = "";
  select.append(all);
  if (selected.length > 1) {
    const multiple = el("option", `${selected.length} selected · edit in More filters`);
    multiple.value = "__multiple__";
    multiple.disabled = true;
    select.append(multiple);
    select.value = multiple.value;
  }
  const options = { ...values };
  for (const value of selected) if (!(value in options)) options[value] = null;
  for (const [value, count] of Object.entries(options)) {
    const option = el("option", `${label(value)}${count == null ? "" : ` · ${count}`}`);
    option.value = value;
    select.append(option);
  }
  if (selected.length === 1) select.value = selected[0];
  select.addEventListener("change", () => onChange(select.value ? [select.value] : []));
  wrapper.append(select);
  parent.append(wrapper);
}
function quickAddressMatch(parent, checked, onChange) {
  if (!searchedAddress) return;
  const label = el("label", null, "quick-address-match");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  label.append(input, document.createTextNode(`Source address matches ${searchedAddress}`));
  parent.append(label);
}
function renderTimelineFilters(data, qs, version) {
  const container = $("timeline-filters");
  container.replaceChildren();
  const summary = el("p", null, "overview-summary");
  summary.id = "timeline-result-count";
  container.append(summary);
  container.append(el("p", "All returned dates and published statuses are included until you apply a filter. Older and closed records remain reachable by loading more rows.", "filter-context"));
  const quick = el("div", null, "quick-filters");
  const update = (key, value) => {
    timelineFilters = { ...timelineFilters, [key]: value };
    saveDataUrl();
    void loadFeed(qs, version);
  };
  quickFilterSelect(quick, "Category", "All categories", data.facets?.category, timelineFilters.category,
    (value) => municipalCategoryTitles[value] ?? value, (value) => update("category", value));
  quickFilterSelect(quick, "Published record type", "All record types", data.facets?.record_type, timelineFilters.record_type,
    (value) => value, (value) => update("record_type", value));
  quickFilterSelect(quick, "Published status", "All statuses", data.facets?.source_status, timelineFilters.source_status,
    (value) => value, (value) => update("source_status", value));
  quickAddressMatch(quick, timelineFilters.address_match, (value) => update("address_match", value));
  container.append(quick);
  if (filterCount(timelineFilters)) {
    const active = el("div", null, "active-filters");
    active.append(el("span", `${filterCount(timelineFilters)} applied`, "filter-count"));
    for (const key of ["category", "record_type", "source_id", "source_status", "event_date_from", "event_date_to", "address_match"])
      for (const value of Array.isArray(timelineFilters[key]) ? timelineFilters[key] : timelineFilters[key] ? [timelineFilters[key]] : []) {
        const chip = el("button", `${key.replaceAll("_", " ")}: ${value === true ? "yes" : value} ×`, "filter-chip");
        chip.type = "button";
        chip.onclick = () => {
          timelineFilters = { ...timelineFilters, [key]: Array.isArray(timelineFilters[key]) ? timelineFilters[key].filter((entry) => entry !== value) : key === "address_match" ? false : "" };
          saveDataUrl();
          void loadFeed(qs, version);
        };
        active.append(chip);
      }
    container.append(active);
  }
  const sourceCoverage = el("details", null, "sources-panel timeline-coverage");
  const issues = incompleteSources(data.sources);
  sourceCoverage.append(el("summary", `Timeline source coverage · ${data.sources.length} checks${issues.length ? ` · ${issues.length} incomplete` : ""}`));
  const sourceList = el("div", null, "source-list");
  for (const source of data.sources) sourceLine(sourceList, source);
  sourceCoverage.append(sourceList);
  container.append(sourceCoverage);
  if (issues.length)
    container.append(el("p", `Incomplete timeline checks: ${sourceIssueLabels(issues)}. Open Timeline source coverage for details.`, "source-warning"));
  const details = el("details", null, "filter-drawer");
  details.append(el("summary", `More filters${filterCount(timelineFilters) ? ` · ${filterCount(timelineFilters)} applied` : ""}`));
  const form = el("form", null, "filter-form");
  filterChoices(form, "category", "Record category", data.facets?.category, timelineFilters.category, (value) => municipalCategoryTitles[value] ?? value);
  filterChoices(form, "record_type", "Published record type", data.facets?.record_type, timelineFilters.record_type, (value) => value);
  filterChoices(form, "source_id", "Official source", data.facets?.source_id, timelineFilters.source_id, sourceName);
  filterChoices(form, "source_status", "Exact published status", data.facets?.source_status, timelineFilters.source_status, (value) => value);
  const dates = el("fieldset", null, "filter-fieldset filter-dates");
  dates.append(el("legend", "Source event date · inclusive"));
  for (const [key, title] of [["event_date_from", "From"], ["event_date_to", "Through"]]) {
    const label = el("label", title);
    const input = document.createElement("input");
    input.type = "date";
    input.name = key;
    input.value = timelineFilters[key] ?? "";
    label.append(input);
    dates.append(label);
  }
  form.append(dates);
  if (searchedAddress) {
    const label = el("label", null, "filter-choice");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "address_match";
    input.checked = timelineFilters.address_match;
    label.append(input, document.createTextNode(`Source address matches ${searchedAddress}`));
    form.append(label);
  }
  const apply = el("button", "Apply filters");
  apply.type = "submit";
  const clear = el("button", "Clear all", "secondary");
  clear.type = "button";
  clear.onclick = () => {
    timelineFilters = { category: [], record_type: [], source_id: [], source_status: [], event_date_from: "", event_date_to: "", address_match: false };
    saveDataUrl();
    void loadFeed(qs, version);
  };
  form.append(apply, clear);
  form.onsubmit = (event) => {
    event.preventDefault();
    const values = new FormData(form);
    timelineFilters = {
      category: values.getAll("category"), record_type: values.getAll("record_type"), source_id: values.getAll("source_id"), source_status: values.getAll("source_status"),
      event_date_from: values.get("event_date_from") ?? "", event_date_to: values.get("event_date_to") ?? "",
      address_match: values.has("address_match"),
    };
    saveDataUrl();
    void loadFeed(qs, version);
  };
  details.append(form);
  container.append(details);
}
function addFilterParams(params, filters) {
  for (const key of ["category", "record_type", "source_id", "display_group", "source_status"])
    for (const value of filters[key] ?? []) params.append(key, value);
  for (const key of ["event_date_from", "event_date_to"])
    if (filters[key]) params.set(key, filters[key]);
  if (filters.address_match) params.set("address_match", "true");
}
function filterCount(filters) {
  return ["category", "record_type", "source_id", "display_group", "source_status"]
    .reduce((count, key) => count + (filters[key]?.length ?? 0), 0) +
    Number(Boolean(filters.event_date_from)) + Number(Boolean(filters.event_date_to)) + Number(Boolean(filters.address_match));
}
function filterChoices(parent, key, title, values, selected, label) {
  if (!Object.keys(values ?? {}).length) return;
  const fieldset = el("fieldset", null, "filter-fieldset");
  fieldset.append(el("legend", title));
  for (const [value, count] of Object.entries(values)) {
    const row = el("label", null, "filter-choice");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = key;
    input.value = value;
    input.checked = selected.includes(value);
    row.append(input, document.createTextNode(`${label(value)} · ${count} returned`));
    fieldset.append(row);
  }
  parent.append(fieldset);
}
function renderFilters(id, data, qs, version) {
  const current = filterState(id);
  const container = el("div", null, "filters-area");
  const quick = el("div", null, "quick-filters");
  const update = (key, value) => {
    groupFilters.set(id, { ...current, [key]: value });
    saveDataUrl();
    void loadGroup(id, $(`group-${id}`), qs, version);
  };
  if (id !== "activity") quickFilterSelect(quick, "Published record type", "All record types",
    data.facets?.record_type, current.record_type, (value) => value, (value) => update("record_type", value));
  quickFilterSelect(quick, "Published status", "All statuses", data.facets?.source_status, current.source_status,
    (value) => value, (value) => update("source_status", value));
  quickAddressMatch(quick, current.address_match, (value) => update("address_match", value));
  container.append(quick);
  const active = el("div", null, "active-filters");
  const amount = filterCount(current);
  if (amount) {
    active.append(el("span", `${amount} applied`, "filter-count"));
    for (const key of ["category", "record_type", "source_id", "display_group", "source_status"])
      for (const value of current[key] ?? []) {
        const chip = el("button", `${key.replaceAll("_", " ")}: ${value} ×`, "filter-chip");
        chip.type = "button";
        chip.setAttribute("aria-label", `Remove ${key.replaceAll("_", " ")} filter ${value}`);
        chip.onclick = () => {
          groupFilters.set(id, { ...current, [key]: current[key].filter((entry) => entry !== value) });
          saveDataUrl();
          void loadGroup(id, $(`group-${id}`), qs, version);
        };
        active.append(chip);
      }
    for (const key of ["event_date_from", "event_date_to", "address_match"])
      if (current[key]) {
        const chip = el("button", `${key.replaceAll("_", " ")}: ${current[key] === true ? "yes" : current[key]} ×`, "filter-chip");
        chip.type = "button";
        chip.onclick = () => {
          groupFilters.set(id, { ...current, [key]: key === "address_match" ? false : "" });
          saveDataUrl();
          void loadGroup(id, $(`group-${id}`), qs, version);
        };
        active.append(chip);
      }
    const clear = el("button", "Clear all", "filter-clear");
    clear.type = "button";
    clear.onclick = () => { groupFilters.delete(id); saveDataUrl(); void loadGroup(id, $(`group-${id}`), qs, version); };
    active.append(clear);
  }
  container.append(active);
  const details = el("details", null, "filter-drawer");
  details.append(el("summary", `More filters${amount ? ` · ${amount} applied` : ""}`));
  const form = el("form", null, "filter-form");
  filterChoices(form, "category", "Record category", data.facets?.category, current.category, (value) => municipalCategoryTitles[value] ?? value);
  filterChoices(form, "record_type", "Published record type", data.facets?.record_type, current.record_type, (value) => value);
  filterChoices(form, "source_id", "Official source", data.facets?.source_id, current.source_id, sourceName);
  if (["activity", "business", "ownership"].includes(id)) {
    const definitions = new Map((data.display_groups ?? []).map((entry) => [entry.key, entry.title]));
    filterChoices(form, "display_group", id === "ownership" ? "Ownership section" : "Published status reading group", data.facets?.display_group, current.display_group, (value) => definitions.get(value) ?? value);
  }
  filterChoices(form, "source_status", "Exact published status", data.facets?.source_status, current.source_status, (value) => value);
  const dates = el("fieldset", null, "filter-fieldset filter-dates");
  dates.append(el("legend", "Source event date · inclusive"));
  for (const [key, title] of [["event_date_from", "From"], ["event_date_to", "Through"]]) {
    const label = el("label", title);
    const input = document.createElement("input");
    input.type = "date";
    input.name = key;
    input.value = current[key] ?? "";
    label.append(input);
    dates.append(label);
  }
  dates.append(el("p", `${data.facets?.undated ?? 0} returned rows have no event date; a date range excludes them.`, "meta"));
  form.append(dates);
  const submit = el("button", "Apply filters");
  submit.type = "submit";
  form.append(submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const filters = Object.fromEntries(["category", "record_type", "source_id", "display_group", "source_status"].map((key) => [key, values.getAll(key)]));
    filters.event_date_from = values.get("event_date_from") ?? "";
    filters.event_date_to = values.get("event_date_to") ?? "";
    filters.address_match = current.address_match;
    groupFilters.set(id, filters);
    saveDataUrl();
    void loadGroup(id, $(`group-${id}`), qs, version);
  });
  details.append(form);
  container.append(details);
  return container;
}
function kindTitle(key, data) {
  if (key.startsWith("source:")) return sourceName(key.slice(7));
  return data.display_groups?.find((entry) => entry.key === key)?.title ?? municipalCategoryTitles[key] ?? key;
}
function kindKey(item, id) {
  return id === "ownership" ? item.display_group?.key ?? "unclassified" : item.category ?? `source:${item.source_id}`;
}
function orderedKinds(id, facets) {
  const preferred = id === "ownership"
    ? ["owner_names", "owner_registry", "owner_history", "unclassified"]
    : id === "business" ? ["License", "Permit", "Occupant"]
      : ["Permit", "License", "Application", "Complaint", "Contact", "Document", "Certificate", "Occupant"];
  return Object.keys(facets?.kind ?? {}).sort((a, b) => {
    const aRank = preferred.indexOf(a);
    const bRank = preferred.indexOf(b);
    return (aRank < 0 ? preferred.length : aRank) - (bRank < 0 ? preferred.length : bRank) || a.localeCompare(b);
  });
}
function renderCategoryIndex(parent, id, data, qs, version) {
  if (!["activity", "business", "ownership"].includes(id)) return;
  const index = el("nav", null, "category-index");
  index.setAttribute("aria-label", `${groups.find(([key]) => key === id)?.[1] ?? id} categories`);
  const all = el("button", "All categories", "category-button");
  all.type = "button";
  const currentSelection = filterState(id);
  all.setAttribute("aria-pressed", String(!currentSelection.category.length && !currentSelection.source_id.length && !currentSelection.display_group.length));
  all.onclick = () => {
    const current = filterState(id);
    groupFilters.set(id, { ...current, category: [], source_id: [], display_group: [] });
    saveDataUrl();
    void loadGroup(id, $(`group-${id}`), qs, version);
  };
  index.append(all);
  for (const key of orderedKinds(id, data.facets)) {
    const count = data.facets.kind[key];
    const button = el("button", `${kindTitle(key, data)} · ${count}`, "category-button");
    button.type = "button";
    button.setAttribute("aria-pressed", String(id === "ownership" ? currentSelection.display_group.includes(key) :
      key.startsWith("source:") ? currentSelection.source_id.includes(key.slice(7)) : currentSelection.category.includes(key)));
    button.onclick = () => {
      const current = filterState(id);
      const next = { ...current, category: [], source_id: [], display_group: [] };
      if (id === "ownership") next.display_group = [key];
      else if (key.startsWith("source:")) next.source_id = [key.slice(7)];
      else next.category = [key];
      groupFilters.set(id, next);
      saveDataUrl();
      void loadGroup(id, $(`group-${id}`), qs, version);
    };
    index.append(button);
  }
  parent.append(index);
}
function prepareHierarchy(parent, id, data) {
  const state = { id, data, categories: new Map() };
  displayTargets.set(parent, state);
  const filters = filterState(id);
  const keys = orderedKinds(id, data.facets).filter((key) =>
    (id === "ownership" ? !filters.display_group.length || filters.display_group.includes(key) :
      (!filters.category.length || filters.category.includes(key)) &&
      (!filters.source_id.length || !key.startsWith("source:") || filters.source_id.includes(key.slice(7)))));
  for (const key of keys) {
    const category = el("section", null, "record-category");
    category.hidden = true;
    const heading = el("div", null, "record-category-heading");
    const countNode = el("span", `0 shown · ${data.facets.kind[key]} returned`, "group-count");
    heading.append(el("h3", kindTitle(key, data)), countNode);
    category.append(heading);
    parent.append(category);
    state.categories.set(key, { category, countNode, count: 0, statuses: new Map() });
  }
}
function appendHierarchicalRecord(parent, item) {
  const state = displayTargets.get(parent);
  const key = kindKey(item, state.id);
  const target = state.categories.get(key);
  if (!target) return;
  target.category.hidden = false;
  target.count += 1;
  target.countNode.textContent = `${target.count} shown · ${state.data.facets.kind[key]} returned`;
  if (state.id === "ownership") {
    let list = target.statuses.get("all");
    if (!list) {
      list = el("div", null, "record-list");
      target.category.append(list);
      target.statuses.set("all", list);
    }
    appendRecord(list, item);
    return;
  }
  const statusKey = item.display_group?.key ?? "unclassified";
  let status = target.statuses.get(statusKey);
  if (!status) {
    const section = el("section", null, "status-section");
    const name = state.data.display_groups?.find((entry) => entry.key === statusKey)?.title ?? "Status not stated";
    const count = state.data.facets?.kind_display_group?.[key]?.[statusKey] ?? 0;
    const heading = el("h4", `${name} · 0 shown · ${count} returned`);
    section.append(heading);
    const list = el("div", null, "record-list");
    section.append(list);
    target.category.append(section);
    status = { list, heading, name, count, shown: 0 };
    target.statuses.set(statusKey, status);
  }
  status.shown += 1;
  status.heading.textContent = `${status.name} · ${status.shown} shown · ${status.count} returned`;
  appendRecord(status.list, item);
}
async function loadGroup(id, section, qs, version, cursor = null) {
  const generation = cursor ? groupLoadVersions.get(id) : (groupLoadVersions.set(id, (groupLoadVersions.get(id) ?? 0) + 1), groupLoadVersions.get(id));
  if (!cursor) section.replaceChildren(el("p", "Loading returned records and source coverage…", "meta"));
  try {
    const p = new URLSearchParams(qs);
    p.set("group", id);
    p.set("limit", "50");
    addFilterParams(p, filterState(id));
    if (cursor) p.set("cursor", cursor);
    const data = await api(`/api/v1/records?${p}`);
    if (version !== viewVersion || generation !== groupLoadVersions.get(id)) return;
    if (!cursor) {
      const definition = groups.find((group) => group[0] === id);
      section.replaceChildren();
      const heading = el("div", null, "group-heading");
      heading.append(el("h2", definition[1]));
      heading.append(el("span", null, "group-count"));
      section.append(heading);
      if (id !== "activity") section.append(el("p", definition[2], "group-intro"));
      renderCategoryIndex(section, id, data, qs, version);
      section.append(renderFilters(id, data, qs, version));
      const coverage = el("details", null, "sources-panel");
      const issues = incompleteSources(data.sources);
      const notIntegrated = data.sources.filter((source) => source.status === "not_integrated").length;
      const notLinked = data.sources.filter((source) => source.status === "not_linked").length;
      coverage.append(el("summary", `Source coverage · ${data.sources.length - notIntegrated - notLinked} live checks${issues.length ? ` · ${issues.length} incomplete` : ""}${notIntegrated ? ` · ${notIntegrated} not integrated` : ""}${notLinked ? ` · ${notLinked} not linked` : ""}`));
      const sourceList = el("div", null, "source-list");
      for (const source of data.sources) sourceLine(sourceList, source);
      coverage.append(sourceList);
      section.append(coverage);
      const grouped = ["activity", "business", "ownership"].includes(id);
      const records = el("div", null, grouped ? "activity-sections" : "record-list");
      records.id = `records-${id}`;
      section.append(records);
      if (grouped) prepareHierarchy(records, id, data);
      if (!data.items.length)
        section.append(el("p", "No returned records match these filters. Review source coverage for gaps.", "empty-state"));
    }
    const records = $(`records-${id}`);
    for (const item of data.items) {
      if (["activity", "business", "ownership"].includes(id)) appendHierarchicalRecord(records, item);
      else appendRecord(records, item);
    }
    const shown = records.querySelectorAll(".record-card").length;
    const count = section.querySelector(".group-heading .group-count");
    if (count) count.textContent = `Showing ${shown} of ${data.total} ${data.total === data.returned_total ? "returned records" : "matching records"}`;
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
    if (version !== viewVersion || generation !== groupLoadVersions.get(id)) return;
    loadedGroups.delete(id);
    section.append(
      el("p", `Could not load this group: ${error.message}`, "meta"),
    );
    const retry = el("button", "Retry group", "secondary");
    retry.type = "button";
    retry.onclick = () => showDataSection(id, false);
    section.append(retry);
  }
}
function appendTimelineEvent(parent, item) {
  const entry = el("li", null, "timeline-entry");
  entry.append(eventDateBlock(item, "timeline-event-date"));
  const content = el("div", null, "timeline-content");
  const kind = item.category === "Document"
    ? eventDateLabel(item) === "Modified date" ? "Document modified" : "Document record"
    : item.category === "Occupant"
        ? eventDateLabel(item) === "Created date" ? "Occupant record created" : "Occupant record"
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
  const generation = cursor ? feedLoadVersion : ++feedLoadVersion;
  if (!cursor) {
    $("timeline-filters").replaceChildren(el("p", "Loading dated records and source coverage…", "meta"));
    $("feed").replaceChildren();
  }
  try {
    const p = new URLSearchParams(qs);
    addFilterParams(p, timelineFilters);
    if (cursor) p.set("cursor", cursor);
    const data = await api(`/api/v1/feed?${p}`);
    if (version !== viewVersion || generation !== feedLoadVersion) return;
    if (!cursor) {
      $("feed").replaceChildren();
      renderTimelineFilters(data, qs, version);
    }
    for (const item of data.items) appendTimelineEvent($("feed"), item);
    timelineReturnedCount = data.returned_total;
    updateDataNavCounts();
    const summary = $("timeline-result-count");
    if (summary) summary.textContent = `${$("feed").querySelectorAll(".timeline-entry").length} shown of ${data.total} matching dated rows · ${data.returned_total} returned by sources`;
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
    if (version === viewVersion && generation === feedLoadVersion) {
      feedLoaded = false;
      const notice = el("li", `Could not load the timeline: ${error.message}`, "timeline-note");
      const retry = el("button", "Retry timeline", "secondary");
      retry.type = "button";
      retry.onclick = () => showDataSection("timeline", false);
      notice.append(retry);
      $("feed").append(notice);
    }
  }
}
$("search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  closeNearbyBusinessResearch();
  closeStorefrontOpportunity();
  maplessRecords = false;
  document.body.classList.remove("record-only-mode");
  const version = ++viewVersion;
  selected = null;
  resetMap();
  $("record-content").hidden = true;
  requestedParcelKey = null;
  $("parcel-photo").hidden = true;
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
$("records-tab").addEventListener("click", () => showExplorerTab("records"));
$("browse-tab").addEventListener("click", () => showExplorerTab("browse"));
$("activity-tab").addEventListener("click", () => showExplorerTab("activity"));
$("guide-tab").addEventListener("click", () => showExplorerTab("guide"));
$("ask-tab").addEventListener("click", () => showExplorerTab("ask"));
$("browse-open-records").addEventListener("click", () => {
  if (!selected || requestedParcelKey !== parcelKey(selected)) return;
  showExplorerTab("records", { noMap: true });
  void loadHeroPhoto(selectedQuery(), viewVersion);
  navigateDataSection(activeDataSection);
});

function closeNearbyBusinessResearch() {
  const panel = $("nearby-business-research");
  if (!panel || panel.hidden) return;
  nearbyBusinessRequest?.abort();
  nearbyBusinessRequest = null;
  panel.hidden = true;
  $("nearby-business-open").setAttribute("aria-expanded", "false");
  $("nearby-business-result").replaceChildren();
  $("nearby-business-result").hidden = true;
}

const nearbyBusinessGroup = $("nearby-business-category");
const nearbyBusinessTypeFilter = $("nearby-business-type-filter");
const nearbyBusinessTypeList = $("nearby-business-type-list");
const nearbyBusinessTypeCatalog = new Map(
  Array.from($("nearby-business-type-catalog")?.content.children ?? [], (group) => [group.dataset.group, group]),
);

function normalizedBusinessType(value) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function filterNearbyBusinessTypes() {
  const words = normalizedBusinessType(nearbyBusinessTypeFilter.value).split(" ").filter(Boolean);
  let matched = false;
  for (const choice of nearbyBusinessTypeList.children) {
    const searchText = normalizedBusinessType(`${choice.textContent} ${choice.firstElementChild.value}`);
    choice.hidden = !words.every((word) => searchText.includes(word));
    if (!choice.hidden) matched = true;
  }
  $("nearby-business-no-types").hidden = matched;
}

function checkedNearbyBusinessTypes() {
  return [...nearbyBusinessTypeList.querySelectorAll("input:checked")];
}

function updateNearbyBusinessSelection() {
  const count = checkedNearbyBusinessTypes().length;
  $("nearby-business-selection").textContent = count ? `${count} selected` : "All types";
  $("nearby-business-clear-types").hidden = count === 0;
}

function resetNearbyBusinessTypes() {
  const options = nearbyBusinessTypeCatalog.get(nearbyBusinessGroup.value);
  nearbyBusinessTypeList.replaceChildren(...options.cloneNode(true).children);
  nearbyBusinessTypeFilter.value = "";
  filterNearbyBusinessTypes();
  updateNearbyBusinessSelection();
}

function updateNearbyBusinessCountButton(form) {
  $("nearby-business-count").disabled = !nearbyBusinessConfigured ||
    !form.elements.origin.value || !nearbyBusinessGroup.value;
}

function clearNearbyBusinessResults(form) {
  $("nearby-business-result").replaceChildren();
  $("nearby-business-result").hidden = true;
  updateNearbyBusinessCountButton(form);
  if (nearbyBusinessConfigured) $("nearby-business-status").textContent = "";
}

nearbyBusinessTypeFilter?.addEventListener("input", filterNearbyBusinessTypes);
nearbyBusinessTypeFilter?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  nearbyBusinessTypeList.querySelector("label:not([hidden]) input")?.focus();
});
$("nearby-business-clear-types")?.addEventListener("click", () => {
  for (const choice of checkedNearbyBusinessTypes()) choice.checked = false;
  nearbyBusinessTypeFilter.focus();
  updateNearbyBusinessSelection();
  clearNearbyBusinessResults(nearbyBusinessGroup.form);
});

async function openNearbyBusinessResearch() {
  if (!selected || requestedParcelKey !== parcelKey(selected)) return;
  const panel = $("nearby-business-research");
  if (!panel.hidden) {
    closeNearbyBusinessResearch();
    return;
  }
  closeStorefrontOpportunity();
  showExplorerTab("records", { noMap: true });
  showDataSection("overview");
  panel.hidden = false;
  $("nearby-business-open").setAttribute("aria-expanded", "true");
  $("nearby-business-title").focus();
  const form = $("nearby-business-form");
  form.reset();
  $("nearby-business-subcategories").open = false;
  resetNearbyBusinessTypes();
  const origin = form.elements.origin;
  origin.replaceChildren(new Option("Choose a City address or parcel center", ""));
  const status = $("nearby-business-status");
  const note = $("nearby-business-origin-note");
  note.hidden = true;
  status.textContent = "Checking City address points…";
  nearbyBusinessConfigured = false;
  $("nearby-business-fields").disabled = true;
  $("nearby-business-count").disabled = true;
  const request = new AbortController();
  nearbyBusinessRequest = request;
  try {
    const data = await api(`/api/v1/nearby-business-count?${selectedQuery()}`, { signal: request.signal });
    if (request !== nearbyBusinessRequest) return;
    for (const choice of data.origins) {
      const repeated = choice.address && data.origins.filter(({ address }) => address === choice.address).length > 1;
      const label = repeated ? `${choice.address} · City point ${choice.objectid}` : choice.address ?? "City parcel's mapped center";
      origin.add(new Option(label, choice.id));
    }
    origin.value = data.default_origin ?? "";
    nearbyBusinessConfigured = data.configured;
    note.textContent = data.warning ?? (!origin.value && searchedAddress
      ? `A City point for ${searchedAddress} could not be verified. Choose a published address from this parcel.`
      : "The search uses a straight-line radius.");
    note.hidden = false;
    status.textContent = !data.configured ? "Live place counts are awaiting a Places Aggregate API key for this Preview."
      : !data.origins.length ? "No verified City address point is available for this search." : "";
    updateNearbyBusinessCountButton(form);
  } catch (error) {
    if (request === nearbyBusinessRequest) status.textContent = error.message;
  } finally {
    if (request === nearbyBusinessRequest) {
      nearbyBusinessRequest = null;
      $("nearby-business-fields").disabled = false;
    }
  }
}
$("nearby-business-open")?.addEventListener("click", () => void openNearbyBusinessResearch());

$("nearby-business-form")?.addEventListener("change", (event) => {
  if (event.target === nearbyBusinessTypeFilter) return;
  if (event.target === nearbyBusinessGroup) resetNearbyBusinessTypes();
  if (event.target.name === "subcategory") updateNearbyBusinessSelection();
  clearNearbyBusinessResults(event.currentTarget);
});

function offerNearbyBusinessMatches(output, count, search) {
  const matchLimit = Number($("nearby-business-research").dataset.matchLimit);
  const refine = `Google Maps provides names for searches with ${matchLimit} matches or fewer. Try a smaller radius.`;
  if (count === 0) return;
  if (count > matchLimit) {
    output.append(el("p", refine, "meta"));
    return;
  }
  const list = el("ul", null, "nearby-business-matches");
  list.setAttribute("aria-label", "Matching places from Google Maps");
  list.hidden = true;
  const matchStatus = el("p", null, "meta");
  matchStatus.setAttribute("role", "status");
  matchStatus.tabIndex = -1;
  const button = el("button", "Show matching places", "secondary");
  button.type = "button";
  button.classList.add("nearby-business-match-button");
  output.append(matchStatus, list, button);
  let cursor;
  let unavailable = 0;
  button.addEventListener("click", async () => {
    if (nearbyBusinessRequest || !maplessRecords || output.hidden || !button.isConnected) return;
    const request = new AbortController();
    nearbyBusinessRequest = request;
    $("nearby-business-fields").disabled = true;
    button.disabled = true;
    matchStatus.textContent = "Loading matching places…";
    try {
      const data = await api("/api/v1/nearby-business-matches", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: request.signal,
        body: JSON.stringify({ ...search, cursor }),
      });
      if (request !== nearbyBusinessRequest) return;
      if (data.status === "above_limit") {
        matchStatus.textContent = `Google Maps now lists ${data.count} matches. ${refine}`;
        button.hidden = true;
        matchStatus.focus();
        return;
      }
      for (const place of data.results) {
        const row = el("li");
        const name = el("div");
        name.append(el("strong", place.name));
        if (place.address) name.append(el("span", place.address, "meta"));
        const maps = link(place.maps_url, "Open in Google Maps");
        maps.setAttribute("aria-label", `Open ${place.name} in Google Maps`);
        row.append(name, maps);
        list.append(row);
      }
      const displayed = list.children.length;
      list.hidden = displayed === 0;
      unavailable += data.unavailable;
      const missing = unavailable + data.missing_matches;
      matchStatus.textContent = data.count === 0 ? "Google Maps currently lists no matching places for this search."
        : `Showing ${displayed} of ${data.count} Google Maps matches.${missing ? ` Details unavailable for ${missing}.` : ""}`;
      cursor = data.next_cursor;
      button.textContent = "Load more places";
      button.hidden = !cursor;
      if (button.hidden) matchStatus.focus();
    } catch (error) {
      if (request === nearbyBusinessRequest) matchStatus.textContent = error.message;
    } finally {
      if (request === nearbyBusinessRequest) {
        nearbyBusinessRequest = null;
        $("nearby-business-fields").disabled = false;
        button.disabled = false;
      }
    }
  });
}

$("nearby-business-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!maplessRecords || $("nearby-business-research").hidden || nearbyBusinessRequest || !nearbyBusinessConfigured) return;
  const form = event.currentTarget;
  const { origin, group, radius_meters } = form.elements;
  if (!origin.value || !group.value || !selected) return;
  const types = checkedNearbyBusinessTypes();
  const request = new AbortController();
  nearbyBusinessRequest = request;
  const status = $("nearby-business-status");
  const output = $("nearby-business-result");
  output.replaceChildren();
  output.hidden = true;
  status.textContent = "Counting Google Maps listings…";
  $("nearby-business-fields").disabled = true;
  try {
    const search = { ...Object.fromEntries(selectedQuery()), origin: origin.value,
      group: group.value, subcategories: types.map((type) => type.value), radius_meters: Number(radius_meters.value) };
    const data = await api("/api/v1/nearby-business-count", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: request.signal,
      body: JSON.stringify(search),
    });
    if (request !== nearbyBusinessRequest) return;
    const heading = el("p", data.count === 1 ? "matching place" : "matching places", "nearby-business-result-heading");
    heading.prepend(el("strong", `${data.count} `));
    const scope = el("p", `${data.category_label} · ${types.map((type) => type.nextElementSibling.textContent).join(", ") || "All types"}`, "meta");
    const originLabel = data.origin.address ?? "the City parcel's mapped center";
    const detail = el("p", `Listed by Google Maps within ${data.radius_label} of ${originLabel}.`);
    const source = el("p", null, "meta");
    const checked = new Date(data.retrieved_at);
    const time = el("time", new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York",
    }).format(checked));
    time.dateTime = data.retrieved_at;
    source.append(link(data.source_url, data.attribution), document.createTextNode(" · Checked "), time);
    output.replaceChildren(heading, scope, detail, source);
    offerNearbyBusinessMatches(output, data.count, search);
    output.hidden = false;
    status.textContent = "";
  } catch (error) {
    if (request === nearbyBusinessRequest) status.textContent = error.message;
  } finally {
    if (request === nearbyBusinessRequest) {
      nearbyBusinessRequest = null;
      $("nearby-business-fields").disabled = false;
    }
  }
});

let storefrontRequest = null;
let storefrontConfigured = false;
let storefrontHalfMileConfigured = false;

function closeStorefrontOpportunity() {
  const panel = $("storefront-opportunity");
  if (!panel || panel.hidden) return;
  storefrontRequest?.abort();
  storefrontRequest = null;
  storefrontConfigured = false;
  storefrontHalfMileConfigured = false;
  panel.hidden = true;
  $("storefront-opportunity-open").setAttribute("aria-expanded", "false");
  $("storefront-report").replaceChildren();
  $("storefront-report").hidden = true;
}

function updateStorefrontRun(form) {
  const ready = form.elements.origin.value && form.elements.confirmed_vacancy.checked;
  $("storefront-run").disabled = !storefrontConfigured || !ready;
  $("storefront-half-mile").disabled = !storefrontHalfMileConfigured || !ready;
}

$("storefront-opportunity-open")?.addEventListener("click", async () => {
  if (!selected || requestedParcelKey !== parcelKey(selected)) return;
  const panel = $("storefront-opportunity");
  if (!panel.hidden) {
    closeStorefrontOpportunity();
    return;
  }
  closeNearbyBusinessResearch();
  showExplorerTab("records", { noMap: true });
  showDataSection("overview");
  panel.hidden = false;
  $("storefront-opportunity-open").setAttribute("aria-expanded", "true");
  $("storefront-opportunity-title").focus();
  const form = $("storefront-opportunity-form");
  form.reset();
  form.elements.storefront_sq_ft.required = false;
  form.querySelector("details").open = false;
  const origin = form.elements.origin;
  origin.replaceChildren(new Option("Choose a City address", ""));
  const status = $("storefront-status");
  const checks = $("storefront-space-checks");
  checks.replaceChildren();
  storefrontConfigured = false;
  storefrontHalfMileConfigured = false;
  $("storefront-walking-options").hidden = true;
  $("storefront-half-mile").hidden = true;
  updateStorefrontRun(form);
  $("storefront-opportunity-fields").disabled = true;
  status.textContent = "Checking City address points…";
  const request = new AbortController();
  storefrontRequest = request;
  try {
    const data = await api(`/api/v1/parcel-opportunity?${selectedQuery()}`, { signal: request.signal });
    if (storefrontRequest !== request) return;
    for (const point of data.origins) {
      const repeated = data.origins.filter(({ address }) => address === point.address).length > 1;
      origin.add(new Option(repeated ? `${point.address} · City point ${point.objectid}` : point.address, point.id));
    }
    origin.value = data.default_origin ?? "";
    for (const option of data.space_checks) {
      const label = el("label", null, "storefront-check");
      const checkbox = el("input");
      checkbox.type = "checkbox";
      checkbox.name = "space_checked_for";
      checkbox.value = option.id;
      label.append(checkbox, document.createTextNode(option.label));
      checks.append(label);
    }
    storefrontConfigured = data.configured;
    storefrontHalfMileConfigured = data.half_mile_available;
    $("storefront-walking-options").hidden = !data.configured;
    $("storefront-half-mile").hidden = !storefrontHalfMileConfigured;
    status.textContent = !data.origins.length
      ? data.warning ?? "No verified City street address is available for this parcel."
      : storefrontHalfMileConfigured ? "" : "Neighborhood analysis is awaiting the Preview Google Places Aggregate key.";
    updateStorefrontRun(form);
  } catch (error) {
    if (storefrontRequest === request) status.textContent = error.message;
  } finally {
    if (storefrontRequest === request) {
      storefrontRequest = null;
      $("storefront-opportunity-fields").disabled = false;
    }
  }
});

$("storefront-opportunity-form")?.addEventListener("change", (event) => {
  const form = event.currentTarget;
  const selectedChecks = form.querySelector('input[name="space_checked_for"]:checked');
  const area = form.elements.storefront_sq_ft;
  area.required = Boolean(selectedChecks);
  if (area.required && !area.validity.valid) form.querySelector("details").open = true;
  $("storefront-report").replaceChildren();
  $("storefront-report").hidden = true;
  updateStorefrontRun(form);
});

$("storefront-opportunity-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const halfMile = event.submitter?.value === "half_mile";
  if (storefrontRequest || !(halfMile ? storefrontHalfMileConfigured : storefrontConfigured) || !selected ||
      $("storefront-opportunity").hidden || !maplessRecords) return;
  const form = event.currentTarget;
  const { elements } = form;
  if (!elements.origin.value || !elements.confirmed_vacancy.checked) return;
  const payload = {
    ...Object.fromEntries(selectedQuery()), origin: elements.origin.value, confirmed_vacancy: true,
  };
  if (halfMile) payload.mode = "half_mile";
  else {
    const area = elements.storefront_sq_ft.valueAsNumber;
    payload.storefront_sq_ft = Number.isFinite(area) ? area : undefined;
    payload.space_checked_for = [...form.querySelectorAll('input[name="space_checked_for"]:checked')]
      .map(({ value }) => value);
  }
  const request = new AbortController();
  storefrontRequest = request;
  const status = $("storefront-status");
  const report = $("storefront-report");
  report.hidden = true;
  status.textContent = halfMile ? "Checking each category within ½ mile…" : "Calculating walking areas and checking nearby places…";
  $("storefront-opportunity-fields").disabled = true;
  try {
    const [{ renderStorefrontReport, renderHalfMileReport }, data] = await Promise.all([
      import("/storefront-opportunity.js"),
      api("/api/v1/parcel-opportunity", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: request.signal,
        body: JSON.stringify(payload),
      }),
    ]);
    if (storefrontRequest !== request) return;
    const render = halfMile ? renderHalfMileReport : renderStorefrontReport;
    render(report, data, { el, link, sourceNames });
    report.hidden = false;
    status.textContent = "";
  } catch (error) {
    if (storefrontRequest === request) status.textContent = error.message;
  } finally {
    if (storefrontRequest === request) {
      storefrontRequest = null;
      $("storefront-opportunity-fields").disabled = false;
    }
  }
});

function queryExplorer() {
  queryModule ??= import("/query-explorer.js").then((module) => ({
    ...module,
    explorer: module.createQueryExplorer({
      api, el, link, schema: async () => guideData ??= await api("/api/v1/schema"),
      openTest: () => { showExplorerTab("ask"); void setAskMode("fields", true); },
      openQuestion: (question) => {
        showExplorerTab("ask");
        void setAskMode("language", true);
        $("ask-question").value = question;
        $("ask-question").focus();
      },
      run: (method, args) => void runFieldSearch(method, args),
    }),
  })).catch((error) => { queryModule = null; throw error; });
  return queryModule;
}
async function setAskMode(mode, fromGuide = false) {
  if ($("ask-tab").hidden || (mode === askMode && !fromGuide)) return;
  askMode = mode;
  askVersion++;
  const structured = mode === "fields";
  $("ask-language-mode").setAttribute("aria-pressed", String(!structured));
  $("ask-fields-mode").setAttribute("aria-pressed", String(structured));
  $("ask-language").hidden = structured;
  $("ask-structured").hidden = !structured;
  clearAskResult();
  setAskStatus("");
  if (!structured) return;
  try {
    const { explorer } = await queryExplorer();
    if (askMode !== "fields") return;
    await explorer.renderWorkbench($("ask-structured"));
    if (fromGuide && askMode === "fields") $("ask-structured").querySelector("select")?.focus();
  } catch (error) { setAskStatus(error.message, "unavailable"); }
}
$("ask-query-guide").addEventListener("click", (event) => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  showExplorerTab("guide", { section: "query-explorer" });
});
$("ask-language-mode").addEventListener("click", () => void setAskMode("language"));
$("ask-fields-mode").addEventListener("click", () => void setAskMode("fields"));

function renderAskContext(entries = []) {
  const target = $("ask-context");
  target.replaceChildren();
  target.hidden = !entries.length;
  if (!entries.length) return;
  target.append(el("h2", "How to read this data"));
  for (const entry of entries) {
    const row = el("div", null, "ask-context-row");
    row.append(el("h3", entry.term), el("p", entry.source_fact),
      el("p", entry.reading_rule, "meta"), link(entry.official_source_url, "Official source"));
    target.append(row);
  }
}
function renderAskCoverage(result) {
  const target = $("ask-coverage");
  target.replaceChildren();
  const coverage = result?.coverage;
  const checks = [...(coverage?.source_checks ?? []), ...(coverage?.live_source_checks ?? [])];
  target.hidden = !checks.length && !coverage?.note && !coverage?.interpretation_warning;
  if (target.hidden) return;
  target.append(el("h2", "Source coverage"));
  if (coverage?.interpretation_warning) target.append(el("p", coverage.interpretation_warning, "source-warning"));
  if (coverage?.earlier_page_incomplete)
    target.append(el("p", "Some records on earlier pages had incomplete checks.", "meta"));
  for (const check of checks) {
    const permitType = check.scope_key?.startsWith("permit-type:") ? check.scope_key.slice("permit-type:".length) : null;
    const label = [sourceNames[check.source_id] ?? check.source_id, permitType].filter(Boolean).join(" · ");
    const line = el("p", `${label}: ${check.status}`, "ask-source-check");
    if (check.returned_count != null && Number.isFinite(Number(check.returned_count)))
      line.append(el("span", ` · ${check.returned_count} source records`));
    if (Number(check.unlinked_count) > 0)
      line.append(el("strong", ` · ${check.unlinked_count} without a verified parcel link`));
    if (Number(check.ambiguous_count) > 0)
      line.append(el("strong", ` · ${check.ambiguous_count} ambiguous links`));
    if (check.finished_at) line.append(el("span", ` · checked ${new Date(check.finished_at).toLocaleString()}`));
    if (check.coverage_date_from && check.coverage_date_to)
      line.append(el("span", ` · checked window ${check.coverage_date_from} through ${check.coverage_date_to}`));
    if (check.latest_attempt_warning) line.append(el("span", ` · ${check.latest_attempt_warning}`));
    else if (check.warning) line.append(el("span", ` · ${check.warning}`));
    else if (check.date_covered === false) line.append(el("span", " · requested dates are outside this source run"));
    target.append(line);
  }
  if (coverage?.permit_date_from && coverage?.permit_date_to)
    target.append(el("p", `Parent PermitDate window · ${coverage.permit_date_from} through ${coverage.permit_date_to}`, "meta"));
  if (coverage?.type_inventory?.gaps) target.append(el("p",
    Object.entries(coverage.type_inventory.gaps).map(([kind, count]) => `${kind} gaps: ${count}`).join(" · "), "meta"));
  if (coverage?.cumulative) {
    const checked = coverage.cumulative;
    target.append(el("p", `${checked.scanned} permits checked · ${checked.detail_failed} detail checks unavailable · ${coverage.remaining_candidate_permits} candidates remaining`, "meta"));
  }
  if (coverage?.note || result.note) target.append(el("p", coverage?.note ?? result.note, "meta"));
  target.append(el("p", result.complete_for_query
    ? "All required source checks are complete through the last result page."
    : "Review incomplete source checks and any remaining pages before relying on the result.", "meta"));
}
function appendProjectedRecords(parent, match) {
  const group = el("details", null, "query-projected-group");
  if (match.source_id === "permit-contacts" || match.matching_record_count <= 3) group.open = true;
  group.append(el("summary", `${sourceNames[match.source_id] ?? match.source_id} · ${match.matching_record_count} returned`));
  const list = el("ul", null, "query-projected-records");
  for (const record of match.records) {
    const row = el("li");
    const fields = record.fields ?? {};
    const title = fields.Fullname ?? fields.CompanyName ?? fields.BusinessName ?? fields.business ??
      fields.PermitNo ?? record.permit_number ?? record.published_type ?? record.address ?? `Record ${record.record_id}`;
    const head = el("p");
    head.append(el("strong", title));
    for (const value of [record.published_role, record.published_type, record.published_status]
      .filter((value) => value && value !== title)) head.append(document.createTextNode(` · ${value}`));
    if (record.event_date) head.append(el("strong",
      ` · ${record.date_field ? `${record.date_field} ` : ""}${String(record.event_date).slice(0, 10)}`, "ask-date"));
    row.append(head);
    const values = Object.entries(fields).filter(([, value]) => value != null && value !== "");
    if (values.length) {
      const dl = el("dl", null, "query-projected-fields");
      for (const [field, value] of values) {
        const label = match.source_id === "school-attendance" ? {
          k8_school: "K–8 attendance zone", high_school: "High-school attendance zone",
        }[field] : null;
        dl.append(el("dt", label ?? field), el("dd", typeof value === "object" ? JSON.stringify(value) : value));
      }
      row.append(dl);
    }
    if (record.permit_description_as_published)
      row.append(el("p", record.permit_description_as_published, "meta"));
    const evidence = el("p", null, "meta");
    if (record.source_url) evidence.append(link(record.source_url, "Official record"));
    if (record.permit_source_url && record.permit_source_url !== record.source_url)
      evidence.append(document.createTextNode(" · "), link(record.permit_source_url, "Linked permit"));
    if (record.match || record.match_methods?.length) evidence.append(document.createTextNode(
      ` · ${record.match?.method ?? record.match_methods.join(", ")}`));
    if (record.address_evidence?.matches_query) evidence.append(document.createTextNode(" · Exact searched address"));
    if (record.source_snapshot_retrieved_at) evidence.append(document.createTextNode(
      ` · Official snapshot ${record.source_snapshot_retrieved_at.slice(0, 10)}`));
    if (evidence.textContent) row.append(evidence);
    list.append(row);
  }
  if (!match.records.length) group.append(el("p", "No records returned for this parcel.", "meta"));
  else group.append(list);
  parent.append(group);
}
function appendAskItems(items = []) {
  for (const item of items) {
    const li = el("li", null, "ask-result");
    const page = new URL("/parcel", location.href);
    page.searchParams.set("parcel_id", item.city_parcel_id);
    page.searchParams.set("objectid", item.city_objectid);
    const parcelLink = el("a", item.city_address || `City parcel ${item.city_parcel_id}`);
    parcelLink.href = `${page.pathname}${page.search}`;
    li.append(parcelLink, el("p", `City parcel ${item.city_parcel_id} · feature ${item.city_objectid}`, "meta"));
    for (const match of item.matching_sources ?? []) {
      if (match.records) { appendProjectedRecords(li, match); continue; }
      const example = match.example_record;
      const row = el("p", `${sourceNames[match.source_id] ?? match.source_id}: ${match.matching_record_count} matching official record${Number(match.matching_record_count) === 1 ? "" : "s"}`);
      if (example?.published_type) row.append(el("span", ` · ${example.published_type}`));
      if (example?.event_date) row.append(el("strong", ` · ${String(example.event_date).slice(0, 10)}`, "ask-date"));
      if (example?.published_status) row.append(el("span", ` · ${example.published_status}`));
      if (example?.source_url) row.append(document.createTextNode(" · "),
        link(example.source_url, `Source record ${example.record_id ?? ""}`.trim()));
      li.append(row);
    }
    const work = item.permit;
    const sourceUrl = item.source_url ?? item.permit_source_url ?? work?.source_url;
    if (sourceUrl) {
      const fields = item.fields ?? {};
      const name = fields.BusinessName ?? fields.dba ?? fields.business ?? fields.name;
      const type = item.published_type ?? item.permit_type ?? item.activity_type ?? work?.PermitType;
      const recordStatus = item.published_status ?? item.permit_status ?? item.activity_status ?? work?.PermStatus;
      const date = item.event_date ?? item.permit_date ?? item.activity_date ?? work?.PermitDate;
      const record = el("p", [name, type, recordStatus, date && String(date).slice(0, 10)].filter(Boolean).join(" · "));
      if (record.textContent) record.append(document.createTextNode(" · "));
      record.append(link(sourceUrl, `Official record ${item.permit_number ?? item.record_id ?? item.permit_id ?? work?.PermitNo ?? ""}`.trim()));
      li.append(record);
      if (work?.Description) li.append(el("p", work.Description, "meta"));
      if (item.contacts?.length) {
        const contacts = el("ul", null, "query-contact-list");
        for (const person of item.contacts) {
          const entry = el("li");
          entry.append(el("strong", person.Fullname ?? person.CompanyName ?? person.ContactRole ?? "Listed contact"));
          const summary = [person.ContactRole, person.CompanyName !== person.Fullname ? person.CompanyName : null,
            person.Phone, person.Email ?? person.EMailAddress].filter(Boolean);
          if (summary.length) entry.append(document.createTextNode(` · ${summary.join(" · ")}`));
          if (person.source_url && person.source_url !== sourceUrl) entry.append(document.createTextNode(" · "),
            link(person.source_url, "Contact source"));
          contacts.append(entry);
        }
        li.append(contacts);
      }
      const detail = el("details", null, "query-result-detail");
      detail.append(el("summary", "Published fields and parcel evidence"),
        el("pre", JSON.stringify(item, null, 2)));
      li.append(detail);
    }
    $("ask-results").append(li);
  }
}
function setAskStatus(message, state = "") {
  $("ask-status").textContent = message;
  $("ask-status").dataset.state = state;
}
function clearAskResult() {
  $("ask-run-mode").hidden = true;
  $("ask-without-commercial").hidden = true;
  $("ask-results").replaceChildren();
  $("ask-coverage").hidden = true;
  $("ask-interpretation").hidden = true;
  $("ask-filter-form").hidden = true;
  $("ask-more").hidden = true;
  $("ask-context").hidden = true;
  $("ask-clarification").replaceChildren();
  $("ask-clarification").hidden = true;
  askCriteria = null;
  askCursor = null;
}
function displaySearchResult(result, { append = false } = {}) {
  askCursor = result.next_cursor;
  appendAskItems(result.items);
  renderAskCoverage(result);
  $("ask-more").hidden = !askCursor;
  const indexStatus = result.coverage?.index_status;
  const count = append ? $("ask-results").children.length : result.items.length;
  const noun = ["parcels", "unified"].includes(askMethod) ? "parcel" : askMethod === "contacts" ? "permit" : "record";
  const candidates = result.coverage?.candidate_parcels_checked;
  $("ask-more").textContent = !count && candidates != null ? "Check more candidate parcels" : "Load more results";
  let message;
  if (indexStatus === "unconfigured")
    message = "The private parcel index is not connected in this Preview.";
  else if (indexStatus === "unavailable")
    message = "The private parcel index could not be queried.";
  else if (count) {
    const more = askCursor ? " More matches are available." : "";
    const coverage = result.complete_for_query ? " Source checks and paging are complete."
      : !askCursor || result.status === "coverage_limited" || indexStatus === "partial" ? " Review source coverage." : "";
    message = `${count} ${noun}${count === 1 ? "" : "s"} shown.${more}${coverage}`;
  }
  else if (candidates > 0)
    message = `No verified matches among the ${candidates} candidate parcels checked in this batch.${askCursor
      ? " More candidate parcels are available to check." : result.complete_for_query ? "" : " Review source coverage for incomplete checks."}`;
  else message = result.complete_for_query ? `No matching ${noun}s in the checked sources.` :
    `No matching ${noun}s on this page. Source coverage is incomplete.`;
  setAskStatus(message, ["unconfigured", "unavailable"].includes(indexStatus)
    ? "unavailable" : result.complete_for_query ? "ready" : "coverage_limited");
}
async function runFieldSearch(method, args, context) {
  const version = ++askVersion;
  clearAskResult();
  setAskStatus("Checking indexed sources…", "loading");
  try {
    const { indexedQueryRequest, indexedQueryTool } = await queryExplorer();
    const result = await api(...indexedQueryRequest(method, args));
    if (version !== askVersion) return;
    if (method === "unified") {
      renderUnifiedAnswer({ ...result, context }, null, version);
      return;
    }
    const target = $("ask-interpretation");
    const request = el("details", null, "query-result-detail");
    request.append(el("summary", "MCP request"),
      el("pre", JSON.stringify({ tool: indexedQueryTool(method), arguments: args }, null, 2)));
    target.replaceChildren(request);
    target.hidden = false;
    askMethod = method;
    askCriteria = args;
    displaySearchResult(result);
  } catch (error) {
    if (version === askVersion) setAskStatus(error.message, "unavailable");
  }
}
function renderUnifiedAnswer(response, question, version) {
  const plan = response.plan;
  if (plan) {
    const target = $("ask-interpretation");
    const pending = response.status === "planned";
    const run = (selectedPlan) => {
      if (version === askVersion) void runFieldSearch("unified", { plan: selectedPlan }, response.context);
    };
    const summary = el("dl", null, "query-plan-summary");
    const line = (label, value) => summary.append(el("dt", label), el("dd", value));
    target.replaceChildren(el("h2", "Search plan"), summary);
    const scope = plan.scope;
    line("Search area", scope.kind === "city" ? "Citywide · New Haven" : [
      scope.kind === "neighborhood" ? "City neighborhood" : scope.kind === "ward" ? "City ward" :
        scope.kind === "parcel" ? "City parcel" : "Searched address",
      scope.name ?? scope.ward ?? scope.parcel_id ?? scope.address,
    ].join(" · "));
    for (const requirement of plan.requirements ?? []) {
      const date = requirement.date;
      const filters = [requirement.permit_group ? `Permit group ${requirement.permit_group}` : null,
        ...Object.entries(requirement.equals ?? {}).map(([field, value]) => `${field} = ${value}`),
        ...Object.entries(requirement.number_gte ?? {}).map(([field, value]) => `${field} ≥ ${value}`),
        ...Object.entries(requirement.number_lte ?? {}).map(([field, value]) => `${field} ≤ ${value}`),
        ...Object.entries(requirement.one_of ?? {}).map(([field, values]) =>
          `${field} matches any of ${values.join(", ")}`),
        date ? [date.field, date.from && `from ${date.from}`, date.to && `through ${date.to}`].filter(Boolean).join(" ") : null,
      ].filter(Boolean);
      line(sourceNames[requirement.source_id] ?? requirement.source_id, filters.join(" · ") || "Any matching record");
    }
    if (plan.parcel_use_category) line("Recorded parcel use", response.use_category ?? plan.parcel_use_category.replaceAll("_", " "));
    if (plan.contact_role) line(plan.require_contact_role ? "Required contact role" : "Returned contact role", plan.contact_role);
    if (plan.permit_description_terms?.length) line("Permit description contains any of", plan.permit_description_terms.join(", "));
    if (plan.radius_meters) line("Search radius", `${plan.radius_meters} meters`);
    if (plan.include?.length) line("Return fields", plan.include.map(({ source_id, fields, record_category }) =>
      `${sourceNames[source_id] ?? source_id}${record_category ? ` · ${record_category} records` : ""}${fields ? ` (${fields.join(", ")})` : ""}`).join(" · "));
    if (pending) {
      const confirm = el("button", "Run search");
      confirm.type = "button";
      confirm.onclick = () => run(plan);
      target.append(confirm);
    }
    const detail = el("details", null, "query-result-detail");
    detail.append(el("summary", "View or edit MCP request"));
    const form = el("form", null, "query-plan-editor");
    const label = el("label", "Query plan JSON");
    const input = el("textarea");
    input.rows = 10;
    input.value = JSON.stringify(plan, null, 2);
    label.append(input);
    const submit = el("button", "Run edited plan", "secondary");
    submit.type = "submit";
    form.append(label, submit);
    form.onsubmit = (event) => {
      event.preventDefault();
      try { run(JSON.parse(input.value)); }
      catch { setAskStatus("Enter valid query plan JSON.", "unsupported"); }
    };
    detail.append(form);
    target.append(detail);
    target.hidden = false;
  }
  renderAskContext(response.context);
  if (response.clarification) {
    const clarification = response.clarification;
    setAskStatus(clarification.question, "clarify");
    const target = $("ask-clarification");
    for (const choice of clarification.options) {
      const button = el("button", choice.label, "secondary");
      button.type = "button";
      button.onclick = () => {
        if (version !== askVersion) return;
        if (plan && clarification.id === "parcel") {
          const [parcel_id, objectid] = choice.id.split(":");
          void runFieldSearch("unified", { plan: { ...plan, scope: { ...plan.scope, parcel_id, objectid } } }, response.context);
        } else if (question) void runAsk(question, null, { id: clarification.id, choice: choice.id });
      };
      target.append(button);
    }
    target.hidden = !target.childElementCount;
    return;
  }
  if (response.status === "planned") {
    setAskStatus("Review the search plan below. No parcel records have been searched yet.", "planned");
    return;
  }
  if (!response.items) { setAskStatus(response.reason ?? "No validated search result was returned.", response.status); return; }
  askMethod = "unified";
  askCriteria = { plan };
  displaySearchResult(response);
}
async function runAsk(question, filters = null, clarification = null) {
  const version = ++askVersion;
  clearAskResult();
  if (filters) $("ask-question").value = "";
  if (filters) {
    $("ask-run-mode").textContent = "This result uses the applied filters below.";
    $("ask-run-mode").hidden = false;
  }
  setAskStatus(filters ? "Checking edited filters against indexed sources…" :
    "Preparing the search plan…", "loading");
  try {
    const response = await api(filters ? "/api/v1/ask-parcels" : "/api/v1/ask-parcel-data", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(filters ? { filters } : { question, plan_only: true, ...(clarification ? { clarification } : {}) }) });
    if (version !== askVersion) return;
    if (!filters) { renderUnifiedAnswer(response, question, version); return; }
    const parsed = response.interpretation;
    if (parsed) {
      const target = $("ask-interpretation");
      target.replaceChildren(el("h2", filters ? "Applied filters" : "Interpreted filters"));
      const parts = [parsed.commercial ? "City parcels in reviewed commercial use codes" : null,
        parsed.permit_group ? `Published permit group: ${parsed.permit_group}` : null,
        parsed.permit_type ? `Permit type: ${parsed.permit_type}` : null,
        parsed.permit_status ? `Published permit status: ${parsed.permit_status}` : null,
        parsed.contact_role ? `Listed contact role: ${parsed.contact_role}` : null,
        parsed.permit_description_terms?.length ? `Permit description contains any of ${parsed.permit_description_terms.join(", ")}` : null,
        parsed.activity === "municipal_business_license_issuance" ? "City business license issuance" : null,
        parsed.date_window ? `${parsed.date_field ?? "PermitDate"} · ${parsed.date_window.from} through ${parsed.date_window.to}` : null,
        parsed.neighborhood ? `City neighborhood: ${parsed.neighborhood}` : null].filter(Boolean);
      for (const part of parts) target.append(el("p", part));
      target.hidden = !parts.length;
      $("ask-commercial").checked = Boolean(parsed.commercial);
      $("ask-permit-group").value = parsed.permit_group ?? "";
      $("ask-permit-type").value = parsed.permit_type ?? "";
      $("ask-permit-status").value = parsed.permit_status ?? "";
      $("ask-days").value = parsed.permit_days ?? "";
      $("ask-neighborhood").value = parsed.neighborhood ?? "";
      $("ask-filter-form").hidden = Boolean(parsed.activity);
    }
    renderAskContext(response.context);
    if (response.reason || response.clarification) {
      const blockedCommercial = response.status === "blocked" && parsed?.commercial;
      setAskStatus(`${response.reason ?? response.clarification}${blockedCommercial
        ? " No parcel search was run with this filter." : ""}`, response.status);
      if (blockedCommercial) {
        const button = $("ask-without-commercial");
        button.hidden = false;
        button.onclick = () => void runAsk(null, { commercial: false,
          permit_group: parsed.permit_group, permit_type: parsed.permit_type,
          permit_status: parsed.permit_status, permit_days: parsed.permit_days,
          neighborhood: parsed.neighborhood });
      }
      return;
    }
    const result = response.search_result;
    if (!result) { setAskStatus("No validated search result was returned.", "unavailable"); return; }
    askCriteria = response.criteria;
    askMethod = response.search_method === "contacts" ? "contacts" : askCriteria?.source_id ? "records" : "parcels";
    displaySearchResult(result);
  } catch (error) {
    if (version === askVersion) setAskStatus(error.message, "unavailable");
  }
}
for (const button of document.querySelectorAll("[data-ask-example]")) {
  button.addEventListener("click", () => {
    const question = button.dataset.askExample;
    $("ask-question").value = question;
    void runAsk(question);
  });
}
$("ask-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void runAsk($("ask-question").value.trim());
});
$("ask-question").addEventListener("input", () => {
  askVersion++;
  clearAskResult();
  setAskStatus("");
});
$("ask-filter-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void runAsk(null, { commercial: $("ask-commercial").checked,
    permit_group: $("ask-permit-group").value.trim() || null,
    permit_type: $("ask-permit-type").value.trim() || null,
    permit_status: $("ask-permit-status").value.trim() || null,
    permit_days: $("ask-days").value ? Number($("ask-days").value) : null,
    neighborhood: $("ask-neighborhood").value.trim() || null });
});
$("ask-more").addEventListener("click", async () => {
  if (!askCursor || !askCriteria) return;
  const version = askVersion;
  const button = $("ask-more");
  button.disabled = true;
  setAskStatus("Loading the next results…", "loading");
  try {
    const { indexedQueryRequest } = await queryExplorer();
    const result = await api(...indexedQueryRequest(askMethod, askCriteria, askCursor));
    if (version === askVersion) displaySearchResult(result, { append: true });
  } catch (error) {
    if (version === askVersion) setAskStatus(error.message, "unavailable");
  } finally { button.disabled = false; }
});
function setMobileBrowseView(view) {
  document.body.classList.toggle("mobile-records-active", view === "records");
  $("mobile-map-tab").setAttribute("aria-pressed", String(view === "map"));
  $("mobile-records-tab").setAttribute("aria-pressed", String(view === "records"));
  if (view === "map") requestAnimationFrame(() => browseMap?.invalidateSize());
}
$("mobile-map-tab").addEventListener("click", () => setMobileBrowseView("map"));
$("mobile-records-tab").addEventListener("click", () => setMobileBrowseView("records"));
$("browse-panel-toggle").addEventListener("click", () => {
  const expanded = document.body.classList.toggle("browse-expanded");
  $("browse-panel-toggle").setAttribute("aria-expanded", String(expanded));
  $("browse-panel-toggle").textContent = expanded ? "Narrow panel" : "Expand panel";
  requestAnimationFrame(() => browseMap?.invalidateSize());
});
$("records-tab").parentElement.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const tabs = [$("records-tab"), $("browse-tab"), $("activity-tab"), $("guide-tab"), $("ask-tab")]
    .filter((tab) => !tab.hidden);
  const current = tabs.indexOf(document.activeElement);
  const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
    (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  const target = tabs[index];
  target.focus();
  target.click();
});
const initial = new URL(location.href).searchParams;
if (initial.get("view") === "guide") showExplorerTab("guide", { section: initial.get("guide") ?? "home" });
if (initial.get("view") === "ask" && !$("ask-tab").hidden) showExplorerTab("ask");
if (initial.get("view") === "activity" && !$("activity-tab").hidden) showExplorerTab("activity");
if (initial.get("view") === "records") showExplorerTab("records", { noMap: true });
if (initial.get("view") === "map") {
  showExplorerTab("browse");
  if (initial.has("parcel_id")) requestAnimationFrame(async () => {
    try {
      const qs = new URLSearchParams({ parcel_id: initial.get("parcel_id") });
      if (initial.has("objectid")) qs.set("objectid", initial.get("objectid"));
      const feature = await api(`/api/v1/geometry?${qs}`);
      if (!browseMap || !feature?.geometry || !feature?.properties) return;
      const bounds = window.L.geoJSON(feature).getBounds();
      if (bounds.isValid()) browseMap.fitBounds(bounds.pad(2), { maxZoom: 18 });
      await selectBrowseParcel(feature);
    } catch (error) {
      $("browse-map-status").textContent = `Could not restore this City parcel: ${error.message}`;
    }
  });
}
if (initial.has("parcel_id") && !["map", "guide", "ask", "activity"].includes(initial.get("view"))) {
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
          await choose(verified, original, "records", true);
          return;
        }
      } catch { /* Load the parcel without an unverified address focus. */ }
    }
    if (startingVersion === viewVersion)
      await choose({ parcel_id: initial.get("parcel_id"), objectid: initial.get("objectid") }, null, "records", true);
  };
  void restore();
}
for (const example of document.querySelectorAll("[data-example]"))
  example.addEventListener("click", () => {
    $("query").value = example.dataset.example;
    $("search-form").requestSubmit();
  });
