import { source } from "../parcel/config.js";
import { normalizeAddress } from "../parcel/resolve.js";
import { eventDateLabel, fieldLabel, recordStatus, recordTitle, shortDate } from "./parcel-record-text.js";

const chapters = {
  property: "Property and assessment",
  ownership: "Ownership and sales",
  geography: "Zoning and boundaries",
  activity: "Permits and municipal activity",
  business: "Businesses and registrations",
  representation: "Local representation",
  environment: "Environmental records",
};
const categories = {
  Permit: "Permits", Application: "Applications", License: "Licenses", Complaint: "Complaints",
  Certificate: "Certificates", Document: "Documents", Occupant: "Occupants", Contact: "Contacts",
};
const businessRecordTypes = {
  "municipal-business-licenses": "City business license",
  "municipal-occupants": "City occupant record",
  "ct-public-charities": "State charity registration",
  "ct-liquor-permits": "State liquor permit",
  "ct-child-care-licenses": "State child care or youth camp license",
  "ct-cannabis-retail": "State cannabis retail listing",
};
const chapterExplanations = {
  ownership: "Sale prices come from the City parcel or assessor records. A published $0 is kept as recorded. Use official land records to confirm title and transfers.",
  activity: "Dates and statuses come from the municipal record. Check a permit’s inspection or closeout records to verify completion.",
  business: "City licenses and State permits show the address on the credential. State charity registrations show the organization’s registered address. Check current occupancy separately.",
};
const timelineMirrors = new Set(["municipal-business-licenses", "municipal-occupants"]);
const labels = {
  mblu: "MBLU", dba: "DBA", owner_name_1: "Owner", owner_name_2: "Co-owner", co_line: "Care of",
  book_page: "Book and page", year_building_built: "Year built", total_land_area_acres: "Land area (acres)",
  site_address_as_published: "Site address",
  gross_area_sq_ft: "Gross area (sq ft)", living_area_sq_ft: "Living area (sq ft)",
  k8_attendance_zone_school: "K–8 school preference", high_school_attendance_zone_school: "High school preference",
  registered_address_as_published: "Registered address", fullcredentialcode: "Registration number",
  businessname: "Legal name", issuedate: "Issue date", expirationdate: "Expiration date", LegalAddress: "Recorded address",
  PermitNo: "Permit number", PermitNumber: "Permit number", ApplicationNumber: "Application number",
  ApplicaNo: "Application number", nh_ward: "Ward", zone_as_published: "Assessor parcel zone field",
  total_assessed_bldg_value: "Assessed building value", total_assessed_bldg_xf_value: "Assessed building and extra features",
  total_assessed_improvements: "Assessed improvements", total_assessed_land_value: "Assessed land value",
  total_assessed_land_outbldg: "Assessed land and outbuildings", total_assessed_extra_features: "Assessed extra features",
  total_assessed_parcel_value_x: "City assessed parcel value (X)",
  total_assessed_parcel_value_y: "City assessed parcel value (Y)",
};
const municipalFields = {
  Permit: ["PermitNo", "PermitNumber", "PermitType", "Description", "LegalAddress", "PermitDate", "IssueDate", "ExpirationDate",
    "PermStatus", "Department", "WorkType", "EstCost", "EstimatedCost"],
  Application: ["ApplicationNumber", "ApplicaNo", "ApplicationType", "Description", "LegalAddress",
    "ApplicationDate", "PermitApplicationStatus", "ApplicationStatus", "Department"],
  License: ["BusinessName", "LicenseNumber", "LicenseType", "LegalAddress", "Addr1", "IssueDate", "ExpirationDate", "Status"],
  Certificate: ["CertificateNumber", "CertificateType", "LegalAddress", "Description", "CertificateDate", "Status"],
  Contact: ["contact_name", "contact_role", "contact_type"],
};
const selectedFields = {
  assessor: ["building_facts"],
  zoning: ["zone_code", "districts", "district_category"],
  neighborhoods: ["neighborhood", "neighborhood_label", "neighborhood_name", "name"],
  wards: ["ward", "ward_label"],
  "ct-public-charities": ["businessname", "dba", "credential", "fullcredentialcode", "registered_address_as_published",
    "city", "status", "statusreason", "issuedate", "expiration_date"],
};
const coverageStatus = {
  ok: "Returned records", no_records: "No records returned", partial: "Partial response",
  unavailable: "Unavailable", not_linked: "Parcel link unavailable", not_integrated: "Outside current coverage",
};
const blank = /^(?:[-–—]+|n\/?a|null|undefined|not (?:provided|listed|published|available))$/i;
const escape = (value) => String(value).replace(/[&<>"']/g,
  (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const sourceTitle = (id) => source(id)?.title ?? fieldLabel(id.replaceAll("-", " "));
const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
};
const external = (url, text, accessibleName) => {
  const href = safeUrl(url);
  return href ? `<a href="${escape(href)}" rel="noreferrer"${accessibleName ? ` aria-label="${escape(accessibleName)}"` : ""}>${escape(text)}</a>` : "";
};
const page = (title, body) => `<!doctype html><html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow"><title>${escape(title)}</title>
  <link rel="stylesheet" href="/leaflet/leaflet.css"><link rel="stylesheet" href="/parcel-report.css">
  </head><body>${body}</body></html>`;

export function renderReportMessage(title, message) {
  return page(title, `<main class="report"><h1>${escape(title)}</h1><p>${escape(message)}</p>
    <a href="/parcel">Open parcel search</a></main>`);
}

function valueText(value, key = "") {
  if (value == null || typeof value === "object") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value).trim();
  if (!text || blank.test(text)) return "";
  if (/^year_(?:building_)?built$/.test(key) && /^0+$/.test(text)) return "";
  if (typeof value === "number" && /^(?:price|sale_price|total_assessed_)/i.test(key))
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
  if (/date/i.test(key) && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(text)) return shortDate(text.slice(0, 10));
  if (/date/i.test(key) && /^\/Date\(\d+(?:[+-]\d{4})?\)\/$/.test(text)) {
    const parsed = new Date(Number(text.match(/\d+/)[0]));
    if (Number.isFinite(parsed.valueOf())) return shortDate(parsed.toISOString().slice(0, 10));
  }
  return text;
}

function fieldEntries(data, allowed, parent = "") {
  return Object.entries(data ?? {}).flatMap(([key, value]) => {
    const technical = /^(?:objectid|fid|globalid|pid|parcel_id|section_id|table_number|row_number|lblPid|credentialid|source_id|shape__.*)$/i.test(key) ||
      /(?:_url|_source_field|_objectids?|_row_ids)$/i.test(key);
    if (allowed ? !allowed.includes(key) : technical) return [];
    const name = labels[key] ?? fieldLabel(key.replace(/_as_published$/, ""));
    const label = parent ? `${parent} · ${name}` : name;
    if (Array.isArray(value)) {
      const publishedRows = value.filter((row) => row?.label_as_published && valueText(row.value_as_published));
      if (publishedRows.length)
        return publishedRows.map((row) => [row.label_as_published, valueText(row.value_as_published)]);
      const values = value.map((entry) => valueText(entry, key)).filter(Boolean);
      const rows = value.flatMap((entry, index) => entry && typeof entry === "object"
        ? fieldEntries(entry, null, `${label} ${index + 1}`) : []);
      return [...(values.length ? [[label, [...new Set(values)].join(", ")]] : []), ...rows];
    }
    if (value && typeof value === "object") return fieldEntries(value, null, name === "Building facts" ? "" : label);
    const text = valueText(value, key);
    return text ? [[label, text]] : [];
  });
}

function fieldList(entries) {
  if (!entries.length) return "";
  return `<dl class="record-fields">${entries.map(([label, value, id]) =>
    `<div><dt>${escape(label)}</dt><dd>${id ? `<a href="#${escape(id)}">${escape(value)}</a>` : escape(value)}</dd></div>`).join("")}</dl>`;
}

const permitNumber = (a) => valueText(a.PermitNo) || valueText(a.PermitNumber);

function permitHeading(item) {
  const a = item.attributes ?? {};
  return [valueText(a.PermitType), permitNumber(a)].filter(Boolean).join(" · ");
}

function titleFor(item) {
  const a = item.attributes ?? {};
  if (item.source_id === "assessor-sales") return a.owner || "Assessor ownership history";
  if (item.source_id === "parcel-sale") return "Sale on City parcel record";
  if (item.source_id === "neighborhoods") return a.neighborhood || a.neighborhood_label || sourceTitle(item.source_id);
  if (item.source_id === "wards") return a.ward ? `Ward ${a.ward}` : sourceTitle(item.source_id);
  if (item.source_id === "municity" && item.category === "Permit") return permitHeading(item) || "Permit record";
  const name = valueText(recordTitle(item));
  return name && name !== String(item.source_record_id) && !/\bnot listed\b/i.test(name)
    ? name : item.category ? `${item.category} record` : sourceTitle(item.source_id);
}

function meaningfulFields(item) {
  return fieldEntries(item.attributes, selectedFields[item.source_id] ??
    (item.source_id === "municity" ? municipalFields[item.category] : null));
}

function publishedDate(item) {
  if (item.event_date) return item.event_date;
  const year = String(item.attributes?.valuation_year ?? "").trim();
  return item.source_id === "assessor-valuations" && /^\d{4}$/.test(year) ? year : "";
}

const newestFirst = (a, b) => publishedDate(b.item).localeCompare(publishedDate(a.item));

function recordRow(item, id, title, candidates) {
  const a = item.attributes ?? {};
  const permit = item.source_id === "municity" && item.category === "Permit";
  const businessType = businessRecordTypes[item.source_id];
  const address = permit ? valueText(a.LegalAddress) : businessType
    ? valueText(a.registered_address_as_published ?? a.site_address_as_published ?? a.recorded_address) : "";
  const addressLabel = item.source_id === "ct-public-charities" ? "Registered address" :
    a.site_address_as_published && businessType ? "Site address" : "Recorded address";
  const description = permit ? valueText(a.Description) : "";
  const status = valueText(recordStatus(item));
  const dateLabel = eventDateLabel(item);
  const dateText = shortDate(item.event_date);
  const date = item.event_date
    ? `<span class="record-date"><span>${escape(dateLabel)}</span> <time datetime="${escape(item.event_date)}">${escape(dateText)}</time></span>`
    : permit ? '<span class="undated">Date unpublished</span>' : "";
  const primary = new Map();
  if (permit) {
    primary.set("permit type", valueText(a.PermitType));
    primary.set("permit number", permitNumber(a));
    primary.set("description", description);
    if (dateLabel === "Permit date") primary.set("permit date", valueText(a.PermitDate, "PermitDate"));
  }
  if (address) primary.set(addressLabel.toLowerCase(), address);
  const fields = [...new Map(candidates.filter(([label, value]) => {
    if (primary.get(label.toLowerCase()) === value) return false;
    // Title and status comparisons apply to their own fields so equal values under
    // other labels (such as Permit type and Department) retain their meaning.
    return !(/^(?:status|perm status|record status|registry status|(?:permit )?application status|comp status)$/i.test(label) && value === status) &&
      !(/^(?:owner|business name|legal name|occupant name|document name|contact name)$/i.test(label) && value === title);
  })
    .map((row) => [row.join("\u0000"), row])).values()];
  const recordNumber = permit ? permitNumber(a) : "";
  const sourceLink = recordNumber ? external(item.source_url, `Open permit ${recordNumber}`)
    : external(item.source_url, "Open source", `Open source for ${title}`);
  return `<article class="record" id="${id}">
    <div class="record-head"><h4 tabindex="-1">${escape(title)}</h4>${sourceLink}</div>
    ${date || status || address ? `<div class="record-meta">${date}
      ${status ? `<span class="status">${escape(status)}</span>` : ""}
      ${address ? `<span>${addressLabel} <strong>${escape(address)}</strong></span>` : ""}</div>` : ""}
    ${description ? `<p class="record-description">${escape(description)}</p>` : ""}${fieldList(fields)}</article>`;
}

function timeline(items) {
  const originalIds = new Set(items.filter(({ item }) => item.source_id === "municity")
    .map(({ item }) => item.source_record_id));
  const dated = items.filter(({ item }) => item.event_date &&
      !(timelineMirrors.has(item.source_id) && originalIds.has(item.source_record_id)))
    .sort(newestFirst);
  if (!dated.length) return "";
  const years = Map.groupBy(dated, ({ item }) => item.event_date.slice(0, 4));
  return `<section id="history" class="report-section"><h2 tabindex="-1">Parcel history</h2>
    ${[...years].map(([year, rows]) => `<details class="history-year" open>
      <summary>${escape(year)} <span>${rows.length} dated ${rows.length === 1 ? "record" : "records"}</span></summary>
      <ol>${rows.map(({ item, id, title }) => `<li>
        <time datetime="${escape(item.event_date)}">${escape(shortDate(item.event_date))}</time>
        <div><a href="#${id}">${escape(title)}</a><span>${escape(eventDateLabel(item))} · ${escape(sourceTitle(item.source_id))}</span></div>
        </li>`).join("")}</ol></details>`).join("")}</section>`;
}

function coverageIssues(sources) {
  return sources.filter((entry) => entry.status === "unavailable" || entry.status === "partial" ||
    entry.omitted_categories?.length || (entry.count_established === false && ["ok", "no_records"].includes(entry.status)));
}

function coverageNotice(issues) {
  if (!issues.length) return "";
  const problem = (entry) => {
    if (entry.status === "unavailable") return "Unavailable when the report was generated.";
    const details = [
      entry.omitted_categories?.length ? `The response omitted these categories — ${entry.omitted_categories.join(", ")}.` : "",
      entry.truncated_categories?.length ? `Record limit reached for ${entry.truncated_categories.join(", ")}.` : "",
    ].filter(Boolean).join(" ");
    return details || "The response provided partial coverage.";
  };
  return `<div class="coverage-note"><p><strong>Incomplete source checks</strong> · <a href="#sources">See source coverage</a></p>
    <ul>${issues.map((entry) => `<li><span>${escape(entry.source_id === "municity" ? "Municipal parcel service" : sourceTitle(entry.source_id))}</span> · ${escape(problem(entry))}</li>`).join("")}</ul></div>`;
}

function recordChapter(key, entries, issues) {
  if (!entries.length && !issues.length) return "";
  const sections = Map.groupBy(entries, ({ item }) =>
    item.source_id === "municity" && item.category ? categories[item.category] ?? item.category
      : businessRecordTypes[item.source_id] ?? sourceTitle(item.source_id));
  return `<section id="${key}" class="report-section"><h2 tabindex="-1">${chapters[key]}</h2>
    ${entries.length && chapterExplanations[key] ? `<p class="chapter-note">${chapterExplanations[key]}</p>` : ""}
    ${coverageNotice(issues)}
    ${[...sections].map(([heading, rows]) => `<details class="record-section" open>
      <summary><h3>${escape(heading)}</h3><span>${rows.length}</span></summary>
      ${rows.sort(newestFirst).map(({ item, id, title, fields }) => recordRow(item, id, title, fields)).join("")}
      </details>`).join("")}</section>`;
}

function coverageSection(groups, addresses, photo, context) {
  const statusDescription = (entry) => coverageStatus[entry.count_established === false ||
    entry.omitted_categories?.length ? "partial" : entry.status] ?? fieldLabel(entry.status);
  const row = (entry, title) => `<tr><th scope="row">${external(entry.source_url, title) || escape(title)}</th>
    <td>${escape(statusDescription(entry))}
    ${entry.count > 0 ? ` · ${Number(entry.count).toLocaleString("en-US")} returned` : ""}
    ${entry.warning || entry.note || entry.coverage ? `<p>${escape(entry.warning ?? entry.note ?? entry.coverage)}</p>` : ""}</td></tr>`;
  return `<section id="sources" class="report-section"><h2 tabindex="-1">Sources and coverage</h2>
    <p class="caption">Source dates describe the published records. This report was generated from the records available at the time of the request.</p>
    <details class="record-section" open><summary><h3>Parcel records</h3></summary>
    <table><thead><tr><th scope="col">Source</th><th scope="col">Response</th></tr></thead>
    <tbody>${groups.flatMap(({ sources }) => sources).map((entry) => row(entry, sourceTitle(entry.source_id))).join("")}</tbody></table></details>
    <details class="record-section" open><summary><h3>Photo and map</h3></summary>
    <table><thead><tr><th scope="col">Source</th><th scope="col">Response</th></tr></thead><tbody>
    ${row(photo, "Parcel photograph")}${row(addresses, "City-mapped addresses")}
    ${context?.layers.map((layer) => row(layer, layer.title)).join("") ??
      row({ status: "unavailable" }, "City map overlays")}</tbody></table></details></section>`;
}

function reportMap(geometry, context, parcel, photograph) {
  const heading = '<section id="map" class="report-section"><h2 tabindex="-1">Parcel and surrounding streets</h2>';
  if (!geometry) return `${heading}
    <p>City parcel geometry was unavailable for this report.</p>${external(parcel.source_url, "Open City parcel record")}
    ${photograph}</section>`;
  const layers = (context?.layers ?? []).filter(({ features }) => features.length);
  const data = JSON.stringify({ geometry, layers, radius: context?.nearby_radius_m ?? 400 })
    .replaceAll("<", "\\u003c");
  return `${heading}<div class="report-visuals${photograph ? " with-photo" : ""}"><div>
    <figure class="map-figure"><div id="report-map" role="region" aria-label="Map of the selected parcel and surrounding streets" tabindex="0"></div>
    <figcaption><span class="map-key parcel-key">City parcel boundary</span>
    ${external(parcel.source_url, "City GIS parcel")}</figcaption></figure>
    <p id="report-map-status" class="caption" role="status">Loading street map…</p>
    ${layers.length ? `<fieldset class="map-options"><legend>Map layers</legend>
      ${layers.map((layer) => `<label><input type="checkbox" value="${escape(layer.id)}"${["parcel-addresses", "transit-stops"].includes(layer.id) ? " checked" : ""}> <span class="map-key" data-layer="${escape(layer.id)}">${escape(layer.title)}</span></label>`).join("")}</fieldset>` : ""}
    ${layers.some(({ scope }) => scope === "nearby") ? `<p class="caption">Nearby layers cover ${escape(context.nearby_radius_m)} meters from the parcel map center.</p>` : ""}
    <noscript><p>Enable JavaScript to view the street map.</p></noscript></div>${photograph}</div>
    <script type="application/json" id="report-map-data">${data}</script></section>`;
}

function recordSummary(entries, label, include, describe) {
  const latest = entries.filter(({ item }) => item.event_date && include(item)).sort(newestFirst)[0];
  return latest ? [[label, describe(latest), latest.id]] : [];
}

export function renderParcelReport({ parcel, searchedAddress, addresses, groups, photo, geometry, context, generated_at }) {
  const title = valueText(parcel.address) || `Parcel ${parcel.parcel_id}`;
  const query = new URLSearchParams({ parcel_id: parcel.parcel_id, objectid: parcel.objectid });
  if (searchedAddress) query.set("query_address", searchedAddress);
  let number = 0;
  const rows = Object.keys(chapters).map((id) => [id, (groups.find(({ group }) => group === id)?.items ?? [])
    .filter(({ source_id }) => source_id !== "parcels" && source_id !== "addresses")
    .flatMap((item) => {
      const fields = meaningfulFields(item);
      return fields.length || item.event_date || valueText(recordStatus(item)) || item.attributes?.public_document_url
        ? [{ item, fields, title: titleFor(item), id: `record-${++number}` }] : [];
    })]);
  const allRows = rows.flatMap(([, entries]) => entries);
  const history = timeline(allRows);
  const issues = new Map(groups.map(({ group, sources }) => [group, coverageIssues(sources)]));
  const affected = rows.filter(([id]) => issues.get(id)?.length).length;
  const navigation = [["map", "Map and photo"], ...(history ? [["history", "History"]] : []),
    ...rows.filter(([id, entries]) => entries.length || issues.get(id)?.length).map(([id]) => [id, chapters[id]]),
    ["sources", "Sources and coverage"]];
  const checked = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York",
  }).format(new Date(generated_at));
  const photoUrl = photo.status === "ok" ? safeUrl(photo.photo_url) : null;
  const photograph = photoUrl ? `<figure class="property-photo">
    <img id="report-photo" src="${escape(photoUrl)}" alt="Official parcel photograph of ${escape(title)}">
    <figcaption>${external(photo.source_url, photo.photo_source_id === "assessor" ? "Assessor photograph" : "City parcel photograph")}
      <span id="report-photo-status">Photo date unpublished</span></figcaption></figure>` : "";
  const identity = [["Parcel ID", parcel.parcel_id], ["MBLU", parcel.mblu], ["Assessor account", parcel.account_number]]
    .map(([label, value]) => [label, valueText(value)]).filter(([, value]) => value);
  const differentAddress = searchedAddress && normalizeAddress(searchedAddress) !== normalizeAddress(parcel.address);
  const items = groups.flatMap(({ items }) => items);
  const attributes = (id) => items.find(({ source_id }) => source_id === id)?.attributes ?? {};
  const assessment = attributes("parcel-assessment");
  const values = (id, field) => [...new Set(items.filter(({ source_id }) => source_id === id)
    .map(({ attributes }) => valueText(attributes[field])).filter(Boolean))].join(", ");
  const assessedUse = valueText(attributes("assessor-land").use_description_as_published);
  const facts = [["City zoning", values("zoning", "zone_code"), "geography"],
    [assessedUse ? "Assessor land use" : "City parcel use code",
      assessedUse || valueText(assessment.use_code), "property"],
    ["City-mapped neighborhoods", values("neighborhoods", "neighborhood") || values("neighborhoods", "neighborhood_label")],
    ["Ward", values("wards", "ward")],
    ["Year built", valueText(assessment.year_building_built, "year_building_built")],
    ["Land area (acres)", valueText(assessment.total_land_area_acres)],
    ...recordSummary(allRows, "Latest sale in returned records",
      (item) => item.source_id === "parcel-sale" || item.source_id === "assessor-sales", ({ item }) => {
        const { price, sale_price } = item.attributes;
        const amount = valueText(price ?? sale_price, "price");
        return [shortDate(item.event_date), amount, item.source_id === "parcel-sale" ? "City parcel" : "Assessor"].filter(Boolean).join(" · ");
      }),
    ...recordSummary(allRows, "Latest dated City permit", (item) => item.source_id === "municity" && item.category === "Permit",
      ({ item, title }) => [`${eventDateLabel(item)} ${shortDate(item.event_date)}`, title, valueText(recordStatus(item))]
        .filter(Boolean).join(" · ")),
  ].filter(([, value]) => value);
  const mapped = addresses.addresses.length ? `<div class="mapped-addresses"><h2>City-mapped addresses</h2>
    <ul>${addresses.addresses.map(({ address, units }) => `<li>${escape(address)}${units.length ? ` <span>· ${units.length === 1 ? "Unit" : "Units"} ${escape(units.join(", "))}</span>` : ""}</li>`).join("")}</ul></div>` : "";
  return page(`${title} · Property report`, `<a class="skip" href="#property-report">Skip to property report</a>
    <header class="report-bar"><div>
      <a href="/parcel?${escape(query)}">← Parcel records</a>
      <button type="button" id="print-report" hidden>Print report</button>
    </div></header><main class="report" id="property-report">
    <header class="report-title">
      <p class="eyebrow">New Haven Civic Data · Property report</p><h1>${escape(title)}</h1>
      ${differentAddress ? `<p class="searched-address">Searched address <strong>${escape(searchedAddress)}</strong></p>` : ""}
      ${mapped}
      <div class="report-identity">${fieldList(identity)}
      <p class="caption">Generated <time datetime="${escape(generated_at)}">${escape(checked)} ET</time></p></div>
    </header>
    ${facts.length || affected ? `<section class="report-facts"><h2>Property at a glance</h2>${fieldList(facts)}
      ${affected ? `<p class="coverage-summary"><strong>Incomplete source checks in ${affected} ${affected === 1 ? "section" : "sections"}</strong>
        <a href="#sources">See source coverage</a></p>` : ""}</section>` : ""}
    <nav class="report-nav" aria-label="Report sections">
      <div class="report-nav-links">${navigation.map(([id, label]) => `<a href="#${id}">${escape(label)}</a>`).join("")}</div>
      <div class="report-jump" hidden><label for="report-section-select">Jump to</label>
        <select id="report-section-select">${navigation.map(([id, label]) => `<option value="${id}">${escape(label)}</option>`).join("")}</select>
        <button type="button" id="report-section-go">Go</button></div>
    </nav>
    ${reportMap(geometry, context, parcel, photograph)}${history}
    ${rows.map(([id, entries]) => recordChapter(id, entries, issues.get(id) ?? [])).join("")}
    ${coverageSection(groups, addresses, photo, context)}
    </main><script src="/leaflet/leaflet.js" defer></script><script src="/parcel-report.js" type="module"></script>`);
}
