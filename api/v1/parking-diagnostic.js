import { loadParcel } from "../../parcel/resolve.js";
import { parcelFeatureToGeoJSON } from "../../parcel/geometry.js";
import { arcgis, fetchBounded, fetchJson } from "../../parcel/http.js";
import { LAYERS } from "../../parcel/config.js";
import { parcelMapContext } from "../../parcel/map-context.js";
import { browseParcels } from "../../parcel/browse.js";
import { load } from "cheerio";

const envelope = (center, metres) => {
  const lat = metres / 111195;
  const lon = lat / Math.cos(center[1] * Math.PI / 180);
  return { xmin: center[0] - lon, ymin: center[1] - lat,
    xmax: center[0] + lon, ymax: center[1] + lat,
    spatialReference: { wkid: 4326 } };
};

const meters = (center, x, y) => Math.hypot(
  (x - center[0]) * 111195 * Math.cos(center[1] * Math.PI / 180),
  (y - center[1]) * 111195,
);

export default {
  async fetch(request) {
    if (process.env.VERCEL_ENV !== "preview" || request.method !== "GET")
      return new Response("Not found", { status: 404 });
    if (new URL(request.url).searchParams.get("mode") === "browse") {
      const data = await browseParcels("-72.932,41.305,-72.924,41.311");
      return Response.json({ status: data.status, count: data.features.length,
        warning: data.warning, first: data.features[0]?.properties ?? null },
      { headers: { "Cache-Control": "private, no-store" } });
    }
    const id = "10386";
    const objectid = "20011";
    const parcel = await loadParcel(id, objectid);
    const bbox = parcelFeatureToGeoJSON(parcel).bbox;
    const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
    const counts = await Promise.all([400, 1000, 2000].map(async (radius) => {
      const result = await arcgis(LAYERS.parkingSpaces, {
        geometry: JSON.stringify(envelope(center, radius)), geometryType: "esriGeometryEnvelope",
        inSR: "4326", spatialRel: "esriSpatialRelIntersects", returnCountOnly: "true",
      });
      return { radius, count: result.count };
    }));
    const candidates = await arcgis(LAYERS.parkingSpaces, {
      geometry: JSON.stringify(envelope(center, 2000)), geometryType: "esriGeometryEnvelope",
      inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects",
      returnGeometry: "true", outFields: "objectid,facilityid", resultRecordCount: "2000",
    });
    const closest = candidates.features.map((item) => ({
      id: item.attributes.objectid, facilityid: item.attributes.facilityid,
      distance_m: Math.round(meters(center, item.geometry.x, item.geometry.y)),
    })).sort((a, b) => a.distance_m - b.distance_m).slice(0, 5);
    const context = await parcelMapContext(id, objectid);
    const layer = context.layers.find((item) => item.id === "metered-parking-spaces");
    const assessorHtml = await fetchBounded(`https://gis.vgsi.com/newhavenct/Parcel.aspx?pid=${id}`, {
      accept: "text/html,application/xhtml+xml", timeout: 9000, maxBytes: 5_000_000,
    });
    const $ = load(assessorHtml);
    const assessorVerified = Number($("#MainContent_lblPid").first().text().trim()) === Number(id);
    const assessorImages = assessorVerified ? $("img").toArray().map((node) => ({
      id: $(node).attr("id") ?? null, alt: $(node).attr("alt") ?? null,
      src: $(node).attr("src") ?? null, parent_id: $(node).parent().attr("id") ?? null,
      parent_href: $(node).parent().attr("href") ?? null,
    })).slice(0, 30) : [];
    const photoSrc = assessorImages.find((item) => item.alt === "Building Photo")?.src;
    const photoUrls = photoSrc ? [
      new URL(photoSrc, "https://gis.vgsi.com").href,
      `https://gis.vgsi.com${photoSrc.replaceAll("\\", "/")}`,
      `https://gis.vgsi.com${photoSrc.replaceAll("\\", "%5C")}`,
    ] : [];
    const photoChecks = await Promise.all([...new Set(photoUrls)].map(async (url) => {
      try {
        const response = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000) });
        return { url, status: response.status, type: response.headers.get("content-type"),
          location: response.headers.get("location") };
      } catch (error) { return { url, error: error.message }; }
    }));
    const parcelImageFields = Object.fromEntries(Object.entries(parcel.attributes)
      .filter(([key]) => /image|photo|picture|file/i.test(key)));
    const key = String(parcel.attributes.mblu).split("/").map((part) => part.trim())
      .filter(Boolean).join(" ").toUpperCase();
    const municipalSearch = new URL("https://services5.municity5.com/M5Services/M5Service.svc/GetM5Data");
    for (const [name, value] of Object.entries({ Customer: "NewHavenCityCT", entity: "Parcel", entity_id: "",
      fieldtype: "text", mapid: "", mapobject: "", module: "", numrecs: "5", operator: "=",
      pid: "", searchfield: "PrintKey", section: "", value: key }))
      municipalSearch.searchParams.set(name, value);
    const municipalResult = await fetchJson(municipalSearch, {
      headers: { SourceId: "2" }, timeout: 10000, maxBytes: 10_000_000,
    });
    const vendor = Array.isArray(municipalResult.rows) && municipalResult.rows.length === 1
      ? municipalResult.rows[0] : null;
    const municipalId = vendor && String(vendor.PrintKey).trim() === key ? Number(vendor.Parcel_ID) : null;
    const municipalPhotoChecks = await Promise.all([municipalId, 13303]
      .filter((value) => Number.isSafeInteger(value)).map(async (value) => {
        const url = `https://www.municitymedia.com/NewHavenCityCT/Parcel/${value}/streetview.jpg`;
        try {
          const response = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000) });
          return { id: value, status: response.status, type: response.headers.get("content-type"),
            length: response.headers.get("content-length"), location: response.headers.get("location") };
        } catch (error) { return { id: value, error: error.message }; }
      }));
    return Response.json({ parcel: { id, objectid, address: parcel.attributes.property_address, bbox },
      center, counts, closest, layer: { status: layer.status, count: layer.features.length,
        warning: layer.warning, source_updated_at: layer.source_updated_at },
      parcelImageFields, assessorVerified, assessorImages, photoChecks,
      municipal: { id: municipalId, match_count: municipalResult.rows?.length ?? null,
        photo_fields: Object.fromEntries(Object.entries(vendor ?? {})
          .filter(([field]) => /image|photo|media|streetview/i.test(field))),
        photo_checks: municipalPhotoChecks } },
    { headers: { "Cache-Control": "private, no-store" } });
  },
};
