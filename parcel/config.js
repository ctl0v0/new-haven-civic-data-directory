export const GIS = "https://gis.newhavenct.gov/server/rest/services/Hosted/";
export const LAYERS = Object.freeze({
  parcels:
    GIS + "New_Haven_Parcels_Authoritative_Parcel_Viewer/FeatureServer/0",
  addresses: GIS + "New_Haven_Addresses_Authoritative_view/FeatureServer/0",
  zoning: GIS + "Zoning_(View)/FeatureServer/0",
  wards: GIS + "Wards_2022_(View)/FeatureServer/0",
  neighborhoods: GIS + "Neighborhoods_(View)/FeatureServer/0",
  cmt: GIS + "CMT_Districts_(View)/FeatureServer/0",
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
    url: LAYERS.cmt,
    mode: "live",
    coverage:
      "City GIS districts intersecting the selected parcel. Boundary overlaps are shown as candidates; district currency requires source review.",
  },
  {
    id: "cmt-contacts",
    group: "representation",
    title: "Community Management Team contacts from city GIS",
    url: LAYERS.cmt,
    verification_url: "https://www.newhavenct.gov/government/community-management-team",
    mode: "live",
    coverage:
      "District manager, neighborhood specialist and chair contacts from the city GIS layer. The city CMT page can differ; confirm contacts there before use.",
  },
  {
    id: "municity",
    group: "activity",
    title: "City parcel applications, complaints, contacts, documents, licenses and permits",
    url: "https://www.municityconnect.com/#/app/NewHavenCityCT/landing",
    mode: "live",
    coverage:
      "Live public Municity parcel children, including applications, complaints, contacts, documents, licenses and permits. Certificates are also returned. Documents link to the vendor; complaint narratives and contact phone, email and address fields are omitted. No complete historical coverage is claimed.",
  },
  {
    id: "lci-cases",
    group: "activity",
    title: "LCI Case HQ housing code and anti-blight cases",
    url: "https://lci.city/",
    mode: "live",
    coverage:
      "Public case number, status, filed date and listed fine only. Complaint narratives, attachments and licensing status are not collected; property PID and address must both match.",
  },
  {
    id: "tax-bills",
    group: "property",
    title: "New Haven real estate tax bills",
    url: "https://www.mytaxbill.org/inet/bill/home.do?town=newhaven",
    mode: "gap",
    coverage:
      "Official search portal only. No approved automated parcel-to-account lookup or current balance is available in this API.",
  },
  {
    id: "land-records",
    group: "property",
    title: "City Clerk land records",
    url: "https://www.newhavenct.gov/government/departments-divisions/city-clerk",
    mode: "gap",
    coverage:
      "Official City Clerk entry point only. No approved machine feed or verified parcel join; deeds, mortgages and liens are not returned here.",
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
    id: "municipal-business-licenses",
    group: "business",
    title: "Named municipal business licenses",
    url: "https://www.municityconnect.com/#/app/NewHavenCityCT/landing",
    mode: "live",
    coverage:
      "Named licenses linked to the verified municipal parcel MBLU. Historical, expired or void records may appear; a license does not prove current occupancy or operation.",
  },
  {
    id: "business-master",
    group: "business",
    title: "Connecticut Business Registry Master",
    url: "https://data.ct.gov/Business/Connecticut-Business-Registry-Business-Master/n7gp-d28j",
    mode: "live",
    coverage:
      "Registry billing addresses are matched to the parcel-listed address and city address points. They are address matches, not evidence of occupancy or ownership.",
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
    coverage:
      "Credential addresses are matched to the parcel-listed address and city address points. They are address matches, not proof of current use or business location.",
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
      "Area context is paused and is not collected by this parcel pilot.",
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
