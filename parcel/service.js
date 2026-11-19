import { GROUPS, SOURCES } from "./config.js";
import { cached, SourceError } from "./http.js";
import { loadParcel, resolveParcel } from "./resolve.js";
import { parcelFeatureToGeoJSON } from "./geometry.js";
import { parcelMapContext } from "./map-context.js";
import { checkedQueryAddress, markAddressEvidence } from "./address-evidence.js";
import { getGroup, getSourceRecords, pageItems } from "./adapters.js";
import { parcelPhoto as photoForParcel } from "./photo.js";
import { DISPLAY_GROUPS, displayGroup, displayGroupCounts, orderDisplayRecords } from "./record-state.js";
import { checkedFilters, filterRecords, recordFacets } from "./filters.js";
import { permitDetails, applicationDetails } from "./permit-details.js";
import { searchMunicipalPermits } from "./permit-search.js";
import { municipalPermitTypes } from "./permit-types.js";

export { resolveParcel };
export { parcelMapContext };
export { searchMunicipalPermits };
export { municipalPermitTypes };

export async function parcelGeometry(id, objectid = null) {
  return parcelFeatureToGeoJSON(await loadParcel(id, objectid));
}

export async function parcelPhoto(id, objectid = null) {
  return photoForParcel(id, objectid);
}

export async function parcelSummary(id, objectid = null) {
  const feature = await loadParcel(id, objectid);
  const a = feature.attributes;
  return {
    parcel: {
      parcel_id: a.parcel_id,
      objectid: a.objectid,
      address: a.property_address ?? null,
      mblu: a.mblu ?? null,
      account_number: a.account_number ?? null,
    },
    groups: GROUPS,
    source_count: SOURCES.length,
    notes: [
      "Live source results are not an official property determination.",
      "Assessment values are not current tax bills.",
      "Source dates and retrieval dates have different meanings.",
    ],
  };
}

export async function parcelOverview(id, objectid = null) {
  const feature = await loadParcel(id, objectid);
  const groups = await Promise.all(
    GROUPS.map(async (group) => getGroup(group.id, feature)),
  );
  const events = groups
    .flatMap((group) => group.items)
    .filter((item) => item.event_date)
    .sort((a, b) =>
      b.event_date.localeCompare(a.event_date) || a.id.localeCompare(b.id),
    )
    .slice(0, 5)
    .map((item) => ({
      source_id: item.source_id,
      source_record_id: item.source_record_id,
      event_date: item.event_date,
      source_url: item.source_url,
    }));
  const preferred = {
    property: ["parcels", "assessor-subareas", "assessor-valuations"],
    ownership: ["parcel-owner", "assessor-owner", "business-master"],
    business: ["municipal-business-licenses", "municipal-occupants"],
    activity: ["municity", "lci-cases", "managed-lots"],
    geography: ["zoning", "neighborhoods"],
    environment: ["ct-brownfields"],
    representation: ["alders", "cmt-contacts"],
  };
  const highlight = (item) => {
    const a = item.attributes ?? {};
    const label = item.source_id === "parcels" ? a.property_address :
      item.source_id === "assessor-subareas" ? `${a.description_as_published ?? "Building subarea"}${a.code ? ` (${a.code})` : ""}` :
      item.source_id === "assessor-valuations" ? `${a.valuation_year ?? "Unspecified year"} ${a.valuation_type ?? ""} valuation` :
      item.source_id === "parcel-owner" ? a.owner_name_1 ?? a.owner_name_2 :
      item.source_id === "assessor-owner" ? a.owner_name ?? a.co_owner_name :
      item.source_id === "business-master" ? a.legal_name :
      item.source_id === "municipal-business-licenses" ? a.business_name :
      item.source_id === "municipal-occupants" ? a.occupant_name :
      item.source_id === "zoning" ? a.zone_code ? `Zoning district ${a.zone_code}` : null :
      item.source_id === "neighborhoods" ? a.neighborhood_name ?? a.name :
      item.source_id === "ct-brownfields" ? a.site_name :
      item.source_id === "alders" ? a.alder_name :
      item.source_id === "cmt-contacts" ? a.district_name :
      item.category ? `${item.category} ${item.source_record_id ?? ""}`.trim() : null;
    return {
      source_id: item.source_id,
      source_record_id: item.source_record_id,
      source_url: item.source_url,
      event_date: item.event_date,
      label: String(label ?? item.source_record_id ?? item.source_id).slice(0, 160),
    };
  };
  const highlights = Object.fromEntries(groups.map((group) => {
    const rows = (preferred[group.group] ?? []).flatMap((sourceId) =>
      group.items.filter((item) => item.source_id === sourceId).slice(0, sourceId === "municity" ? 3 : 1));
    return [group.group, rows.slice(0, 3).map(highlight)];
  }));
  return {
    parcel: {
      parcel_id: feature.attributes.parcel_id,
      objectid: feature.attributes.objectid,
      address: feature.attributes.property_address ?? null,
    },
    groups: groups.map((group) => ({
      id: group.group,
      record_count: group.items.length,
      sources: group.sources,
    })),
    recent_events: events,
    highlights,
    partial: groups.some((group) => group.partial),
    note: "Source counts and dates describe the current response, not a complete property history. Use get_parcel_records for fields and provenance.",
  };
}

