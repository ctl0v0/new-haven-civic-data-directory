const accessLabel = {
  both_windows: "Google Maps lists zero matches in either walking area",
  shorter_window: "Google Maps lists matches beyond the 10-minute area",
  mapped_supply: "Google Maps lists matches within 10 minutes",
  incomplete: "The two walking-window counts could not be compared",
};
const zoningLabel = {
  by_right: "Listed as permitted by right in the City use table",
  special_exception: "Listed as requiring a special exception in the City use table",
  review_needed: "Confirm this proposed use with City Planning",
};
const checkedDate = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York",
});

export function renderHalfMileReport(output, data, { el, link }) {
  const countFormat = new Intl.NumberFormat("en-US");
  const summary = el("p", "½ mile straight-line from the ", "meta");
  summary.append(link(data.origin.source_url, "City address point"), " · Checked ",
    checkedDate.format(new Date(data.checked_at)));
  const note = el("p", "Google Maps counts listings marked operational. Categories can overlap. Use zero counts as leads to verify.", "meta");
  const table = el("table", null, "storefront-table storefront-half-mile-table");
  table.setAttribute("aria-label", "Half-mile neighborhood counts");
  const header = el("tr");
  for (const label of ["Place category", "Count", "Source"]) {
    const cell = el("th", label);
    cell.scope = "col";
    header.append(cell);
  }
  const head = el("thead");
  head.append(header);
  table.append(head);
  for (const [group, rows] of Map.groupBy(data.categories, ({ group }) => group)) {
    const body = el("tbody");
    const groupRow = el("tr");
    const groupName = el("th", group, "storefront-category-group");
    groupName.scope = "rowgroup";
    groupName.colSpan = 3;
    groupRow.append(groupName);
    body.append(groupRow);
    for (const category of rows) {
      const row = el("tr");
      const name = el("th", category.label);
      name.scope = "row";
      if (category.note) name.append(el("small", category.note, "meta"));
      const count = el("td", null, "storefront-category-count");
      count.append(el("strong", category.status === "ok" ? countFormat.format(category.count) : "Unavailable"));
      const source = el("td");
      source.append(link(category.source_url, category.attribution));
      if (category.reason) source.append(el("small", category.reason, "meta"));
      row.append(name, count, source);
      body.append(row);
    }
    table.append(body);
  }
  output.replaceChildren(el("h3", `Neighborhood around ${data.origin.address}`), summary, note, table);
}

