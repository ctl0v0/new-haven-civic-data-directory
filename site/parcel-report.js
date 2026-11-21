import { createParcelMap, STREET_TILES } from "./parcel-map-sources.js";
import { renderRadiusReport } from "./storefront-opportunity.js";

const mapData = document.getElementById("report-map-data");
const mapStatus = document.getElementById("report-map-status");
let map;

function initializeMap() {
  const leaflet = window.L;
  const { geometry, layers, radius } = JSON.parse(mapData.textContent);
  map = createParcelMap(leaflet, "report-map");
  const streets = leaflet.tileLayer(STREET_TILES, {
    maxZoom: 23, maxNativeZoom: 23,
    attribution: '<a href="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer">Street map · Esri and contributors</a>',
  });
  let tilesUnavailable = false;
  streets.on("loading", () => { tilesUnavailable = false; });
  streets.on("tileerror", () => { tilesUnavailable = true; });
  streets.on("load", () => {
    mapStatus.textContent = tilesUnavailable ? "Some street map tiles were unavailable." : "";
  });
  streets.addTo(map);
  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(`--${name}`).trim();
  const boundaryStyle = () => ({ color: color("parcel-edge"), weight: 2, fillColor: color("parcel"), fillOpacity: 1 });
  const boundary = leaflet.geoJSON(geometry, { style: boundaryStyle });
  const bounds = boundary.getBounds();
  const center = bounds.getCenter();
  const radiusStyle = () => ({ radius, color: color("ink"), dashArray: "4 4", weight: 1.2, fill: false });
  const restyleLayers = [];
  const latOffset = radius / 111195;
  const lonOffset = latOffset / Math.cos(center.lat * Math.PI / 180);
  const surrounding = leaflet.latLngBounds(
    [center.lat - latOffset, center.lng - lonOffset],
    [center.lat + latOffset, center.lng + lonOffset],
  ).extend(bounds);
  map.fitBounds(surrounding, { padding: [12, 12], maxZoom: 18 });
  const circle = leaflet.circle(center, radiusStyle()).addTo(map);
  boundary.addTo(map);
  leaflet.control.scale({ metric: true, imperial: true }).addTo(map);
  for (const layer of layers) {
    const toggle = [...document.querySelectorAll(".map-options input")].find((input) => input.value === layer.id);
    const token = layer.id === "zoning" ? "cat-document" :
      layer.id === "transit-stops" ? "cat-permit" : layer.id === "metered-parking-spaces" ? "cat-license" : "ink";
    const layerStyle = ({ properties }) => {
      const out = layer.id === "transit-stops" && [0, false, "0"].includes(properties.InService);
      return { color: color(out ? token : "surface-raised"), weight: 1.5,
        fillColor: color(out ? "surface-raised" : token), fillOpacity: 0.95 };
    };
    const areaStyle = () => ({ color: color(token), weight: 1.4, fillOpacity: 0.12 });
    const overlay = leaflet.geoJSON({ type: "FeatureCollection", features: layer.features }, {
      style: (feature) => feature.geometry.type === "Point" ? layerStyle(feature) : areaStyle(),
      pointToLayer: (feature, latlng) => leaflet.circleMarker(latlng, { radius: 4.5, ...layerStyle(feature) }),
      onEachFeature: ({ properties: p }, feature) => {
        const label = document.createElement("span");
        const transit = p.StopName ? [p.StopName, p.StopId != null && `Stop ${p.StopId}`,
          [0, false, "0"].includes(p.InService) && "Not in service"].filter(Boolean).join(" · ") : "";
        label.textContent = [p.house_number, p.full_street_name].filter(Boolean).join(" ") ||
          p.zone_code || transit || p.facilityid || layer.title;
        feature.bindTooltip(label);
      },
    });
    restyleLayers.push(() => overlay.eachLayer((item) =>
      item.setStyle(item.feature.geometry.type === "Point" ? layerStyle(item.feature) : areaStyle())));
    const showLayer = () => toggle.checked ? overlay.addTo(map) : map.removeLayer(overlay);
    toggle.addEventListener("change", showLayer);
    showLayer();
  }
  const refreshColors = () => {
    boundary.setStyle(boundaryStyle());
    circle.setStyle(radiusStyle());
    restyleLayers.forEach((restyle) => restyle());
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", refreshColors);
  new MutationObserver(refreshColors).observe(document.documentElement, { attributeFilter: ["data-theme"] });

}

if (mapData) {
  try { initializeMap(); }
  catch {
    try { map?.remove(); } catch { /* The map may have failed partway through initialization. */ }
    map = null;
    document.getElementById("report-map").hidden = true;
    mapStatus.textContent = "The parcel map could not be displayed.";
  }
}

const photo = document.getElementById("report-photo");
if (photo) {
  const showMissingPhoto = () => {
    document.getElementById("report-photo-frame").hidden = true;
    photo.closest(".p-hero").setAttribute("data-photo-unavailable", "");
    document.getElementById("report-photo-status").textContent = "Photo could not be loaded";
  };
  photo.addEventListener("error", showMissingPhoto, { once: true });
  if (photo.complete && !photo.naturalWidth) showMissingPhoto();
}

const navigation = document.querySelector(".report-nav");
const jump = navigation.querySelector(".report-jump");
const sectionSelect = document.getElementById("report-section-select");
jump.hidden = false;
const sizeNavigation = () => {
  const offset = matchMedia("(min-width: 1180px)").matches ? 12 : navigation.offsetHeight;
  document.documentElement.style.setProperty("--report-nav-height", `${offset}px`);
};
new ResizeObserver(sizeNavigation).observe(navigation);
sizeNavigation();

const railLinks = [...navigation.querySelectorAll("a")];
function setCurrent(id) {
  for (const link of railLinks) {
    if (link.hash === `#${id}`) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
  if ([...sectionSelect.options].some(({ value }) => value === id)) sectionSelect.value = id;
}

function revealTarget() {
  const target = document.getElementById(location.hash.slice(1));
  if (!target?.closest(".report-section")) return;
  const chapter = target.closest(".report-section");
  target.closest(".p-year")?.removeAttribute("hidden");
  for (let parent = target; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  const record = target.closest(".p-record");
  document.querySelector(".p-record[data-targeted]")?.removeAttribute("data-targeted");
  if (record) record.dataset.targeted = "";
  setCurrent(chapter.id);
  const landing = target.id === "geography" ? chapter : target;
  landing.scrollIntoView();
  const heading = landing.querySelector("h2, h3, h4") ?? record?.querySelector("h4");
  (heading ?? landing).focus({ preventScroll: true });
}
document.getElementById("report-section-go").addEventListener("click", () => {
  const hash = `#${sectionSelect.value}`;
  if (location.hash === hash) revealTarget();
  else location.hash = hash;
});
window.addEventListener("hashchange", revealTarget);
revealTarget();

const railObserver = new IntersectionObserver((entries) => {
  const entry = entries.find(({ isIntersecting }) => isIntersecting);
  if (entry) setCurrent(entry.target.id);
}, { rootMargin: "-20% 0px -70% 0px" });
for (const link of railLinks) {
  const target = document.getElementById(link.hash.slice(1));
  if (target) railObserver.observe(target);
  link.addEventListener("click", () => {
    if (link.hash === location.hash) revealTarget();
  });
}

for (const toggle of document.querySelectorAll("[data-plat-layer]")) {
  const layer = document.querySelector(`#plat-drawing [data-layer="${toggle.dataset.platLayer}"]`);
  toggle.addEventListener("change", () => layer?.toggleAttribute("data-off", !toggle.checked));
}

for (const button of document.querySelectorAll("[data-copy]")) {
  const label = button.getAttribute("aria-label");
  let timer;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.setAttribute("aria-label", "Copied");
      button.dataset.copied = "";
      clearTimeout(timer);
      timer = setTimeout(() => {
        button.setAttribute("aria-label", label);
        delete button.dataset.copied;
      }, 1500);
    } catch {
      const value = button.previousElementSibling;
      const range = document.createRange();
      range.selectNodeContents(value);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
}

function addFilters(container, filterAttribute, entries, valueAttribute, update) {
  if (!container) return;
  const buttons = [...container.querySelectorAll(`[data-filter-${filterAttribute}]`)];
  for (const button of buttons) button.addEventListener("click", () => {
    const active = button.getAttribute("aria-pressed") !== "true" ? button.dataset[`filter${filterAttribute[0].toUpperCase()}${filterAttribute.slice(1)}`] : "";
    for (const other of buttons) other.setAttribute("aria-pressed", String(Boolean(active) && other === button));
    for (const row of container.querySelectorAll(entries)) row.toggleAttribute("data-dim", Boolean(active) && row.dataset[valueAttribute] !== active);
    update(active);
  });
}

const timeline = document.getElementById("history");
addFilters(timeline, "cat", "[data-cat].mark, .p-year li", "cat", (active) => {
  for (const year of timeline.querySelectorAll(".p-year")) {
    year.hidden = Boolean(active) && !year.querySelector("li:not([data-dim])");
    if (active && !year.hidden) year.open = true;
  }
});
const sources = document.getElementById("sources");
addFilters(sources, "resp", "tr[data-response]", "response", () => {
  for (const group of sources.querySelectorAll("tbody"))
    group.querySelector(".p-ledger__group")?.toggleAttribute("data-dim", !group.querySelector("tr[data-response]:not([data-dim])"));
});

const chart = timeline?.querySelector(".p-timeline__chart");
if (chart) {
  const tip = document.createElement("div");
  tip.className = "p-tip";
  tip.hidden = true;
  document.body.append(tip);
  const hide = () => { tip.hidden = true; };
  for (const mark of chart.querySelectorAll(".mark")) {
    const show = () => {
      const rect = mark.getBoundingClientRect();
      tip.textContent = mark.getAttribute("aria-label");
      tip.style.top = `${Math.max(6, rect.top - 48)}px`;
      tip.style.left = `${Math.max(6, Math.min(rect.left, window.innerWidth - 286))}px`;
      tip.hidden = false;
    };
    mark.addEventListener("focus", show);
    mark.addEventListener("blur", hide);
    mark.addEventListener("pointerenter", show);
    mark.addEventListener("pointerleave", hide);
    mark.addEventListener("keydown", (event) => {
      if (event.key !== " ") return;
      event.preventDefault();
      location.hash = mark.getAttribute("href");
      hide();
    });
  }
  chart.addEventListener("scroll", hide, { passive: true });
  chart.scrollLeft = chart.scrollWidth;
}

const profile = document.getElementById("nearby-profile");
const profileButton = document.getElementById("profile-run");
const profileOrigin = document.getElementById("profile-origin");
const profileStatus = document.getElementById("profile-status");
const profileOutput = document.getElementById("profile-output");
const profileQuery = new URLSearchParams(profile.dataset.parcelQuery);
const opportunityPath = "/api/v1/parcel-opportunity";
let profileOriginsVerified = false;
profile.querySelector(".profile-controls").hidden = false;

async function profileRequest(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error ?? (response.status === 429
    ? "Too many requests. Try again in a minute." : "The nearby places profile could not be loaded."));
  return data;
}

function profileElement(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function profileLink(href, label) {
  const link = profileElement("a", label);
  try {
    const url = new URL(href);
    if (url.protocol === "https:") link.href = url.href;
    link.className = "p-src";
  } catch { /* Keep the source label if its link is unavailable. */ }
  return link;
}

profileOrigin.addEventListener("change", () => {
  profileOutput.replaceChildren();
  profileStatus.textContent = "";
  profileButton.textContent = "Run quarter-mile profile";
});

profileButton.addEventListener("click", async () => {
  profileButton.disabled = true;
  profileButton.setAttribute("aria-busy", "true");
  profileOutput.replaceChildren();
  try {
    if (!profileOriginsVerified) {
      const selected = profileOrigin.value;
      profileStatus.textContent = "Checking City address points…";
      const { origins, default_origin, radius_available, warning } =
        await profileRequest(`${opportunityPath}?${profileQuery}`);
      if (!origins.length) throw new Error(warning ?? "No verified City address point is available for this parcel.");
      if (!radius_available) throw new Error("The quarter-mile profile is awaiting the Preview Google Places Aggregate key.");
      profileOrigin.replaceChildren(new Option("Choose a City address point", ""));
      for (const point of origins) {
        const repeated = origins.filter(({ address }) => address === point.address).length > 1;
        profileOrigin.add(new Option(repeated ? `${point.address} · City point ${point.objectid}` : point.address, point.id));
      }
      profileOrigin.value = origins.some(({ id }) => id === selected) ? selected : default_origin ?? "";
      profileOriginsVerified = true;
      profileOrigin.closest(".profile-origin").hidden = Boolean(profileOrigin.value && origins.length === 1);
    }
    if (!profileOrigin.value) {
      profileStatus.textContent = "Choose a City address point to run the profile.";
      profileOrigin.focus();
      return;
    }
    profileOrigin.disabled = true;
    profileStatus.textContent = "Counting nearby places by category…";
    const data = await profileRequest(opportunityPath, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...Object.fromEntries(profileQuery), mode: "report_profile", origin: profileOrigin.value }),
    });
    renderRadiusReport(profileOutput, data, { el: profileElement, link: profileLink, plat: true });
    const available = data.categories.filter(({ status }) => status === "ok").length;
    profileStatus.textContent = `${available} of ${data.categories.length} category counts returned.`;
    profileButton.textContent = "Refresh quarter-mile profile";
  } catch (error) {
    profileStatus.textContent = error.message;
  } finally {
    profileButton.disabled = false;
    profileButton.removeAttribute("aria-busy");
    profileOrigin.disabled = false;
  }
});

const print = document.getElementById("print-report");
print.hidden = false;
print.addEventListener("click", () => window.print());
let openedForPrint = [];
window.addEventListener("beforeprint", () => {
  openedForPrint = [...document.querySelectorAll(".report details:not([open])")];
  for (const detail of openedForPrint) detail.open = true;
});
window.addEventListener("afterprint", () => {
  for (const detail of openedForPrint) detail.open = false;
  openedForPrint = [];
});
