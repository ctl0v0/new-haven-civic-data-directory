import { arcgis, fetchJson } from "../../parcel/http.js";
import { LAYERS } from "../../parcel/config.js";

const BASE = "https://services5.municity5.com/M5Services/M5Service.svc/GetM5Data";
const OPTS = { headers: { SourceId: "2" }, timeout: 12000, maxBytes: 10_000_000 };

async function search(entity, searchfield, operator, value, fieldtype = "text", numrecs = 5) {
  const url = new URL(BASE);
  for (const [key, entry] of Object.entries({ Customer: "NewHavenCityCT", entity,
    entity_id: "", fieldtype, mapid: "", mapobject: "", module: "",
    numrecs: String(numrecs), operator, pid: "", searchfield, section: "", value }))
    url.searchParams.set(key, entry);
  try {
    const data = await fetchJson(url, OPTS);
    const rows = Array.isArray(data.rows) ? data.rows : [];
    return { entity, searchfield, operator, value, numrecs, total: data.total,
      returned: Array.isArray(data.rows) ? data.rows.length : null,
      years: Object.fromEntries([...new Set(rows.map((row) => String(row.PermitDate ?? row.ApplicationDate ?? "").slice(0, 4)).filter(Boolean))]
        .map((year) => [year, rows.filter((row) => String(row.PermitDate ?? row.ApplicationDate ?? "").startsWith(year)).length])),
      samples: rows.slice(0, 5).map((row) => ({
        Permit_ID: row.Permit_ID, Application_ID: row.Application_ID,
        PermitNo: row.PermitNo, PermitType: row.PermitType,
        PermStatus: row.PermStatus, PermitDate: row.PermitDate,
        ApplicationNumber: row.ApplicationNumber,
        PermitApplicationStatus: row.PermitApplicationStatus,
        PermitApplicationStatusUpdated: row.PermitApplicationStatusUpdated,
        ApplicationDate: row.ApplicationDate, PrintKey: row.PrintKey,
      })),
    };
  } catch (error) {
    return { entity, searchfield, operator, value, error: error.message };
  }
}

