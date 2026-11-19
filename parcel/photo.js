import { assessorPhotoForParcel } from "./adapters.js";
import { loadParcel } from "./resolve.js";
import { fetchJson, SourceError } from "./http.js";

const MUNICIPAL = "https://services5.municity5.com/M5Services/M5Service.svc";

function printKey(value) {
  return String(value ?? "").split("/").map((part) => part.trim()).filter(Boolean)
    .join(" ").replace(/\s+/g, " ").toUpperCase();
}

async function municipalStreetView(parcel) {
  const key = printKey(parcel.attributes.mblu);
  if (!key) return null;
  const search = new URL(`${MUNICIPAL}/GetM5Data`);
  for (const [name, value] of Object.entries({
    Customer: "NewHavenCityCT", entity: "Parcel", entity_id: "", fieldtype: "text",
    mapid: "", mapobject: "", module: "", numrecs: "5", operator: "=", pid: "",
    searchfield: "PrintKey", section: "", value: key,
  })) search.searchParams.set(name, value);
  const found = await fetchJson(search, {
    headers: { SourceId: "2" }, timeout: 10000, maxBytes: 10_000_000,
  });
  if (!Array.isArray(found.rows) || found.rows.length !== 1) return null;
  const row = found.rows[0];
  const vendorId = Number(row.Parcel_ID);
  if (printKey(row.PrintKey) !== key || !Number.isSafeInteger(vendorId) || vendorId <= 0)
    return null;
  const photoUrl = `https://www.municitymedia.com/NewHavenCityCT/Parcel/${vendorId}/streetview.jpg`;
  const response = await fetch(photoUrl, {
    method: "HEAD", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new SourceError(`Municipal photo source returned HTTP ${response.status}`);
  const bytes = Number(response.headers.get("content-length"));
  if (!/^image\/jpeg(?:;|$)/i.test(response.headers.get("content-type") ?? "") ||
      !Number.isFinite(bytes) || bytes <= 0 || bytes > 5_000_000)
    return null;
  return {
    parcel_id: parcel.attributes.parcel_id,
    objectid: parcel.attributes.objectid,
    status: "ok",
    photo_source_id: "municity",
    photo_url: photoUrl,
    source_url: `https://www.municityconnect.com/#/app/NewHavenCityCT/entity/Parcel/${vendorId}`,
    municipal_parcel_id: vendorId,
    match: { method: "mblu-printkey-exact", city_field: "mblu", municipal_field: "PrintKey" },
    note: "Municipal street-view photo for the one municipal Parcel_ID matching the City MBLU. Its date is not published here; it may not show the entire parcel or current conditions.",
  };
}

export async function parcelPhoto(id, objectid = null) {
  const parcel = await loadParcel(id, objectid);
  let municipalUnavailable = false;
  try {
    const photo = await municipalStreetView(parcel);
    if (photo) return photo;
  } catch { municipalUnavailable = true; }
  try {
    const assessor = await assessorPhotoForParcel(parcel);
    return { ...assessor, photo_source_id: "assessor",
      status: assessor.status === "no_records" && municipalUnavailable ? "partial" : assessor.status };
  } catch {
    return { parcel_id: parcel.attributes.parcel_id, objectid: parcel.attributes.objectid,
      status: "unavailable", photo_source_id: null, photo_url: null, source_url: null,
      note: "Neither official photo source could be verified for this request." };
  }
}
