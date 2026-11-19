import { LAYERS, SOURCES } from "../parcel/config.js";
import { MAP_LAYERS, MAP_SOURCE_GAPS } from "../parcel/map-context.js";
import { MUNICIPAL_PERMIT_TYPES_URL } from "../parcel/permit-types.js";

// One physical import may serve several source records shown on a parcel.
const alias = {
  "parcel-assessment": "parcels", "parcel-owner": "parcels", "parcel-sale": "parcels",
  "cmt-contacts": "cmt",
};
const gis = {
  parcels: LAYERS.parcels, addresses: LAYERS.addresses,
  "trash-pickup": LAYERS.trashPickup, zoning: LAYERS.zoning,
  wards: LAYERS.wards, neighborhoods: LAYERS.neighborhoods,
  cmt: LAYERS.cmt, "managed-lots": LAYERS.managedLots,
  "ct-brownfields": LAYERS.ctBrownfields,
  "metered-parking-spaces": LAYERS.parkingSpaces,
};
const withheld = new Set(["local-historic-districts", "state-historic-districts"]);
const parcelOnly = new Set([
  "assessor", "assessor-owner", "assessor-sales", "assessor-valuations",
  "assessor-subareas", "assessor-land", "assessor-buildings",
  "assessor-extra-features", "assessor-outbuildings", "lci-cases",
  "municipal-business-licenses", "municipal-occupants",
  "business-master", "business-principals", "business-agents",
]);
const stateLocations = new Set(["ct-liquor-permits", "ct-child-care-licenses", "ct-cannabis-retail"]);

export const INDEX_DATASETS = Object.freeze({
  ...Object.fromEntries(Object.entries(gis).map(([id, url]) => [id,
    { id, kind: "arcgis", url, cadence: "daily" }])),
  "managed-lots": { id: "managed-lots", kind: "arcgis", url: LAYERS.managedLots,
    cadence: "daily", gate: "City MBP field semantics and complete parcel-key matches need verification before broad indexing." },
  "transit-stops": {
    id: "transit-stops", kind: "arcgis",
    url: MAP_LAYERS.find((layer) => layer.id === "transit-stops").url,
    cadence: "daily",
    publisher_evidence: "https://www.arcgis.com/home/item.html?id=94777472521147bcb9d8d847aa4715ae",
  },
  "school-attendance": { id: "school-attendance", kind: "official-snapshot", cadence: "daily" },
  municity: { id: "municity", kind: "municipal-type", cadence: "daily",
    gate: "Only municipal Permit parent rows are indexed by published type. Applications, complaints, documents, contacts, licenses and occupants remain live parcel-only. Types at the 2,000-row search limit cannot be indexed completely." },
  "municity-permit-types": { id: "municity-permit-types", kind: "municipal-catalog",
    cadence: "daily" },
  ...Object.fromEntries([...stateLocations].map((id) => [id,
    { id, kind: "socrata-location", cadence: "daily" }])),
});

export function indexSourceCatalog() {
  const entries = SOURCES.map((source) => {
    const indexSource = alias[source.id] ?? source.id;
    const definition = INDEX_DATASETS[indexSource];
    const search_mode = source.mode === "gap" ? "gap"
      : withheld.has(source.id) ? "excluded_from_search"
        : parcelOnly.has(source.id) ? "parcel_only_pending_complete_enumeration"
          : definition?.gate ? "conditional_index" : definition ? "index_candidate" : "parcel_only";
    return { source_id: source.id, index_source_id: definition ? indexSource : null,
      search_mode, cadence: definition?.cadence ?? null,
      source_url: source.url, coverage: source.coverage,
      ...(definition?.gate ? { release_gate: definition.gate } : {}) };
  });
  for (const layer of MAP_LAYERS.filter((item) => item.scope === "nearby")) {
    const definition = INDEX_DATASETS[layer.id];
    entries.push({ source_id: layer.id, index_source_id: definition ? layer.id : null,
      search_mode: definition ? "index_candidate" : "parcel_only",
      cadence: definition?.cadence ?? null, source_url: layer.url,
      coverage: layer.note ?? "Nearby mapped features, not parcel records." });
  }
  for (const gap of MAP_SOURCE_GAPS)
    entries.push({ source_id: gap.id, index_source_id: null,
      search_mode: "gap", cadence: null, source_url: gap.source_url,
      coverage: gap.note });
  entries.push({ source_id: "municity-permit-types",
    index_source_id: "municity-permit-types", search_mode: "index_candidate",
    cadence: "daily", source_url: MUNICIPAL_PERMIT_TYPES_URL,
    coverage: "Official municipal permit type catalog; entries are types, not issued permits." });
  return entries;
}
