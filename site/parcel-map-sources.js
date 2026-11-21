const streetSource = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer";

export function createStreetLayer(leaflet) {
  return leaflet.tileLayer(`${streetSource}/tile/{z}/{y}/{x}`, {
    maxZoom: 23, maxNativeZoom: 23, className: "plat-street-tiles",
    attribution: `<a href="${streetSource}" target="_blank" rel="noopener noreferrer">Street map · Esri and contributors</a>`,
  });
}

export function createParcelMap(leaflet, container) {
  const map = leaflet.map(container, { scrollWheelZoom: false, keyboard: true });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  return map;
}

export const mapColor = (token) => `var(--${token})`;

const layerTokens = {
  "parcel-addresses": "ink",
  zoning: "cat-document",
  "transit-stops": "cat-permit",
  "metered-parking-spaces": "cat-sale",
};

export const mapLayerColor = (id) => mapColor(layerTokens[id] ?? "ink");

export const recordedUseStyles = new Map([
  ["residential", { label: "Residential", token: "cat-permit", opacity: .57 }],
  ["mixed_use", { label: "Mixed-use", token: "cat-license", opacity: .60 }],
  ["commercial_only", { label: "Commercial only", token: "cat-document", opacity: .60 }],
  ["other", { label: "Other", token: "ink-muted", opacity: .32 }],
  ["unclassified", { label: "Unclassified", token: "line-strong", opacity: .13 }],
]);

// Leaflet's canvas renderer needs resolved colors. The SVG layers and legend
// can read the same tokens directly from CSS.
export function watchBrowseMapColors(onChange) {
  const root = document.documentElement;
  const tokens = new Set(["ink", "parcel", ...Array.from(recordedUseStyles.values(), ({ token }) => token)]);
  const update = () => {
    const styles = getComputedStyle(root);
    onChange(Object.fromEntries(Array.from(tokens, (token) => [token, styles.getPropertyValue(`--${token}`).trim()])));
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", update);
  new MutationObserver(update).observe(root, { attributeFilter: ["data-theme"] });
  update();
}
