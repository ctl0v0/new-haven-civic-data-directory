const $ = (id) => document.getElementById(id);
const SHOW_SNAPSHOT = true;
const groups = [
  ["property", "Building and addresses", "City parcel fields, assessment details, valuation rows, and address points on the parcel."],
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
  "school-attendance": "NHPS attendance-zone schools",
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
};
let selected = null;
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
let overviewGroups = [];
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
let browseSelectedLayer = null;
let browseContextLayers = [];
let browseTimer = null;
let browseRequestVersion = 0;
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
  $("record-detail").hidden = true;
  $("parcel-map-section").hidden = id !== "overview";
  $("snapshot").hidden = id !== "overview";
  $("feed-section").hidden = id !== "timeline";
  for (const [key] of groups) {
    const section = $(`group-${key}`);
    if (section) section.hidden = key !== id;
  }
  if (id === "overview" && parcelMap && !document.body.classList.contains("browse-mode"))
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
function navigateDataSection(id) {
  showDataSection(id);
  if (!document.body.classList.contains("browse-mode")) {
    const target = id === "overview" ? $("parcel-summary") : id === "timeline" ? $("feed-section") : $(`group-${id}`);
    requestAnimationFrame(() => target?.scrollIntoView({ behavior: "auto", block: "start" }));
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
    updateDataNavCounts();
    const counts = $("overview-counts");
    counts.replaceChildren();
    const total = data.groups.reduce((sum, group) => sum + group.record_count, 0);
    const incompleteGroups = data.groups.filter((group) => incompleteSources(group.sources).length).length;
    counts.append(el("p", `${total} returned rows across ${data.groups.length} groups${incompleteGroups ? ` · ${incompleteGroups} ${incompleteGroups === 1 ? "group has" : "groups have"} incomplete live checks` : ""}. Counts describe this response, and a record may appear in more than one group.`, "overview-summary"));
    const knownGaps = data.groups.flatMap((group) =>
      group.sources.filter((source) => ["not_integrated", "not_linked"].includes(source.status))
        .map((source) => ({ group: group.id, source })));
    if (knownGaps.length) {
      const details = el("details", null, "overview-known-gaps");
      details.append(el("summary", `Known coverage limits · ${knownGaps.length} ${knownGaps.length === 1 ? "source" : "sources"} not integrated or not linked`));
      const list = el("ul");
      for (const { group, source } of knownGaps) {
        const row = el("li");
        row.append(el("strong", `${groups.find(([id]) => id === group)?.[1] ?? group} · ${sourceName(source.source_id)}: `));
        row.append(document.createTextNode(source.warning ?? source.coverage));
        list.append(row);
      }
      details.append(list);
      counts.append(details);
    }
    const grid = $("snapshot-grid");
    grid.replaceChildren();
    for (const [id, title] of groups) {
      const group = data.groups.find((entry) => entry.id === id);
      const section = el("section", null, "overview-group");
      const heading = el("div", null, "overview-group-heading");
      const open = el("button", title, "overview-link");
      open.type = "button";
      open.addEventListener("click", () => showDataSection(id));
      heading.append(open, el("span", `${group?.record_count ?? 0} returned`, "group-count"));
      section.append(heading);
      const issues = incompleteSources(group?.sources);
      if (issues.length)
        section.append(el("p", `Incomplete live checks: ${sourceIssueLabels(issues)}. Open this group for details.`, "source-warning"));
      const items = data.highlights?.[id] ?? [];
      if (items.length) {
        const list = el("ul", null, "overview-highlights");
        for (const item of items) {
          const row = el("li");
          row.append(el("span", `${item.label}${item.event_date ? ` · ${shortDate(item.event_date)}` : ""}`));
          if (item.source_url) row.append(link(item.source_url, sourceName(item.source_id)));
          list.append(row);
        }
        section.append(list);
      } else section.append(el("p", "No highlight row returned by the checked sources.", "meta"));
      grid.append(section);
    }
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
  const missing = source.missing_categories ?? [];
  const truncated = source.truncated_categories ?? [];
  if (source.source_id === "municity" && (missing.length || truncated.length))
    return [
      missing.length ? `${missing.join(", ")} ${missing.length === 1 ? "category was" : "categories were"} not returned by the municipal service` : null,
      truncated.length ? `${truncated.join(", ")} ${truncated.length === 1 ? "category exceeded" : "categories exceeded"} the 500-row display limit` : null,
    ].filter(Boolean).join("; ");
  return source.warning ?? source.coverage ?? source.status;
}
function sourceIssueLabels(sources) {
  return sources.map((source) => `${sourceName(source.source_id)} (${source.status}): ${sourceIssueReason(source)}`).join("; ");
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
  if (item.event_date) detail.append(el("p", `Source event date: ${shortDate(item.event_date)}`, "record-meta"));
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
          : `${source.count} ${source.count === 1 ? "record" : "records"}`;
  top.append(el("span", count, "source-count"));
  top.append(el("span", source.status.replaceAll("_", " "), `badge ${source.status}`));
  row.append(top);
  if (source.status === "unavailable" || source.status === "partial")
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
  if (source.warning && !["unavailable", "partial", "not_linked"].includes(source.status))
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
  const priorParams = restoreState ? new URL(location.href).searchParams : null;
  const browsing = viewer === "browse";
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
    `/parcel?parcel_id=${encodeURIComponent(item.parcel_id)}${item.objectid ? `&objectid=${encodeURIComponent(item.objectid)}` : ""}${searchedAddress ? `&query_address=${encodeURIComponent(searchedAddress)}` : ""}${browsing ? "&view=map" : ""}`,
  );
  saveDataUrl();
  $("groups").replaceChildren();
  $("group-nav").replaceChildren();
  $("record-detail").hidden = true;
  $("overview-counts").replaceChildren();
  $("snapshot-grid").replaceChildren(el("p", "Loading source-linked overview…", "meta"));
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
    if (browsing) $("browse-intro").textContent = "Official records for the selected parcel are below.";
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
    status("Records are loading by source.");
    const tasks = [];
    if (!browsing) tasks.push(loadHeroPhoto(qs, version));
    tasks.push(browsing ? loadBrowseSelectedMap(qs, version) : loadMap(qs, version));
    tasks.push(loadOverview(qs, version));
    for (const [id, title] of groups) {
      const section = el("section", null, "panel");
      section.id = `group-${id}`;
      section.append(el("h2", title));
      section.append(el("p", "Loading…", "meta"));
      $("groups").append(section);
    }
    renderDataNav();
    await Promise.allSettled(tasks);
    if (version === viewVersion) status("Overview loaded. Choose a group to request and inspect its records.");
  } catch (error) {
    if (version === viewVersion) status(error.message);
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
function mapFeatureLayer(layer) {
  const color = MAP_COLORS[layer.id] ?? "#315e4e";
  return window.L.geoJSON({ type: "FeatureCollection", features: layer.features }, {
    style: () => ({
      color,
      weight: 3,
      fillOpacity: 0.04,
    }),
    pointToLayer: (_feature, latlng) => window.L.circleMarker(latlng, {
      radius: layer.id === "parcel-addresses" ? 6 : layer.id === "metered-parking-spaces" ? 4 : 5,
      color: "#fff", weight: 2, fillColor: color, fillOpacity: 1,
    }),
    onEachFeature: (feature, leafletLayer) => leafletLayer.bindPopup(mapFeaturePopup(feature, layer)),
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
      const rendered = mapFeatureLayer(layer);
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
function showExplorerTab(tab) {
  const browsing = tab === "browse";
  const guiding = tab === "guide";
  document.body.classList.toggle("browse-mode", browsing);
  const url = new URL(location.href);
  if (browsing) url.searchParams.set("view", "map");
  else if (guiding) url.searchParams.set("view", "guide");
  else url.searchParams.delete("view");
  history.replaceState(null, "", `${url.pathname}${url.search}`);
  $("records-view").hidden = browsing || guiding;
  $("browse-view").hidden = !browsing;
  $("guide-view").hidden = !guiding;
  if (!guiding) placeRecordContent(browsing);
  $("records-tab").setAttribute("aria-selected", String(!browsing && !guiding));
  $("browse-tab").setAttribute("aria-selected", String(browsing));
  $("guide-tab").setAttribute("aria-selected", String(guiding));
  if (guiding) void loadGuide();
  if (browsing) requestAnimationFrame(() => {
    if (!browseMap) initBrowseMap();
    else browseMap.invalidateSize();
    if (selected && requestedParcelKey === parcelKey(selected) && !browseSelectedLayer) {
      void loadBrowseSelectedMap(selectedQuery(), viewVersion, true);
    }
  });
  else if (!guiding && selected && requestedParcelKey === parcelKey(selected)) requestAnimationFrame(() => {
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
  const content = $("guide-content");
  const example = $("guide-example");
  content.replaceChildren();
  example.replaceChildren();
  for (const button of $("guide-nav").querySelectorAll("button"))
    button.setAttribute("aria-current", button.dataset.guide === key ? "page" : "false");
  if (key === "home") {
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
async function loadGuide() {
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
  for (const [id, title] of [["home", "How to read the data"], ...guideData.methods.map((item) => [item.id, item.title]), ["fields", "Field guide"], ["sources", "Sources and gaps"]]) {
    const button = el("button", title, "guide-nav-button");
    button.type = "button";
    button.dataset.guide = id;
    button.onclick = () => renderGuideSection(id);
    nav.append(button);
  }
  renderGuideSection("home");
}
function browseParcelStyle(feature) {
  const p = feature.properties ?? {};
  const active = selectedBrowseParcel &&
    String(p.parcel_id) === String(selectedBrowseParcel.parcel_id) &&
    String(p.objectid) === String(selectedBrowseParcel.objectid);
  return { color: active ? "#00d5d8" : "#173e35", weight: active ? 4 : 1.5,
    fillColor: active ? "#00d5d8" : "#f8c547", fillOpacity: active ? .22 : .04 };
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
    $("browse-intro").textContent = "Select Request parcel data to load the full records for this parcel.";
    clearBrowseDataMap();
    resetMap();
  }
  const version = ++browseSelectionVersion;
  selectedBrowseParcel = { parcel_id: p.parcel_id, objectid: p.objectid,
    address: p.address, source_url: p.source_url };
  browseLayer?.setStyle(browseParcelStyle);
  const aside = $("browse-selection");
  if (window.matchMedia("(max-width: 44rem)").matches)
    aside.scrollIntoView({ behavior: "smooth", block: "start" });
  const title = p.address?.trim() || `City parcel ${p.parcel_id}`;
  aside.replaceChildren(el("p", "Selected City parcel", "eyebrow"), el("h2", title),
    el("p", `Parcel ID ${p.parcel_id}${p.mblu ? ` · MBLU ${p.mblu}` : ""}`, "meta"),
    el("p", "Checking official parcel photo sources…", "meta"));
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
  try {
    const qs = new URLSearchParams({ parcel_id: p.parcel_id, objectid: p.objectid });
    const data = await api(`/api/v1/parcel-photo?${qs}`);
    if (version !== browseSelectionVersion) return;
    aside.querySelector(".meta:last-of-type")?.remove();
    if (data.status !== "ok") {
      aside.insertBefore(el("p", "No verified municipal or assessor photo was returned for this parcel.", "meta"), button);
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
    if (setVerifiedPhoto(figure, image, source, data)) aside.insertBefore(figure, button);
  } catch {
    if (version === browseSelectionVersion) {
      aside.querySelector(".meta:last-of-type")?.remove();
      aside.insertBefore(el("p", "Photo sources unavailable; the City parcel selection remains available.", "meta"), button);
    }
  }
}
async function loadBrowseParcels() {
  if (!browseMap) return;
  const version = ++browseRequestVersion;
  const status = $("browse-map-status");
  if (browseMap.getZoom() < 17) {
    if (browseLayer) browseMap.removeLayer(browseLayer);
    browseLayer = null;
    status.textContent = "Zoom in to level 17 to display City parcel outlines.";
    return;
  }
  const bounds = browseMap.getBounds();
  const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(",");
  status.textContent = "Loading City parcel outlines for this map view…";
  try {
    const data = await api(`/api/v1/browse-parcels?${new URLSearchParams({ bbox })}`);
    if (version !== browseRequestVersion || !browseMap) return;
    if (browseLayer) browseMap.removeLayer(browseLayer);
    browseLayer = window.L.geoJSON({ type: "FeatureCollection", features: data.features }, {
      style: browseParcelStyle,
      onEachFeature: (feature, layer) => layer.on("click", () => { void selectBrowseParcel(feature); }),
    }).addTo(browseMap);
    status.textContent = data.warning ?? (data.features.length
      ? `${data.features.length} City parcel outlines in view. Select one to preview it; full records have not been requested.`
      : "No City parcel outlines returned for this view.");
  } catch (error) {
    if (version === browseRequestVersion)
      status.textContent = `Could not load City parcel outlines: ${error.message}`;
  }
}
function initBrowseMap() {
  if (browseMap) return;
  const leaflet = window.L;
  if (!leaflet) {
    $("browse-map-status").textContent = "Map renderer unavailable.";
    return;
  }
  browseMap = leaflet.map($("browse-map"), { scrollWheelZoom: false, keyboard: true });
  addMapBackgrounds(browseMap);
  browseMap.setView([41.3083, -72.9279], 17);
  browseMap.on("moveend", () => {
    clearTimeout(browseTimer);
    browseTimer = setTimeout(() => { void loadBrowseParcels(); }, 250);
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
  container.append(el("p", "All returned records are shown by default, including older, closed, voided and expired rows. Within each category, recent source-reported statuses appear first; each record retains its exact published status. Filter option counts are before filters.", "filter-context"));
  const quick = el("div", null, "quick-filters");
  const update = (key, value) => {
    groupFilters.set(id, { ...current, [key]: value });
    saveDataUrl();
    void loadGroup(id, $(`group-${id}`), qs, version);
  };
  quickFilterSelect(quick, "Published record type", "All record types", data.facets?.record_type, current.record_type,
    (value) => value, (value) => update("record_type", value));
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
  if (searchedAddress) {
    const label = el("label", null, "filter-choice");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "address_match";
    input.checked = current.address_match;
    label.append(input, document.createTextNode(`Source address matches ${searchedAddress}`));
    form.append(label, el("p", "Only explicit source address fields qualify. Other parcel records remain available when this filter is off.", "meta"));
  }
  const submit = el("button", "Apply filters");
  submit.type = "submit";
  form.append(submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const filters = Object.fromEntries(["category", "record_type", "source_id", "display_group", "source_status"].map((key) => [key, values.getAll(key)]));
    filters.event_date_from = values.get("event_date_from") ?? "";
    filters.event_date_to = values.get("event_date_to") ?? "";
    filters.address_match = values.has("address_match");
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
  index.append(el("p", "Browse categories · counts are returned rows before filters; select a category to request its rows directly", "meta"));
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
      section.append(el("p", definition[2], "group-intro"));
      section.append(renderFilters(id, data, qs, version));
      renderCategoryIndex(section, id, data, qs, version);
      const coverage = el("details", null, "sources-panel");
      const issues = incompleteSources(data.sources);
      const notIntegrated = data.sources.filter((source) => source.status === "not_integrated").length;
      const notLinked = data.sources.filter((source) => source.status === "not_linked").length;
      coverage.append(el("summary", `Source coverage · ${data.sources.length - notIntegrated - notLinked} live checks${issues.length ? ` · ${issues.length} incomplete` : ""}${notIntegrated ? ` · ${notIntegrated} not integrated` : ""}${notLinked ? ` · ${notLinked} not linked` : ""}`));
      const sourceList = el("div", null, "source-list");
      for (const source of data.sources) sourceLine(sourceList, source);
      coverage.append(sourceList);
      section.append(coverage);
      if (issues.length) section.append(el("p", `Incomplete live checks: ${sourceIssueLabels(issues)}. Returned counts may be limited; open Source coverage for the source's reason.`, "source-warning"));
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
    if (count) count.textContent = `${shown} shown of ${data.total} matching · ${data.returned_total} returned by sources`;
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
$("guide-tab").addEventListener("click", () => showExplorerTab("guide"));
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
  const tabs = [$("records-tab"), $("browse-tab"), $("guide-tab")];
  const current = tabs.indexOf(document.activeElement);
  const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
    (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  const target = tabs[index];
  target.focus();
  target.click();
});
const initial = new URL(location.href).searchParams;
if (initial.get("view") === "guide") showExplorerTab("guide");
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
if (initial.has("parcel_id") && !["map", "guide"].includes(initial.get("view"))) {
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
