// A display grouping of published record fields. It does not change a source
// status or determine whether work, occupancy, or a license is current.
const ownerRegistry = new Set(["business-master", "business-principals", "business-agents"]);
const ownerNames = new Set(["parcel-owner", "assessor-owner"]);
const currentWords = /\b(active|issued|approved|open|assigned|scheduled|valid|effective|in progress)\b/;
const earlyWords = /\b(draft|submitted|pending|review|awaiting|incomplete|pre.?application|received|processing|on hold)\b/;
const negativeApproval = /\b(not issued|not approved|unissued|awaiting issuance)\b/;
const pastWords = /\b(void|voided|cancelled|canceled|denied|rejected|withdrawn|expired|inactive|dissolved|closed|complete|completed|final|finaled|resolved|dismissed|abandoned|superseded|forfeited)\b/;

export const DISPLAY_GROUPS = Object.freeze([
  { key: "owner_names", title: "Owner names published for this parcel", description: "City GIS and assessor owner names are shown separately, with their own source links. A difference is left visible for review." },
  { key: "owner_registry", title: "State registry for the owner LLC", description: "Entity, principals and registered agent for a matched parcel owner LLC. An agent or principal is not identified here as the parcel's beneficial owner." },
  { key: "owner_history", title: "Published sale and ownership history", description: "The City parcel's one sale field set and separate assessor Ownership History rows. Neither is a complete deed chain." },
  { key: "reported", title: "Recently reported active, open or issued", description: "These are source statuses. An issued permit does not prove work is underway, and a license does not prove a business is operating here." },
  { key: "early", title: "Recent drafts and records awaiting review", description: "These records have not been shown as issued or approved by the source." },
  { key: "older", title: "Older open, issued or draft records", description: "These records are more than two years old but still carry a nonterminal source status. Their present state needs source review." },
  { key: "past", title: "Closed, void, expired or inactive", description: "The source reports a terminal status or a published expiration date has passed." },
  { key: "unclassified", title: "Other or unstated status", description: "The source did not provide a recognized status for these groups. Any published status still appears on its record." },
]);
const rank = Object.fromEntries(DISPLAY_GROUPS.map((entry, index) => [entry.key, index]));
const activityCategoryRank = Object.fromEntries([
  "Permit", "License", "Application", "Complaint", "Certificate", "Occupant", "Contact", "Document",
].map((name, index) => [name, index]));
const businessSourceRank = { "municipal-business-licenses": 0, "municipal-occupants": 1 };
const ownerSourceRank = { "business-master": 0, "business-principals": 1, "business-agents": 2 };
const ownerNameRank = { "parcel-owner": 0, "assessor-owner": 1 };

function dateOnly(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value))
    return value.slice(0, 10);
  const dotNet = typeof value === "string" ? value.match(/^\/Date\((\d+)(?:[+-]\d{4})?\)\/$/) : null;
  if (dotNet) return new Date(Number(dotNet[1])).toISOString().slice(0, 10);
  return null;
}

export function publishedStatus(item) {
  const a = item.attributes ?? {};
  if (item.category === "Occupant" || item.source_id === "municipal-occupants")
    return a.inactive === true ? "Inactive" : null;
  return [a.status, a.Status, a.record_status, a.PermStatus,
    a.PermitApplicationStatus, a.ApplicationStatus, a.CompStatus,
    a.registry_status].find((value) => typeof value === "string" && value.trim())?.trim() ?? null;
}

export function displayGroup(item, asOf = new Date()) {
  const checkedOn = asOf.toISOString().slice(0, 10);
  if (ownerNames.has(item.source_id))
    return { key: "owner_names", basis: item.source_id === "parcel-owner" ? "City GIS parcel owner fields" : "Verified assessor card owner field", as_of: checkedOn };
  if (ownerRegistry.has(item.source_id))
    return { key: "owner_registry", basis: "Matched State entity record", as_of: checkedOn };
  if (["assessor-sales", "parcel-sale"].includes(item.source_id))
    return { key: "owner_history", basis: item.source_id === "parcel-sale" ? "Published City parcel sale fields" : "Published assessor ownership history row", as_of: checkedOn };
  if (item.source_id === "ct-cannabis-retail")
    return { key: "reported", basis: "Included in the State operating retail location roster at lookup; no row-level status or update date is published", as_of: checkedOn };
  const status = publishedStatus(item);
  const normalized = String(status ?? "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const a = item.attributes ?? {};
  const hasCredential = ["License", "Registration"].includes(item.category) ||
    item.source_id === "municipal-business-licenses" || item.source_id === "ct-liquor-permits";
  const expiration = hasCredential ? dateOnly(a.expiration_date ?? a.ExpirationDate) : null;
  if (pastWords.test(normalized))
    return { key: "past", basis: "Published terminal status", as_of: checkedOn };
  if (expiration && expiration < checkedOn)
    return { key: "past", basis: item.category === "Registration" ? "Published registration expiration date passed"
      : "Published license expiration date passed", as_of: checkedOn };
  let key = negativeApproval.test(normalized) ? "early" : currentWords.test(normalized) ? "reported"
    : earlyWords.test(normalized) ? "early" : "unclassified";
  const recorded = dateOnly(item.event_date);
  const cutoff = new Date(asOf);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2);
  const unexpiredCredential = key === "reported" && expiration && expiration >= checkedOn;
  if (key !== "unclassified" && !unexpiredCredential && recorded && recorded < cutoff.toISOString().slice(0, 10))
    key = "older";
  return {
    key,
    basis: key === "older" ? "Published status; record date more than two years old"
      : key === "unclassified" ? "No recognized current, early or terminal source status"
        : "Published source status",
    as_of: checkedOn,
  };
}

export function orderDisplayRecords(items, group, asOf = new Date()) {
  if (!["activity", "business", "ownership"].includes(group)) return items;
  const ordered = items.map((item) => ({ ...item, display_group: displayGroup(item, asOf) }))
    .sort((a, b) => {
      const bucket = rank[a.display_group.key] - rank[b.display_group.key];
      if (bucket) return bucket;
      const category = group === "activity"
        ? (activityCategoryRank[a.category] ?? 99) - (activityCategoryRank[b.category] ?? 99)
        : group === "ownership" && a.display_group.key === "owner_names"
          ? (ownerNameRank[a.source_id] ?? 99) - (ownerNameRank[b.source_id] ?? 99)
        : a.display_group.key === "owner_registry"
          ? (ownerSourceRank[a.source_id] ?? 99) - (ownerSourceRank[b.source_id] ?? 99)
        : (businessSourceRank[a.source_id] ?? 99) - (businessSourceRank[b.source_id] ?? 99);
      if (category) return category;
      return newestRecordFirst(a, b);
    });
  if (group === "ownership") return ordered;
  const usesChronology = group === "business"
    ? (item) => item.source_id !== "municipal-occupants"
    : (item) => item.category === "License";
  // Keep the other record categories in display order while ordering all
  // credentials before paging, regardless of the status on a credential.
  const credentials = ordered.filter(usesChronology).sort(newestRecordFirst);
  let next = 0;
  return ordered.map((item) => usesChronology(item) ? credentials[next++] : item);
}

export function newestRecordFirst(a, b) {
  return String(b.event_date ?? "").localeCompare(String(a.event_date ?? "")) ||
    String(a.id ?? a.source_record_id ?? "").localeCompare(String(b.id ?? b.source_record_id ?? ""));
}

export function displayGroupCounts(items) {
  return Object.fromEntries(DISPLAY_GROUPS.map(({ key }) =>
    [key, items.filter((item) => item.display_group?.key === key).length]));
}
