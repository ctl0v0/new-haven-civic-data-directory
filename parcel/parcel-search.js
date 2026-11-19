import { LAYERS } from "./config.js";
import { arcgis, fetchJson, SourceError, sqlString } from "./http.js";
import { fingerprint, makeSearchCursor, readSearchCursor } from "./search-cursor.js";

const checkedDate = (value, field) => {
  if (value == null || value === "") return null;
  const text = String(value);
  const parsed = Date.parse(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== text)
    throw new SourceError(`Invalid ${field}`, 400);
  return text;
};
const publishedDate = (value) => {
  if (value == null || value === "") return null;
  const time = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
};
const normalized = (value) => String(value ?? "").trim().toUpperCase();
const sourceCheck = (sourceId, status, extra = {}) =>
  ({ source_id: sourceId, status, ...extra });

async function idsFor(layer, options) {
  const [ids, count] = await Promise.all([
    arcgis(layer, { ...options, returnIdsOnly: "true", returnGeometry: "false" }),
    arcgis(layer, { ...options, returnCountOnly: "true", returnGeometry: "false" }),
  ]);
  if (!Array.isArray(ids.objectIds) || !Number.isSafeInteger(count.count) ||
      ids.objectIds.some((id) => !Number.isSafeInteger(Number(id))) ||
      new Set(ids.objectIds.map(Number)).size !== count.count || ids.objectIds.length !== count.count)
    throw new SourceError("City GIS ID list and count did not agree");
  return ids.objectIds.map(Number).sort((a, b) => a - b);
}

async function scopedIds(scope, name) {
  if (scope === "city") return { ids: await idsFor(LAYERS.parcels, { where: "1=1" }),
    source_checks: [sourceCheck("parcels", "ok")] };
  const neighborhood = scope === "neighborhood";
  const layer = neighborhood ? LAYERS.neighborhoods : LAYERS.wards;
  const field = neighborhood ? "neighborhood" : "ward";
  const label = neighborhood ? "neighborhood_label" : null;
  const where = neighborhood
    ? `UPPER(${field}) = '${sqlString(normalized(name))}' OR UPPER(${label}) = '${sqlString(normalized(name))}'`
    : `ward = ${Number(name)}`;
  const zones = await arcgis(layer, { where, outFields: "*", returnGeometry: "true",
    outSR: "4326", resultRecordCount: "20" });
  if (!zones.features?.length) throw new SourceError(`City ${scope} was not found`, 404);
  if (zones.exceededTransferLimit || zones.features.length >= 20)
    throw new SourceError(`City ${scope} boundary result was truncated`);
  const all = new Set();
  for (const zone of zones.features) {
    if (!zone.geometry) throw new SourceError(`City ${scope} boundary had no geometry`);
    const ids = await idsFor(LAYERS.parcels, { where: "1=1",
      geometry: JSON.stringify(zone.geometry), geometryType: "esriGeometryPolygon",
      inSR: "4326", spatialRel: "esriSpatialRelIntersects" });
    for (const id of ids) all.add(id);
  }
  return { ids: [...all].sort((a, b) => a - b), source_checks: [
    sourceCheck(neighborhood ? "neighborhoods" : "wards", "ok", {
      intersecting_boundary_features: zones.features.length }),
    sourceCheck("parcels", "ok")],
  };
}

