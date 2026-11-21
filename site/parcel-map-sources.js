export const STREET_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";

export function createParcelMap(leaflet, container) {
  const map = leaflet.map(container, { scrollWheelZoom: false, keyboard: true });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  return map;
}

export const MAP_COLORS = {
  "parcel-addresses": "#dc5c32",
  zoning: "#195e9d",
  "transit-stops": "#2476ba",
  "metered-parking-spaces": "#7550a4",
};
