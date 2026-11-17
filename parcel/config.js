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
  localHistoricDistricts:
    "https://services6.arcgis.com/AWSPcxcHO7OnZlnu/ArcGIS/rest/services/New_Haven_Local_Historic_Districts/FeatureServer/5",
  stateHistoricDistricts:
    "https://services6.arcgis.com/AWSPcxcHO7OnZlnu/ArcGIS/rest/services/New_Haven_State_Historic_Districts/FeatureServer/1",
  ctBrownfields:
    "https://services1.arcgis.com/FjPcSmEFuDYlIdKC/ArcGIS/rest/services/Brownfields_Final_2025/FeatureServer/0",
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
    id: "assessor-sales",
    group: "property",
    title: "Assessor ownership history",
    url: "https://gis.vgsi.com/newhavenct/",
    mode: "live",
    coverage:
      "Ownership History rows from the assessor card for the exact parcel PID. Published rows may not be a complete deed chain; a $0 sale price is shown as published.",
    directoryId: "assessor",
  },
  {
    id: "assessor-valuations",
    group: "property",
    title: "Assessor valuation history",
    url: "https://gis.vgsi.com/newhavenct/",
    mode: "live",
    coverage:
      "Current and historical appraised and assessed valuation rows from the assessor card for the exact parcel PID. Valuation year is not an exact event date or a tax bill.",
    directoryId: "assessor",
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
    id: "assessor-subareas",
    group: "property",
    title: "Assessor building subareas",
    url: "https://gis.vgsi.com/newhavenct/",
    mode: "live",
    coverage:
      "Building Sub-Areas rows from the Vision card with the exact parcel PID. Codes, descriptions, gross area and living area are assessment fields, not a measured retail lease area or a zoning permission.",
    directoryId: "assessor",
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
    id: "zoning",
    group: "geography",
    title: "City zoning polygons",
    url: LAYERS.zoning,
    mode: "live",
    coverage:
      "All City zoning polygons intersecting the selected parcel. Zone code, district category and districts are shown as published; they do not specify how many square feet of a building may be used for retail.",
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
    id: "local-historic-districts",
    group: "geography",
    title: "City local historic district boundaries",
    url: LAYERS.localHistoricDistricts,
    mode: "live",
    coverage:
      "City mapped local historic district polygons, updated January 2022, intersecting the selected parcel. The map is general reference, not a permit or designation determination.",
  },
  {
    id: "state-historic-districts",
    group: "geography",
    title: "City hosted State historic district boundaries",
    url: LAYERS.stateHistoricDistricts,
    mode: "live",
    coverage:
      "City mapped State historic district polygons, updated December 2021, intersecting the selected parcel. The map is general reference, not a permit or designation determination.",
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
    title: "City parcel applications, complaints, contacts, documents, licenses, occupants and permits",
    url: "https://www.municityconnect.com/#/app/NewHavenCityCT/landing",
    mode: "live",
    coverage:
      "Live public Municity parcel children, including applications, complaints, contacts, documents, licenses, occupants and permits. Certificates are also returned. Occupant personal contact fields, complaint narratives and contact phone, email and address fields are omitted. No complete historical coverage is claimed.",
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
    id: "ct-brownfields",
    group: "environment",
    title: "Connecticut DEEP brownfields inventory",
    url: LAYERS.ctBrownfields,
    verification_url: "https://portal.ct.gov/deep/remediation--site-clean-up/brownfields/brownfields-site-inventory",
    mode: "live",
    coverage:
      "DEEP inventory updated February 19, 2026. Only New Haven rows whose published Site Parcel equals this parcel's official PID or MBLU are returned. An inventory listing does not establish present contamination, cleanup status, or every environmental condition.",
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
      "An exact MBP–MBLU candidate identifies a managed-lot record; it does not establish current parcel use.",
  },
  {
    id: "planning",
    group: "activity",
    title: "Planning cases",
    url: "https://newhaven-ct.maps.arcgis.com/",
    mode: "gap",
    coverage:
      "No planning case feed with a verified parcel identifier is connected. Manually selected documents are not returned as parcel records.",
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
    id: "municipal-occupants",
    group: "business",
    title: "Municipal parcel occupants",
    url: "https://www.municityconnect.com/#/app/NewHavenCityCT/landing",
    mode: "live",
    coverage:
      "Public Occupant rows returned by the verified municipal parcel. Names and inactive flags are source fields; they do not establish a current tenant or operating business.",
  },
  {
    id: "business-master",
    group: "business",
    title: "Connecticut Business Registry Master",
    url: "https://data.ct.gov/Business/Connecticut-Business-Registry-Business-Master/n7gp-d28j",
    mode: "gap",
    coverage:
      "The registry has billing addresses but no verified parcel identifier. Address-only matches are excluded from parcel records.",
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
    mode: "gap",
    coverage:
      "Credential addresses lack a verified parcel identifier. Address-only matches are excluded from parcel records.",
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
]);

export const GROUPS = Object.freeze([
  { id: "property", title: "Property and assessment" },
  { id: "geography", title: "Zoning and boundaries" },
  { id: "environment", title: "Environmental records" },
  { id: "representation", title: "Representation" },
  { id: "activity", title: "Parcel activity" },
  { id: "business", title: "Business records" },
  { id: "nearby", title: "Nearby activity" },
]);

// Area context is requested separately from parcel records and the parcel timeline.
export const CONTEXT_SOURCES = Object.freeze([
  {
    id: "census-block-2020",
    title: "City hosted 2020 census blocks",
    url: "https://services6.arcgis.com/AWSPcxcHO7OnZlnu/ArcGIS/rest/services/NH_2020_Census_pop_by_Block/FeatureServer/0",
    mode: "live",
    coverage: "2020 population, adults, and housing units for the census block containing the parcel point; these are area counts, not parcel occupants or building-level conditions.",
  },
  {
    id: "ct-tract-2020-acs",
    title: "Connecticut 2023 tract dataset (2020 ACS measures)",
    url: "https://data.ct.gov/Government/2023-Disproportionately-Impacted-Areas/3p9s-pdza",
    geometry_url: "https://services6.arcgis.com/AWSPcxcHO7OnZlnu/ArcGIS/rest/services/2020_USA_Tracts/FeatureServer/0",
    mode: "live",
    coverage: "2020 ACS income, poverty, and population only where the State dataset has an exact row for the City hosted 2020 census tract FIPS.",
  },
  {
    id: "ct-transit-stops",
    title: "City hosted CT Transit bus stops",
    url: "https://services6.arcgis.com/AWSPcxcHO7OnZlnu/ArcGIS/rest/services/CT_Transit_New_Haven_Bus_Stops/FeatureServer/0",
    mode: "live",
    coverage: "Recorded stop points within 400 meters. The source InService flag is shown; current schedules are not established by this layer.",
  },
  {
    id: "nearby-municipal-business",
    title: "Named municipal license and occupant records on nearby parcels",
    url: "https://www.municityconnect.com/#/app/NewHavenCityCT/landing",
    mode: "live",
    coverage: "Public License and Occupant rows on nearby City parcels matched by each parcel's verified MBLU. Source-reported type, status, dates and recorded address are shown where present. Rows can be historical and do not establish current operation.",
  },
]);

export function source(id) {
  return SOURCES.find((item) => item.id === id);
}