export async function searchParcels(input = {}) {
  const scope = input.scope ?? "city";
  if (!["city", "neighborhood", "ward"].includes(scope))
    throw new SourceError("Invalid parcel search scope", 400);
  const neighborhood = scope === "neighborhood" ? String(input.neighborhood ?? "").trim() : null;
  const ward = scope === "ward" ? Number(input.ward) : null;
  if (scope === "neighborhood" && (!neighborhood || neighborhood.length > 80))
    throw new SourceError("Provide one City neighborhood name", 400);
  if (scope === "ward" && (!Number.isInteger(ward) || ward < 1 || ward > 100))
    throw new SourceError("Provide one City ward number", 400);
  if (scope === "city" && (input.neighborhood || input.ward != null))
    throw new SourceError("Boundary name requires a matching scope", 400);
  const useCodes = [...new Set((input.use_codes ?? []).map((value) => {
    const code = normalized(value);
    if (!code || code.length > 40) throw new SourceError("Invalid City use code", 400);
    return code;
  }))].sort();
  if (useCodes.length > 20) throw new SourceError("Too many City use codes", 400);
  const commercialUnitsMin = input.commercial_units_min == null ? null : Number(input.commercial_units_min);
  if (commercialUnitsMin != null && (!Number.isSafeInteger(commercialUnitsMin) || commercialUnitsMin < 0))
    throw new SourceError("Invalid minimum commercial units", 400);
  const saleFrom = checkedDate(input.sale_date_from, "sale_date_from");
  const saleTo = checkedDate(input.sale_date_to, "sale_date_to");
  if (saleFrom && saleTo && saleFrom > saleTo) throw new SourceError("Sale date range is reversed", 400);
  const scanLimit = input.scan_limit == null ? 100 : Number(input.scan_limit);
  if (!Number.isSafeInteger(scanLimit) || scanLimit < 1 || scanLimit > 200)
    throw new SourceError("scan_limit must be 1–200", 400);
  const criteria = { scope, neighborhood, ward, use_codes: useCodes,
    commercial_units_min: commercialUnitsMin, sale_date_from: saleFrom, sale_date_to: saleTo };
  const queryHash = fingerprint(criteria);
  let source;
  try { source = await scopedIds(scope, neighborhood ?? ward); }
  catch (error) {
    if (error instanceof SourceError && error.status === 404) throw error;
    return { criteria, items: [], next_cursor: null, complete_for_query: false,
      coverage: { source_checks: [sourceCheck(scope === "city" ? "parcels" : scope === "ward" ? "wards" : "neighborhoods",
        "unavailable", { warning: error instanceof SourceError ? error.message : "City GIS request failed" })],
      returned_count: 0, candidate_city_features: null },
      retrieved_at: new Date().toISOString() };
  }
  const metadata = await fetchJson(`${LAYERS.parcels}?f=pjson`, { timeout: 8000 })
    .catch(() => null);
  const revision = metadata?.editingInfo?.dataLastEditDate ??
    metadata?.editingInfo?.lastEditDate ?? metadata?.lastEditDate;
  const revisionKnown = Number.isFinite(revision) && revision > 0 &&
    Number.isFinite(new Date(revision).getTime());
  const sourceHash = fingerprint({ ids: source.ids, revision: revisionKnown ? revision : null });
  const cursor = readSearchCursor(input.cursor, queryHash, sourceHash);
  if (cursor.offset > source.ids.length) throw new SourceError("Search cursor is beyond the City result", 400);
  const selected = source.ids.slice(cursor.offset, cursor.offset + scanLimit);
  let features = [];
  let pageGap = 0;
  if (selected.length) {
    try {
      const data = await arcgis(LAYERS.parcels, { where: "1=1", objectIds: selected.join(","),
        outFields: "objectid,parcel_id,mblu,property_address,use_code,units_commercial,sale_date,price,book,page",
        returnGeometry: "false", resultRecordCount: String(selected.length) });
      features = data.features ?? [];
      const returned = new Set(features.map((feature) => Number(feature.attributes?.objectid)));
      if (data.exceededTransferLimit || features.length !== selected.length ||
          returned.size !== selected.length ||
          selected.some((id) => !returned.has(id))) pageGap++;
      const malformed = features.filter(({ attributes: a = {} }) =>
        !Number.isSafeInteger(Number(a.parcel_id)) ||
        !Number.isSafeInteger(Number(a.objectid))).length;
      if (malformed) {
        pageGap += malformed;
        features = features.filter(({ attributes: a = {} }) =>
          Number.isSafeInteger(Number(a.parcel_id)) &&
          Number.isSafeInteger(Number(a.objectid)));
      }
    } catch { pageGap++; }
  }
  let missingFilterFields = 0;
  const items = features.filter(({ attributes: a = {} }) => {
    if ((useCodes.length && !normalized(a.use_code)) ||
        (commercialUnitsMin != null && (a.units_commercial == null || a.units_commercial === "" ||
          !Number.isFinite(Number(a.units_commercial)))) ||
        ((saleFrom || saleTo) && a.sale_date != null && a.sale_date !== "" &&
          !publishedDate(a.sale_date))) missingFilterFields++;
    if (useCodes.length && !useCodes.includes(normalized(a.use_code))) return false;
    if (commercialUnitsMin != null) {
      const units = Number(a.units_commercial);
      if (!Number.isFinite(units) || units < commercialUnitsMin) return false;
    }
    if (saleFrom || saleTo) {
      const day = publishedDate(a.sale_date);
      if (!day || (saleFrom && day < saleFrom) || (saleTo && day > saleTo)) return false;
    }
    return true;
  }).sort((a, b) => Number(a.attributes.objectid) - Number(b.attributes.objectid))
    .map(({ attributes: a }) => ({ city_parcel_id: Number(a.parcel_id),
      city_objectid: Number(a.objectid), city_address: a.property_address ?? null,
      mblu: a.mblu ?? null,
      matching_source_fields: { use_code: a.use_code ?? null,
        units_commercial: a.units_commercial ?? null, sale_date: a.sale_date ?? null,
        price: a.price ?? null, book: a.book ?? null, page: a.page ?? null },
      match: { method: scope === "city" ? "city-parcel-feature" : "city-parcel-boundary-intersection",
        ...(scope !== "city" ? { boundary_source_id: scope === "ward" ? "wards" : "neighborhoods" } : {}) },
      source_url: `${LAYERS.parcels}/query?f=json&objectIds=${Number(a.objectid)}&outFields=*`,
    }));
  const nextOffset = cursor.offset + selected.length;
  const cumulativeGaps = Number(cursor.gaps ?? 0) + pageGap + missingFilterFields +
    (cursor.offset === 0 && !revisionKnown ? 1 : 0);
  const nextCursor = nextOffset < source.ids.length
    ? makeSearchCursor({ v: 1, query: queryHash, source: sourceHash,
      offset: nextOffset, gaps: cumulativeGaps, expires: Date.now() + 30 * 60_000 }) : null;
  return { criteria, items, next_cursor: nextCursor,
    complete_for_query: !nextCursor && cumulativeGaps === 0,
    coverage: { source_checks: source.source_checks.map((check) => check.source_id === "parcels"
      ? { ...check, ...(revisionKnown ? { source_updated_at: new Date(revision).toISOString() }
        : { status: "partial", warning: "City parcel publisher revision is unavailable" }) }
      : check),
      candidate_city_features: source.ids.length, scanned_this_page: selected.length,
      scanned_total: nextOffset, remaining_candidates: source.ids.length - nextOffset,
      returned_count: items.length, page_source_gaps: pageGap,
      missing_published_filter_fields: missingFilterFields,
      cumulative_source_gaps: cumulativeGaps,
      note: "One candidate-scan page. City parcel use, units, and sale fields are published attributes, not vacancy, lease area, or a complete title history." },
    retrieved_at: new Date().toISOString() };
}
