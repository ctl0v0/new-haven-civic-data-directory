export const GIS = "https://gis.newhavenct.gov/server/rest/services/Hosted/";
export const LAYERS = Object.freeze({
  parcels:
    GIS + "New_Haven_Parcels_Authoritative_Parcel_Viewer/FeatureServer/0",
  addresses: GIS + "New_Haven_Addresses_Authoritative_view/FeatureServer/0",
  zoning: GIS + "Zoning_(View)/FeatureServer/0",
  wards: GIS + "Wards_2022_(View)/FeatureServer/0",
  neighborhoods: GIS + "Neighborhoods_(View)/FeatureServer/0",
  managedLots: GIS + "LCI_Managed_Lots_(View)/FeatureServer/0",
  streetsPoints:
    "https://services6.arcgis.com/AWSPcxcHO7OnZlnu/arcgis/rest/services/Complete_Streets_Projects_public_view/FeatureServer/0",
  streetsLines:
    "https://services6.arcgis.com/AWSPcxcHO7OnZlnu/arcgis/rest/services/Complete_Streets_Projects_public_view/FeatureServer/1",
});

// The source catalog describes access, not completeness. IDs are shared by API and MCP.
export const SOURCES = Object.freeze([
  {
    id: "parcels",
    group: "property",
    title: "City parcel and assessment layer",
    url: LAYERS.parcels,
    mode: "live",
    coverage: "Citywide parcel records; valuation date is not established.",
    directoryId: "gis-parcels",
  },
  {
    id: "addresses",
    group: "property",
    title: "City address points",
    url: LAYERS.addresses,
    mode: "live",
    coverage:
      "Address points may have multiple rows or no unique parcel match.",
    directoryId: "gis-parcels",
  },
  {
    id: "assessor",
    group: "property",
    title: "Vision assessor card",
    url: "https://gis.vgsi.com/newhavenct/",
    mode: "live",
    coverage:
      "Individual assessor cards; card fields and assessment date require source review.",
    directoryId: "assessor",
  },
  {
    id: "zoning",
    group: "geography",
    title: "City zoning polygons",
    url: LAYERS.zoning,
    mode: "live",
    coverage:
      "All polygons intersecting the selected parcel; codes are not zoning advice.",
    directoryId: "gis-parcels",
  },
  {
    id: "wards",
    group: "geography",
    title: "City ward polygons",
    url: LAYERS.wards,
    mode: "live",
    coverage: "Wards_2022 plan; legal currency is unconfirmed.",
    directoryId: "ward-boundaries",
  },
  {
    id: "neighborhoods",
    group: "geography",
    title: "City neighborhoods",
    url: LAYERS.neighborhoods,
    mode: "live",
    coverage:
      "City GIS neighborhood polygons; labels and boundary currency require review.",
  },
  {
    id: "alders",
    group: "representation",
    title: "Board of Alders roster",
    url: "https://www.newhavenct.gov/government/departments-divisions/board-of-alders/list-of-alders",
    mode: "live",
    coverage:
      "Public roster; when inaccessible, city ward-layer contacts are labeled partial and require officeholder confirmation.",
    directoryId: "alders",
  },
  {
    id: "cmt",
    group: "representation",
    title: "Community Management Team districts",
    url: "https://maps.newhavenct.gov/datasets/cmt-districts-1",
    mode: "gap",
    coverage:
      "Civic Fit uses reviewed district geometry; a standalone live parcel lookup is not verified.",
  },
  {
    id: "cmt-contacts",
    group: "representation",
    title: "Community Management Team contacts",
    url: "https://www.newhavenct.gov/government/departments-divisions/livable-city-initiative/community-management-teams",
    mode: "gap",
    coverage: "Current source and district-specific contacts require review.",
  },
  {
    id: "municity",
    group: "activity",
    title: "Municity applications, permits, licenses and certificates",
    url: "https://www.municityconnect.com/#/app/NewHavenCityCT/landing",
    mode: "live",
    coverage:
      "Public parcel children returned by the vendor; no inspections or complete historical coverage is claimed.",
  },
  {
    id: "managed-lots",
    group: "activity",
    title: "LCI Managed Lots",
    url: LAYERS.managedLots,
    mode: "live",
    coverage:
      "An exact MBP–MBLU candidate is not proof of vacancy or availability.",
  },
  {
    id: "planning",
    group: "activity",
    title: "Reviewed planning cases",
    url: "https://newhaven-ct.maps.arcgis.com/",
    mode: "curated",
    coverage:
      "Selected documented cases only; no complete case feed or meeting records.",
  },
  {
    id: "business-master",
    group: "business",
    title: "Connecticut Business Registry Master",
    url: "https://data.ct.gov/Business/Connecticut-Business-Registry-Business-Master/n7gp-d28j",
    mode: "live",
    coverage:
      "Address or owner-name candidates do not establish occupancy or ownership.",
  },
  {
    id: "business-principals",
    group: "business",
    title: "Connecticut Business Registry Principals",
    url: "https://data.ct.gov/Business/Connecticut-Business-Registry-Principals/ka36-64k6",
    mode: "gap",
    coverage:
      "Entity joins require reviewed identity; no automatic parcel association.",
  },
  {
    id: "state-licenses",
    group: "business",
    title: "Connecticut State Licenses and Credentials",
    url: "https://data.ct.gov/Business/State-Licenses-and-Credentials/ngch-56tr",
    mode: "live",
    coverage: "Exact address matches are candidates, not proof of current use.",
  },
  {
    id: "complete-streets",
    group: "nearby",
    title: "Complete Streets projects",
    url: LAYERS.streetsPoints,
    mode: "live",
    coverage:
      "Nearby recorded projects; source appears stale and distance is not a parcel relationship.",
  },
  {
    id: "service-requests",
    group: "nearby",
    title: "Service requests",
    url: "https://seeclickfix.com/new-haven",
    mode: "gap",
    coverage: "No verified stable New Haven parcel lookup or reusable feed.",
  },
  {
    id: "inspections",
    group: "activity",
    title: "Inspections and enforcement",
    url: "https://www.newhavenct.gov/",
    mode: "gap",
    coverage: "No verified safe, complete parcel-level feed.",
  },
  {
    id: "vacancy",
    group: "property",
    title: "Commercial vacancy",
    url: "https://www.newhavenct.gov/",
    mode: "gap",
    coverage:
      "No reliable structured commercial vacancy source; managed lots are not vacancy.",
  },
  {
    id: "area-context",
    group: "nearby",
    title: "Census, transit, places and walkability",
    url: "https://www.census.gov/data.html",
    mode: "paused",
    coverage:
      "Civic Fit area enrichment is paused and is not collected by this pilot.",
  },
]);

export const GROUPS = Object.freeze([
  { id: "property", title: "Property and assessment" },
  { id: "geography", title: "Zoning and boundaries" },
  { id: "representation", title: "Representation" },
  { id: "activity", title: "Parcel activity" },
  { id: "business", title: "Business records" },
  { id: "nearby", title: "Nearby activity" },
]);

export function source(id) {
  return SOURCES.find((item) => item.id === id);
}
