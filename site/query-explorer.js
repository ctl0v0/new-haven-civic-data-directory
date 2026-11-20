const methods = {
  records: { title: "Records from one source", path: "/api/v1/search-indexed-records", post: true },
  parcels: { title: "Parcels across sources", path: "/api/v1/search-indexed-parcels", post: true },
  permits: { title: "Permit records", path: "/api/v1/search-indexed-permits" },
  activity: { title: "Applications, reviews and inspections", path: "/api/v1/search-indexed-permit-activity" },
  contacts: { title: "Permit contacts", path: "/api/v1/search-parcel-permits" },
};
const planMethod = { path: "/api/v1/query-parcel-data", post: true };
const operators = { equals: "Equals", number_gte: "At least", number_lte: "At most", one_of: "Any of" };
const examples = [
  ["Electrical permits in the past 30 days", "Show parcels with electrical permits pulled in the past 30 days"],
  ["Commercial parcels with electrical permits", "Show commercial parcels with electrical permits pulled in the past 30 days"],
  ["City business licenses issued in East Rock", "Show me new business licenses in East Rock neighborhood in the last 30 days"],
  ["Water Heater contractor contacts", "Show me Contractor contacts who did water heater replacements in the last 30 days"],
];
const neighborhoods = "Exact published City neighborhood";
const requirement = (source_id = "parcels") => ({ source_id, filters: [],
  permit_type: "", permit_group: "", event_date_from: "", event_date_to: "" });
const recent = () => {
  const to = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return { permit_date_from: new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86400_000)
    .toISOString().slice(0, 10), permit_date_to: to };
};

export function indexedQueryRequest(method, args, cursor = null) {
  const spec = method === "unified" ? planMethod : methods[method];
  if (!spec) throw new Error("Choose an indexed search method.");
  const body = cursor ? { ...args, cursor } : args;
  if (spec.post) return [spec.path, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }];
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (key === "permit_types") value.forEach((type) => params.append("permit_type", type));
    else if (key === "permit_description_terms") value.forEach((term) => params.append("permit_description_term", term));
    else params.set(key, value);
  }
  return [`${spec.path}?${params}`];
}

export function indexedQueryTool(method) {
  return { records: "search_indexed_records", parcels: "search_indexed_parcels",
    permits: "search_indexed_permits", activity: "search_indexed_permit_activity",
    contacts: "search_parcel_permits", unified: "query_parcel_data" }[method];
}

