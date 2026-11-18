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
