import { getSourceRecords } from "./adapters.js";
import { cached, fetchJson, SourceError } from "./http.js";

const API = "https://services5.municity5.com/M5Services/M5Service.svc";
const WEB = "https://www.municityconnect.com/#/app/NewHavenCityCT/entity";
const OPTIONS = { headers: { SourceId: "2" }, timeout: 10000, maxBytes: 10_000_000 };
const CATEGORIES = ["Fee", "Task", "Document", "Contact", "Communication"];
const IDS = { Fee: "Fee_ID", Task: "Task_ID", Document: "Document_ID", Contact: "Contact_ID", Communication: "Communication_ID" };
const FIELDS = {
  Fee: ["Fee_ID", "Amount", "Date", "CreatedDate", "Modified", "Entity", "FeeCategory", "FeeSource", "FeeType", "FeePaid", "FeeVoided", "Paid", "PayType", "Status", "InvoicedDate", "InvoiceNumber", "InvoicePrinted", "ReceiptBookNo", "GLCode", "IsStateTax", "IsNotAllowedToPay", "ApplicationNumber", "PermitNo", "PrintKey", "LegalAddr", "LegalAddrNo", "LegalAddress", "ZipCode", "Section"],
  Task: ["Task_ID", "TaskType", "Subject", "ApprovalStatus", "AssignedTo", "Contact_ID", "Entity", "Entity_ID", "MappingSortOrder", "CreatedDate", "Modified", "DateCompleted"],
  Document: ["Document_ID", "Name", "FilenameWeb", "Description", "Type", "DocumentType", "DocumentTemplate_ID", "Section", "Section_ID", "Date", "CreatedDate", "Modified", "Public", "UrlExists"],
  Contact: ["Contact_ID", "Fullname", "ContactRole", "ContactType", "PrimaryOwner", "Applicant", "Inspector"],
  Communication: ["Communication_ID", "CommunicationType_ID", "Title", "CreatedDate", "Modified"],
};

function id(value) {
  const raw = String(value ?? "");
  const number = Number(raw);
  return /^\d{1,12}$/.test(raw) && Number.isSafeInteger(number) && number > 0 ? number : null;
}
function date(value) {
  if (!value) return null;
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}
function selected(row, fields) {
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
}
function flag(value) {
  return [true, 1, "true", "1"].includes(value);
}
function documentUrl(row) {
  if (!flag(row.Public) || flag(row.Deleted) || !flag(row.UrlExists)) return null;
  try {
    const url = new URL(row.Url);
    return url.protocol === "https:" &&
      (url.hostname === "municitymedia.com" || url.hostname.endsWith(".municitymedia.com"))
      ? url.href : null;
  } catch {
    return null;
  }
}
function childAttributes(kind, row) {
  const attributes = selected(row, FIELDS[kind]);
  if (kind === "Document") attributes.public_document_url = documentUrl(row);
  if (kind === "Contact") {
    attributes.Fullname = row.Fullname ??
      ([row.ContactFirstName, row.ContactLastName].filter(Boolean).join(" ") || null);
  }
  return attributes;
}
function childDate(kind, row) {
  const fields = kind === "Fee" ? ["Date", "CreatedDate"]
    : kind === "Task" ? ["DateCompleted", "CreatedDate"]
      : kind === "Document" ? ["Modified", "CreatedDate"] : ["CreatedDate", "Modified"];
  return fields.map((field) => date(row[field])).find(Boolean) ?? null;
}
function searchUrl(kind, entityId) {
  const url = new URL(`${API}/GetM5Data`);
  for (const [key, value] of Object.entries({
    Customer: "NewHavenCityCT", entity: kind, entity_id: "", fieldtype: "text",
    mapid: "", mapobject: "", module: "", numrecs: "5", operator: "=",
    pid: "", searchfield: `${kind}_ID`, section: "", value: String(entityId),
  })) url.searchParams.set(key, value);
  return url;
}
async function fullEntity(kind, entityId, vendorParcelId, key) {
  const data = await fetchJson(searchUrl(kind, entityId), OPTIONS);
  if (!Array.isArray(data.rows) || data.rows.length !== 1) return null;
  const row = data.rows[0];
  return id(row?.[`${kind}_ID`]) === entityId &&
    id(row.Parcel_ID) === vendorParcelId && String(row.PrintKey ?? "").trim().toUpperCase() === key
    ? row : null;
}
function entityRecord(kind, row, match) {
  const entityId = id(row[`${kind}_ID`]);
  return {
    source_id: "municity", category: kind, source_record_id: `${kind}:${entityId}`,
    attributes: row, match, source_url: `${WEB}/${kind}/${entityId}`,
  };
}