export function createQueryExplorer({ api, el, link, schema, openTest, openQuestion, run }) {
  let metadata;
  let permitCatalog;
  const browser = { mode: "permits", source: "all", term: "" };
  let draft = { method: "records", requirements: [requirement()], params: {} };
  let formTarget;
  const load = async () => {
    metadata ??= Promise.all([api("/api/v1/search-capabilities"), schema()]).catch((error) => {
      metadata = null;
      throw error;
    });
    return metadata;
  };
  const loadPermits = async () => {
    permitCatalog ??= api("/api/v1/permit-types?prefer=index").catch((error) => {
      permitCatalog = null;
      throw error;
    });
    return permitCatalog;
  };
  const button = (label, action, className = "secondary") => {
    const node = el("button", label, className);
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  };
  const groupTitle = (schemaData, id) => schemaData.groups.find((group) => group.id === id)?.title ?? "Other sources";
  const sourceTitle = (schemaData, id) => schemaData.sources.find((source) => source.id === id)?.title ?? id;
  const matches = (...parts) => parts.join(" ").toLowerCase().includes(browser.term.trim().toLowerCase());
  const labeled = (name, control) => {
    const label = el("label", name);
    control.setAttribute("aria-label", name);
    label.append(control);
    return label;
  };
  const option = (value, name) => {
    const node = el("option", name);
    node.value = value;
    return node;
  };
  function select(value, options, change) {
    const control = el("select");
    for (const [key, label] of options) control.append(option(key, label));
    control.value = value;
    control.onchange = () => change(control.value);
    return control;
  }
  function groupedSources(control, schemaData, ids) {
    const groups = new Map();
    for (const id of ids) {
      const published = schemaData.sources.find((source) => source.id === id);
      const group = groupTitle(schemaData, published?.group);
      if (!groups.has(group)) {
        const options = el("optgroup");
        options.label = group;
        groups.set(group, options);
        control.append(options);
      }
      groups.get(group).append(option(id, sourceTitle(schemaData, id)));
    }
  }

  function setDraft(method, { source, field, value = "", type, group } = {}) {
    const first = requirement(source);
    if (group) {
      first.permit_group = group;
      const dates = recent();
      first.event_date_from = dates.permit_date_from;
      first.event_date_to = dates.permit_date_to;
    }
    if (field && field !== "PermitType") first.filters.push({ field, operator: "equals", value });
    draft = { method, requirements: [first],
      params: { ...(method === "permits" ? { ...recent(), permit_types: type ?? "" } : {}),
        ...(method === "contacts" ? { ...recent(), permit_types: type ?? "", contact_role: "Contractor" } : {}),
        ...(method === "activity" ? { activity_kind: "application", permit_type: type ?? "" } : {}) } };
  }
  function test(method, options) {
    setDraft(method, options);
    openTest();
  }

  async function renderGuide(parent, sidebar) {
    parent.append(el("h2", "Query explorer"),
      el("p", "Find published permit types, browse source fields, and send a filter to the test workbench."));
    const browseTarget = el("div", null, "query-catalog");
    const modes = [["permits", "Permit catalog"], ["fields", "Indexed filters"],
      ["projections", "Return sources and fields"], ["examples", "Question examples"]];
    const controls = el("div", null, "query-grid");
    const browseBy = select(browser.mode, modes, (mode) => {
      browser.mode = mode;
      browser.source = "all";
      void refresh();
    });
    const search = el("input");
    search.type = "search";
    search.value = browser.term;
    search.placeholder = "Electrical, IssueDate, zoning…";
    search.addEventListener("input", () => { browser.term = search.value; void refresh(); });
    const sourceSelect = select(browser.source, [["all", "All indexed sources"]], (id) => {
      browser.source = id;
      void refresh();
    });
    const sourceLabel = labeled("Official source", sourceSelect);
    controls.append(labeled("Browse", browseBy), labeled("Find a type or field", search), sourceLabel);
    const exports = el("div", null, "query-actions query-exports");
    for (const [format, name] of [["csv", "Download license CSV"], ["json", "View license export and coverage"]]) {
      const download = el("a", name, "meta");
      download.href = `/api/v1/license-export?format=${format}`;
      if (format === "json") { download.target = "_blank"; download.rel = "noopener"; }
      exports.append(download);
    }
    parent.append(controls, exports, browseTarget);
    sidebar.append(el("h3", "Test a search"), el("p",
      "Use the exact published spelling shown here. Field filters can also combine sources, such as City neighborhood and State liquor permits."));
    sidebar.append(button("Open field filters", () => openTest()));
    let version = 0;
    async function refresh() {
      const current = ++version;
      sourceLabel.hidden = !["fields", "projections"].includes(browser.mode);
      search.disabled = browser.mode === "examples";
      browseTarget.replaceChildren(el("p", "Loading query reference…", "meta"));
      try {
        if (browser.mode === "permits") {
          const catalog = await loadPermits();
          if (current === version) renderPermitTypes(browseTarget, catalog);
        } else if (browser.mode === "fields") {
          const [capabilities, schemaData] = await load();
          if (current !== version) return;
          sourceSelect.replaceChildren(option("all", "All indexed sources"));
          groupedSources(sourceSelect, schemaData, Object.keys(capabilities.indexed_source_fields));
          sourceSelect.value = browser.source;
          renderFields(browseTarget, capabilities, schemaData);
        } else if (browser.mode === "projections") {
          const [capabilities] = await load();
          if (current !== version) return;
          const sources = capabilities.query_catalog.sources.filter((source) => source.projectable);
          sourceSelect.replaceChildren(option("all", "All return sources"),
            ...sources.map((source) => option(source.source_id, source.title)));
          if (!sources.some(({ source_id }) => source_id === browser.source)) browser.source = "all";
          sourceSelect.value = browser.source;
          renderProjections(browseTarget, sources);
        } else renderExamples(browseTarget);
      } catch (error) {
        if (current !== version) return;
        browseTarget.replaceChildren(el("p", error.message, "source-warning"), button("Retry", () => void refresh()));
      }
    }
    await refresh();
  }

  function renderProjections(target, sources) {
    target.replaceChildren();
    for (const source of sources) {
      if (browser.source !== "all" && browser.source !== source.source_id) continue;
      const fields = source.return_fields.filter((field) => matches(field, source.title, source.source_id));
      if (!fields.length && !matches(source.title, source.source_id)) continue;
      const group = el("details", null, "query-catalog-group");
      group.open = browser.source !== "all" || Boolean(browser.term.trim());
      group.append(el("summary", source.title), el("p", source.source_id, "meta"));
      if (source.source_url) group.append(link(source.source_url, "Official source"));
      if (source.coverage) group.append(el("p", source.coverage, "meta"));
      if (fields.length) {
        const list = el("ul", null, "query-catalog-list");
        for (const field of fields) {
          const item = el("li");
          item.append(el("code", field));
          list.append(item);
        }
        group.append(list);
      } else group.append(el("p", "Request the source to return its published fields together.", "meta"));
      target.append(group);
    }
    if (!target.childElementCount) target.append(el("p", "No return sources match that search.", "meta"));
  }

  function renderPermitTypes(target, catalog) {
    const groups = catalog.groups.map((group) => ({ ...group, matching: group.types.filter((type) =>
      matches(group.name, type.name)) })).filter((group) => group.matching.length);
    const count = groups.reduce((sum, group) => sum + group.matching.length, 0);
    const note = el("p", `${count} matching permit type${count === 1 ? "" : "s"} in ${groups.length} group${groups.length === 1 ? "" : "s"}. `, "meta");
    note.append(link(catalog.source_url, "Official permit catalog"));
    target.replaceChildren(note);
    target.append(el("p", "The catalog lists configured permit types. Search results show which permits the index can return.", "meta"));
    if (catalog.partial) target.append(el("p", "The official catalog was partial.", "source-warning"));
    for (const group of groups) {
      const disclosure = el("details", null, "query-catalog-group");
      disclosure.open = Boolean(browser.term.trim());
      disclosure.append(el("summary", `${group.name ?? "Ungrouped"} · ${group.matching.length}`));
      if (group.name === "Electrical") disclosure.append(button("Test Electrical as a group", () =>
        test("parcels", { source: "municity", group: group.name })));
      const list = el("ul", null, "query-catalog-list");
      for (const type of group.matching) {
        const row = el("li");
        const actions = el("div", null, "query-actions");
        actions.append(button("Test type", () => test("permits", { type: type.name })),
          button("Test contacts", () => test("contacts", { type: type.name })));
        row.append(el("code", type.name), actions);
        list.append(row);
      }
      disclosure.append(list);
      target.append(disclosure);
    }
  }

  function renderFields(target, capabilities, schemaData) {
    target.replaceChildren();
    let matched = 0;
    for (const [sourceId, spec] of Object.entries(capabilities.indexed_source_fields)) {
      if (browser.source !== "all" && browser.source !== sourceId) continue;
      const source = schemaData.sources.find((entry) => entry.id === sourceId);
      const title = sourceTitle(schemaData, sourceId);
      const fields = [...new Set(Object.keys(operators).flatMap((key) => spec[key] ?? []))]
        .filter((field) => matches(field, title, sourceId, groupTitle(schemaData, source?.group)));
      if (!fields.length) continue;
      matched += fields.length;
      const details = el("details", null, "query-catalog-group");
      details.open = browser.source !== "all" || Boolean(browser.term.trim());
      details.append(el("summary", `${title} · ${fields.length} field${fields.length === 1 ? "" : "s"}`));
      const sourceLine = el("p", null, "meta");
      sourceLine.append(el("code", sourceId));
      if (spec.event_date_field) sourceLine.append(document.createTextNode(` · Date range uses ${spec.event_date_field}`));
      if (source?.url) sourceLine.append(document.createTextNode(" · "), link(source.url, "Official source"));
      details.append(sourceLine, button("Test this source", () => test("records", { source: sourceId })));
      const list = el("ul", null, "query-catalog-list");
      for (const field of fields) {
        const row = el("li");
        const label = el("div");
        label.append(el("code", field), el("span", Object.keys(operators).filter((key) =>
          spec[key]?.includes(field)).map((key) => operators[key]).join(" · "), "meta"));
        const actions = el("div", null, "query-actions");
        actions.append(button("Test field", () => test("records", { source: sourceId, field })));
        if (spec.observed_value_fields?.includes(field)) {
          const output = el("p", null, "meta");
          output.hidden = true;
          const values = button("Show values", async () => {
            values.disabled = true;
            output.hidden = false;
            output.textContent = "Loading observed values…";
            try {
              const params = new URLSearchParams({ values: "1", source_id: sourceId, field });
              const report = await api(`/api/v1/search-capabilities?${params}`);
              output.replaceChildren(document.createTextNode(report.values.length
                ? `Observed in indexed parcel-linked records${report.truncated ? " · first 100" : ""}. `
                : "No values are available in the checked index. "));
              for (const value of report.values) output.append(button(value,
                () => test("records", { source: sourceId, field, value })));
            } catch (error) {
              output.textContent = error.message;
              values.disabled = false;
            }
          });
          values.setAttribute("aria-label", `Show observed values for ${field}`);
          actions.append(values);
          label.append(output);
          output.classList.add("query-values");
        }
        row.append(label, actions);
        list.append(row);
      }
      details.append(list);
      target.append(details);
    }
    const activity = capabilities.available.find((method) => method.tool === "search_indexed_permit_activity");
    if (browser.source === "all" && activity) {
      const fields = Object.entries(activity.filter_fields).filter(([field, meaning]) =>
        matches(field, meaning, "permit activity applications reviews inspections"));
      if (fields.length) {
        matched += fields.length;
        const details = el("details", null, "query-catalog-group");
        details.open = Boolean(browser.term.trim());
        details.append(el("summary", `Permit activity · ${fields.length} filter${fields.length === 1 ? "" : "s"}`),
          el("p", `Indexed permit types · ${capabilities.permit_activity_types.join(", ")}`, "meta"),
          button("Test permit activity", () => test("activity")));
        const list = el("ul", null, "query-catalog-list");
        for (const [field, meaning] of fields) {
          const row = el("li");
          row.append(el("code", field), el("span", meaning, "meta"));
          list.append(row);
        }
        details.append(list);
        target.append(details);
      }
    }
    if (browser.source === "all" && matches("permit contacts ContactRole Contractor")) {
      matched++;
      const group = el("details", null, "query-catalog-group");
      group.open = Boolean(browser.term.trim());
      group.append(el("summary", "Permit contacts"), el("p",
        "Filter by the published contact role, exact permit type, permit date or neighborhood. The search checks the permit and linked application live.", "meta"),
      button("Test permit contacts", () => test("contacts")));
      target.append(group);
    }
    target.prepend(el("p", matched ? `${matched} matching field${matched === 1 ? " or filter" : "s and filters"}.`
      : "No fields match those filters.", "meta"));
  }

  function renderExamples(target) {
    target.replaceChildren(el("p",
      "Plain-language search supports permits, permit contacts, reviewed commercial use, City neighborhoods, and recent City license issuance. Use field filters for other listed sources."));
    const list = el("ul", null, "query-catalog-list");
    for (const [name, question] of examples) {
      const row = el("li");
      row.append(el("span", name), button("Use question", () => openQuestion(question)));
      list.append(row);
    }
    target.append(list);
  }

  function input(label, values, key, { type = "text", placeholder = "", required = false } = {}) {
    const control = el("input");
    control.type = type;
    control.value = values[key] ?? "";
    control.placeholder = placeholder;
    control.required = required;
    control.oninput = () => { values[key] = control.value; };
    return labeled(label, control);
  }
  const date = { type: "date" };
  function sourceFields(req, cap, schemaData, index, redraw) {
    const boxed = el("fieldset", null, "query-requirement");
    boxed.append(el("legend", draft.method === "parcels" ? `Source ${index + 1}` : "Source filters"));
    const available = cap.indexed_source_fields;
    const grid = el("div", null, "query-grid");
    const source = select(req.source_id, [], (id) => {
      draft.requirements[index] = requirement(id);
      redraw();
    });
    groupedSources(source, schemaData, Object.keys(available));
    source.value = req.source_id;
    grid.append(labeled("Official source", source));
    if (req.source_id === "municity") grid.append(
      input("Exact permit type", req, "permit_type", { placeholder: "Water Heater" }),
      input("Indexed permit group", req, "permit_group", { placeholder: "Electrical" }));
    const spec = available[req.source_id];
    if (spec.event_date_field) grid.append(
      input(`${spec.event_date_field} from`, req, "event_date_from", date),
      input(`${spec.event_date_field} through`, req, "event_date_to", date));
    boxed.append(grid);
    const filterOptions = Object.entries(operators).filter(([op]) => op !== "one_of" || draft.method === "parcels")
      .flatMap(([op, description]) =>
      (spec[op] ?? []).filter((field) => !(req.source_id === "municity" && field === "PermitType"))
        .map((field) => [`${op}|${field}`, `${field} · ${description}`]));
    for (const [i, filter] of req.filters.entries()) {
      const row = el("div", null, "query-filter-row");
      const comparator = select(`${filter.operator}|${filter.field}`, filterOptions, (selection) => {
        const [op, field] = selection.split("|");
        req.filters[i] = { operator: op, field, value: "" };
        redraw();
      });
      row.append(labeled("Field and comparison", comparator),
        input("Value", filter, "value", { required: true,
          type: filter.operator.startsWith("number_") ? "number" : "text",
          placeholder: filter.operator === "one_of" ? "Comma-separated values" : "" }),
        button("Remove filter", () => { req.filters.splice(i, 1); redraw(); }));
      if (filter.operator.startsWith("number_")) row.querySelector("input").step = "any";
      boxed.append(row);
    }
    const actions = el("div", null, "query-actions");
    const add = button("Add field filter", () => {
      const [operator, field] = filterOptions[0][0].split("|");
      req.filters.push({ operator, field, value: "" });
      redraw();
    });
    add.disabled = !filterOptions.length;
    actions.append(add);
    if (draft.requirements.length > 1) actions.append(button("Remove source", () => {
      draft.requirements.splice(index, 1);
      redraw();
    }));
    boxed.append(actions);
    return boxed;
  }

  function serializeRequirement(req) {
    const { source_id, event_date_from, event_date_to, permit_group, permit_type } = req;
    const values = { source_id };
    if (event_date_from) values.event_date_from = event_date_from;
    if (event_date_to) values.event_date_to = event_date_to;
    if (source_id === "municity") {
      if (Boolean(permit_type.trim()) === Boolean(permit_group.trim()))
        throw new Error("Enter one exact permit type or one indexed permit group.");
      if (permit_group.trim()) values.permit_group = permit_group.trim();
      if (permit_type.trim()) values.equals = { PermitType: permit_type.trim() };
    }
    for (const { field, operator, value } of req.filters) {
      const text = value.trim();
      if (!text) throw new Error(`Enter a value for ${field}.`);
      values[operator] ??= {};
      if (Object.hasOwn(values[operator], field)) throw new Error(`Use each comparison for ${field} once.`);
      values[operator][field] = operator === "one_of" ? text.split(",").map((item) => item.trim()).filter(Boolean)
        : operator.startsWith("number_") ? Number(text) : text;
    }
    return values;
  }

  function serializeDraft(capabilities) {
    const method = draft.method;
    const values = method === "contacts" ? { scan_limit: 6, require_contact_role: true } : { limit: 25 };
    if (method === "parcels") return { ...values, requirements: draft.requirements.map(serializeRequirement) };
    const fields = method === "records" ? ["city_parcel_id", "city_objectid", "neighborhood",
      ...(capabilities.indexed_source_fields[draft.requirements[0].source_id].site_address_supported ? ["site_address"] : [])]
      : ["permits", "contacts"].includes(method) ? ["permit_types", "scope", draft.params.scope,
        "permit_status", "permit_date_from", "permit_date_to",
        ...(method === "contacts" ? ["contact_role", "permit_description_terms"] : [])]
        : ["activity_kind", "permit_type", "permit_id", "city_parcel_id", "neighborhood", "permit_status",
          "activity_type", "activity_status", "permit_date_from", "permit_date_to", "activity_date_from", "activity_date_to"];
    for (const key of fields) {
      const value = draft.params[key]?.trim();
      if (value) values[key] = key === "permit_types" ? [value] :
        key === "permit_description_terms" ? value.split(",").map((term) => term.trim()).filter(Boolean) : value;
    }
    return method === "records" ? { ...serializeRequirement(draft.requirements[0]), ...values } : values;
  }

  async function renderWorkbench(target) {
    formTarget = target;
    target.replaceChildren(el("p", "Loading structured search filters…", "meta"));
    try {
      const [cap, schemaData] = await load();
      function redraw() {
        const form = el("form", null, "query-workbench-form");
        const methodPick = select(draft.method, Object.entries(methods).map(([key, spec]) => [key, spec.title]),
          (method) => { setDraft(method); redraw(); });
        form.append(labeled("Search method", methodPick));
        const p = draft.params;
        if (["records", "parcels"].includes(draft.method)) {
          draft.requirements.forEach((item, index) => form.append(sourceFields(item, cap, schemaData, index, redraw)));
          if (draft.method === "parcels" && draft.requirements.length < 5)
            form.append(button("Add source to match", () => { draft.requirements.push(requirement("neighborhoods")); redraw(); }));
          if (draft.method === "records") {
            const grid = el("div", null, "query-grid");
            grid.append(input("City neighborhood", p, "neighborhood", { placeholder: neighborhoods }),
              input("City parcel ID", p, "city_parcel_id"), input("City feature ID", p, "city_objectid"));
            if (cap.indexed_source_fields[draft.requirements[0].source_id].site_address_supported)
              grid.append(input("Verified license site address", p, "site_address", { placeholder: "1533 State St" }));
            form.append(grid);
          }
        } else {
          const grid = el("div", null, "query-grid");
          if (["permits", "contacts"].includes(draft.method)) {
            p.scope ??= "city";
            const contacts = draft.method === "contacts";
            grid.append(input("Exact permit type", p, "permit_types", {
              required: contacts, placeholder: contacts ? "Water Heater" : "Blank searches all types",
            }), labeled("Scope", select(p.scope, [["city", "Citywide"], ["neighborhood", "Neighborhood"],
              ...(!contacts ? [["ward", "Ward"]] : [])],
                (value) => { p.scope = value; redraw(); })));
            if (contacts) grid.append(input("Exact contact role", p, "contact_role", { required: true }),
              input("Description contains any of", p, "permit_description_terms", { placeholder: "replace, replacing" }),
              el("p", "Uses the published permit date and the contact role listed on the permit or linked application.", "meta"));
            if (p.scope === "neighborhood") grid.append(input("City neighborhood", p, "neighborhood", { required: true }));
            if (p.scope === "ward") grid.append(input("City ward", p, "ward", { type: "number", required: true }));
          } else {
            const permitType = select(p.permit_type, [["", "Choose a permit type"],
              ...cap.permit_activity_types.map((name) => [name, name])], (value) => { p.permit_type = value; });
            permitType.required = true;
            grid.append(labeled("Exact permit type", permitType), labeled("Activity kind",
              select(p.activity_kind, [["application", "Application"], ["review", "Review task"], ["inspection", "Inspection"]],
                (value) => { p.activity_kind = value; redraw(); })),
            input("City neighborhood", p, "neighborhood"), input("City parcel ID", p, "city_parcel_id"),
            input("Official permit ID", p, "permit_id"), input("Exact activity type", p, "activity_type"),
            input("Published activity status", p, "activity_status"));
            const field = { application: "ApplicationDate", review: "DateCompleted", inspection: "CloseDate" }[p.activity_kind];
            grid.append(input(`${field} from`, p, "activity_date_from", date),
              input(`${field} through`, p, "activity_date_to", date));
          }
          grid.append(input("Published permit status", p, "permit_status"),
            input("PermitDate from", p, "permit_date_from", date), input("PermitDate through", p, "permit_date_to", date));
          form.append(grid);
        }
        const submit = el("button", "Run field search");
        submit.type = "submit";
        const error = el("p", null, "source-warning");
        error.setAttribute("role", "alert");
        error.hidden = true;
        form.append(submit, error);
        form.onsubmit = (event) => {
          event.preventDefault();
          error.hidden = true;
          try { run(draft.method, serializeDraft(cap)); }
          catch (problem) { error.textContent = problem.message; error.hidden = false; }
        };
        formTarget.replaceChildren(form);
      }
      redraw();
    } catch (error) {
      target.replaceChildren(el("p", error.message, "source-warning"),
        button("Retry", () => void renderWorkbench(target)));
    }
  }

  return { renderGuide, renderWorkbench };
}
