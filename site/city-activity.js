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

export function initCityActivity({ api, el, link }) {
  const byId = (id) => document.getElementById(id);
  const form = byId("activity-filters");
  const status = byId("activity-status");
  const resultList = byId("activity-results");
  const sourceList = byId("activity-sources");
  const coverage = byId("activity-coverage");
  const more = byId("activity-more");
  const submit = form.querySelector("button");
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
      const li = el("li");
      const heading = el("h3");
      const parcel = el("a", item.city_address || `City parcel ${item.city_parcel_id}`);
      const params = new URLSearchParams({ parcel_id: item.city_parcel_id, objectid: item.city_objectid, view: "records" });
      parcel.href = `/parcel?${params}`;
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

  async function load(filters, cursor) {
    const query = new URLSearchParams(filters);
    if (cursor) query.set("cursor", cursor);
    submit.disabled = more.disabled = true;
    status.textContent = cursor ? "Loading more activity…" : "Loading activity…";
    resultList.setAttribute("aria-busy", "true");
    try {
      const data = await api(`/api/v1/city-activity?${query}`);
      if (!cursor) {
        applied = new URLSearchParams(Object.entries(data.filters).filter(([, value]) => value));
        form.elements.from.value = data.filters.from;
        form.elements.to.value = data.filters.to;
        const select = form.elements.neighborhood;
        select.replaceChildren(new Option("All neighborhoods", ""),
          ...data.neighborhoods.map((name) => new Option(name, name)));
        const selected = data.filters.neighborhood;
        if (selected && !data.neighborhoods.includes(selected)) select.add(new Option(selected, selected));
        select.value = selected ?? "";
        coverage.hidden = !data.coverage.sources.length;
        sourceList.replaceChildren(...data.coverage.sources.map((source) => {
          const li = el("li");
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
      const partial = data.coverage.status === "partial" ? " Some sources have limited coverage." : "";
      status.textContent = data.coverage.status === "unconfigured" || data.coverage.status === "unavailable"
        ? "The index needed for this feed is unavailable."
        : `${count ? `Showing ${count} activity items.` : "No indexed activity matches these filters."}${partial}`;
    } catch (error) {
      if (!cursor) {
        resultList.replaceChildren();
        coverage.hidden = more.hidden = true;
      }
      status.textContent = error.message;
    } finally {
      submit.disabled = more.disabled = false;
      resultList.removeAttribute("aria-busy");
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const filters = new URLSearchParams();
    for (const [key, value] of new FormData(form)) if (value) filters.set(key, value);
    void load(filters);
  });
  more.addEventListener("click", () => void load(applied, nextCursor));
  return load(applied);
}
