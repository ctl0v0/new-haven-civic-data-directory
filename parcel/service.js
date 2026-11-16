import { GROUPS, SOURCES } from "./config.js";
import { cached, SourceError } from "./http.js";
import { loadParcel, resolveParcel } from "./resolve.js";
import { getGroup, getSourceRecords, pageItems } from "./adapters.js";

export { resolveParcel };

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

export async function parcelRecords(
  id,
  group,
  { objectid = null, cursor = null, limit = 25 } = {},
) {
  const feature = await loadParcel(id, objectid);
  const data = await getGroup(group, feature);
  return { ...data, ...pageItems(data.items, cursor, limit) };
}

export async function parcelFeed(
  id,
  { objectid = null, cursor = null, limit = 25 } = {},
) {
  const feature = await loadParcel(id, objectid);
  const key = `feed:${feature.attributes.parcel_id}:${feature.attributes.objectid}`;
  const data = await cached(key, async () => {
    const sources = await Promise.all(
      ["parcels", "assessor", "municity", "planning", "managed-lots"].map(
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
  return { ...data, ...pageItems(data.items, cursor, limit) };
}

export function sourceCoverage() {
  return {
    sources: SOURCES,
    groups: GROUPS,
    excluded: [
      "meetings, agendas and legislation",
      "budgets and monthly finance reports",
    ],
    as_of: new Date().toISOString(),
  };
}

export function apiError(error) {
  if (error instanceof SourceError)
    return { status: error.status, error: error.message };
  return { status: 502, error: "A source request failed" };
}
