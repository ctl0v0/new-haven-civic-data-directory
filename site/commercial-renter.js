import { savedVacancyAddresses } from "./vacancy-session.js";
import { eventDateLabel, recordTitle, recordStatus, shortDate, fieldLabel } from "./parcel-record-text.js";

const toolNames = {
  search_commercial_vacancies: "Approved vacancy listings",
  get_commercial_storefront_evidence: "Storefront records",
  count_nearby_places: "Google Maps nearby places",
};
const sections = {
  hood: "Hood permits and inspections", history: "Prior businesses and occupants", space: "Building and subareas",
  zoning: "Mapped zoning", applications: "Applications and instructions", lease: "Lease terms",
};
const matchLabel = (evidence) => evidence?.matches_query ? "Searched address"
  : evidence?.source_address ? "Same parcel · other recorded address" : "Parcel record · address unspecified";
const usable = (value) => value !== null && value !== undefined && value !== "";

export function initCommercialRenter({ api, el, link, setStatus, clearResults, invalidate, sourceNames }) {
  const $ = (id) => document.getElementById(id);
  const form = $("renter-address-form");
  if (!form) return { selectedStorefront: () => undefined };
  const field = $("renter-address-input");
  let storefront;

  function action(label, handler, css = "secondary") {
    const button = el("button", label, css);
    button.type = "button";
    button.onclick = handler;
    return button;
  }

  function select(target, focus = false) {
    storefront = target;
    $("renter-selection").hidden = !target;
    $("renter-address").textContent = target?.address ?? "";
    form.hidden = Boolean(target);
    if (focus) $("ask-question").focus();
  }

  form.onsubmit = (event) => {
    event.preventDefault();
    const address = field.value.trim().replace(/,\s*New Haven(?:,?\s*CT)?(?:\s+\d{5})?$/i, "");
    if (!/^\d{1,6}\s+\S/.test(address)) {
      setStatus("Enter a New Haven street address with its house number.", "clarify");
      return;
    }
    invalidate();
    clearResults();
    select({ address }, true);
    setStatus("Choose a follow-up or ask your own question.");
  };
  $("renter-change").onclick = () => {
    invalidate();
    clearResults();
    setStatus("");
    select(undefined);
    field.value = "";
    field.focus();
  };

  function recordFields(record) {
    const detail = el("details", null, "query-result-detail");
    const fields = el("dl", null, "query-plan-summary");
    for (const [key, value] of Object.entries(record.attributes ?? {})) {
      if (!usable(value)) continue;
      const formatted = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
      fields.append(el("dt", fieldLabel(key)), el("dd", formatted));
    }
    detail.append(el("summary", "Published fields"), fields);
    return detail;
  }

  function row(title) {
    const item = el("li");
    item.append(el("h3", title));
    $("ask-results").append(item);
    return item;
  }

  function addCoverage(title, entries, note) {
    const container = $("ask-coverage");
    const detail = el("details", null, "query-result-detail");
    const list = el("ul");
    for (const { label, status, url, warning } of entries) {
      const item = el("li");
      item.append(url ? link(url, label) : label);
      if (status) item.append(` · ${status.replaceAll("_", " ")}`);
      if (warning) item.append(el("p", warning, "meta"));
      list.append(item);
    }
    detail.append(el("summary", title));
    if (note) detail.append(el("p", note, "meta"));
    if (entries.length) detail.append(list);
    container.append(detail);
    container.hidden = false;
  }

  const sourceCheck = (check) => ({
    label: sourceNames[check.source_id] ?? check.source_id ?? check.title,
    status: check.count_established === false && !["partial", "unavailable"].includes(check.status)
      ? "partial" : check.status,
    url: check.source_url ?? check.url, warning: check.warning,
  });

  function renderShortlist(result, plan, execute) {
    if (result.status === "needs_import") {
      const item = row("Load your approved vacancy listings");
      const browse = el("a", "Open Browse parcel map");
      browse.href = "/parcel?view=map";
      item.append(el("p", "Import the approved Civic Fit CSV on the map, then return to Test a question in this tab."), browse);
      setStatus("The vacancy collection is empty.", "clarify");
      return;
    }
    if (result.status === "unavailable") {
      setStatus(result.reason ?? "The listing index is unavailable.", "unavailable");
      return;
    }
    for (const item of result.items) {
      const { storefront: target, hood_permit: hood } = item;
      const entry = row(target.address);
      entry.append(el("p", [item.neighborhoods.join(", "), `City parcel ${target.parcel_id}`, "Availability unverified"]
        .filter(Boolean).join(" · "), "meta"));
      if (hood) {
        entry.append(el("p", [hood.permit_type, hood.permit_number, shortDate(hood.permit_date), hood.permit_status]
          .filter(Boolean).join(" · ")),
        el("p", [matchLabel(hood.address_evidence), hood.address_evidence?.source_address].filter(Boolean).join(" · "), "meta"),
        link(hood.source_url, "City permit"));
      }
      const actions = el("div", null, "query-actions");
      actions.append(action("Use this storefront", () => {
        select(target, true);
        setStatus(`Selected ${target.address}. Choose a follow-up or ask a question.`);
      }), link(item.parcel_source_url, "City parcel"));
      entry.append(actions);
    }
    const summary = result.total_matches
      ? `Showing ${result.items.length} of ${result.total_matches} matching listings.`
      : "No listings matched in the checked records.";
    setStatus([summary, result.status === "partial" ? "Some source checks were incomplete." : null].filter(Boolean).join(" "),
      result.status);
    const { coverage } = result;
    const checks = (coverage.hood_permits?.source_checks ?? []).map((check) => ({
      ...sourceCheck(check), label: check.scope_key?.startsWith("permit-type:")
        ? check.scope_key.slice("permit-type:".length) : sourceCheck(check).label,
    }));
    if (coverage.hood_permits) checks.unshift(sourceCheck({ ...coverage.hood_permits.catalog, title: "City permit type catalog" }));
    addCoverage("Listing and permit coverage", checks,
      `${coverage.total_listed} approved listing addresses checked · ${coverage.unresolved_listings} without a verified parcel link`);
    if (result.next_cursor) {
      const item = row("More storefronts");
      item.append(action("Next page", () => execute({ ...plan, arguments: { ...plan.arguments, cursor: result.next_cursor } })));
    }
  }

  function renderHood(result, plan, execute) {
    if (!result.permits.length) row("No matching hood permit returned");
    for (const permit of result.permits) {
      const record = row([permit.permit_type, permit.permit_number].filter(Boolean).join(" · "));
      record.append(el("p", [shortDate(permit.permit_date), permit.permit_status].filter(Boolean).join(" · ")),
        el("p", [matchLabel(permit.address_evidence), permit.address_evidence?.source_address].filter(Boolean).join(" · "), "meta"),
        link(permit.source_url, "City permit"));
      const work = result.work.find(({ permit_id }) => permit_id === permit.permit_id);
      if (!work) {
        record.appendChild(el("div", null, "query-actions")).append(action("Check inspections", () =>
          execute({ ...plan, arguments: { ...plan.arguments, permit_id: permit.permit_id } })));
        continue;
      }
      if (!work.inspections.length) record.append(el("p", work.status === "unavailable"
        ? "The City inspection detail was unavailable." : "The City returned no linked inspection rows.", "meta"));
      for (const inspection of work.inspections) {
        const a = inspection.attributes;
        const dates = [inspection.closed_date && `Closed ${shortDate(inspection.closed_date)}`,
          inspection.scheduled_date && `Scheduled ${shortDate(inspection.scheduled_date)}`];
        record.append(el("p", [a.InspType ?? "Inspection", a.Status, a.Results, ...dates].filter(Boolean).join(" · ")),
          recordFields(inspection));
      }
      if (work.application) record.append(link(work.application.source_url, "Linked City application"));
      for (const warning of work.warnings ?? []) record.append(el("p", warning, "meta"));
    }
    setStatus("A permit or inspection records past City activity. Current hood presence and condition remain unverified.");
    addCoverage("Hood permit coverage", [sourceCheck(result.coverage.live),
      sourceCheck({ ...result.coverage.indexed.catalog, title: "Published permit type catalog" }),
      ...result.coverage.indexed.source_checks.map(sourceCheck)], result.coverage.indexed.warning);
  }

  function renderEvidence(result, plan, execute) {
    if (result.section === "hood") {
      renderHood(result, plan, execute);
      return;
    }
    if (result.section === "lease") {
      setStatus(result.reason);
      return;
    }
    if (result.section === "applications") {
      for (const entry of result.applications) {
        const item = row(entry.title);
        item.append(el("p", entry.department, "meta"));
        for (const { text, source } of entry.instructions) item.append(el("p", text), link(source.url, source.title));
        for (const form of entry.forms) item.appendChild(el("p")).append(link(form.url, form.title));
        if (entry.start?.url) item.appendChild(el("p")).append(link(entry.start.url, "Open official application portal"));
      }
      addCoverage("Application source coverage", result.coverage.sources.map(sourceCheck), result.coverage.citysquared_menu.note);
      setStatus(result.applications.length ? "Official application and department guidance." : "No relevant directory entries returned.");
      return;
    }
    const items = [...result.items].sort((a, b) => Number(Boolean(b.address_evidence?.matches_query)) -
      Number(Boolean(a.address_evidence?.matches_query)) || Number(Boolean(b.food_service_evidence)) -
      Number(Boolean(a.food_service_evidence)) || String(b.event_date ?? "").localeCompare(String(a.event_date ?? "")));
    for (const record of items) {
      const item = row(recordTitle(record));
      const date = shortDate(record.event_date);
      const a = record.attributes;
      const parts = [date && `${eventDateLabel(record)} · ${date}`, recordStatus(record),
        record.food_service_evidence?.value ?? a.occupancy_type ?? a.license_type,
        usable(a.gross_area_sq_ft) && `${a.gross_area_sq_ft.toLocaleString("en-US")} gross sq ft`,
        usable(a.living_area_sq_ft) && `${a.living_area_sq_ft.toLocaleString("en-US")} living sq ft`,
        a.building_number && `Building ${a.building_number}`].filter(Boolean);
      if (parts.length) item.append(el("p", parts.join(" · ")));
      item.append(el("p", [matchLabel(record.address_evidence), record.address_evidence?.source_address]
        .filter(Boolean).join(" · "), "meta"));
      item.append(link(record.source_url, sourceNames[record.source_id] ?? "Official record"), recordFields(record));
    }
    if (result.guidance?.length) {
      const item = row("City guidance");
      for (const resource of result.guidance) item.appendChild(el("p")).append(link(resource.url, resource.title));
    }
    addCoverage("Source coverage", result.coverage.map(sourceCheck));
    const descriptions = {
      history: "Published business and license records may reflect past activity. See the recorded address on each row.",
      space: "The assessor reports areas by building and subarea. The area available to lease may differ.",
      zoning: "City Plan can verify whether your restaurant use is allowed at this storefront.",
    };
    const checkedFood = items.some(({ food_service_evidence }) => food_service_evidence);
    const message = result.section === "history" && items.length && !checkedFood
      ? "The returned record types do not identify a restaurant or food service use. Other business records are shown below."
      : descriptions[result.section];
    setStatus(items.length ? message : "No matching records returned. Review source coverage.");
  }

  function renderNearby(result, plan, execute) {
    const item = row(`${result.count} operational ${result.count === 1 ? "place" : "places"} listed by Google Maps`);
    item.append(el("p", [result.category_label ?? result.category, `${result.radius_meters} m straight-line radius`,
      result.origin.address, `Checked ${new Date(result.retrieved_at).toLocaleString("en-US", { timeZone: "America/New_York" })}`].join(" · ")),
    link(result.source_url, result.attribution));
    const matches = plan.tool === "list_nearby_places";
    const matchPlan = { tool: "list_nearby_places", arguments: { ...plan.arguments,
      storefront: result.storefront, origin: result.origin.id, count: result.count } };
    if (!matches && result.count >= 1 && result.count <= 100) {
      item.appendChild(el("div", null, "query-actions")).append(action("Show matching places", () => execute(matchPlan)));
    }
    if (result.count > 100 || result.status === "above_limit") {
      setStatus("Google Maps provides names for searches with up to 100 matches.");
      return;
    }
    if (matches && result.results?.length) {
      const places = el("ul");
      for (const place of result.results) {
        const entry = el("li");
        entry.append(link(place.maps_url, place.name));
        if (place.address) entry.append(` · ${place.address}`);
        places.append(entry);
      }
      item.append(places);
      if (result.next_cursor) item.append(action("Next matches", () => execute({
        ...matchPlan, arguments: { ...matchPlan.arguments, cursor: result.next_cursor },
      })));
    }
    setStatus(result.unavailable || result.missing_matches
      ? "Some place details were unavailable. The Google Maps count is shown above."
      : "The count reflects places Google Maps lists as operational.");
  }

  function renderPlan(response, isCurrent) {
    const plan = response.renter_plan;
    const target = $("ask-interpretation");
    const summary = el("dl", null, "query-plan-summary");
    const args = plan.arguments;
    const line = (label, value) => summary.append(el("dt", label), el("dd", value));
    line("Search", toolNames[plan.tool]);
    if (args.storefront) line("Storefront", args.storefront.address);
    if (plan.tool === "search_commercial_vacancies") {
      line("Area", args.neighborhood ?? "New Haven");
      if (args.hood_permit) line("Filter", "Published hood permit types · indexed history");
    }
    if (args.section) line("Records", sections[args.section]);
    if (args.category) line("Place type", args.category.replaceAll("_", " "));
    if (args.radius_meters) line("Straight-line radius", `${args.radius_meters} m`);
    const detail = el("details", null, "query-result-detail");
    detail.append(el("summary", "MCP request"), el("pre", JSON.stringify(plan, null, 2)));
    target.replaceChildren(el("h2", "Search plan"), summary);
    const confirm = action("Run search", () => execute(plan), "");
    target.append(confirm, detail);
    target.hidden = false;
    setStatus("Review the search plan, then run it.", "planned");
    let requestVersion = 0;

    async function execute(next) {
      if (!isCurrent()) return;
      const request = ++requestVersion;
      confirm.disabled = true;
      $("ask-results").replaceChildren();
      $("ask-coverage").replaceChildren();
      $("ask-coverage").hidden = true;
      $("ask-clarification").hidden = true;
      $("ask-clarification").replaceChildren();
      setStatus("Checking sources…", "loading");
      try {
        const listing_addresses = next.tool === "search_commercial_vacancies" ? savedVacancyAddresses() : null;
        const result = await api("/api/v1/commercial-renter", { method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...next, arguments: { ...next.arguments,
            ...(listing_addresses?.length ? { listing_addresses } : {}) } }) });
        if (!isCurrent() || request !== requestVersion) return;
        if (result.storefront) select(result.storefront);
        if (next.tool === "search_commercial_vacancies") renderShortlist(result, next, execute);
        else if (["ok", "above_limit"].includes(result.status)) {
          if (next.tool === "get_commercial_storefront_evidence") renderEvidence(result, next, execute);
          else renderNearby(result, next, execute);
        } else {
          setStatus(result.reason ?? "The source could not be checked.", result.status);
          const choices = $("ask-clarification");
          for (const candidate of result.candidates ?? []) {
            choices.append(action(`${candidate.address ?? "City parcel"} · ${candidate.parcel_id}`, () => {
              const selected = { ...next.arguments.storefront, parcel_id: candidate.parcel_id, objectid: candidate.objectid };
              select(selected);
              void execute({ ...next, arguments: { ...next.arguments, storefront: selected } });
            }));
          }
          for (const { id, address, objectid } of result.origins ?? []) {
            choices.append(action(`Use ${address} · City point ${objectid}`, () =>
              execute({ ...next, arguments: { ...next.arguments, origin: id } })));
          }
          choices.hidden = !choices.childElementCount;
        }
      } catch (error) {
        if (isCurrent() && request === requestVersion) setStatus(error.message, "unavailable");
      } finally {
        if (isCurrent() && request === requestVersion) confirm.disabled = false;
      }
    }
  }

  return { renderPlan, selectedStorefront: () => storefront };
}
