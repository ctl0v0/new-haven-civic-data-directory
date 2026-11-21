const typeLabels = {
  sale: "Sale", permit: "Permit", license: "License", application: "Application",
  review: "Review", inspection: "Inspection",
};
const dateLabels = {
  sale_date: "Sale date", PermitDate: "Permit date", IssueDate: "Issue date",
  effective_date: "Effective date", effectivedate: "Effective date", ApplicationDate: "Application date",
  DateCompleted: "Review completion date", CloseDate: "Inspection close date",
};
const calendar = new Intl.DateTimeFormat("en-US", {
  dateStyle: "full", timeZone: "UTC",
});
const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2,
});
const dateText = (value) => calendar.format(new Date(`${value}T00:00:00Z`));
const title = (event) => event.activity === "sale" && event.price !== null && event.price !== "" &&
  Number.isFinite(Number(event.price)) ? `Sale · ${money.format(Number(event.price))}`
  : [typeLabels[event.activity], event.business_name ?? event.published_type].filter(Boolean).join(" · ");

const filterKeys = ["neighborhood", "from", "to", "activity", "permit_type"];
const newHavenCalendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
function dateWindow(days) {
  const to = newHavenCalendar.format(new Date());
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { from: start.toISOString().slice(0, 10), to };
}
function linkedParcel(item) {
  const event = item.events.find(({ activity }) => activity === "permit") ?? item.events[0];
  const section = event.activity === "sale" ? "ownership" : event.activity === "license" ? "business" : "activity";
  const params = new URLSearchParams({
    parcel_id: item.city_parcel_id, objectid: item.city_objectid, view: "records", section,
  });
  if (section === "activity") {
    const application = event.activity === "application";
    params.set("category", application ? "Application" : "Permit");
    const type = event.activity === "permit" ? event.published_type : application ? null : event.permit_type;
    if (type && type.length <= 100) params.set("record_type", type);
  }
  return { href: `/parcel?${params}`, section };
}

