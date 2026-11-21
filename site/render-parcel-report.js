import { source } from "../parcel/config.js";
import { normalizeAddress } from "../parcel/resolve.js";
import { eventDateLabel, fieldLabel, recordStatus, recordTitle, shortDate } from "./parcel-record-text.js";
import { calc, coverageBar, coverageNote, coveragePill, coverageState, coverageTone, escape, factTile, fields,
  icon, ledger, panel, pill, recordSourceLink, safeUrl, section, sourceChecks, sourceLink, split, stack,
  verbatim } from "./plat/components.js";
import { areaBars, categoryNames, glyph, platDrawing, projectAround, publishedNumber, timelineChart,
  valuationBars } from "./plat/graphics.js";

const chapters = {
  property: "Property and assessment",
  ownership: "Ownership and sales",
  geography: "Zoning and boundaries",
  activity: "Permits and municipal activity",
  business: "Businesses and tenants",
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
  business: "City occupant records list reported occupants. City licenses and State permits show the address on the credential. State charity registrations show the organization’s registered address. Check current occupancy separately.",
};
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
  occupant_id: "City occupant ID",
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
const blank = /^(?:[-–—]+|n\/?a|null|undefined|not (?:provided|listed|published|available))$/i;
const sourceTitle = (id) => source(id)?.title ?? fieldLabel(id.replaceAll("-", " "));
const page = (title, body) => `<!doctype html><html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow"><title>${escape(title)}</title>
  <link rel="stylesheet" href="/leaflet/leaflet.css">
  <link rel="stylesheet" href="/plat/plat-tokens.css"><link rel="stylesheet" href="/plat/plat-fonts.css">
  <link rel="stylesheet" href="/plat/plat.css"><link rel="stylesheet" href="/parcel-report.css">
  </head><body class="plat">${body}</body></html>`;

