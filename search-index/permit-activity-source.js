import { municipalDate, municipalEntityRow, municipalWorkChildren } from "./municity.js";

export const PERMIT_ACTIVITY_SOURCE = "municity-permit-activity";
export const PERMIT_ACTIVITY_TYPES = Object.freeze(["Water Heater", "Hood - C"]);
export const PERMIT_ACTIVITY_KINDS = Object.freeze({
  application: { id: "Application_ID", type: "ApplicationType", status: "PermitApplicationStatus",
    date: "ApplicationDate", fields: ["ApplicationNumber", "ApplicaNo", "Status", "ApplicationStatus", "Department"] },
  review: { category: "Task", id: "Task_ID", type: "TaskType", status: "ApprovalStatus",
    date: "DateCompleted", fields: ["Entity", "Entity_ID"] },
  inspection: { category: "Inspection", id: "Inspection_ID", type: "InspType", status: "Status",
    date: "CloseDate", fields: ["SchedDate", "Department", "PermitNo"] },
});

const WEB = "https://www.municityconnect.com/#/app/NewHavenCityCT/entity";
const text = (value) => String(value ?? "").trim();
const key = (value) => text(value).replace(/[/\s]+/g, " ").trim().toUpperCase();
const id = (value) => /^[1-9]\d{0,11}$/.test(text(value)) ? text(value) : null;
const conflicts = (a, b) => Boolean(text(a) && text(b) && key(a) !== key(b));

export async function collectPermitActivity(permit, {
  entity = municipalEntityRow, children = municipalWorkChildren,
} = {}) {
  const permitId = id(permit.record_id);
  const appId = id(permit.fields?.Application_ID);
  if (!permitId) throw new Error("Verified permit inventory is missing a record ID");
  const records = new Map();
  const conflicting = new Set();
  const gaps = { application: 0, review: 0, inspection: 0 };
  const parents = [{ kind: "Permit", id: permitId }];
  const permitUrl = `${WEB}/Permit/${permitId}`;
  const add = (kind, row, parent) => {
    const definition = PERMIT_ACTIVITY_KINDS[kind];
    const activityId = id(row[definition.id]);
    const eventDate = municipalDate(row[definition.date]);
    if (!activityId || (text(row[definition.date]) && !eventDate)) { gaps[kind]++; return; }
    const recordId = `${permitId}:${kind}:${activityId}`;
    if (conflicting.has(recordId)) return;
    const sourceUrl = `${WEB}/${parent.kind}/${parent.id}`;
    const linkedFrom = { entity: parent.kind, entity_id: parent.id, source_url: sourceUrl };
    const published = Object.fromEntries([definition.id, definition.type, definition.status, definition.date,
      ...definition.fields].filter((field) => text(row[field])).map((field) => [field, row[field]]));
    const existing = records.get(recordId);
    if (existing) {
      if (Object.entries(published).some(([field, value]) => conflicts(value, existing.fields[field]))) {
        records.delete(recordId);
        conflicting.add(recordId);
        gaps[kind]++;
      } else {
        Object.assign(existing.fields, published);
        existing.fields.linked_from.push(linkedFrom);
        existing.published_type ??= text(row[definition.type]) || null;
        existing.published_status ??= text(row[definition.status]) || null;
        existing.event_date ??= eventDate;
      }
      return;
    }
    records.set(recordId, { record_id: recordId, source_url: sourceUrl,
      published_type: text(row[definition.type]) || null,
      published_status: text(row[definition.status]) || null,
      event_date: eventDate, fields: { ...published, activity_kind: kind,
        permit_id: permitId, permit_type: permit.published_type,
        permit_status: permit.published_status, permit_number: permit.fields?.PermitNo ?? null,
        permit_date: municipalDate(permit.fields?.PermitDate),
        permit_source_url: permitUrl, application_id: appId,
        linked_from: [linkedFrom] } });
  };

  if (appId) {
    let app;
    try { app = await entity("Application", appId); }
    catch { /* Gap counted below. */ }
    if (id(app?.Application_ID) !== appId ||
        conflicts(app.PrintKey, permit.fields?.PrintKey) || conflicts(app.Parcel_ID, permit.fields?.Parcel_ID)) {
      for (const kind of Object.keys(gaps)) gaps[kind]++;
    } else {
      const parent = { kind: "Application", id: appId };
      parents.push(parent);
      add("application", app, parent);
    }
  }
  for (const parent of parents) {
    let listed;
    try { listed = await children(parent.kind, parent.id); }
    catch { /* Each unavailable category is counted below. */ }
    for (const kind of ["review", "inspection"]) {
      const rows = listed?.[PERMIT_ACTIVITY_KINDS[kind].category];
      if (!Array.isArray(rows)) { gaps[kind]++; continue; }
      if (rows.length >= 500) gaps[kind]++;
      for (const row of rows.slice(0, 500)) {
        if (!row || typeof row !== "object") { gaps[kind]++; continue; }
        if ([true, 1, "true", "1"].includes(row.Deleted)) continue;
        const declared = text(row.Entity).toUpperCase();
        const owner = id(row.Entity_ID);
        const ownerMatches = parents.some((item) => item.kind.toUpperCase() === declared && item.id === owner);
        if ((declared || text(row.Entity_ID)) && !ownerMatches) { gaps[kind]++; continue; }
        if (conflicts(row.PermitNo, permit.fields?.PermitNo) || conflicts(row.PrintKey, permit.fields?.PrintKey)) {
          gaps[kind]++;
          continue;
        }
        add(kind, row, parent);
      }
    }
  }
  return { records: [...records.values()], gaps, has_application_id: Boolean(appId) };
}
