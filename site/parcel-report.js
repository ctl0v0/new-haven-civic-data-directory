import { MAP_COLORS, STREET_TILES } from "./parcel-map-sources.js";

const mapData = document.getElementById("report-map-data");
const mapStatus = document.getElementById("report-map-status");
let map;

function initializeMap() {
  const leaflet = window.L;
  const { geometry, layers, radius } = JSON.parse(mapData.textContent);
  map = leaflet.map("report-map", { scrollWheelZoom: false });
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
  const boundary = leaflet.geoJSON(geometry, {
    style: { color: "#173e35", weight: 7, fillOpacity: 0 },
  }).addTo(map);
  leaflet.geoJSON(geometry, {
    style: { color: "#f8c547", weight: 4, fillColor: "#f8c547", fillOpacity: 0.18 },
  }).addTo(map);
  const bounds = boundary.getBounds();
  const center = bounds.getCenter();
  const latOffset = radius / 111195;
  const lonOffset = latOffset / Math.cos(center.lat * Math.PI / 180);
  const surrounding = leaflet.latLngBounds(
    [center.lat - latOffset, center.lng - lonOffset],
    [center.lat + latOffset, center.lng + lonOffset],
  ).extend(bounds);
  map.fitBounds(surrounding, { padding: [12, 12], maxZoom: 18 });
  leaflet.control.scale({ metric: true, imperial: true }).addTo(map);
  for (const layer of layers) {
    const toggle = [...document.querySelectorAll(".map-options input")].find((input) => input.value === layer.id);
    const color = MAP_COLORS[layer.id] ?? "#315e4e";
    const overlay = leaflet.geoJSON({ type: "FeatureCollection", features: layer.features }, {
      style: { color, weight: 2, fillOpacity: 0.04 },
      pointToLayer: (_feature, latlng) => leaflet.circleMarker(latlng, {
        radius: 5, color: "#fff", weight: 1.5, fillColor: color, fillOpacity: 0.95,
      }),
      onEachFeature: ({ properties: p }, feature) => {
        const label = document.createElement("span");
        label.textContent = [p.house_number, p.full_street_name].filter(Boolean).join(" ") ||
          p.zone_code || p.StopName || p.facilityid || layer.title;
        feature.bindTooltip(label);
      },
    });
    const showLayer = () => toggle.checked ? overlay.addTo(map) : map.removeLayer(overlay);
    toggle.addEventListener("change", showLayer);
    showLayer();
  }
}

if (mapData) {
  try { initializeMap(); }
  catch {
    map?.remove();
    map = null;
    document.getElementById("report-map").hidden = true;
    mapStatus.textContent = "The parcel map could not be displayed.";
  }
}

const photo = document.getElementById("report-photo");
if (photo) {
  const showMissingPhoto = () => {
    photo.hidden = true;
    document.getElementById("report-photo-status").textContent = "Photo could not be loaded";
  };
  photo.addEventListener("error", showMissingPhoto, { once: true });
  if (photo.complete && !photo.naturalWidth) showMissingPhoto();
}

function revealRecord() {
  if (!/^#record-\d+$/.test(location.hash)) return;
  const record = document.getElementById(location.hash.slice(1));
  const section = record?.closest("details");
  if (section) {
    section.open = true;
    record.scrollIntoView();
  }
}
window.addEventListener("hashchange", revealRecord);
revealRecord();

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
