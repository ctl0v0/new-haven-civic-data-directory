import { SourceError } from "./http.js";
import { publishedStatus } from "./record-state.js";

function publishedRecordType(item) {
  const a = item.attributes ?? {};
  const value = item.category === "Permit" ? a.PermitType :
    item.category === "Application" ? a.ApplicationType :
    item.category === "License" ? a.LicenseType ?? a.license_type :
    item.category === "Registration" ? a.credential : null;
  return value == null ? null : String(value).trim() || null;
}

const MAX_SELECTIONS = 20;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const values = (input, label) => {
  const list = (Array.isArray(input) ? input : input == null ? [] : [input])
    .map((value) => String(value).trim()).filter(Boolean);
  if (list.length > MAX_SELECTIONS || list.some((value) => value.length > 100))
    throw new SourceError(`Invalid ${label} filter`, 400);
  return [...new Set(list)];
};
const date = (input, label) => {
  if (input == null || input === "") return null;
  const value = String(input);
  if (!datePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
    throw new SourceError(`Invalid ${label} date`, 400);
  return value;
};
const countBy = (items, getter) => {
  const counts = new Map();
  for (const item of items) {
    const value = getter(item);
    if (value != null && value !== "") counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
};

export function checkedFilters(options = {}, { feed = false, queryAddress = null } = {}) {
  const filters = {
    category: values(options.category, "category"),
    record_type: values(options.record_type, "record type"),
    source_id: values(options.source_id, "source"),
    display_group: feed ? [] : values(options.display_group, "display group"),
    source_status: values(options.source_status, "source status"),
    event_date_from: date(options.event_date_from, "start"),
    event_date_to: date(options.event_date_to, "end"),
    address_match: options.address_match === true || options.address_match === "true",
  };
  if (options.address_match != null && ![true, false, "true", "false"].includes(options.address_match))
    throw new SourceError("Invalid address match filter", 400);
  if (filters.address_match && !queryAddress)
    throw new SourceError("Address match requires query_address", 400);
  if (filters.event_date_from && filters.event_date_to && filters.event_date_from > filters.event_date_to)
    throw new SourceError("Start date must precede end date", 400);
  return filters;
}

export function recordFacets(items, group = null) {
  const kind = (item) => group === "ownership" ? item.display_group?.key ?? "unclassified" :
    item.category ?? `source:${item.source_id}`;
  const kinds = countBy(items, kind);
  return {
    kind: kinds,
    kind_display_group: Object.fromEntries(Object.keys(kinds).map((key) =>
      [key, countBy(items.filter((item) => kind(item) === key), (item) => item.display_group?.key)])),
    category: countBy(items, (item) => item.category),
    record_type: countBy(items, publishedRecordType),
    source_id: countBy(items, (item) => item.source_id),
    display_group: countBy(items, (item) => item.display_group?.key),
    source_status: countBy(items, (item) => publishedStatus(item)),
    undated: items.filter((item) => !item.event_date).length,
    basis: "returned_records_before_filters",
  };
}

export function filterRecords(items, filters) {
  return items.filter((item) =>
    (!filters.category.length || filters.category.includes(item.category)) &&
    (!filters.record_type.length || filters.record_type.some((type) =>
      type.toLowerCase() === String(publishedRecordType(item) ?? "").toLowerCase())) &&
    (!filters.source_id.length || filters.source_id.includes(item.source_id)) &&
    (!filters.display_group.length || filters.display_group.includes(item.display_group?.key)) &&
    (!filters.source_status.length || filters.source_status.some((status) =>
      status.toLowerCase() === String(publishedStatus(item) ?? "").toLowerCase())) &&
    (!filters.event_date_from || (item.event_date && item.event_date >= filters.event_date_from)) &&
    (!filters.event_date_to || (item.event_date && item.event_date <= filters.event_date_to)) &&
    (!filters.address_match || item.address_evidence?.matches_query === true));
}
