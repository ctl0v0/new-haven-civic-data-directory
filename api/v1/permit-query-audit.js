import { arcgis, fetchJson } from "../../parcel/http.js";
import { LAYERS } from "../../parcel/config.js";
import { permitDetails } from "../../parcel/permit-details.js";
import { getSourceRecords } from "../../parcel/adapters.js";
import { searchMunicipalPermits } from "../../parcel/permit-search.js";

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
    if (mode === "cross-search") {
      const data = await searchMunicipalPermits({ neighborhood: "Westville",
        permit_type: "Water Heater", permit_status: "Issued", days_back: 90,
        review_status: "Approved", contact_role: "Contractor" });
      return Response.json({ criteria: data.criteria, coverage: data.coverage, partial: data.partial,
        items: data.items.map((item) => ({ city_address: item.city_address,
          city_parcel_id: item.city_parcel_id, permit: item.permit,
          application: item.application, review_tasks: item.review_tasks,
          contacts: item.contacts, detail_partial: item.detail_partial,
          detail_warnings: item.detail_warnings })),
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (mode === "extra-child-schema") {
      const targets = [{ entity: "Permit", id: 589760 }, { entity: "Permit", id: 590645 },
        { entity: "Application", id: 50838 }, { entity: "Application", id: 51953 }];
      const results = await Promise.all(targets.map(async ({ entity, id }) => {
        const data = await fetchJson(`https://services5.municity5.com/M5Services/M5Service.svc/Customer/NewHavenCityCT/${entity}/${id}/Children`, OPTS);
        return { entity, id, categories: Object.fromEntries(Object.entries(data).map(([kind, rows]) =>
          [kind, { count: Array.isArray(rows) ? rows.length : null,
            keys: Array.isArray(rows) ? [...new Set(rows.slice(0, 3).flatMap((row) => Object.keys(row ?? {})))].sort() : null,
            sample: ["Inspection", "Flag"].includes(kind) && Array.isArray(rows) ? rows.slice(0, 2).map((row) =>
              Object.fromEntries(Object.entries(row).filter(([key, value]) =>
                /^(Inspection|Flag|Status|Result|Type|Date|CreatedDate|Modified|Entity|Description|Name|Public|Deleted|Category)/i.test(key) &&
                (value == null || ["string", "number", "boolean"].includes(typeof value))))) : null }])),
        };
      }));
      return Response.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (mode === "westville-details") {
      const expected = [
        { parcel_id: 25642, objectid: 15603, permit_id: 590395, print_key: "417 1239 00500" },
        { parcel_id: 25317, objectid: 26456, permit_id: 589760, print_key: "409 1244 00400" },
        { parcel_id: 25080, objectid: 9288, permit_id: 590645, print_key: "405 1241 02100" },
      ];
      const city = await arcgis(LAYERS.parcels, {
        where: `parcel_id IN (${expected.map((item) => item.parcel_id).join(",")})`,
        outFields: "*", returnGeometry: "true", outSR: "4326", resultRecordCount: "10",
      });
      const results = await Promise.all(expected.map(async (item) => {
        const feature = (city.features ?? []).find((candidate) =>
          Number(candidate.attributes?.parcel_id) === item.parcel_id &&
          Number(candidate.attributes?.objectid) === item.objectid &&
          String(candidate.attributes?.mblu ?? "").replaceAll("/", " ").trim() === item.print_key);
        if (!feature) return { parcel_id: item.parcel_id, error: "City parcel identity mismatch" };
        const neighborhoods = await getSourceRecords("neighborhoods", feature);
        const westville = neighborhoods.items.some((row) => row.attributes.neighborhood === "WESTVILLE");
        if (!westville) return { parcel_id: item.parcel_id, error: "No Westville polygon intersection" };
        const detail = await permitDetails(feature, String(item.permit_id));
        const app = detail.application?.attributes ?? {};
        const contactSources = [
          { entity: "Permit", id: item.permit_id },
          ...(app.Application_ID ? [{ entity: "Application", id: app.Application_ID }] : []),
        ];
        const contacts = await Promise.all(contactSources.map(async (parent) => {
          const children = await fetchJson(`https://services5.municity5.com/M5Services/M5Service.svc/Customer/NewHavenCityCT/${parent.entity}/${parent.id}/Children`, OPTS);
          return (children.Contact ?? []).filter((row) =>
            ![true, 1, "true", "1"].includes(row.Deleted) &&
            /contractor/i.test(`${row.ContactRole ?? ""} ${row.ContactType ?? ""}`))
            .map((row) => ({ parent: `${parent.entity}/${parent.id}`, Contact_ID: row.Contact_ID,
              Fullname: row.Fullname, CompanyName: row.CompanyName, ContactRole: row.ContactRole,
              ContactType: row.ContactType, Phone: row.Phone, Email: row.Email,
              EMailAddress: row.EMailAddress, Addr1: row.Addr1, City: row.City,
              State: row.State, ZipCode: row.ZipCode, RoleIsPublic: row.Role?.IsPublic }));
        }));
        return { parcel_id: item.parcel_id, address: feature.attributes.property_address,
          permit: { Permit_ID: detail.permit.attributes.Permit_ID,
            PermitNo: detail.permit.attributes.PermitNo, PermitType: detail.permit.attributes.PermitType,
            PermStatus: detail.permit.attributes.PermStatus, PermitDate: detail.permit.attributes.PermitDate,
            LegalAddress: detail.permit.attributes.LegalAddress },
          application: Object.fromEntries(["Application_ID", "ApplicationNumber", "ApplicationDate",
            "PermitApplicationStatus", "PermitApplicationStatusUpdated", "ApplicationStatus",
            "ApplicationStatusUpdated", "DateApproved", "Modified", "CreatedDate"]
            .map((key) => [key, app[key] ?? null])),
          review_tasks: detail.items.filter((child) => child.category === "Task")
            .map((child) => ({ ...child.attributes, linked_from: child.linked_from.map((parent) => `${parent.entity}/${parent.entity_id}`) })),
          contractor_contacts: contacts.flat(), partial: detail.partial, warnings: detail.warnings,
        };
      }));
      return Response.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
    }
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