export async function permitDetails(parcel, permitId) {
  const requestedId = id(permitId);
  if (!requestedId) throw new SourceError("Invalid permit ID", 400);
  const vendor = await getSourceRecords("municity", parcel);
  if (vendor.status === "unavailable") throw new SourceError(vendor.warning ?? "Municipal parcel lookup unavailable");
  const listed = vendor.items.find((item) => item.category === "Permit" && id(item.attributes.Permit_ID) === requestedId);
  if (!listed) throw new SourceError("Permit is not in this verified parcel's public records", 404);
  const vendorParcelId = id(listed.match?.vendor_parcel_id);
  const key = String(listed.match?.value ?? "").trim().toUpperCase();
  if (!vendorParcelId || !key) throw new SourceError("Permit parcel association could not be verified");
  const applicationId = id(listed.attributes.Application_ID);
  const listedApplication = applicationId ? vendor.items.find((item) =>
    item.category === "Application" && id(item.attributes.Application_ID) === applicationId) : null;
  return cached(`permit-details:${parcel.attributes.parcel_id}:${parcel.attributes.objectid}:${requestedId}`, async () => {
    const targets = [{ kind: "Permit", entityId: requestedId, listed }];
    if (applicationId) targets.push({ kind: "Application", entityId: applicationId, listed: listedApplication });
    const checks = await Promise.all(targets.map(async (target) => {
      const [entity, children] = await Promise.allSettled([
        fullEntity(target.kind, target.entityId, vendorParcelId, key),
        fetchJson(`${API}/Customer/NewHavenCityCT/${target.kind}/${target.entityId}/Children`, OPTIONS),
      ]);
      const verified = entity.status === "fulfilled" ? entity.value : null;
      const fallback = target.listed?.attributes ?? null;
      const valid = Boolean(verified || fallback);
      return {
        ...target,
        row: verified ?? fallback,
        full: Boolean(verified),
        children: valid && children.status === "fulfilled" && children.value &&
          typeof children.value === "object" && !Array.isArray(children.value) ? children.value : null,
      };
    }));
    const verifiedTargets = checks.filter((target) => target.row);
    const warnings = [];
    if (!checks[0].full) warnings.push("Full permit fields were unavailable; the parcel child row is shown.");
    if (applicationId && !checks[1].row) warnings.push("The linked application could not be verified on this parcel.");
    else if (applicationId && !checks[1].full) warnings.push("Full application fields were unavailable; the parcel child row is shown.");
    const counts = Object.fromEntries(CATEGORIES.map((kind) => [kind, null]));
    const items = new Map();
    for (const target of verifiedTargets) {
      if (!target.children) {
        warnings.push(`${target.kind} child records were unavailable.`);
        continue;
      }
      const parent = { entity: target.kind, entity_id: target.entityId, source_url: `${WEB}/${target.kind}/${target.entityId}` };
      for (const kind of CATEGORIES)
        if (!(kind in target.children)) warnings.push(`${target.kind} ${kind} category was not returned.`);
      for (const [kind, rows] of Object.entries(target.children)) {
        if (!CATEGORIES.includes(kind)) {
          warnings.push(`${target.kind} returned an unreviewed child category: ${kind}.`);
          continue;
        }
        if (!Array.isArray(rows)) {
          warnings.push(`${target.kind} ${kind} child records were malformed.`);
          continue;
        }
        counts[kind] ??= 0;
        if (rows.length > 500) warnings.push(`${target.kind} ${kind} exceeds the 500-row limit.`);
        for (const [index, row] of rows.slice(0, 500).entries()) {
          if (!row || typeof row !== "object" || flag(row.Deleted)) continue;
          if (kind === "Document" && !flag(row.Public)) continue;
          const rowId = id(row[IDS[kind]]);
          const unique = rowId ? `${kind}:${rowId}` : `${target.kind}:${target.entityId}:${kind}:${index}`;
          if (items.has(unique)) {
            items.get(unique).linked_from.push(parent);
            continue;
          }
          const attributes = childAttributes(kind, row);
          items.set(unique, {
            id: `municity:permit-detail:${unique}`, source_id: "municity", category: kind,
            source_record_id: unique, event_date: childDate(kind, row), attributes,
            match: listed.match, linked_from: [parent],
            source_url: kind === "Document" ? attributes.public_document_url ?? parent.source_url : parent.source_url,
            note: kind === "Fee" ? "Fee and payment fields as reported by the municipal service."
              : kind === "Task" ? "Review task fields as reported; AssignedTo is the source value, not an inferred department."
                : kind === "Document" ? "Public document metadata; file contents are not stored."
                  : kind === "Contact" ? "Public contact role summary; phone, email and address are omitted."
                    : "Communication metadata; message body and recipients are omitted.",
          });
          counts[kind]++;
        }
      }
    }
    const permit = entityRecord("Permit", checks[0].row, listed.match);
    const application = checks[1]?.row ? entityRecord("Application", checks[1].row, listed.match) : null;
    return {
      parcel_id: Number(parcel.attributes.parcel_id), permit_id: requestedId,
      vendor_parcel_id: vendorParcelId, match: listed.match,
      permit, application, items: [...items.values()], category_counts: counts,
      partial: Boolean(warnings.length), warnings,
      retrieved_at: new Date().toISOString(),
      note: "Permit and application fields are public municipal rows. Child fee and review fields retain source labels; private documents, deleted rows, internal notes, contact details and communication bodies are omitted. This endpoint does not assert inspection coverage.",
    };
  });
}
