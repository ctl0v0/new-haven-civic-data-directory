import { fieldLabel, recordTitle } from "./parcel-record-text.js";

const valColumns = ["Year", "Valuation", "Land", "Improvements", "Total"];
const valuation = ({ attributes: a }) => [a.valuation_year, fieldLabel(a.valuation_type ?? ""), a.land, a.improvements, a.total];
const area = (number, published) => typeof number === "number" ? number.toLocaleString("en-US") : published;
const fields = (...entries) => entries.filter(([, value]) => value != null && value !== "");
const publishedRows = (rows) => fields(...(rows ?? []).map(({ label_as_published, value_as_published }) =>
  [label_as_published, value_as_published]));
const namedFields = (data, names) => fields(...names.map(([field, label]) => [label, data[field]]));

const layouts = {
  addresses: {
    title: "City address points", columns: ["Address", "Unit"], values: (item) => [recordTitle(item), item.attributes.unit],
  },
  parcels: {
    title: "City parcel record", facts: ({ attributes: a }) => namedFields(a, [
      ["mblu", "MBLU"], ["account_number", "Account number"], ["nh_ward", "Published ward"],
    ]),
  },
  assessor: {
    title: "Assessor building facts", facts: ({ attributes: a }) => namedFields(a.building_facts ?? {}, [
      ["building_count", "Buildings"], ["year_built", "Year built"], ["stories", "Stories"],
      ["living_area_sq_ft", "Living area (sq ft)"], ["land_size_acres", "Land area (acres)"],
      ["style", "Style"], ["model", "Model"], ["land_use_code", "Land use code"],
    ]),
  },
  "assessor-buildings": {
    title: "Building sections", facts: ({ attributes: a }) => [
      ...publishedRows(a.summary_rows), ...publishedRows(a.attribute_rows),
    ],
  },
  "assessor-subareas": {
    title: "Building subareas", columns: ["Subarea", "Building or section", "Gross sq ft", "Living sq ft"], numeric: [2, 3],
    values: (item) => {
      const a = item.attributes;
      return [recordTitle(item), a.section_heading_as_published ?? [
        a.building_number != null && `Building ${a.building_number}`,
        a.section_number != null && `Section ${a.section_number}`,
      ].filter(Boolean).join(" · "), area(a.gross_area_sq_ft, a.gross_area_as_published),
      area(a.living_area_sq_ft, a.living_area_as_published)];
    },
  },
  "assessor-land": {
    title: "Land use and measures", facts: ({ attributes: a }) => [
      ...publishedRows(a.land_use_rows), ...publishedRows(a.land_measure_rows),
    ],
  },
  "assessor-extra-features": {
    title: "Extra features", columns: ["Feature", "Building", "Size", "Assessed value"], numeric: [3],
    values: (item) => [recordTitle(item), item.attributes.building_number_as_published,
      item.attributes.size_as_published, item.attributes.assessed_value_as_published],
  },
  "assessor-outbuildings": {
    title: "Outbuildings", columns: ["Outbuilding", "Building", "Size", "Assessed value"], numeric: [3],
    values: (item) => [recordTitle(item), item.attributes.building_number_as_published,
      item.attributes.size_as_published, item.attributes.assessed_value_as_published],
  },
  "parcel-assessment": {
    title: "City building and assessment fields", facts: ({ attributes: a }) => namedFields(a, [
      ["use_code", "Use code"], ["year_building_built", "Year built"], ["total_land_area_acres", "Land area (acres)"],
      ["units_commercial", "Commercial units"], ["units_residential", "Residential units"], ["units_condo", "Condo units"],
      ["total_assessed_improvements", "Assessed improvements"], ["total_assessed_land_value", "Assessed land"],
      ["total_assessed_parcel_value_x", "Assessed parcel value (X)"], ["total_assessed_parcel_value_y", "Assessed parcel value (Y)"],
    ]),
  },
  "valuation-current": { title: "Current assessor valuation rows", columns: valColumns, values: valuation, numeric: [2, 3, 4] },
  "valuation-history": { title: "Assessor valuation history", columns: valColumns, values: valuation, numeric: [2, 3, 4] },
  "assessor-valuations": { title: "Other assessor valuation rows", columns: valColumns, values: valuation, numeric: [2, 3, 4] },
  "trash-pickup": {
    title: "Trash pickup zones", columns: ["Address", "Unit", "Pickup day"],
    values: ({ attributes: a }) => [a.address, a.unit, a.trash_day_name ?? a.trash_day],
  },
  "school-attendance": {
    title: "School Choice attendance zones", columns: ["Address", "K–8 school preference", "High school preference"],
    values: ({ attributes: a }) => [a.address, a.k8_attendance_zone_school, a.high_school_attendance_zone_school],
  },
};
const layoutOrder = new Map(Object.keys(layouts).map((key, index) => [key, index]));