export function renderStorefrontReport(output, data, { el, link, sourceNames }) {
  const countFormat = new Intl.NumberFormat("en-US");
  const heading = el("h3", `Neighborhood around ${data.origin.address}`);
  const summary = el("p", null, "meta");
  summary.append(link(data.origin.source_url, "City address point"), " · ", link(data.walking.source_url, data.walking.attribution));
  const methods = el("p", "Walking times are modeled along mapped routes. The 10-minute area approximates a 20-minute round trip.", "meta");
  output.replaceChildren(heading, summary, methods);
  for (const window of data.walking.areas.filter(({ status }) => status !== "ok")) {
    output.append(el("p", `${window.minutes}-minute walk · ${window.reason}`, "storefront-notice"));
  }

  function listIdeas(title, ids, empty) {
    const section = el("section", null, "storefront-shortlist");
    section.append(el("h4", title));
    if (!ids.length) {
      section.append(el("p", empty, "meta"));
      return section;
    }
    const list = el("ol");
    for (const id of ids) {
      const idea = data.candidates.find((candidate) => candidate.id === id);
      const item = el("li");
      item.append(el("strong", idea.label), el("p", accessLabel[idea.access]), link(idea.priority.source_url, idea.priority.label));
      if (idea.zoning.status === "special_exception") item.append(el("p", zoningLabel.special_exception, "meta"));
      list.append(item);
    }
    section.append(list);
    return section;
  }
  const shortlists = el("div", null, "storefront-shortlists");
  shortlists.append(
    listIdeas("Neighborhood priorities", data.neighborhood,
      "No idea met the local evidence and access checks. Review the potential gaps below."),
    listIdeas("Commercial tenant ideas", data.commercial,
      "A shortlist needs a documented local need, a reviewed zoning path and a verified space check."),
  );
  output.append(shortlists);

  function countTable(label, rows, open) {
    const details = el("details", null, "storefront-section");
    details.open = open;
    details.append(el("summary", label));
    const attribution = el("p", null, "meta");
    const checked = checkedDate.format(new Date(data.google_maps.checked_at));
    attribution.append(link(data.google_maps.source_url, data.google_maps.attribution), ` · Checked ${checked}`);
    const table = el("table", null, "storefront-table");
    const header = el("tr");
    for (const name of ["Place type", ...data.walking.areas.map(({ minutes }) => `${minutes} min`)]) {
      const cell = el("th", name);
      cell.scope = "col";
      header.append(cell);
    }
    const head = el("thead");
    head.append(header);
    const body = el("tbody");
    for (const { label, counts } of rows) {
      const row = el("tr");
      const name = el("th", label);
      name.scope = "row";
      row.append(name);
      for (const count of counts) {
        const cell = el("td", count.status === "ok" ? countFormat.format(count.count) : "Unavailable");
        if (count.reason) cell.append(el("small", count.reason, "meta"));
        row.append(cell);
      }
      body.append(row);
    }
    table.append(head, body);
    details.append(attribution, table);
    return details;
  }
  output.append(countTable("Storefront uses checked", data.candidates, true));

  const ideas = el("section", null, "storefront-section");
  ideas.append(el("h4", "Potential gaps and site checks"));
  for (const idea of data.candidates) {
    const detail = el("details", null, "storefront-section");
    detail.open = Boolean(idea.priority || idea.planned_project);
    detail.append(el("summary", idea.label), el("p", accessLabel[idea.access]),
      el("p", `Google Maps types · ${idea.types.map((type) => type.replaceAll("_", " ")).join(", ")}`, "meta"));
    if (idea.priority) {
      detail.append(el("p", idea.priority.explanation), link(idea.priority.source_url, idea.priority.label));
    } else {
      detail.append(el("p", "Local need still needs independent evidence.", "meta"));
    }
    if (idea.planned_project) {
      const project = idea.planned_project;
      const notice = el("p", `${project.explanation} City project address within the ${project.minutes}-minute area. `, "storefront-notice");
      notice.append(link(project.source_url, project.label), " · ", link(project.site_url, "City project addresses"),
        " · ", link(project.location_url, "City address point"));
      detail.append(notice);
    }
    const zoning = el("p", `${zoningLabel[idea.zoning.status]}${idea.zoning.district ? ` (${idea.zoning.district})` : ""}. `);
    zoning.append(link(idea.zoning.source_url, idea.zoning.use_table_row ?? "City zoning and regulations"));
    detail.append(zoning, el("p", idea.space_confirmed ? "Space reviewed by the person running the analysis." :
      "Verify the usable storefront and the requirements for this use.", "meta"), el("p", idea.next_check));
    for (const permit of idea.prior_permits) {
      const row = el("p", "Prior permit at this address · ", "meta");
      row.append(link(permit.source_url, permit.label));
      if (permit.event_date) row.append(` · ${permit.event_date}`);
      detail.append(row);
    }
    ideas.append(detail);
  }
  output.append(ideas);

  const profile = countTable("All main place categories", data.categories, false);
  profile.append(el("p", "Counts are Google’s mapped operational listings. Categories can overlap, and park boundaries can intersect a walking area away from an entrance.", "meta"));
  output.append(profile);
  const site = el("details", null, "storefront-section");
  site.append(el("summary", "Property evidence and source coverage"));
  const districts = el("p", `City zoning · ${data.site.zoning.district_codes.join(", ") || "District unavailable"} · `);
  districts.append(link(data.site.zoning.source_url, "City zoning GIS"), " · ", link(data.site.zoning.ordinance_url, "City ordinance"));
  site.append(districts);
  if (data.site.neighborhoods.length) site.append(el("p", `City mapped neighborhoods · ${data.site.neighborhoods.join(", ")}`));
  if (data.storefront_sq_ft) site.append(el("p", `User-verified usable area · ${countFormat.format(data.storefront_sq_ft)} sq ft`));
  if (data.site.subareas.length) {
    const areas = el("ul");
    for (const subarea of data.site.subareas) {
      const item = el("li", subarea.label);
      if (subarea.gross_area_sq_ft !== null) item.append(` · ${countFormat.format(subarea.gross_area_sq_ft)} gross sq ft`);
      item.append(" · ", link(subarea.source_url, "Assessor card"));
      areas.append(item);
    }
    site.append(el("p", "Assessor building subareas describe the building as assessed.", "meta"), areas);
  }
  for (const check of data.site.source_checks) {
    site.append(el("p", `${sourceNames[check.source_id] ?? check.source_id} · ${check.status.replaceAll("_", " ")}${check.warning ? ` · ${check.warning}` : ""}`, "meta"));
  }
  output.append(site);
}
