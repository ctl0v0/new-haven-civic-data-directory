import { fetchJson } from "../../parcel/http.js";

const BASE = "https://services5.municity5.com/M5Services/M5Service.svc/Customer/NewHavenCityCT/Permit/569338";
const OPTIONS = { headers: { SourceId: "2" }, timeout: 12000, maxBytes: 8_000_000 };

function describe(value) {
  if (Array.isArray(value)) return {
    type: "array", count: value.length,
    keys: [...new Set(value.slice(0, 5).flatMap((row) => row && typeof row === "object" ? Object.keys(row) : []))].sort(),
  };
  if (value && typeof value === "object") return {
    type: "object", keys: Object.keys(value).sort(),
    children: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, describe(child)])),
  };
  return { type: typeof value };
}

export default {
  async fetch(request) {
    if (process.env.VERCEL_ENV !== "preview" || request.method !== "GET")
      return new Response("Not found", { status: 404 });
    const mode = new URL(request.url).searchParams.get("mode");
    if (mode === "values") {
      const data = await fetchJson(BASE + "/Children", OPTIONS);
      const keys = {
        Fee: ["Fee_ID", "Amount", "Date", "FeeCategory", "FeePaid", "FeeSource", "FeeType", "FeeVoided", "GLCode", "InvoicedDate", "Paid", "PayType", "PermitNo", "ApplicationNumber", "PrintKey", "Status", "CustomFields"],
        Task: ["Task_ID", "Entity", "Entity_ID", "ApprovalStatus", "AssignedTo", "DateCompleted", "Subject", "TaskType", "CustomFields"],
        Document: ["Document_ID", "Name", "Type", "DocumentType", "Section", "Public", "Deleted", "UrlExists", "CreatedDate", "Modified"],
        Communication: ["Communication_ID", "CommunicationType_ID", "Title", "CreatedDate"],
        Contact: ["Contact_ID", "ContactRole", "ContactType", "Role", "RoleGroupCode_ID", "Applicant", "Inspector"],
      };
      const rows = Object.fromEntries(Object.entries(keys).map(([kind, fields]) => [kind,
        (data[kind] ?? []).slice(0, 5).map((row) => Object.fromEntries(fields.map((key) => [key, row[key] ?? null])))]));
      return Response.json({ rows }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (mode === "search") {
      const search = new URL("https://services5.municity5.com/M5Services/M5Service.svc/GetM5Data");
      for (const [key, value] of Object.entries({ Customer: "NewHavenCityCT", entity: "Permit", entity_id: "", fieldtype: "text", mapid: "", mapobject: "", module: "", numrecs: "5", operator: "=", pid: "", searchfield: "Permit_ID", section: "", value: "569338" }))
        search.searchParams.set(key, value);
      try {
        const data = await fetchJson(search, OPTIONS);
        return Response.json({ total: data.total, rows: Array.isArray(data.rows) ? data.rows.map((row) => ({ keys: Object.keys(row).sort(), Permit_ID: row.Permit_ID, Parcel_ID: row.Parcel_ID, PermitNo: row.PermitNo, ApplicationNumber: row.ApplicationNumber, PrintKey: row.PrintKey })) : data.rows }, { headers: { "Cache-Control": "private, no-store" } });
      } catch (error) {
        return Response.json({ error: error.message }, { headers: { "Cache-Control": "private, no-store" } });
      }
    }
    if (mode === "links") {
      const search = new URL("https://services5.municity5.com/M5Services/M5Service.svc/GetM5Data");
      for (const [key, value] of Object.entries({ Customer: "NewHavenCityCT", entity: "Permit", entity_id: "", fieldtype: "text", mapid: "", mapobject: "", module: "", numrecs: "5", operator: "=", pid: "", searchfield: "Permit_ID", section: "", value: "569338" }))
        search.searchParams.set(key, value);
      const parent = (await fetchJson(search, OPTIONS)).rows?.[0];
      const appId = Number(parent?.Application_ID);
      const appChildren = Number.isSafeInteger(appId) && appId > 0
        ? await fetchJson(`https://services5.municity5.com/M5Services/M5Service.svc/Customer/NewHavenCityCT/Application/${appId}/Children`, OPTIONS).catch((error) => ({ error: error.message })) : null;
      const parcelChildren = await fetchJson(`https://services5.municity5.com/M5Services/M5Service.svc/Customer/NewHavenCityCT/Parcel/${Number(parent.Parcel_ID)}/Children`, OPTIONS);
      const parcelPermit = (parcelChildren.Permit ?? []).find((row) => Number(row.Permit_ID) === 569338);
      const parcelApplication = (parcelChildren.Application ?? []).find((row) => Number(row.Application_ID) === appId);
      return Response.json({
        parent: Object.fromEntries(["Permit_ID", "Parcel_ID", "Application_ID", "ApplicationNumber", "ApplicaNo", "PermitNo", "Department", "PermStatus", "PermitType", "PermitDate", "ApplicaDate1", "PrintKey", "LegalAddress"].map((key) => [key, parent?.[key] ?? null])),
        parent_field_count: parent ? Object.keys(parent).length : 0,
        parcel_permit_found: Boolean(parcelPermit), parcel_permit_field_count: parcelPermit ? Object.keys(parcelPermit).length : 0,
        parcel_permit_missing_fields: parent && parcelPermit ? Object.keys(parent).filter((key) => !(key in parcelPermit)).sort() : null,
        parcel_permit_missing_nonempty_fields: parent && parcelPermit ? Object.keys(parent).filter((key) => !(key in parcelPermit) && parent[key] != null && parent[key] !== "").sort() : null,
        parcel_application_found: Boolean(parcelApplication), parcel_application_field_count: parcelApplication ? Object.keys(parcelApplication).length : 0,
        application_children: appChildren ? describe(appChildren) : null,
        application_review_rows: (appChildren?.Task ?? []).slice(0, 10).map((row) => Object.fromEntries(["Task_ID", "Entity", "Entity_ID", "TaskType", "Subject", "ApprovalStatus", "DateCompleted", "Deleted"].map((key) => [key, row[key] ?? null]))),
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const checks = await Promise.all(["", "/Children"].map(async (suffix) => {
      try {
        const data = await fetchJson(BASE + suffix, OPTIONS);
        return { path: suffix || "entity", shape: describe(data) };
      } catch (error) {
        return { path: suffix || "entity", error: error.message };
      }
    }));
    return Response.json({ checks }, { headers: { "Cache-Control": "private, no-store" } });
  },
};
