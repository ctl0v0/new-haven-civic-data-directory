const $ = (id) => document.getElementById(id);
const groups = [
  ["property", "Building, ownership, and addresses", "City parcel facts, published assessor ownership history, and address points on the parcel."],
  ["business", "Businesses in records", "Municipal licenses and occupant rows attached to the verified parcel. These do not confirm current tenants."],
  ["activity", "Permits, applications, and cases", "Municipal work records, documents, complaints, and other parcel activity."],
  ["geography", "Zoning and boundaries", "Mapped districts that intersect the parcel."],
  ["environment", "Environmental records", "State environmental inventory rows linked by an official parcel identifier."],
  ["representation", "Representation", "Ward and community management contacts shown by the checked sources."],
];
const sourceNames = {
  parcels: "City parcel layer",
  addresses: "City address points",
  assessor: "Assessor card",
  "assessor-sales": "Assessor ownership history",
  "assessor-valuations": "Assessor valuation history",
  "assessor-subareas": "Assessor building subareas",
  "local-historic-districts": "City local historic districts",
  "state-historic-districts": "City hosted State historic districts",
  "ct-brownfields": "CT DEEP brownfields inventory",
  municity: "Municipal parcel service",
  "municipal-business-licenses": "Municipal licenses",
  "municipal-occupants": "Municipal occupants",
  "business-master": "CT business registry",
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
let parcelMap = null;
const AERIAL_TILES = "https://cteco.uconn.edu/ctraster/rest/services/images/Ortho_2023_tiled/ImageServer/tile/{z}/{y}/{x}";
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
  return a.status ?? a.Status ?? a.record_status ?? a.PermStatus ?? a.PermitApplicationStatus ?? a.CompStatus ?? null;
}
function recordTitle(item) {
  const a = item.attributes ?? {};
  if (item.source_id === "addresses")
    return `${a.house_number ?? ""} ${a.full_street_name ?? `${a.street_name ?? ""} ${a.suffix_type ?? ""}`}`.trim() || "City address point";
  if (item.source_id === "assessor-valuations")
    return `${a.valuation_year ?? "Unspecified year"} ${a.valuation_type ?? ""} valuation`;
  if (item.source_id === "assessor-subareas")
    return `${a.description_as_published ?? "Building subarea"}${a.code ? ` (${a.code})` : ""}`;
  if (item.source_id === "zoning")
    return a.zone_code ? `Zoning district ${a.zone_code}` : "City zoning polygon";
  if (item.source_id === "assessor") return "Assessor building and land facts";
  if (item.source_id === "ct-brownfields") return a.site_name ?? "DEEP inventory site";
  if (["local-historic-districts", "state-historic-districts"].includes(item.source_id))
    return a.HistoricDistrict ?? a.historicdistrict ?? "Historic district boundary";
  return brief(
    a.business_name ?? a.occupant_name ?? a.owner ?? a.BusinessName ?? a.name ?? a.document_name ??
      a.complaint_number ?? a.contact_name ?? a.title ?? a.PermitNo ??
      a.PermitNumber ?? a.ApplicationNumber ?? a.LicenseNumber ??
      a.CertificateNumber ?? a.property_address ?? a.LegalAddress ??
      a.PermitType ?? a.ApplicationType ?? item.source_record_id,
    120,
  );
}
function recordDescription(item) {
  const a = item.attributes ?? {};
  if (item.source_id === "parcels") {
    const facts = [
      a.year_building_built ? `Built ${a.year_building_built}` : null,
      a.units_commercial ? `${a.units_commercial} commercial units listed` : null,
      a.use_code ? `Assessor use code ${a.use_code}` : null,
    ];
    return facts.filter(Boolean).join(" · ");
  }
  if (item.source_id === "assessor-sales")
    return [a.sale_price ? `Sale price listed: ${a.sale_price}` : null, a.book_page ? `Book and page ${a.book_page}` : null, a.instrument ? `Instrument ${a.instrument}` : null].filter(Boolean).join(" · ");
  if (item.source_id === "assessor-valuations")
    return [a.table_section, a.total ? `Total ${a.total}` : null, a.land ? `Land ${a.land}` : null, a.improvements ? `Improvements ${a.improvements}` : null].filter(Boolean).join(" · ");
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
  return brief(a.Description ?? a.description ?? a.complaint_type ?? a.document_type ?? a.PermitType ?? a.ApplicationType ?? a.section ?? "", 190);
}
function matchEvidence(item) {
  const match = item.match;
  if (match?.method !== "exact" || !match.parcel_field || !match.source_field || !match.value)
    return null;
  const fields = `${match.parcel_field.toUpperCase()} = source ${match.source_field} ${match.value}`;
  return match.address_confirmed ? `Parcel match: ${fields}; property address also matches` : `Parcel match: ${fields}`;
}
function appendRecord(parent, item) {
  const card = el("article", null, "record-card");
  const head = el("div", null, "record-head");
  head.append(el("h3", recordTitle(item)));
  const state = recordStatus(item);
  if (state) head.append(el("span", brief(state, 45), "status-pill"));
  card.append(head);
  card.append(el("p", [item.category, sourceName(item.source_id), item.attributes?.period, item.event_date ? shortDate(item.event_date) : null].filter(Boolean).join(" · "), "record-meta"));
  const description = recordDescription(item);
  if (description) card.append(el("p", description, "record-description"));
  const evidence = matchEvidence(item);
  if (evidence) card.append(el("p", evidence, "record-note"));
  if (item.note) card.append(el("p", item.note, "record-note"));
  const actions = el("div", null, "record-actions");
  if (item.source_url) actions.append(link(item.source_url, item.category === "Document" && item.source_url.includes("municitymedia.com") ? "Open document" : "Open source"));
  const details = el("details", null, "source-fields");
  details.append(el("summary", "View source fields"));
  const pre = el("pre");
  details.append(pre);
  details.addEventListener("toggle", () => {
    if (details.open && !pre.textContent)
      pre.textContent = JSON.stringify(item.attributes, null, 2);
  });
  actions.append(details);
  card.append(actions);
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
      building.append(el("p", currentValues.map((item) =>
        `${item.attributes.valuation_year} ${item.attributes.valuation_type}: ${item.attributes.total ?? "not listed"}`,
      ).join(" · ")));
    }
    const sales = property.items
      .filter((item) => item.source_id === "assessor-sales")
      .sort((a, b) => String(b.event_date ?? "").localeCompare(String(a.event_date ?? "")));
    if (sales.length) {
      const latest = sales[0];
      building.append(el("p", "Latest published ownership row", "snapshot-label"));
      building.append(el("p", [latest.attributes.owner, latest.event_date ? shortDate(latest.event_date) : null, latest.attributes.sale_price].filter(Boolean).join(" · ")));
      building.append(el("p", `${sales.length} ownership history ${sales.length === 1 ? "row" : "rows"} returned by the assessor.`, "meta"));
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
    building.append(el("p", "Address points are spatial links; occupancy is not verified.", "snapshot-caveat"));
  }

  const business = groupResponses.get("business");
  const businesses = snapshotCard("Business names in records", "business");
  if (!business) businesses.append(el("p", "Loading business records…", "meta"));
  else {
    const named = business.items
      .filter((item) => ["municipal-business-licenses", "municipal-occupants"].includes(item.source_id))
      .filter((item) => item.attributes?.business_name || item.attributes?.occupant_name)
      .sort((a, b) =>
        Number(b.source_id === "municipal-business-licenses") -
        Number(a.source_id === "municipal-business-licenses") ||
        String(b.attributes?.expiration_date ?? b.event_date ?? "").localeCompare(
          String(a.attributes?.expiration_date ?? a.event_date ?? ""),
        ));
    if (!named.length) businesses.append(el("p", "No named business record was returned by checked sources."));
    else {
      businesses.append(el("p", `${business.total} municipal business records returned. Names and inactive flags are shown as published.`, "meta"));
      const list = el("ul", null, "snapshot-list");
      for (const item of named.slice(0, 4)) {
        const row = el("li");
        row.append(el("strong", recordTitle(item)));
        const state = recordStatus(item);
        if (state) row.append(el("span", state, "snapshot-state"));
        list.append(row);
      }
      businesses.append(list);
    }
    businesses.append(el("p", "A municipal occupant row or license does not establish a current storefront.", "snapshot-caveat"));
  }

  const activity = groupResponses.get("activity");
  const work = snapshotCard("Recent open or submitted records", "activity");
  if (!activity) work.append(el("p", "Checking work records…", "meta"));
  else {
    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2);
    const recentSince = cutoff.toISOString().slice(0, 10);
    const issuedPermitNumbers = new Set(activity.items
      .filter((item) => item.category === "Permit")
      .map((item) => item.attributes?.PermitNo ?? item.attributes?.PermitNumber)
      .filter(Boolean));
    const open = activity.items
      .filter((item) => ["Application", "Permit", "Complaint"].includes(item.category) || item.source_id === "lci-cases")
      .filter((item) => /open|submitted|pending|in review|under review|assigned|scheduled/i.test(String(recordStatus(item) ?? "")))
      .filter((item) => item.event_date && item.event_date >= recentSince)
      .filter((item) => item.category !== "Application" || !issuedPermitNumbers.has(item.attributes?.ApplicationNumber))
      .sort((a, b) => String(b.event_date ?? "").localeCompare(String(a.event_date ?? "")));
    if (!open.length) work.append(el("p", "No recent open or submitted record surfaced in the returned records."));
    else {
      const list = el("ul", null, "snapshot-list");
      for (const item of open.slice(0, 3)) {
        const row = el("li");
        row.append(el("strong", recordTitle(item)));
        row.append(el("span", `${recordStatus(item)}${item.event_date ? ` · ${shortDate(item.event_date)}` : ""}`, "snapshot-state"));
        list.append(row);
      }
      work.append(list);
    }
    work.append(el("p", "A filed or open record does not confirm a future schedule or completed work.", "snapshot-caveat"));
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
  searchedAddress = searchedQuery ?? "";
  groupResponses.clear();
  $("candidates").hidden = true;
  history.replaceState(
    null,
    "",
    `/parcel?parcel_id=${encodeURIComponent(item.parcel_id)}${item.objectid ? `&objectid=${encodeURIComponent(item.objectid)}` : ""}`,
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
    const summary = await api(`/api/v1/parcel?${qs}`);
    if (version !== viewVersion) return;
    $("parcel-summary").hidden = false;
    $("snapshot").hidden = false;
    $("parcel-title").textContent =
      summary.parcel.address ?? `Parcel ${summary.parcel.parcel_id}`;
    $("parcel-identifiers").textContent =
      `Parcel ID ${summary.parcel.parcel_id} · MBLU ${summary.parcel.mblu ?? "unavailable"} · Assessor account ${summary.parcel.account_number ?? "unavailable"}`;
    const alternateMatch =
      searchedQuery &&
      item.match?.method === "address-point-intersection" &&
      normalizedAddress(searchedQuery) !== normalizedAddress(summary.parcel.address);
    $("parcel-match").hidden = !alternateMatch;
    $("parcel-match").replaceChildren();
    if (alternateMatch) {
      $("parcel-match").append(document.createTextNode(
        `${searchedQuery} is a city address point on this parcel. The parcel lists ${summary.parcel.address ?? "another address"}. Check the building before relying on the match.`,
      ));
    }
    renderSnapshot();
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
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 20 });
    leaflet.control.scale({ metric: false, imperial: true }).addTo(map);
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
      renderSnapshot();
      const definition = groups.find((group) => group[0] === id);
      section.replaceChildren();
      const heading = el("div", null, "group-heading");
      heading.append(el("h2", definition[1]));
      heading.append(el("span", `${data.total} ${data.total === 1 ? "record" : "records"}`, "group-count"));
      section.append(heading);
      section.append(el("p", definition[2], "group-intro"));
      if (id === "activity") {
        const municipal = data.sources.find((source) => source.source_id === "municity");
        if (municipal?.category_counts) {
          const categories = el("div", null, "category-strip");
          for (const [kind, count] of Object.entries(municipal.category_counts)) {
            const missing = count == null;
            const truncated = municipal.truncated_categories?.includes(kind);
            categories.append(el("span", `${kind}: ${missing ? "not returned" : truncated ? `${count} shown; truncated` : count}`, missing || truncated ? "category-missing" : ""));
          }
          section.append(categories);
        }
      }
      const coverage = el("details", null, "sources-panel");
      const gaps = data.sources.filter((source) => ["partial", "unavailable"].includes(source.status)).length;
      coverage.append(el("summary", `Sources checked: ${data.sources.length}${gaps ? ` · ${gaps} with gaps` : ""}`));
      const sourceList = el("div", null, "source-list");
      for (const source of data.sources) sourceLine(sourceList, source);
      coverage.append(sourceList);
      section.append(coverage);
      const records = el("div", null, "record-list");
      records.id = `records-${id}`;
      section.append(records);
      if (!data.items.length)
        records.append(el("p", "No records returned by the checked sources. Open source coverage to see any gaps.", "empty-state"));
    }
    const records = $(`records-${id}`);
    for (const item of data.items) appendRecord(records, item);
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
      : item.source_id === "parcels"
        ? "Sale date on parcel record"
        : item.category ?? sourceName(item.source_id);
  content.append(el("p", kind, "timeline-type"));
  content.append(el("h3", recordTitle(item)));
  const state = recordStatus(item);
  if (state) content.append(el("span", state, "status-pill"));
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
if (initial.has("parcel_id"))
  void choose({
    parcel_id: initial.get("parcel_id"),
    objectid: initial.get("objectid"),
  });
for (const example of document.querySelectorAll("[data-example]"))
  example.addEventListener("click", () => {
    $("query").value = example.dataset.example;
    $("search-form").requestSubmit();
  });