export default {
  async fetch(request) {
    if (process.env.VERCEL_ENV !== "preview" || request.method !== "GET")
      return new Response("Not found", { status: 404 });
    const mode = new URL(request.url).searchParams.get("mode");
    if (mode === "westville-candidates") {
      const url = new URL(BASE);
      for (const [key, entry] of Object.entries({ Customer: "NewHavenCityCT", entity: "Permit",
        entity_id: "", fieldtype: "text", mapid: "", mapobject: "", module: "",
        numrecs: "2000", operator: "=", pid: "", searchfield: "PermitType",
        section: "", value: "Water Heater" })) url.searchParams.set(key, entry);
      const vendor = await fetchJson(url, { ...OPTS, maxBytes: 35_000_000, timeout: 25000 });
      const permits = (Array.isArray(vendor.rows) ? vendor.rows : []).filter((row) =>
        row.PermitType === "Water Heater" && row.PermStatus === "Issued" &&
        String(row.PermitDate ?? "") >= "2026-08-20");
      const neighborhood = await arcgis(LAYERS.neighborhoods, {
        where: "UPPER(neighborhood) = 'WESTVILLE'", outFields: "objectid,neighborhood,neighborhood_label",
        returnGeometry: "true", outSR: "4326", resultRecordCount: "10",
      });
      const zone = neighborhood.features ?? [];
      if (zone.length !== 1) return Response.json({ neighborhood_matches: zone.length }, { headers: { "Cache-Control": "private, no-store" } });
      const parcels = [];
      let truncated = false;
      for (let offset = 0; offset < 6000; offset += 1000) {
        const page = await arcgis(LAYERS.parcels, {
          where: "1=1", geometry: JSON.stringify(zone[0].geometry), geometryType: "esriGeometryPolygon",
          inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "objectid,parcel_id,mblu,property_address",
          orderByFields: "objectid", resultOffset: String(offset), resultRecordCount: "1000",
        });
        parcels.push(...(page.features ?? []));
        if (!page.exceededTransferLimit && (page.features ?? []).length < 1000) break;
        if (offset === 5000) truncated = true;
      }
      const key = (value) => String(value ?? "").replaceAll("/", " ").replace(/\s+/g, " ").trim().toUpperCase();
      const byKey = new Map();
      for (const feature of parcels) {
        const normalized = key(feature.attributes?.mblu);
        if (!normalized) continue;
        if (!byKey.has(normalized)) byKey.set(normalized, []);
        byKey.get(normalized).push(feature.attributes);
      }
      return Response.json({ vendor_returned: vendor.rows?.length, vendor_limit_reached: vendor.rows?.length === 2000,
        recent_issued_count: permits.length, neighborhood_objectid: zone[0].attributes.objectid,
        intersecting_parcels: parcels.length, parcel_query_truncated: truncated,
        matches: permits.flatMap((permit) => (byKey.get(key(permit.PrintKey)) ?? []).map((parcel) => ({
          permit_id: permit.Permit_ID, permit_number: permit.PermitNo, permit_date: permit.PermitDate,
          application_id: permit.Application_ID, legal_address: permit.LegalAddress,
          print_key: permit.PrintKey, city_parcel_id: parcel.parcel_id,
          city_objectid: parcel.objectid, city_address: parcel.property_address,
        }))),
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (mode === "neighborhood-schema") {
      const [metadata, sample] = await Promise.all([
        fetchJson(`${LAYERS.neighborhoods}?f=json`, OPTS),
        arcgis(LAYERS.neighborhoods, { where: "1=1", outFields: "*", resultRecordCount: "5" }),
      ]);
      return Response.json({ fields: metadata.fields?.map((field) => field.name),
        samples: sample.features?.map((feature) => feature.attributes) },
      { headers: { "Cache-Control": "private, no-store" } });
    }
    if (mode === "recent-candidates") {
      const url = new URL(BASE);
      for (const [key, entry] of Object.entries({ Customer: "NewHavenCityCT", entity: "Permit",
        entity_id: "", fieldtype: "text", mapid: "", mapobject: "", module: "",
        numrecs: "2000", operator: "=", pid: "", searchfield: "PermitType",
        section: "", value: "Water Heater" })) url.searchParams.set(key, entry);
      const data = await fetchJson(url, { ...OPTS, maxBytes: 35_000_000, timeout: 25000 });
      const rows = Array.isArray(data.rows) ? data.rows : [];
      const recent = rows.filter((row) => String(row.PermitDate ?? "") >= "2026-08-20");
      return Response.json({ total: data.total, returned: rows.length,
        recent_count: recent.length,
        recent: recent.slice(0, 100).map((row) => ({ Permit_ID: row.Permit_ID,
          Application_ID: row.Application_ID, PermitNo: row.PermitNo,
          PermStatus: row.PermStatus, PermitType: row.PermitType,
          PermitDate: row.PermitDate, PrintKey: row.PrintKey,
          LegalAddress: row.LegalAddress })),
        years: Object.fromEntries([...new Set(rows.map((row) => String(row.PermitDate ?? "").slice(0, 4)).filter(Boolean))]
          .map((year) => [year, rows.filter((row) => String(row.PermitDate ?? "").startsWith(year)).length])),
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (mode === "scale") {
      const results = await Promise.all([
        search("Permit", "PermitType", "=", "Water Heater", "text", 100),
        search("Permit", "PermitType", "=", "Water Heater", "text", 500),
        search("Permit", "PermitDate", "=", "2022-11-16", "date", 5),
        search("Permit", "PermitDate", ">=", "2026-08-20", "text", 5),
      ]);
      return Response.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const results = await Promise.all([
      search("Permit", "PermitType", "=", "Water Heater"),
      search("Permit", "PermitDate", ">=", "2026-08-20", "date"),
      search("Application", "PermitApplicationStatusUpdated", ">=", "2026-08-20", "date"),
    ]);
    return Response.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
  },
};
