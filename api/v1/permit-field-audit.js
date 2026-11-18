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
