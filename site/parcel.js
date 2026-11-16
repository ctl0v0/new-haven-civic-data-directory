const $ = (id) => document.getElementById(id);
const groups = [
  ["property", "Property and assessment"],
  ["geography", "Zoning and boundaries"],
  ["representation", "Representation"],
  ["activity", "Parcel activity"],
  ["business", "Business records"],
  ["nearby", "Nearby activity"],
];
let selected = null;
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
function appendRecord(parent, item) {
  const details = el("details", null, "record");
  const summary = el(
    "summary",
    `${item.event_date ? item.event_date + " · " : ""}${item.source_id} · ${item.attributes?.title ?? item.attributes?.property_address ?? item.attributes?.LegalAddress ?? item.source_record_id}`,
  );
  details.append(summary);
  const p = el(
    "p",
    item.note ?? `Match: ${item.match?.method ?? "unknown"}`,
    "meta",
  );
  details.append(p);
  details.append(link(item.source_url, "Original source"));
  details.append(el("p", `Retrieved ${item.retrieved_at}`, "meta"));
  details.append(el("pre", JSON.stringify(item.attributes, null, 2)));
  parent.append(details);
}
function sourceLine(parent, source) {
  const row = el("div", null, "source-status");
  row.append(
    el("span", source.status.replaceAll("_", " "), `badge ${source.status}`),
    document.createTextNode(` ${source.source_id} · ${source.count} records`),
  );
  row.append(el("p", source.warning ?? source.coverage, "meta"));
  if (source.source_url) row.append(link(source.source_url, "Open source"));
  parent.append(row);
}
async function choose(item) {
  selected = item;
  $("candidates").hidden = true;
  history.replaceState(
    null,
    "",
    `/parcel?parcel_id=${encodeURIComponent(item.parcel_id)}${item.objectid ? `&objectid=${encodeURIComponent(item.objectid)}` : ""}`,
  );
  $("groups").replaceChildren();
  $("group-nav").replaceChildren();
  $("feed").replaceChildren();
  $("feed-section").hidden = false;
  status("Loading parcel records…");
  try {
    const qs = new URLSearchParams({ parcel_id: item.parcel_id });
    if (item.objectid) qs.set("objectid", item.objectid);
    const summary = await api(`/api/v1/parcel?${qs}`);
    $("parcel-summary").hidden = false;
    $("parcel-title").textContent =
      summary.parcel.address ?? `Parcel ${summary.parcel.parcel_id}`;
    $("parcel-identifiers").textContent =
      `Parcel ID ${summary.parcel.parcel_id} · MBLU ${summary.parcel.mblu ?? "unavailable"} · Assessor account ${summary.parcel.account_number ?? "unavailable"}`;
    status("Records are loading by source.");
    for (const [id, title] of groups) {
      const section = el("section", null, "panel");
      section.id = `group-${id}`;
      section.append(el("h2", title));
      section.append(el("p", "Loading…", "meta"));
      $("groups").append(section);
      const a = link(location.href + `#group-${id}`, title);
      a.href = `#group-${id}`;
      $("group-nav").append(a);
      void loadGroup(id, section, qs);
    }
    void loadFeed(qs);
  } catch (error) {
    status(error.message);
  }
}
async function loadGroup(id, section, qs, cursor = null) {
  try {
    const p = new URLSearchParams(qs);
    p.set("group", id);
    if (cursor) p.set("cursor", cursor);
    const data = await api(`/api/v1/records?${p}`);
    if (!cursor)
      section.replaceChildren(el("h2", groups.find((x) => x[0] === id)[1]));
    if (!cursor) {
      for (const s of data.sources) sourceLine(section, s);
    }
    for (const item of data.items) appendRecord(section, item);
    if (data.next_cursor) {
      const b = el("button", "Load more", "load-more");
      b.type = "button";
      b.addEventListener("click", () => {
        b.remove();
        void loadGroup(id, section, qs, data.next_cursor);
      });
      section.append(b);
    }
  } catch (error) {
    section.append(
      el("p", `Could not load this group: ${error.message}`, "meta"),
    );
  }
}
async function loadFeed(qs, cursor = null) {
  try {
    const p = new URLSearchParams(qs);
    if (cursor) p.set("cursor", cursor);
    const data = await api(`/api/v1/feed?${p}`);
    if (!cursor) {
      $("feed").replaceChildren();
      for (const s of data.sources)
        if (s.status === "unavailable" || s.status === "partial")
          sourceLine($("feed"), s);
    }
    for (const item of data.items) appendRecord($("feed"), item);
    if (!data.items.length && !cursor)
      $("feed").append(
        el("p", "No dated records were returned by the checked sources."),
      );
    const more = $("feed-more");
    more.hidden = !data.next_cursor;
    if (data.next_cursor)
      more.onclick = () => {
        more.hidden = true;
        void loadFeed(qs, data.next_cursor);
      };
  } catch (error) {
    $("feed").append(el("p", `Could not load the timeline: ${error.message}`));
  }
}
$("search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  status("Searching…");
  $("candidates").hidden = true;
  try {
    const data = await api("/api/v1/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: $("query").value }),
    });
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
      const button = el(
        "button",
        `${item.address ?? "No address"} · Parcel ${item.parcel_id} · ${item.match.method}`,
      );
      button.type = "button";
      button.onclick = () => choose(item);
      $("candidate-list").append(button);
    }
    if (data.candidates.length === 1 && !data.truncated) {
      void choose(data.candidates[0]);
      return;
    }
    $("candidates").hidden = false;
    status(
      data.truncated
        ? "Search was truncated; refine your query."
        : "Choose the matching parcel.",
    );
  } catch (error) {
    status(error.message);
  }
});
const initial = new URL(location.href).searchParams;
if (initial.has("parcel_id"))
  void choose({
    parcel_id: initial.get("parcel_id"),
    objectid: initial.get("objectid"),
  });