export async function parcelRecords(
  id,
  group,
  { objectid = null, cursor = null, limit = 25, query_address = null, ...options } = {},
) {
  const queryAddress = checkedQueryAddress(query_address);
  const filters = checkedFilters(options, { queryAddress });
  const feature = await loadParcel(id, objectid);
  const data = await getGroup(group, feature);
  const ordered = markAddressEvidence(orderDisplayRecords(data.items, group), queryAddress);
  const facets = recordFacets(ordered, group);
  const filtered = filterRecords(ordered, filters);
  const page = pageItems(filtered, cursor, limit);
  const displayGroups = DISPLAY_GROUPS.filter(({ key }) =>
    group === "ownership" ? key.startsWith("owner_") : !key.startsWith("owner_"));
  const counts = displayGroupCounts(ordered);
  return {
    ...data,
    ...page,
    facets,
    filters,
    returned_total: ordered.length,
    ...(["activity", "business", "ownership"].includes(group) ? {
      display_groups: displayGroups,
      display_group_counts: Object.fromEntries(displayGroups.map(({ key }) => [key, counts[key]])),
    } : {}),
    ...(queryAddress ? { query_address: queryAddress } : {}),
    items: page.items,
  };
}

export async function parcelTrashPickup(
  id,
  { objectid = null, query_address = null } = {},
) {
  const queryAddress = checkedQueryAddress(query_address);
  const feature = await loadParcel(id, objectid);
  const { items, ...source } = await getSourceRecords("trash-pickup", feature);
  return {
    parcel_id: Number(feature.attributes.parcel_id),
    source: { ...source, count: items.length },
    total: items.length,
    partial: ["partial", "unavailable"].includes(source.status),
    ...(queryAddress ? { query_address: queryAddress } : {}),
    items: markAddressEvidence(items, queryAddress),
  };
}

export async function parcelPermitDetails(id, permitId, objectid = null) {
  return permitDetails(await loadParcel(id, objectid), permitId);
}

export async function parcelApplicationDetails(id, applicationId, objectid = null) {
  return applicationDetails(await loadParcel(id, objectid), applicationId);
}

export async function parcelFeed(
  id,
  { objectid = null, cursor = null, limit = 25, query_address = null, ...options } = {},
) {
  const queryAddress = checkedQueryAddress(query_address);
  const filters = checkedFilters(options, { feed: true, queryAddress });
  const feature = await loadParcel(id, objectid);
  const key = `feed:${feature.attributes.parcel_id}:${feature.attributes.objectid}`;
  const data = await cached(key, async () => {
    const sources = await Promise.all(
      ["parcel-sale", "assessor-sales", "municity", "lci-cases", "managed-lots"].map(
        (name) => getSourceRecords(name, feature),
      ),
    );
    const items = sources
      .flatMap((s) => s.items)
      .filter((item) => item.event_date)
      .sort(
        (a, b) =>
          b.event_date.localeCompare(a.event_date) || a.id.localeCompare(b.id),
      );
    return {
      parcel_id: Number(feature.attributes.parcel_id),
      sources: sources.map(({ items, ...rest }) => ({
        ...rest,
        count: items.length,
      })),
      items,
      partial: sources.some((s) =>
        ["partial", "unavailable"].includes(s.status),
      ),
      note: "Dates are reported event or source-record dates. This feed does not track changes between source checks.",
    };
  });
  const withEvidence = markAddressEvidence(data.items.map((item) =>
    item.category || ["lci-cases", "assessor-sales"].includes(item.source_id)
      ? { ...item, display_group: displayGroup(item) } : item), queryAddress);
  const page = pageItems(filterRecords(withEvidence, filters), cursor, limit);
  return {
    ...data,
    ...page,
    filters,
    facets: recordFacets(withEvidence),
    returned_total: withEvidence.length,
    ...(queryAddress ? { query_address: queryAddress } : {}),
    items: page.items,
  };
}

export function sourceCoverage() {
  return {
    sources: SOURCES,
    groups: GROUPS,
    excluded: [
      "meetings, agendas and legislation",
      "budgets and monthly finance reports",
      "one-off reports and studies",
    ],
    as_of: new Date().toISOString(),
  };
}

export function apiError(error) {
  if (error instanceof SourceError)
    return { status: error.status, error: error.message };
  return { status: 502, error: "A source request failed" };
}