export function initCityActivity({ api, el, link }) {
  const byId = (id) => document.getElementById(id);
  const form = byId("activity-filters");
  const status = byId("activity-status");
  const resultList = byId("activity-results");
  const sourceList = byId("activity-sources");
  const coverage = byId("activity-coverage");
  const more = byId("activity-more");
  const submit = form.querySelector('button[type="submit"]');
  const presets = [...document.querySelectorAll("[data-activity-days]")];
  const reset = byId("activity-reset");
  const permitType = form.elements.permit_type;
  const neighborhood = form.elements.neighborhood;
  let permitCatalog;
  let requestedFilters = null;
  let loadVersion = 0;
  let applied = new URLSearchParams();
  let nextCursor = null;
  let currentDay;
  let currentList;
  let count = 0;

  function record(event, showTitle) {
    const section = el("div", null, "city-activity-event");
    if (showTitle) section.append(el("strong", title(event)));
    const date = el("time", dateText(event.event_date));
    date.dateTime = event.event_date;
    const details = el("p", null, "city-activity-meta");
    details.append(`${dateLabels[event.date_field]} · `, date);
    for (const detail of [event.published_status, event.permit_number, event.license_number,
      event.address, event.department, event.results])
      if (detail != null && detail !== "") details.append(` · ${detail}`);
    section.append(details, link(event.source_url, "Official record"));
    return section;
  }

  function render(items) {
    for (const item of items) {
      if (item.event_date !== currentDay) {
        currentDay = item.event_date;
        const heading = el("h2", dateText(currentDay));
        currentList = el("ol", null, "city-activity-day");
        resultList.append(heading, currentList);
      }
      const li = el("li", null, "p-record");
      const heading = el("h3");
      const parcel = el("a", item.city_address || `City parcel ${item.city_parcel_id}`);
      const destination = linkedParcel(item);
      parcel.href = destination.href;
      const sectionName = { activity: "Permit and application records", business: "Business records", ownership: "Ownership history" };
      parcel.setAttribute("aria-label", `${parcel.textContent} · ${sectionName[destination.section]}`);
      heading.append(parcel);
      li.append(heading);
      if (item.neighborhoods.length) li.append(el("p", item.neighborhoods.join(" · "), "city-activity-meta"));
      if (item.events.length === 1) {
        li.append(el("p", title(item.events[0]), "city-activity-event-title"), record(item.events[0], false));
      } else {
        const details = el("details", null, "city-activity-project");
        const event = item.events.find(({ activity }) => activity === "permit") ?? item.events[0];
        const project = [event.permit_type ?? event.published_type, event.permit_number].filter(Boolean).join(" · ");
        details.append(el("summary", `${project || "Permit project"} · ${item.events.length} dated records`));
        for (const activity of item.events) details.append(record(activity, true));
        li.append(details);
      }
      currentList.append(li);
    }
  }

  function updatePermitFilter() {
    const permits = form.elements.activity.value === "permit";
    byId("activity-permit-type").hidden = !permits;
    permitType.disabled = !permits;
    if (!permits) permitType.value = "";
  }

  function setFilterValues(params, neighborhoods) {
    if (neighborhoods)
      neighborhood.replaceChildren(new Option("All neighborhoods", ""),
        ...neighborhoods.map((name) => new Option(name, name)));
    const selected = params.get("neighborhood") ?? "";
    if (selected && ![...neighborhood.options].some(({ value }) => value === selected))
      neighborhood.add(new Option(selected, selected));
    for (const key of filterKeys) form.elements[key].value = params.get(key) ?? "";
    updatePermitFilter();
  }

  function readFilters(source) {
    const filters = new URLSearchParams();
    for (const key of filterKeys) {
      const value = source.get(key)?.trim();
      if (value) filters.set(key, value);
    }
    if (filters.has("permit_type") && !filters.has("activity")) filters.set("activity", "permit");
    return filters;
  }

  function apply(filters) {
    const url = new URL(location.href);
    for (const key of filterKeys) url.searchParams.delete(key);
    for (const [key, value] of filters) url.searchParams.set(key, value);
    history.replaceState(null, "", `${url.pathname}${url.search}`);
    void load(filters);
  }

  async function load(filters, cursor) {
    const version = ++loadVersion;
    const query = new URLSearchParams(filters);
    if (cursor) query.set("cursor", cursor);
    else requestedFilters = filters.toString();
    for (const control of [submit, more, reset, ...presets]) control.disabled = true;
    if (!cursor) reset.hidden = !filters.size;
    status.textContent = cursor ? "Loading more activity…" : "Loading activity…";
    resultList.setAttribute("aria-busy", "true");
    try {
      const data = await api(`/api/v1/city-activity?${query}`);
      if (version !== loadVersion) return;
      if (!cursor) {
        applied = new URLSearchParams(Object.entries(data.filters).filter(([, value]) => value));
        setFilterValues(applied, data.neighborhoods);
        for (const button of presets) {
          const { from, to } = dateWindow(Number(button.dataset.activityDays));
          button.setAttribute("aria-pressed", String(from === data.filters.from && to === data.filters.to));
        }
        coverage.hidden = !data.coverage.sources.length;
        coverage.querySelector("summary").textContent = data.coverage.status === "partial"
          ? "Source coverage · limited" : "Source coverage";
        sourceList.replaceChildren(...data.coverage.sources.map((source) => {
          const li = el("li", null, "p-record");
          li.append(link(source.source_url, source.label));
          if (source.coverage_from && source.coverage_to)
            li.append(` · Indexed window ${source.coverage_from} through ${source.coverage_to}`);
          if (source.note) li.append(el("p", source.note, "city-activity-meta"));
          return li;
        }));
        resultList.replaceChildren();
        currentDay = null;
        count = 0;
      }
      render(data.items);
      count += data.items.length;
      nextCursor = data.next_cursor;
      more.hidden = !nextCursor;
      status.textContent = data.coverage.status === "unconfigured" || data.coverage.status === "unavailable"
        ? "The index needed for this feed is unavailable."
        : count ? `Showing ${count} activity ${count === 1 ? "item" : "items"}.`
          : "No indexed activity matches these filters.";
    } catch (error) {
      if (version !== loadVersion) return;
      if (!cursor) {
        requestedFilters = null;
        resultList.replaceChildren();
        coverage.hidden = more.hidden = true;
      }
      status.textContent = error.message;
    } finally {
      if (version === loadVersion) {
        for (const control of [submit, more, reset, ...presets]) control.disabled = false;
        resultList.removeAttribute("aria-busy");
      }
    }
  }

  form.elements.activity.addEventListener("change", updatePermitFilter);
  permitType.addEventListener("focus", () => {
    permitCatalog ??= api("/api/v1/permit-types").then(({ groups }) => {
      const names = [...new Set(groups.flatMap(({ types }) => types.map(({ name }) => name)))].sort();
      byId("activity-permit-types").replaceChildren(...names.map((name) => new Option(name, name)));
    }).catch(() => { permitCatalog = null; });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    apply(readFilters(new FormData(form)));
  });
  for (const button of presets) button.addEventListener("click", () => {
    const filters = readFilters(new FormData(form));
    for (const [key, value] of Object.entries(dateWindow(Number(button.dataset.activityDays))))
      filters.set(key, value);
    apply(readFilters(filters));
  });
  reset.addEventListener("click", () => apply(new URLSearchParams()));
  more.addEventListener("click", () => void load(applied, nextCursor));
  return () => {
    const filters = readFilters(new URL(location.href).searchParams);
    if (requestedFilters !== filters.toString()) {
      setFilterValues(filters);
      void load(filters);
    }
  };
}