export function renderReportMessage(title, message) {
  return page(title, `<div class="p-page"><main class="p-sheet p-masthead report-message">
    <h1 class="t-section">${escape(title)}</h1><p>${escape(message)}</p><a href="/parcel">Open parcel search</a></main></div>`);
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

function fieldEntries(data, allowed, parent = "", verbatimValue = false) {
  const display = (value, key) => verbatimValue && valueText(value, key) ? String(value) : valueText(value, key);
  return Object.entries(data ?? {}).flatMap(([key, value]) => {
    const technical = /^(?:objectid|fid|globalid|pid|parcel_id|section_id|table_number|row_number|lblPid|credentialid|source_id|shape__.*)$/i.test(key) ||
      /(?:_url|_source_field|_objectids?|_row_ids)$/i.test(key);
    if (allowed ? !allowed.includes(key) : technical) return [];
    const name = labels[key] ?? fieldLabel(key.replace(/_as_published$/, ""));
    const label = parent ? `${parent} · ${name}` : name;
    if (Array.isArray(value)) {
      const publishedRows = value.filter((row) => row?.label_as_published && valueText(row.value_as_published));
      if (publishedRows.length)
        return publishedRows.map((row) => [row.label_as_published, display(row.value_as_published)]);
      const values = value.map((entry) => display(entry, key)).filter(Boolean);
      const rows = value.flatMap((entry, index) => entry && typeof entry === "object"
        ? fieldEntries(entry, null, `${label} ${index + 1}`, verbatimValue) : []);
      return [...(values.length ? [[label, (verbatimValue ? values : [...new Set(values)]).join(", ")]] : []), ...rows];
    }
    if (value && typeof value === "object") return fieldEntries(value, null, name === "Building facts" ? "" : label, verbatimValue);
    const text = display(value, key);
    return text ? [[label, text]] : [];
  });
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

function meaningfulFields(item, verbatimValue) {
  return fieldEntries(item.attributes, selectedFields[item.source_id] ??
    (item.source_id === "municity" ? municipalFields[item.category] : null), "", verbatimValue);
}

function publishedDate(item) {
  if (item.event_date) return item.event_date;
  const year = String(item.attributes?.valuation_year ?? "").trim();
  return item.source_id === "assessor-valuations" && /^\d{4}$/.test(year) ? year : "";
}

const newestFirst = (a, b) => publishedDate(b.item).localeCompare(publishedDate(a.item));

const countText = new Intl.NumberFormat("en-US");
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" });
const recordCount = (count, label = "record") => `${countText.format(count)} ${label}${count === 1 ? "" : "s"}`;
const descriptionFor = (item) => item.category === "Permit" ? valueText(item.attributes?.Description) : "";
const addressFor = ({ attributes: a = {} }) =>
  valueText(a.registered_address_as_published ?? a.site_address_as_published ?? a.recorded_address ?? a.LegalAddress ?? a.Addr1);
const identifierFor = ({ attributes: a = {} }) => valueText(permitNumber(a) || a.LicenseNumber || a.license_number ||
  a.fullcredentialcode || a.credential_number || a.credential || a.ApplicationNumber || a.ApplicaNo || a.CertificateNumber || a.complaint_number);
const formattedCurrency = (value) => publishedNumber(value) === null ? valueText(value) : currency.format(publishedNumber(value));
const alias = (id) => `<span class="report-anchor" id="${id}" tabindex="-1"></span>`;
const preferredSale = (row) => row.item.attributes.sale_price ?? row.item.attributes.price;
const provenance = (row) => ({
  ...row, raw: [...row.item.event_date ? [[row.dateLabel, row.item.event_date]] : [], ...row.raw],
});
const plotLegend = (entries, attr) => `<div class="p-legend" aria-label="${attr === "cat" ? "Timeline filters" : "Coverage filters"}">
    ${entries.map(([key, title]) => `<button type="button" class="p-chip" data-filter-${attr}="${key}" aria-pressed="false">
      ${attr === "cat" ? glyph(key) : ""}${escape(title)}</button>`).join("")}</div>`;

function linkedRows(primary, secondary, primaryKey, secondaryKey) {
  const candidates = Map.groupBy(primary.filter((row) => primaryKey(row)), primaryKey);
  const links = new Map();
  for (const row of secondary) {
    const matches = candidates.get(secondaryKey(row));
    if (matches?.length !== 1) continue;
    if (!links.has(matches[0].id)) links.set(matches[0].id, []);
    links.get(matches[0].id).push(row);
  }
  return links;
}

function recordCard(row, { merged = [], extra = "", compact = false, className = "" } = {}) {
  const { item, id, title, dateLabel, dateText, status, address, identifier } = row;
  const permit = item.source_id === "municity" && item.category === "Permit";
  const addressLabel = item.source_id === "ct-public-charities" ? "Registered address" :
    item.attributes?.site_address_as_published ? "Site address" : "Recorded address";
  const description = descriptionFor(item);
  const date = item.event_date
    ? `<span class="record-date">${escape(dateLabel)} <time datetime="${escape(item.event_date)}">${escape(dateText)}</time></span>`
    : permit ? '<span>Date unpublished</span>' : "";
  const words = identifier && title.endsWith(` · ${identifier}`) ? title.slice(0, -identifier.length - 3) : title;
  const primary = new Map([
    [addressLabel.toLowerCase(), address], ["description", description], ["permit type", valueText(item.attributes?.PermitType)],
    ["permit number", identifier], ...dateLabel === "Permit date" ? [["permit date", valueText(item.attributes?.PermitDate, "PermitDate")]] : [],
  ]);
  const summary = row.fields.filter(([label, value]) => primary.get(label.toLowerCase()) !== value &&
    !(label.toLowerCase().endsWith("status") && value === status) &&
    !(label.toLowerCase().endsWith("name") && value === words));
  const occupant = item.source_id === "municipal-occupants";
  const published = occupant ? [row] : [row, ...merged];
  const sourceRows = occupant ? [...new Map([row, ...merged]
    .map((entry) => [entry.item.source_url, entry])).values()] : [row];
  const links = sourceRows.map(recordSourceLink).filter(Boolean);
  const recordSource = links.length > 1 ? `<div class="p-record__sources">${links.join("")}</div>` : links[0] ?? "";
  const display = compact ? [] : summary.slice(0, 8);
  return `<article class="p-record record${className ? ` ${className}` : ""}" id="${id}">
    ${merged.map(({ id }) => alias(id)).join("")}
    <div class="p-record__head record-head"><h4 class="p-record__title" tabindex="-1">${escape(words)}${identifier && words !== identifier
      ? ` <span class="t-id">${escape(identifier)}</span>` : ""}</h4>${recordSource}</div>
    ${date || status || address ? `<div class="p-record__meta record-meta">${date} ${pill(status)}
      ${address ? `<span>${addressLabel} <strong>${escape(address)}</strong></span>` : ""}</div>` : ""}
    ${description ? `<p class="p-record__desc record-description">${escape(description)}</p>` : ""}
    ${extra}${fields(display)}
    ${verbatim(published.map(provenance))}
  </article>`;
}

function groupsView(rows, { columns = false } = {}) {
  const named = Map.groupBy(rows, ({ item }) =>
    item.source_id === "municity" && item.category ? categories[item.category] ?? item.category
      : businessRecordTypes[item.source_id] ?? sourceTitle(item.source_id));
  return [...named].map(([title, records]) => `<details class="p-group record-section" open><summary>
    <h3 class="t-group">${escape(title)}</h3><span class="p-count">${records.length}</span></summary>
    <div class="p-records"${columns ? ' data-cols="2"' : ""}>${records.sort(newestFirst).map((row) => recordCard(row)).join("")}</div>
  </details>`).join("");
}

function eventCategory(item) {
  if (["parcel-sale", "assessor-sales"].includes(item.source_id)) return "sale";
  if (item.source_id === "lci-cases" || item.category === "Complaint") return "enforcement";
  if (item.category === "Document") return "document";
  if (["License", "Registration"].includes(item.category) || businessRecordTypes[item.source_id]) return "license";
  return "permit";
}

function reportTimeline(rows, generatedAt) {
  const originals = new Set(rows.filter(({ item }) => item.source_id === "municity").map(({ item }) => item.source_record_id));
  const occupants = new Set(rows.filter(({ item }) => item.source_id === "municity" && item.category === "Occupant")
    .map(occupantProjectionKey).filter(Boolean));
  const dated = rows.filter((row) => {
    const { item } = row;
    return item.event_date && /^\d{4}-/.test(item.event_date) &&
      !(item.source_id === "municipal-business-licenses" && originals.has(item.source_record_id)) &&
      !(item.source_id === "municipal-occupants" && occupants.has(occupantProjectionKey(row)));
  }).sort(newestFirst);
  if (!dated.length) return null;
  const years = Map.groupBy(dated, ({ item }) => item.event_date.slice(0, 4));
  const used = new Set(dated.map(({ eventCategory }) => eventCategory));
  const filters = plotLegend(Object.entries(categoryNames).filter(([key]) => used.has(key)), "cat");
  const list = `<div class="p-years">${[...years].map(([year, events]) => `<details class="p-year history-year" open><summary>
    <span class="p-year__num">${year}</span><span class="p-year__glyphs">${[...new Set(events.map((row) => row.eventCategory))].map(glyph).join("")}</span>
    <span class="p-year__n">${recordCount(events.length, "dated record")}</span></summary><ol>
    ${events.map(({ item, id, title, eventCategory: category, dateText, dateLabel }) => `<li data-cat="${category}">
      <time datetime="${escape(item.event_date)}">${escape(dateText)}</time>${glyph(category)}
      <div><a href="#${id}">${escape(title)}</a><span class="t-caption">${escape(dateLabel)} · ${escape(sourceTitle(item.source_id))}</span></div>
    </li>`).join("")}</ol></details>`).join("")}</div>`;
  return { id: "history", label: "Parcel history", count: dated.length,
    html: section("history", "Parcel history", `<div class="p-timeline">
      ${timelineChart(years, Number(generatedAt.slice(0, 4)))}${filters}${list}</div>`, {
      stat: `${recordCount(dated.length, "dated record")} · ${years.size} ${years.size === 1 ? "year" : "years"} with activity`,
    }) };
}

function makeRows(groups) {
  let number = 0;
  return Object.keys(chapters).flatMap((chapter) => (groups.find(({ group }) => group === chapter)?.items ?? [])
    .filter(({ source_id }) => source_id !== "parcels" && source_id !== "addresses").flatMap((item) => {
      const fields = meaningfulFields(item);
      const status = valueText(recordStatus(item));
      if (!fields.length && !item.event_date && !status && !item.attributes?.public_document_url) return [];
      return [{ item, fields, status, id: `record-${++number}`, title: titleFor(item),
        raw: meaningfulFields(item, true), chapter, dateLabel: eventDateLabel(item), dateText: shortDate(item.event_date),
        address: addressFor(item), identifier: identifierFor(item), eventCategory: eventCategory(item) }];
    }));
}

function addressRows(addresses, primary) {
  return [...Map.groupBy(addresses, ({ address }) => address.replace(/^\S+\s+/, ""))]
    .sort(([a], [b]) => Number(normalizeAddress(primary).endsWith(` ${normalizeAddress(b)}`)) -
      Number(normalizeAddress(primary).endsWith(` ${normalizeAddress(a)}`)) || a.localeCompare(b));
}
function addressChips(addresses, primary) {
  if (!addresses.length) return "";
  return `<div class="p-addresses mapped-addresses">
    <p class="t-caption">City-mapped addresses on this parcel · ${addresses.length}</p>
    ${addressRows(addresses, primary).map(([street, entries]) => `<div><p class="t-label">${escape(street)}</p>
    <div class="p-addresses__row">${entries.map(({ address, units }) => `<span class="p-addr" title="${escape(address)}"${normalizeAddress(address) === normalizeAddress(primary) ? " data-primary" : ""}>${escape(address.split(" ")[0])}
      ${units.length ? `<small>${units.length === 1 ? "Unit" : "Units"} ${escape(units.join(", "))}</small>` : ""}</span>`).join("")}</div></div>`).join("")}
  </div>`;
}

function idTags(properties) {
  return `<div class="p-idtags">${properties.filter(([, value]) => valueText(value)).map(([label, value]) =>
    `<div class="p-idtag"><span class="p-idtag__label t-label">${escape(label)}</span>
      <span class="p-idtag__value">${escape(value)}</span><button type="button" class="p-idtag__copy" data-copy="${escape(value)}"
      aria-label="Copy ${escape(label)}">${icon("copy")}</button></div>`).join("")}</div>`;
}

function buildingFacts(rows) {
  const basics = rows.find(({ item }) => item.source_id === "assessor")?.item.attributes?.building_facts ?? {};
  const buildings = rows.filter(({ item }) => item.source_id === "assessor-buildings");
  const specific = buildings.length === 1 ? Object.fromEntries(
    [...(buildings[0].item.attributes.summary_rows ?? []), ...(buildings[0].item.attributes.attribute_rows ?? [])]
      .map(({ label_as_published, value_as_published }) => [label_as_published, value_as_published])) : {};
  return {
    living: basics.living_area_sq_ft ?? specific["Living Area"], year: basics.year_built ?? specific["Year Built"],
    stories: specific.Stories, style: specific.Style, exterior: specific["Exterior Wall 1"],
  };
}

function summaryFacts(rows) {
  const all = (id) => rows.filter(({ item }) => item.source_id === id);
  const first = (id) => all(id)[0]?.item.attributes ?? {};
  const values = (id, ...names) => [...new Set(all(id).map(({ item }) =>
    names.map((name) => valueText(item.attributes[name])).find(Boolean)).filter(Boolean))].join(", ");
  const assessments = all("assessor-valuations").sort(newestFirst);
  const assessed = assessments.find(({ item }) => item.attributes.valuation_type === "assessed");
  const year = assessed?.item.attributes.valuation_year;
  const appraised = assessments.find(({ item }) => item.attributes.valuation_type === "appraised" &&
    item.attributes.valuation_year === year);
  const ratio = publishedNumber(assessed?.item.attributes.total) / publishedNumber(appraised?.item.attributes.total);
  const sales = rows.filter(({ item }) => ["parcel-sale", "assessor-sales"].includes(item.source_id) && item.event_date).sort(newestFirst);
  const latestSale = sales[0];
  const owner = first("parcel-owner");
  const ownerName = owner.owner_name_1 || first("assessor-owner").owner_name;
  const use = first("assessor-land");
  const building = buildingFacts(rows);
  const assessment = first("parcel-assessment");
  const acres = publishedNumber(assessment.total_land_area_acres);
  const permit = rows.filter(({ item }) => item.source_id === "municity" && item.category === "Permit" && item.event_date).sort(newestFirst)[0];
  const liquor = all("ct-liquor-permits");
  const active = liquor.filter(({ status }) => status.toUpperCase() === "ACTIVE");
  const trash = values("trash-pickup", "trash_day");
  const school = values("school-attendance", "k8_attendance_zone_school");
  const high = values("school-attendance", "high_school_attendance_zone_school");
  const neighborhood = values("neighborhoods", "neighborhood_label", "neighborhood", "name");
  const ward = values("wards", "ward");
  const summary = [
    { label: `Assessed value${year ? ` · ${year}` : ""}`, value: formattedCurrency(assessed?.item.attributes.total),
      sub: appraised ? `Appraised ${formattedCurrency(appraised.item.attributes.total)}` : "",
      foot: Number.isFinite(ratio) && assessed?.item.attributes.total != null ? calc(`Assessed ÷ appraised · ${Math.round(ratio * 100)}%`) : "",
      href: assessed?.id, figure: true },
    { label: "Owner of record", value: ownerName,
      sub: latestSale ? [`Latest sale ${latestSale.dateText}`, formattedCurrency(preferredSale(latestSale))].filter(Boolean).join(" · ") : "",
      subHref: latestSale?.id, foot: pill(valueText(first("business-master").registry_status)), href: ownerName ? "ownership" : undefined },
    { label: "City zoning", value: values("zoning", "zone_code"),
      sub: [values("zoning", "district_category"), values("zoning", "districts")].filter(Boolean).join(" · "), href: "zoning" },
    { label: "Assessor land use", value: use.use_code ?? assessment.use_code, sub: use.use_description_as_published, href: "property" },
    { label: "Living area", value: building.living ? `${building.living} sq ft` : "",
      sub: [building.stories && `${building.stories} stories`, (building.year || assessment.year_building_built) &&
        `Built ${building.year || assessment.year_building_built}`, building.exterior].filter(Boolean).join(" · "),
      href: "building", figure: true },
    { label: "Land area", value: acres === null ? "" : `${assessment.total_land_area_acres} ac`,
      sub: acres === null ? "" : `≈ ${countText.format(Math.round(acres * 43560))} sq ft`,
      foot: acres === null ? "" : calc("Acres × 43,560"), figure: true, href: "property" },
    { label: "Neighborhood · Ward", value: [neighborhood, ward && `Ward ${ward}`].filter(Boolean).join(" · "), href: "zoning" },
    { label: "Latest dated City permit", value: permit?.identifier || permit?.title,
      sub: permit ? [permit.item.attributes.PermitType, `${permit.dateLabel} ${permit.dateText}`].filter(Boolean).join(" · ") : "",
      foot: pill(permit?.status), href: permit?.id },
    { label: "Liquor permits · ACTIVE status", value: liquor.length ? `${active.length} of ${liquor.length}` : "",
      sub: active.map(({ item, title }) => item.attributes.dba ?? title).join(", "), href: "business", figure: true },
    { label: "Trash day · School zone", value: trash || school, sub: [trash && school && `${school} (K–8)`, high].filter(Boolean).join(" · "), href: "services" },
  ];
  const lede = (building.stories || building.style || building.exterior) ? [
    [building.stories && `${building.stories}-story`, building.exterior, "building",
      building.style && `(assessor style ${building.style})`].filter(Boolean).join(" "),
    building.year && `built in ${building.year}`, acres !== null && `on ${assessment.total_land_area_acres} acres`,
    neighborhood && `in ${neighborhood}`, ward && `Ward ${ward}`,
  ].filter(Boolean).join(", ") + "." : "";
  return { summary, lede };
}

const sourceRows = (rows, ...ids) => rows.filter(({ item }) => ids.includes(item.source_id));
const without = (rows, consumed) => {
  const ids = new Set(consumed.map(({ id }) => id));
  return rows.filter(({ id }) => !ids.has(id));
};
const cards = (rows, options, columns = false) => rows.length
  ? `<div class="p-records"${columns ? ' data-cols="2"' : ""}>${rows.slice().sort(newestFirst).map((row) =>
    recordCard(row, typeof options === "function" ? options(row) : options)).join("")}</div>` : "";
const publishedRecords = (rows) => rows.length
  ? `<div class="p-record">${verbatim(rows.map(provenance), { anchors: true })}</div>` : "";

const buildingGroups = [
  ["Size and use", /built|living area|rooms|stories|style|occupancy|floor use|bldg use|model|bedrm|baths/i],
  ["Construction and exterior", /exterior|roof|grade|frame|construction|condition/i],
  ["Interior and systems", /interior|heating|heat\/ac|ceiling|plumb|electric|ac type|fuel/i],
  ["Assessment", /replacement cost|building percent good/i],
];

function buildingSpec(row) {
  const a = row.item.attributes;
  const published = [...a.summary_rows ?? [], ...a.attribute_rows ?? []].map(({ label_as_published, value_as_published }) =>
    [label_as_published, value_as_published]);
  if (!published.length) return "";
  const panels = buildingGroups.map(([heading, pattern]) => {
    const rows = published.filter(([label]) => pattern.test(label));
    return rows.length ? `<section><h5 class="t-label">${heading}</h5><dl>${rows.map(([label, value]) =>
      `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl></section>` : "";
  }).join("");
  const condition = published.find(([label]) => /building percent good/i.test(label))?.[1];
  const percent = publishedNumber(String(condition ?? "").replace(/%$/, ""));
  const meter = percent !== null && percent <= 100
    ? `<div class="p-meter"><div class="p-meter__row"><span>Building percent good</span><span>${escape(condition)}</span></div>
      <svg class="p-condition-meter" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="Published building percent good ${percent}%">
      <rect width="${percent}" height="8"/></svg></div>` : "";
  return meter + (panels ? `<div class="p-spec">${panels}</div>` : "");
}

function propertyView(rows) {
  const valuations = sourceRows(rows, "assessor-valuations").sort((a, b) => newestFirst(a, b) ||
    String(a.item.attributes.valuation_type ?? "").localeCompare(String(b.item.attributes.valuation_type ?? "")));
  const city = sourceRows(rows, "parcel-assessment");
  const buildings = sourceRows(rows, "assessor-buildings");
  const assessor = sourceRows(rows, "assessor");
  const land = sourceRows(rows, "assessor-land");
  const areas = sourceRows(rows, "assessor-subareas");
  const singleBuilding = buildings.length === 1;
  const buildingCards = cards([...buildings, ...singleBuilding ? [] : assessor], (row) => ({
    merged: singleBuilding ? assessor : [],
    extra: buildingSpec(row), compact: row.item.source_id === "assessor-buildings", className: "building-spec",
  }));
  const valuationView = valuations.length ? panel("Valuation history",
    `${valuationBars(valuations)}${publishedRecords(valuations)}`, { count: valuations.length }) : "";
  const totalGross = areas.map(({ item }) => publishedNumber(item.attributes.gross_area_sq_ft));
  const totalLiving = areas.map(({ item }) => publishedNumber(item.attributes.living_area_sq_ft));
  const summed = totalGross.length && totalGross.every((n) => n !== null) && totalLiving.every((n) => n !== null)
    ? `<p class="t-caption">${escape(countText.format(totalGross.reduce((a, b) => a + b, 0)))} gross sq ft ·
      ${escape(countText.format(totalLiving.reduce((a, b) => a + b, 0)))} living sq ft ${calc("Sum of returned subareas")}</p>` : "";
  return split(valuationView, panel("City parcel record", cards(city)), "7-5") +
    panel("Building", buildingCards, { id: "building", count: buildings.length || assessor.length }) +
    split(panel("Building subareas", areaBars(areas) + summed + publishedRecords(areas)), panel("Land", cards(land))) +
    groupsView(without(rows, [...valuations, ...city, ...buildings, ...assessor, ...land, ...areas]));
}

function ownershipView(rows, parcel) {
  const owners = sourceRows(rows, "parcel-owner", "assessor-owner");
  const entities = sourceRows(rows, "business-master");
  const roles = sourceRows(rows, "business-principals", "business-agents");
  const citySales = sourceRows(rows, "parcel-sale");
  const assessorSales = sourceRows(rows, "assessor-sales");
  const possible = linkedRows(assessorSales, citySales, ({ item }) => item.event_date, ({ item }) => item.event_date);
  // A matching date cannot resolve contradictory prices or multiple recorded sales.
  for (const [id, matched] of possible) {
    const assessed = preferredSale(assessorSales.find((row) => row.id === id));
    if (matched.length !== 1 || publishedNumber(preferredSale(matched[0])) !== publishedNumber(assessed)) possible.delete(id);
  }
  const sales = [...assessorSales, ...without(citySales, [...possible.values()].flat())];
  const saleCards = cards(sales, (row) => ({
    merged: possible.get(row.id),
    extra: formattedCurrency(preferredSale(row)) ? `<p class="t-figure">${escape(formattedCurrency(preferredSale(row)))}</p>` : "",
  }));
  const chain = entities.length ? `<div class="p-chain">
    <div class="p-chain__node" data-kind="parcel"><span class="t-label">City parcel</span><p class="p-chain__name">${escape(parcel.address ?? parcel.parcel_id)}</p></div>
    <div class="p-chain__rel"><span>Owner entity matched to City parcel record</span></div>
    ${cards(entities)}${roles.length ? '<div class="p-chain__rel"><span>Published registry roles</span></div>' : ""}
    <div class="p-chain__branches">${cards(roles)}</div></div>` : cards(roles);
  const comparison = [...owners, ...entities];
  const ownerTable = comparison.length ? ledger(["Source", "Name as published", "Address as published"],
    `<tbody>${comparison.map(({ id, item }) => {
      const a = item.attributes;
      const name = a.owner_name_1 ?? a.owner_name ?? a.legal_name;
      const mailing = a.mailing_address_lines ?? [a.mailing_street ?? a.billing_street, a.mailing_city ?? a.billing_city,
        a.mailing_state ?? a.billing_state, a.mailing_zip ?? a.billing_postal_code];
      return `<tr><th scope="row"><a href="#${id}">${escape(sourceTitle(item.source_id))}</a></th>
        <td data-col="Name">${escape(name ?? "")}</td>
        <td data-col="Address">${escape([mailing].flat().filter(Boolean).join(" · "))}</td></tr>`;
    }).join("")}</tbody>`, { className: "p-match" }) : "";
  return split(panel("Who owns it", chain || cards(owners)), panel("Sales on record", saleCards), "7-5") +
    panel("Owner name and address across sources", ownerTable + (chain ? cards(owners) : "")) +
    groupsView(without(rows, [...owners, ...entities, ...roles, ...citySales, ...assessorSales]));
}

function zoningView(rows) {
  const boundaries = sourceRows(rows, "zoning", "wards", "neighborhoods");
  return alias("geography") + (boundaries.length
    ? `<div class="p-boundaries">${boundaries.map((row) => recordCard(row, { className: "boundary-tile" })).join("")}</div>` : "") +
    groupsView(without(rows, boundaries));
}

function activityView(rows, businessDuplicates) {
  const permits = rows.filter(({ item }) => item.source_id === "municity" && item.category === "Permit");
  const lifecycle = rows.filter(({ item }) => item.source_id === "municity" && ["Application", "Certificate"].includes(item.category));
  const links = linkedRows(permits, lifecycle, ({ identifier }) => identifier, ({ item, identifier }) => permitNumber(item.attributes) || identifier);
  const cases = rows.filter(({ item }) => item.source_id === "lci-cases" || item.category === "Complaint");
  const licenses = without(rows.filter(({ item }) => item.source_id === "municity" && item.category === "License"), businessDuplicates);
  const documents = rows.filter(({ item }) => item.category === "Document");
  const contacts = rows.filter(({ item }) => item.category === "Contact");
  const permitsView = cards(permits, (row) => {
    const merged = links.get(row.id) ?? [];
    const steps = [...merged, row].sort((left, right) => {
      const order = { Application: 0, Permit: 1, Certificate: 2 };
      return order[left.item.category] - order[right.item.category];
    });
    return { merged, extra: merged.length ? `<div class="p-life">${steps.map((step) =>
      `<a class="p-life__step" href="#${step.id}"><b>${escape(step.item.category)}</b>
        ${escape(step.dateText ?? "")} ${pill(step.status)}</a>`).join("")}</div>` : "" };
  }, true);
  const grouped = [...permits, ...[...links.values()].flat(), ...cases, ...licenses, ...documents, ...contacts, ...businessDuplicates];
  return panel("Building permits", permitsView, { count: permits.length }) +
    split(panel("Complaints and cases", cards(cases), { count: cases.length }),
      panel("Other municipal licenses", cards(licenses), { count: licenses.length })) +
    split(panel("Documents", cards(documents, { compact: true }), { count: documents.length }),
      panel("Contacts", cards(contacts), { count: contacts.length }), "7-5") +
    groupsView(without(rows, grouped));
}

function occupantProjectionKey({ item }) {
  if (!item.source_record_id?.startsWith("occupant:")) return null;
  return JSON.stringify([item.source_record_id, item.match?.vendor_parcel_id ?? null,
    item.event_date ?? null, Object.entries(item.attributes ?? {}).sort(([a], [b]) => a.localeCompare(b))]);
}

function businessMatch(rows, activity) {
  const licenses = sourceRows(rows, "municipal-business-licenses");
  const occupants = sourceRows(rows, "municipal-occupants");
  const municipal = (category) => activity.filter(({ item }) => item.source_id === "municity" && item.category === category);
  const exactId = ({ item }) => item.source_record_id;
  const cityLicenses = municipal("License");
  const licenseMatches = linkedRows(licenses, cityLicenses, exactId, exactId);
  const byNumber = ({ identifier }) => identifier;
  const otherLicenses = linkedRows(licenses, without(cityLicenses, [...licenseMatches.values()].flat()), byNumber, byNumber);
  for (const [id, records] of otherLicenses)
    licenseMatches.set(id, [...licenseMatches.get(id) ?? [], ...records]);
  return new Map([
    ...licenseMatches,
    ...linkedRows(occupants, municipal("Occupant"), occupantProjectionKey, occupantProjectionKey),
  ]);
}

function addressDirectory(rows, addresses, title) {
  if (!addresses.length && !rows.some(({ address }) => address)) return "";
  const entries = Map.groupBy(rows.filter(({ address }) => address), ({ address }) => normalizeAddress(address));
  const mapped = new Set(addresses.map(({ address }) => normalizeAddress(address)));
  const row = (address, labels, units = []) => `<div class="p-dir__row">
    <div class="p-dir__num">${escape(address)}${units.length ? `<small>Unit ${escape(units.join(", "))}</small>` : ""}</div>
    <div class="p-dir__entities">${labels?.length ? labels.map(({ id, title, item, status }) =>
      `<a class="p-entity" href="#${id}"><span class="p-entity__name">${escape(title)}</span>
        <span class="p-entity__meta">${escape(businessRecordTypes[item.source_id] ?? sourceTitle(item.source_id))} ${pill(status)}</span></a>`).join("")
      : '<span class="p-dir__empty">No returned records at this address</span>'}</div></div>`;
  const heading = (name) => `<h4 class="p-dir__street t-label">${escape(name)}</h4>`;
  const other = [...entries].filter(([key]) => !mapped.has(key));
  return `<div class="p-directory">${addressRows(addresses, title).map(([street, entriesOnStreet]) =>
    heading(street) + entriesOnStreet.map(({ address, units }) =>
      row(address.split(" ")[0], entries.get(normalizeAddress(address)), units)).join("")).join("")}
    ${other.length ? heading("Other recorded addresses") + other.map(([, matches]) => row(matches[0].address, matches)).join("") : ""}
  </div>`;
}

function validityBar(row, generatedAt) {
  const a = row.item.attributes;
  const from = a.effective_date;
  const to = a.expire_date ?? a.expiration_date;
  const since = Date.parse(from);
  const until = Date.parse(to);
  const generated = Date.parse(generatedAt);
  if (![since, until, generated].every(Number.isFinite) || until <= since) return "";
  const marker = Math.round(100 * Math.max(0, Math.min(1, (generated - since) / (until - since))));
  return `<div class="p-validity">
    <svg viewBox="0 0 100 5" preserveAspectRatio="none" class="p-validity__graphic" role="img"
      aria-label="${escape(`Published effective date ${from}; expiration date ${to}; marker at the report date.`)}">
      <rect class="p-validity-period" width="100" height="5"/><path class="p-validity-marker" d="M${marker},0 V5"/></svg>
    <p class="p-validity__row"><span>${escape(valueText(from, "date"))}</span><span>${escape(valueText(to, "date"))}</span></p>
  </div>`;
}

function businessView(rows, addresses, title, duplicates, generatedAt) {
  const licenses = sourceRows(rows, "municipal-business-licenses");
  const occupants = sourceRows(rows, "municipal-occupants");
  const liquor = sourceRows(rows, "ct-liquor-permits");
  return panel("Directory by address", addressDirectory(rows, addresses, title)) +
    panel("State liquor permit", cards(liquor, (row) => ({ extra: validityBar(row, generatedAt) }), true), { count: liquor.length }) +
    split(panel("City business license", cards(licenses, (row) => ({ merged: duplicates.get(row.id) })), { count: licenses.length }),
      panel("City occupant record", cards(occupants, (row) => ({ merged: duplicates.get(row.id) })), { count: occupants.length })) +
    groupsView(without(rows, [...licenses, ...occupants, ...liquor]));
}

function servicePanel(title, rows, valueFor) {
  if (!rows.length) return "";
  const values = rows.map((row) => valueFor(row.item.attributes));
  const uniform = values[0] && values.every((value) => value === values[0]);
  const overview = uniform ? `<div class="p-uniform"><p class="p-uniform__value">${escape(values[0])}</p>
    <p class="p-uniform__scope">${recordCount(rows.length, "address record")}</p></div>`
    : ledger(["Address", "Published value"], `<tbody>${rows.map((row, i) =>
      `<tr><th scope="row"><a href="#${row.id}">${escape(row.item.attributes.address ?? row.title)}</a></th>
        <td>${escape(values[i] || "Not in returned records")}</td></tr>`).join("")}</tbody>`);
  return panel(title, overview + publishedRecords(rows));
}

function representationDetails(row, coverage) {
  const { item } = row;
  const a = item.attributes;
  if (item.source_id === "cmt-contacts") {
    const roles = [
      ["District manager", a.district_manager, a.dm_email, a.dm_phone],
      ["Neighborhood specialist", a.neighborhood_specialist, a.ns_email, a.ns_phone],
      ["CMT chair", a.cmt_chair, a.cmt_email, a.cmt_phone],
    ];
    return `<div class="p-contacts">${roles.filter(([, ...values]) => values.some(Boolean)).map(([role, ...values]) =>
      `<div class="p-contact__lines"><p class="t-label">${role}</p>
        ${values.filter(Boolean).map((value) => `<p>${escape(value)}</p>`).join("")}</div>`).join("")}</div>`;
  }
  if (item.source_id !== "alders") return "";
  const published = [a.alder_name, a.email, a.phone,
    [a.address, a.city, a.state, a.zip_code].filter(Boolean).join(", ")].filter(Boolean);
  const incomplete = coverage.some(({ entry }) => entry.source_id === "alders" && coverageState(entry) === "partial");
  return `<div class="p-contact__lines">${incomplete ? `<p>${pill("Partial roster response", "partial")}</p>` : ""}
    ${published.map((value) => `<p>${escape(value)}</p>`).join("")}</div>`;
}

function servicesView(rows, coverage) {
  const trash = sourceRows(rows, "trash-pickup");
  const schools = sourceRows(rows, "school-attendance");
  const districts = sourceRows(rows, "cmt");
  const contacts = sourceRows(rows, "cmt-contacts");
  const alders = sourceRows(rows, "alders");
  const key = ({ item: { attributes } }) => valueText(attributes.district_num ?? attributes.district_number);
  const joins = linkedRows(contacts, districts, key, key);
  const representation = [...contacts, ...alders, ...without(districts, [...joins.values()].flat())];
  return split(servicePanel("Trash pickup", trash, (a) => valueText(a.trash_day)),
    servicePanel("School Choice attendance zones", schools, (a) =>
      [a.k8_attendance_zone_school && `${a.k8_attendance_zone_school} (K–8)`, a.high_school_attendance_zone_school].filter(Boolean).join(" · "))) +
    (panel("Local representation", cards(representation, (row) => ({
      merged: joins.get(row.id), className: "p-contact",
      extra: representationDetails(row, coverage), compact: ["alders", "cmt-contacts"].includes(row.item.source_id),
    }), true),
      { id: "representation" }) || alias("representation")) +
    groupsView(without(rows, [...trash, ...schools, ...districts, ...contacts, ...alders]));
}

function reportHero(geometry, context, parcel, photo) {
  const heading = '<h2 class="sr-only" tabindex="-1">Parcel and surrounding streets</h2>';
  const photoUrl = photo.status === "ok" ? safeUrl(photo.photo_url) : null;
  const photoState = photoUrl ? "" : " data-photo-unavailable";
  const photoFigure = `<figure class="p-figure p-figure__photo">
    <p class="t-label report-hero-label">Parcel photo</p>
    ${photoUrl ? `<div class="p-figure__frame" id="report-photo-frame">
      <img id="report-photo" src="${escape(photoUrl)}" alt="Official parcel photograph of ${escape(parcel.address ?? parcel.parcel_id)}"></div>` : ""}
    <figcaption class="p-figure__cap t-caption">
      <span id="report-photo-status">${photoUrl ? "Photo date unpublished." : "No verified parcel photograph was returned."}</span>
      ${sourceLink(photo.source_url, photo.photo_source_id === "assessor" ? "Assessor photograph" : "City parcel photograph")}
    </figcaption></figure>`;
  const layers = (context?.layers ?? []).filter(({ features }) => features.length);
  const radius = context?.nearby_radius_m ?? 400;
  const drawing = platDrawing(geometry, layers, parcel.source_url);
  if (!geometry || !drawing) return `<section id="map" class="p-hero p-hero--overview report-section" data-no-boundary${photoState}>${heading}
    <div class="p-figure p-hero__plat"><p>City parcel geometry was unavailable for this report.</p>
      ${sourceLink(parcel.source_url, "Open City parcel record")}</div>${photoFigure}</section>`;
  const data = JSON.stringify({ geometry, layers, radius }).replaceAll("<", "\\u003c");
  const layerLabels = { "parcel-addresses": "Address points", zoning: "Zoning", "transit-stops": "Transit stops",
    "metered-parking-spaces": "Metered parking" };
  return `<section id="map" class="p-hero p-hero--overview report-section"${photoState}>${heading}${drawing}${photoFigure}
    <figure class="p-figure report-locator"><p class="t-label report-hero-label">Street map</p><div class="p-figure__frame p-locator">
      <div id="report-map" role="region" aria-label="Map of the selected parcel and surrounding streets" tabindex="0"></div></div>
      <figcaption class="p-figure__cap t-caption"><span>Street locator · ${radius} m from the parcel map center</span>
      ${sourceLink(parcel.source_url, "City GIS parcel")}</figcaption>
      <p id="report-map-status" class="t-caption" role="status">Loading street map…</p>
      ${layers.length ? `<fieldset class="p-layers map-options"><legend class="sr-only">Street locator layers</legend>
      ${layers.map((layer) => `<label class="p-chip" title="${escape(layer.title)}"><input type="checkbox" value="${escape(layer.id)}"
        ${["parcel-addresses", "transit-stops"].includes(layer.id) ? "checked" : ""}>
        ${escape(layerLabels[layer.id] ?? layer.title)}</label>`).join("")}</fieldset>` : ""}
      <noscript><p>Enable JavaScript to view the street locator.</p></noscript>
    </figure><script type="application/json" id="report-map-data">${data}</script>
  </section>`;
}

function cityOrigins(context, searchedAddress) {
  const layer = context?.layers.find(({ id }) => id === "parcel-addresses");
  if (layer?.status !== "ok") return [];
  const byPoint = new Map();
  for (const feature of layer.features) {
    const a = feature.properties;
    const address = [a.house_number, a.full_street_name].filter(Boolean).join(" ");
    const obj = a.source_record_id;
    if (!a.house_number || !a.full_street_name || !/^\d{1,12}$/.test(obj ?? "") || feature.geometry.type !== "Point") continue;
    const key = `${normalizeAddress(address)}:${feature.geometry.coordinates.join(":")}`;
    const existing = byPoint.get(key);
    if (!existing || Number(obj) < Number(existing.objectid)) byPoint.set(key, { address, objectid: obj });
  }
  const result = [...byPoint.values()].sort((a, b) => a.address.localeCompare(b.address, "en-US", { numeric: true }));
  const matching = result.filter(({ address }) => normalizeAddress(address) === normalizeAddress(searchedAddress));
  return result.map((point) => ({ ...point, selected: matching.length === 1 && matching[0] === point }));
}

function nearbyView(context, geometry, query, searchedAddress) {
  const transit = context?.layers.find(({ id }) => id === "transit-stops");
  const parking = context?.layers.find(({ id }) => id === "metered-parking-spaces");
  const stops = transit?.features ?? [];
  const center = geometry?.bbox ? [(geometry.bbox[0] + geometry.bbox[2]) / 2, (geometry.bbox[1] + geometry.bbox[3]) / 2] : null;
  const project = center ? projectAround(center) : null;
  const stopRows = stops.map(({ properties: p, geometry }) => {
    const distance = project && geometry.type === "Point" ? Math.round(Math.hypot(...project(geometry.coordinates))) : null;
    const inService = [true, 1, "1"].includes(p.InService) ? "In service" : [false, 0, "0"].includes(p.InService) ? "Not in service" : "";
    return { p, distance, inService };
  }).sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  const stopTable = stopRows.length ? ledger(["Stop", `Distance ${calc("From parcel center")}`, "Service"],
    `<tbody>${stopRows.map(({ p, distance, inService }) => `<tr><th scope="row">
      ${sourceLink(p.source_url, p.StopName ?? `Stop ${p.StopId ?? ""}`) || escape(p.StopName ?? "Mapped stop")}
      <span class="t-caption">${escape([p.StopId != null && `Stop ${p.StopId}`, p.OnStreet].filter(Boolean).join(" · "))}</span></th>
      <td class="t-id">${distance === null ? "" : `${distance} m`}</td><td>${pill(inService)}</td></tr>`).join("")}</tbody>`) : "";
  const checks = [transit, parking].filter(Boolean).map((entry) => ({ entry, title: entry.title }));
  const origins = cityOrigins(context, searchedAddress);
  const options = origins.map(({ address, objectid, selected }) => {
    const repeats = origins.some((point) => point.address === address && point.objectid !== objectid);
    return `<option value="city-address-${objectid}"${selected ? " selected" : ""}>${escape(repeats ? `${address} · City point ${objectid}` : address)}</option>`;
  }).join("");
  const runner = `<div id="nearby-profile" class="p-runner" data-parcel-query="${escape(query)}">
    <h3 class="t-group" tabindex="-1">Places within ¼ mile</h3>
    <div class="profile-controls p-runner__controls" hidden>
      <div class="profile-origin p-field"${origins.length <= 1 ? " hidden" : ""}><label for="profile-origin">City address point</label>
        <select id="profile-origin"><option value="">Choose a City address point</option>${options}</select></div>
      <button type="button" class="p-btn" id="profile-run">Run quarter-mile profile</button>
    </div>
    <p id="profile-status" class="p-status" role="status"></p>
    <div id="profile-output"></div>
    <noscript><p>Enable JavaScript to run the live Google Maps profile.</p></noscript>
  </div>`;
  return { id: "nearby", label: "Nearby places", count: stops.length,
    html: section("nearby", "Nearby places within ¼ mile", split(
      panel(`CT Transit stops within ${transit?.search_radius_m ?? context?.nearby_radius_m ?? 400} m`, stopTable, { count: stops.length }),
      stack(runner, sourceChecks(checks)), "7-5")) };
}

function coverageFor(groups, addresses, photo, context) {
  const parcelSources = groups.flatMap(({ group, sources }) => sources.map((entry) => {
    const chapter = ["trash-pickup", "school-attendance"].includes(entry.source_id) ? "services" :
      ({ geography: "zoning", representation: "services" })[group] ?? group;
    return { entry, title: entry.source_id === "municity" ? "Municipal parcel service" : sourceTitle(entry.source_id), chapter };
  }));
  const mapSources = [
    { entry: photo, title: "Parcel photograph", chapter: "map" },
    { entry: addresses, title: "City-mapped addresses", chapter: "map" },
    ...(context?.layers ?? [{ status: "unavailable", title: "City map overlays" }]).map((entry) => ({
      entry, title: entry.title, chapter: ["transit-stops", "metered-parking-spaces"].includes(entry.id) ? "nearby" : "map",
    })),
  ];
  return [["Parcel records", parcelSources], ["Photo and map", mapSources]];
}

function coverageLedger(coverage, records) {
  const all = coverage.flatMap(([, rows]) => rows);
  const first = new Map();
  for (const { item, id } of records) if (!first.has(item.source_id)) first.set(item.source_id, id);
  const rows = coverage.map(([group, entries]) => `<tbody>
    <tr class="p-ledger__group"><th scope="rowgroup" colspan="3">${escape(group)}</th></tr>
    ${entries.map(({ entry, title, chapter }) => {
      const href = first.get(entry.source_id);
      const count = entry.count ?? entry.features?.length ?? entry.addresses?.length;
      const details = entry.warning || entry.note || entry.coverage;
      return `<tr data-response="${coverageTone(entry)}" data-source-id="${escape(entry.source_id ?? entry.id ?? "")}">
        <th scope="row">${sourceLink(entry.source_url, title) || escape(title)}</th>
        <td>${coveragePill(entry)} ${Number.isInteger(count) ? `<span class="t-caption">${countText.format(count)} returned</span>` : ""}
          ${details ? `<p class="t-caption">${escape(details)}</p>` : ""}</td>
        <td>${href ? `<a href="#${href}">View records</a>` : ["map", "nearby"].includes(chapter) ? `<a href="#${chapter}">View section</a>` : ""}</td></tr>`;
    }).join("")}</tbody>`).join("");
  return { id: "sources", label: "Sources and coverage", count: all.length,
    html: section("sources", "Sources and coverage",
      coverageBar(all.map(({ entry }) => entry)) + plotLegend([
        ["ok", "Returned records"], ["partial", "Incomplete"], ["none", "No records"], ["outside", "Outside coverage"],
      ], "resp") + ledger(["Source", "Response", "Records"], rows, { label: "Source coverage ledger" }), {
      note: "Source dates describe the published records. This report was generated from the records available at the time of the request.",
      stat: recordCount(all.length, "source"),
    }) };
}

function sectionRail(entries, totalRows, statuses) {
  const sourceCount = recordCount(statuses.length, "source");
  return `<nav class="p-rail report-nav" aria-label="Report sections">
    <p class="p-rail__title t-label">Report sections</p>
    <ol>${entries.map(({ id, label, count, warning }) => `<li><a href="#${id}">
      <span>${escape(label)}</span>${warning ? '<span class="p-rail__warn" title="Incomplete source check"><span class="sr-only">Incomplete source check</span></span>' : ""}
      ${count == null ? "" : `<span class="p-rail__count">${countText.format(count)}</span>`}</a></li>`).join("")}</ol>
    <div class="report-jump" hidden><label for="report-section-select">Jump to</label>
      <select id="report-section-select">${entries.map(({ id, label }) => `<option value="${id}">${escape(label)}</option>`).join("")}</select>
      <button type="button" class="p-chip" id="report-section-go">Go</button></div>
    <div class="p-rail__foot"><p class="t-caption">${recordCount(totalRows)} from ${sourceCount}</p>${coverageBar(statuses)}</div>
  </nav>`;
}

export function renderParcelReport({ parcel, searchedAddress, addresses, groups, photo, geometry, context, generated_at }) {
  const title = valueText(parcel.address) || `Parcel ${parcel.parcel_id}`;
  const query = new URLSearchParams({ parcel_id: parcel.parcel_id, objectid: parcel.objectid });
  if (searchedAddress) query.set("query_address", searchedAddress);
  const rows = makeRows(groups);
  const inChapter = (chapter) => rows.filter((row) => row.chapter === chapter);
  const property = inChapter("property");
  const services = [...sourceRows(property, "trash-pickup", "school-attendance"), ...inChapter("representation")];
  const activity = inChapter("activity");
  const business = inChapter("business");
  const duplicates = businessMatch(business, activity);
  const mergedBusiness = [...duplicates.values()].flat();
  const occupantCopies = mergedBusiness.filter(({ item }) => item.category === "Occupant").length;
  const coverage = coverageFor(groups, addresses, photo, context);
  const allSources = coverage.flatMap(([, entries]) => entries);
  const byChapter = Map.groupBy(allSources, ({ chapter }) => chapter);
  const incomplete = (id) => (byChapter.get(id) ?? []).some(({ entry }) =>
    ["partial", "unavailable", "not_linked"].includes(coverageState(entry)));
  const checks = (id) => {
    const entries = byChapter.get(id) ?? [];
    const skipped = entries.filter(({ entry }) => coverageState(entry) !== "ok");
    return skipped.length ? panel("Source checks", sourceChecks(skipped)) : "";
  };
  const chapter = (id, label, count, body, note = "") => {
    const warning = incomplete(id);
    const content = body + checks(id);
    return content ? { id, label, count, warning, html: section(id, label, content,
      { stat: recordCount(count), note }) } : null;
  };
  const { summary, lede } = summaryFacts(rows);
  const time = `<time datetime="${escape(generated_at)}">${escape(dateTime.format(new Date(generated_at)))} ET</time>`;
  const nearby = nearbyView(context, geometry, query, searchedAddress ?? parcel.address);
  const chaptersView = [
    reportTimeline(rows, generated_at),
    chapter("property", chapters.property, without(property, services).length, propertyView(without(property, services))),
    chapter("ownership", chapters.ownership, inChapter("ownership").length, ownershipView(inChapter("ownership"), parcel), chapterExplanations.ownership),
    chapter("zoning", chapters.geography, inChapter("geography").length, zoningView(inChapter("geography")),
      "City zoning shows the mapped district. The assessor reports building use and area separately."),
    chapter("activity", chapters.activity, activity.length - mergedBusiness.length, activityView(activity, mergedBusiness), chapterExplanations.activity),
    chapter("business", chapters.business, business.length + mergedBusiness.length - occupantCopies,
      businessView(business, addresses.addresses, title, duplicates, generated_at), chapterExplanations.business),
    chapter("environment", chapters.environment, inChapter("environment").length, groupsView(inChapter("environment"))),
    chapter("services", "Services and representation", services.length, servicesView(services, byChapter.get("services") ?? [])),
    { ...nearby, warning: incomplete("nearby") }, coverageLedger(coverage, rows),
  ].filter(Boolean);
  const affected = chaptersView.filter(({ warning }) => warning);
  const note = affected.length ? coverageNote(`<strong>Incomplete source checks in ${affected.length}
    ${affected.length === 1 ? "section" : "sections"}</strong> · ${affected.map(({ id, label }) =>
    `<a href="#${id}">${escape(label)}</a>`).join(" · ")} · <a href="#sources">See source coverage</a>`) : "";
  return page(`${title} · Property report`, `<a class="sr-only skip" href="#property-report">Skip to property report</a>
    <header class="p-bar"><div class="p-bar__inner"><div class="p-bar__brand">${icon("brand", "p-bar__mark")}
      New Haven Civic Data</div>
      <div class="p-bar__meta"><a href="/parcel?${escape(query)}">← Parcel records</a><span>Generated ${time}</span></div>
      <button class="p-chip" type="button" id="print-report" hidden>Print report</button>
    </div></header><div class="p-page"><main class="p-sheet report" id="property-report" tabindex="-1">
    <header class="p-masthead">
      <div class="p-masthead__eyebrow"><p class="t-label">Property report</p><p class="t-label">Parcel ${escape(parcel.parcel_id)}</p></div>
      <h1 class="t-address">${escape(title)}</h1>
      ${lede ? `<p class="t-lede p-masthead__summary">${escape(lede)}</p>` : ""}
      ${searchedAddress && normalizeAddress(searchedAddress) !== normalizeAddress(parcel.address)
        ? `<p class="searched-address t-body-sm">Searched address <strong>${escape(searchedAddress)}</strong></p>` : ""}
      ${idTags([["Parcel ID", parcel.parcel_id], ["MBLU", parcel.mblu], ["Assessor account", parcel.account_number]])}
      ${addressChips(addresses.addresses, title)}${note}
    </header>
    ${reportHero(geometry, context, parcel, photo)}
    <section class="p-factsband report-facts" aria-label="Property at a glance"><div class="p-facts p-facts--hero">
      ${summary.map(factTile).join("")}</div></section>
    <div class="p-layout">${sectionRail([{ id: "map", label: "Map and photo" }, ...chaptersView], rows.length - occupantCopies,
      allSources.map(({ entry }) => entry))}
      <div class="p-main">${chaptersView.map(({ html }) => html).join("")}</div></div>
    <footer class="p-foot t-caption"><span>New Haven Civic Data · Property report</span><span>Generated ${time}</span></footer>
    </main></div><script src="/leaflet/leaflet.js" defer></script><script src="/parcel-report.js" type="module"></script>`);
}
