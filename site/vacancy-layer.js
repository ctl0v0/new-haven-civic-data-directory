import { saveVacancyAddresses, savedVacancyAddresses } from "./vacancy-session.js";

function readAddresses(csv) {
  const cells = csv.trim().split(/\r?\n/).filter((line) => line.trim())
    .map((line) => line.trim().replace(/^"(.*)"$/, "$1").replaceAll('""', '"'));
  if (cells.shift()?.toLowerCase() !== "address" || !cells.length)
    throw Error("Choose the Civic Fit CSV with an Address column.");
  return cells;
}

export function initVacancyLayer({ map, leaflet, api, el, selectListing, showActivity }) {
  const $ = (id) => document.getElementById(id);
  const panel = $("vacancy-panel");
  const controls = $("vacancy-controls");
  const neighborhood = $("vacancy-neighborhood");
  const search = $("vacancy-search");
  const list = $("vacancy-list");
  const status = $("vacancy-status");
  const toggle = $("vacancy-show-pins");
  const importButton = $("vacancy-import").querySelector("button");
  let data;
  let layer;
  let pending = false;
  let selectedId;

  function render() {
    if (!data) return;
    layer?.remove();
    const term = search.value.trim().toLowerCase();
    const visible = data.listings.filter(({ address, neighborhoods }) =>
      address.toLowerCase().includes(term) && (!neighborhood.value || neighborhoods?.includes(neighborhood.value)));
    const pins = visible.filter(({ geometry }) => geometry);
    controls.hidden = !data.listings.length;
    $("vacancy-fit").disabled = !pins.length;
    $("vacancy-activity-link").disabled = !visible.some(({ status }) => status === "linked");
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    for (const entry of visible) {
      const row = el("li");
      if (entry.status === "linked") {
        const button = el("button", entry.address, "overview-link");
        button.type = "button";
        button.dataset.listingId = entry.id;
        button.setAttribute("aria-current", String(entry.id === selectedId));
        button.onclick = () => pick(entry, true);
        row.append(button);
      } else row.append(el("strong", entry.address));
      const detail = entry.status === "linked" ? [entry.neighborhoods.join(", "),
        entry.geometry ? "" : "Parcel linked · pin unavailable"].filter(Boolean).join(" · ")
        : { ambiguous: "Multiple City parcel matches", unmatched: "No exact City parcel link", unavailable: "City index unavailable" }[entry.status];
      if (detail) row.append(el("span", detail, "t-caption"));
      list.append(row);
    }
    list.scrollTop = scrollTop;
    status.textContent = data.status === "needs_import" ? "Import the approved Civic Fit address export to load the layer."
      : data.status === "unavailable" ? "The City address index is unavailable. Your listings are retained for review."
      : `${visible.length.toLocaleString()} of ${data.listings.length.toLocaleString()} listings · ${pins.length.toLocaleString()} mapped`;
    if (!toggle.checked || !pins.length) return;
    layer = leaflet.geoJSON({
      type: "FeatureCollection",
      features: data.features.filter(({ id }) => pins.some((entry) => id === entry.id)),
    }, {
      pointToLayer: ({ properties }, point) => leaflet.marker(point, {
        icon: leaflet.divIcon({ className: "vacancy-pin", iconSize: [18, 18], iconAnchor: [9, 9] }),
        title: properties.address, alt: properties.address,
      }),
      onEachFeature: ({ properties }, marker) => marker.on("click", () => pick(properties, false)),
    }).addTo(map);
  }

  function setSelection(id) {
    selectedId = id;
    for (const button of list.querySelectorAll("button"))
      button.setAttribute("aria-current", String(button.dataset.listingId === selectedId));
  }

  function pick(entry, recenter) {
    setSelection(entry.id);
    void selectListing(entry, recenter);
  }

  function fit() {
    if (!toggle.checked) {
      toggle.checked = true;
      render();
    }
    if (layer?.getBounds().isValid()) map.fitBounds(layer.getBounds(), { padding: [24, 24], maxZoom: 16 });
  }

  async function load(addresses = savedVacancyAddresses(), focusMap = false) {
    if (pending) return;
    pending = true;
    importButton.disabled = true;
    status.textContent = "Matching listing addresses to City parcels…";
    try {
      data = await api("/api/v1/vacancy-layer", addresses ? {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addresses }),
      } : undefined);
      if (addresses) saveVacancyAddresses(addresses);
      if (data.listings.length) $("vacancy-upload").open = false;
      const prior = new URL(location.href).searchParams;
      const value = neighborhood.value || prior.get("neighborhood") || "";
      const names = [...new Set(data.listings.flatMap((entry) => entry.neighborhoods ?? []))].sort();
      neighborhood.replaceChildren(new Option("All neighborhoods", ""),
        ...names.map((name) => new Option(name, name)));
      if (names.includes(value)) neighborhood.value = value;
      if (prior.has("listing_query")) search.value = prior.get("listing_query");
      render();
      if (focusMap) fit();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      pending = false;
      importButton.disabled = false;
    }
  }

  function updateFilters() {
    const url = new URL(location.href);
    for (const [key, value] of [["neighborhood", neighborhood.value], ["listing_query", search.value.trim()]]) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    history.replaceState(null, "", url);
    render();
  }

  panel.addEventListener("toggle", () => {
    if (panel.open) {
      const url = new URL(location.href);
      url.searchParams.set("collection", "civic-fit");
      history.replaceState(null, "", url);
      if (!data || data.status === "unavailable") void load();
    }
  });
  $("vacancy-import").addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = $("vacancy-csv").files[0];
    if (!file || file.size > 32_000) {
      status.textContent = "Choose a Civic Fit address CSV under 32 KB.";
      return;
    }
    try { await load(readAddresses(await file.text()), true); }
    catch (error) { status.textContent = error.message; }
  });
  toggle.addEventListener("change", render);
  neighborhood.addEventListener("change", updateFilters);
  search.addEventListener("input", updateFilters);
  $("vacancy-fit").addEventListener("click", fit);
  $("vacancy-activity-link").addEventListener("click", () => showActivity(neighborhood.value, search.value.trim()));
  return {
    clearSelection: () => setSelection(null),
    open() {
      panel.open = true;
      if (!data) void load(savedVacancyAddresses(), true);
      else {
        const params = new URL(location.href).searchParams;
        neighborhood.value = params.get("neighborhood") ?? "";
        search.value = params.get("listing_query") ?? "";
        render();
      }
    },
  };
}
