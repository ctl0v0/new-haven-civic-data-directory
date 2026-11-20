const associationLabels = {
  verified_application: "Verified application association",
  shared_instructions: "Shared instructions",
  no_verified_application: "No verified application found",
};
const routeLabels = {
  citysquared: "CitySquared",
  department_portal: "City department portal",
  in_person: "In person",
  email: "Email",
  mail: "Mail",
  directory: "Confirm with the City",
};
const formLabels = {
  blank_form: "Blank form",
  application_packet: "Application packet",
  listed_form: "Form linked by the City",
  directory_listing: "Listed in the City directory",
  supporting_forms: "Supporting forms",
  checklist: "Checklist",
};
const sourceLabels = {
  official_portal: "Official portal",
  city_directory: "City directory",
  city_instructions: "City instructions",
  city_published_portal_walkthrough: "City-published CitySquared walkthrough",
  citysquared_instructions: "CitySquared instructions",
};

export async function renderPermitApplications(parent, sidebar, { api, el, link }) {
  const form = el("form", null, "query-grid");
  function select(label, name, options) {
    const field = el("label", label);
    const input = el("select");
    input.setAttribute("aria-label", label);
    input.name = name;
    fillOptions(input, options);
    field.append(input);
    form.append(field);
    return input;
  }
  function fillOptions(input, options) {
    const value = input.value;
    input.replaceChildren(...options.map(([key, label]) => {
      const option = el("option", label);
      option.value = key;
      return option;
    }));
    if (options.some(([key]) => key === value)) input.value = value;
  }
  const view = select("Browse", "view", [["permit_types", "By permit type"], ["directory", "City application directory"]]);
  const searchLabel = el("label", "Find an application");
  const search = el("input");
  search.name = "q";
  search.type = "search";
  search.maxLength = 160;
  search.setAttribute("aria-label", "Find an application");
  searchLabel.append(search);
  form.append(searchLabel);
  const department = select("Department", "department", [["", "All departments"]]);
  select("Application evidence", "status", [["", "All evidence"], ...Object.entries(associationLabels)]);
  select("Filing route", "route", [["", "All filing routes"], ...Object.entries(routeLabels)]);

  const summary = el("p", null, "meta");
  summary.setAttribute("role", "status");
  const list = el("ol", null, "permit-application-list");
  const next = el("button", "Load more applications", "secondary");
  next.type = "button";
  next.hidden = true;
  parent.append(el("h2", "Permit applications"), form, summary, list, next);
  const coverage = el("div");
  sidebar.append(coverage, el("h3", "MCP and REST"), el("code", "list_permit_applications"),
    el("p", "GET /api/v1/permit-applications", "meta"));

  function renderApplication(entry) {
    const details = el("details", null, "query-catalog-group permit-application-detail");
    details.append(el("summary", entry.title));
    details.append(el("p", [entry.department, routeLabels[entry.filing_route],
      entry.association && associationLabels[entry.association]].filter(Boolean).join(" · "), "meta"));
    if (entry.scope) details.append(el("p", entry.scope));
    const startLabel = entry.start.method === "type_specific" ? "Start application"
      : entry.start.method === "portal_entry" ? "Open CitySquared" : "Open City filing instructions";
    const links = el("p", null, "permit-application-links");
    links.append(link(entry.start.url, startLabel));
    if (entry.start.url !== entry.directory_source.url)
      links.append(link(entry.directory_source.url, entry.directory_source.title));
    details.append(links);
    if (entry.start.availability === "unverified")
      details.append(el("p", "Current application availability is unverified.", "meta"));
    if (entry.start.selection) details.append(el("p",
      `In CitySquared, select ${entry.start.selection.department} → ${entry.start.selection.permit_type}.`));
    if (entry.instructions.length) {
      details.append(el("h4", "Instructions"));
      const instructions = el("ul");
      for (const item of entry.instructions) {
        const row = el("li", item.text);
        row.append(document.createTextNode(" "), link(item.source.url, sourceLabels[item.source.kind] ?? item.source.title));
        instructions.append(row);
      }
      details.append(instructions);
    }
    if (entry.forms.length) {
      details.append(el("h4", "Forms and checklists"));
      const forms = el("ul");
      for (const form of entry.forms) {
        const row = el("li");
        row.append(link(form.url, form.title), el("span", ` · ${formLabels[form.kind]}`, "meta"));
        forms.append(row);
      }
      details.append(forms);
    }
    details.append(el("p", `Source material reviewed ${entry.reviewed_on}`, "meta"));
    return details;
  }

  function renderRow(item) {
    const row = el("li");
    if (item.permit_type) {
      row.append(el("h3", item.permit_type), el("p", [
        item.permit_group, item.permit_type_id && `Type ID ${item.permit_type_id}`, associationLabels[item.status],
      ].filter(Boolean).join(" · "), "meta"));
      if ([true, 1, "1"].includes(item.deleted_as_published))
        row.append(el("p", "Marked deleted in the published permit catalog.", "meta"));
      for (const entry of item.applications) row.append(renderApplication(entry));
    } else {
      row.append(renderApplication(item));
      row.append(el("p", item.linked_types.length
        ? `${item.linked_types.length} associated permit type${item.linked_types.length === 1 ? "" : "s"}`
        : item.status ? "No verified permit type link" : "Permit type link could not be checked", "meta"));
      if (item.linked_types.length) {
        const linked = el("details", null, "permit-application-type-links");
        linked.append(el("summary", "Associated permit types"));
        const types = el("ul");
        for (const type of item.linked_types)
          types.append(el("li", `${type.name} · ${associationLabels[type.association]}`));
        linked.append(types);
        row.append(linked);
      }
    }
    return row;
  }

  function renderCoverage(report) {
    coverage.replaceChildren(el("h3", "Coverage"));
    if (report.permit_type_count == null)
      coverage.append(el("p", "The official permit catalog is unavailable. City directory entries are still available."));
    else {
      coverage.append(el("p", `${report.permit_type_count} permit types checked${report.catalog.status === "partial" ? " · partial catalog" : ""}`));
      for (const [key, count] of Object.entries(report.type_counts))
        coverage.append(el("p", `${count} · ${associationLabels[key]}`, "meta"));
      if (report.catalog.retrieved_at)
        coverage.append(el("p", `Permit catalog checked ${report.catalog.retrieved_at.slice(0, 10)}`, "meta"));
    }
    coverage.append(el("p", `${report.directory_entry_count} City directory entries`));
    if (report.directory_entries_without_type_link != null)
      coverage.append(el("p", `${report.directory_entries_without_type_link} directory entries without a verified type link`, "meta"));
    coverage.append(el("p", report.citysquared_menu.note, "meta"));
    const checks = el("details", null, "query-catalog-group");
    checks.append(el("summary", "Official source checks"));
    const sources = el("ul");
    for (const source of report.source_checks) {
      const item = el("li");
      item.append(link(source.url, source.title), el("p",
        [`Reviewed ${source.last_reviewed_on}`, source.checked_at && `Link checked ${source.checked_at.slice(0, 10)}`,
          source.status === "reachable" ? "Public link reachable" : "Current availability unverified"].filter(Boolean).join(" · "), "meta"));
      if (source.warning) item.append(el("p", source.warning, "meta"));
      sources.append(item);
    }
    checks.append(sources);
    coverage.append(checks);
  }

  let cursor = null;
  let version = 0;
  let timer;
  async function load(append = false) {
    const current = ++version;
    if (!append) {
      list.replaceChildren();
      cursor = null;
      next.hidden = true;
    }
    next.disabled = true;
    summary.textContent = "Checking official application sources…";
    const params = new URLSearchParams([...new FormData(form)].filter(([, value]) => value.trim()));
    if (cursor) params.set("cursor", cursor);
    try {
      const result = await api(`/api/v1/permit-applications?${params}`);
      if (version !== current) return;
      fillOptions(department, [["", "All departments"], ...result.filters.departments.map((name) => [name, name])]);
      cursor = result.next_cursor;
      list.append(...result.items.map(renderRow));
      next.hidden = !cursor;
      summary.textContent = result.view === "permit_types" && result.coverage.catalog.status === "unavailable"
        ? "Permit types are unavailable. Choose City application directory to browse the reviewed entries."
        : `${list.children.length} of ${result.filtered_total} matching ${result.view === "directory" ? "directory entries" : "permit types"}`;
      renderCoverage(result.coverage);
    } catch (error) {
      if (version === current) summary.textContent = error.message;
    } finally {
      if (version === current) next.disabled = false;
    }
  }
  form.onsubmit = (event) => { event.preventDefault(); clearTimeout(timer); void load(); };
  form.onchange = () => { clearTimeout(timer); void load(); };
  search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => void load(), 250); };
  view.onchange = () => { department.value = ""; };
  next.onclick = () => void load(true);
  await load();
}