function layoutKey(item) {
  if (item.source_id !== "assessor-valuations") return item.source_id;
  const key = `valuation-${item.attributes.table_section}`;
  return Object.hasOwn(layouts, key) ? key : item.source_id;
}

function propertyTable(parent, key, title, columns, numeric, el) {
  const section = el("section", null, "p-panel property-table-section");
  section.dataset.propertyTable = key;
  const heading = el("h3", title, "t-group");
  heading.id = `property-table-${key}`;
  section.append(heading);
  const wrapper = el("div", null, "p-tablewrap property-table-wrap");
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-labelledby", heading.id);
  wrapper.tabIndex = 0;
  const table = el("table", null, "p-ledger property-ledger");
  table.setAttribute("role", "table");
  table.setAttribute("aria-labelledby", heading.id);
  const head = table.createTHead();
  head.setAttribute("role", "rowgroup");
  const headers = head.insertRow();
  headers.setAttribute("role", "row");
  [...columns, "Source"].forEach((label, i) => {
    const th = el("th", label, numeric.includes(i) ? "property-number" : null);
    th.setAttribute("role", "columnheader");
    th.scope = "col";
    headers.append(th);
  });
  wrapper.append(table);
  section.append(wrapper);
  const rank = layoutOrder.get(key) ?? layoutOrder.size;
  const next = [...parent.children].find((child) =>
    (layoutOrder.get(child.dataset.propertyTable) ?? layoutOrder.size) > rank);
  parent.insertBefore(section, next ?? null);
  return table;
}

export function appendPropertyRecords(parent, items, { el, link, sourceName, fieldList, sourceFields, recordEvidence }) {
  for (const [key, records] of Map.groupBy(items, layoutKey)) {
    const existing = [...parent.children].find((section) => section.dataset.propertyTable === key);
    const layout = Object.hasOwn(layouts, key) ? layouts[key] : {};
    const title = layout.title ?? sourceName(records[0].source_id);
    const columns = layout.columns ?? ["Record", "Published values"];
    const numeric = layout.numeric ?? [];
    const table = existing?.querySelector("table") ?? propertyTable(parent, key, title, columns, numeric, el);
    for (const item of records) {
      const body = table.createTBody();
      body.setAttribute("role", "rowgroup");
      const row = body.insertRow();
      row.className = "property-record-row";
      row.setAttribute("role", "row");
      const values = layout.values ? layout.values(item) : [
        recordTitle(item), fieldList(layout.facts?.(item) ??
          sourceFields(item.attributes).filter(([, value]) => value !== "Not provided" && value !== "").slice(0, 4), "property-facts"),
      ];
      values.forEach((value, i) => {
        const cell = el(i ? "td" : "th", null, numeric.includes(i) ? "property-number" : null);
        cell.setAttribute("role", i ? "cell" : "rowheader");
        if (!i) cell.scope = "row";
        if (i && layout.columns) {
          const label = el("span", columns[i], "property-mobile-label");
          label.setAttribute("aria-hidden", "true");
          cell.append(label);
        }
        cell.append(value instanceof Node ? value : el("span", value == null || value === "" ? "—" : value));
        if (!i && item.address_evidence?.matches_query) {
          cell.append(el("span", "Source address matches search", "address-badge"));
        }
        row.append(cell);
      });
      const source = row.insertCell();
      source.className = "property-record-actions";
      source.setAttribute("role", "cell");
      if (item.source_url) source.append(link(item.source_url, "Open source"));

      const detail = body.insertRow();
      detail.hidden = true;
      detail.className = "property-detail-row";
      detail.setAttribute("role", "row");
      detail.id = `property-fields-${key}-${table.tBodies.length}`;
      const cell = detail.insertCell();
      cell.colSpan = columns.length + 1;
      cell.setAttribute("role", "cell");
      const toggle = el("button", "Published fields", "property-fields-toggle");
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", detail.id);
      toggle.setAttribute("aria-label", `Published fields for ${recordTitle(item)}`);
      toggle.onclick = () => {
        detail.hidden = !detail.hidden;
        toggle.setAttribute("aria-expanded", String(!detail.hidden));
        if (cell.childElementCount) return;
        recordEvidence(cell, item);
        cell.append(fieldList(sourceFields(item.attributes)));
      };
      source.append(toggle);

      if (item.source_id === "assessor-valuations") {
        body.dataset.year = item.attributes.valuation_year ?? "";
        const next = [...table.tBodies].find((other) => other.dataset.year < body.dataset.year);
        if (next) table.insertBefore(body, next);
      }
    }
  }
}
