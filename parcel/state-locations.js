import { LAYERS } from "./config.js";
import { CHARITY_DATASET, CHARITY_FIELDS, CHARITY_SOURCE, CHARITY_WHERE, isCharityRegistration } from "./charity-registrations.js";
import { arcgis, cached, fetchJson, sqlString, SourceError } from "./http.js";
import { normalizeAddress } from "./resolve.js";
import { businessAddress, normalizeBusinessUnit, REGISTRATION_API, REGISTRATION_DATASET, REGISTRATION_FIELDS,
  REGISTRATION_SOURCE, REGISTRATION_WHERE, validBusinessRegistration } from "./business-registrations.js";

const DATASETS = Object.freeze({
  "ct-liquor-permits": { id: "gwv2-eswx", city: "permit_city", site: "permit_address", credential: "credential" },
  "ct-child-care-licenses": { id: "h8mr-dn95", city: "city", site: "address2", credential: "licensenumber" },
  "ct-cannabis-retail": { id: "42yd-3x3d", city: "city", site: "street", credential: "license" },
  [CHARITY_SOURCE]: { id: CHARITY_DATASET, city: "city", site: "address", credential: "credentialid" },
  [REGISTRATION_SOURCE]: { id: REGISTRATION_DATASET, site: "billingstreet", credential: "id" },
});
const CITY_ROW_LIMIT = 2001;
const ADDRESS_POINT_LIMIT = 1000;

function cityAddress(feature) {
  const a = feature.attributes ?? {};
  const street = a.full_street_name ?? `${a.street_name ?? ""} ${a.suffix_type ?? ""}`;
  return normalizeAddress(`${a.house_number ?? ""} ${street}`);
}

async function parcelRegistrationRows(localPoints) {
  const numbers = [...new Set(localPoints.map(({ attributes }) =>
    String(attributes?.house_number ?? "").trim().toUpperCase()).filter((value) => /^\d{1,6}[A-Z]?$/.test(value)))].sort();
  const limit = 501;
  const batches = Array.from({ length: Math.ceil(Math.min(numbers.length, 100) / 25) }, (_, index) =>
    numbers.slice(index * 25, index * 25 + 25));
  const results = await Promise.allSettled(batches.map((batch) => cached(`ct-registration-houses:${batch.join(",")}`, async () => {
    const prefixes = batch.map((number) => `upper(trim(billingstreet)) LIKE '${number} %'`).join(" OR ");
    const url = `${REGISTRATION_API}?${new URLSearchParams({ $where: `${REGISTRATION_WHERE} AND (${prefixes})`,
      $select: REGISTRATION_FIELDS.join(","), $order: "id", $limit: String(limit) })}`;
    const rows = await fetchJson(url, { timeout: 12000, maxBytes: 1_000_000 });
    if (!Array.isArray(rows) || rows.some((row) => !validBusinessRegistration(row)) ||
        new Set(rows.map(({ id }) => id)).size !== rows.length)
      throw new SourceError("The State Business Registry returned invalid or duplicate New Haven rows.");
    return rows;
  })));
  const completed = results.filter(({ status }) => status === "fulfilled").map(({ value }) => value);
  if (results.length && !completed.length) throw results[0].reason;
  return { rows: [...new Map(completed.flat().map((row) => [row.id, row])).values()],
    truncated: numbers.length > 100 || completed.some((rows) => rows.length >= limit),
    failed: results.length - completed.length };
}

async function stateCityRows(sourceId) {
  const definition = DATASETS[sourceId];
  return cached(`state-location-city:${sourceId}`, async () => {
    const url = new URL(`https://data.ct.gov/resource/${definition.id}.json`);
    const where = `upper(${definition.city})='NEW HAVEN'`;
    if (sourceId === CHARITY_SOURCE) {
      url.searchParams.set("$where", `${where} AND ${CHARITY_WHERE}`);
      url.searchParams.set("$select", CHARITY_FIELDS.join(","));
      url.searchParams.set("$order", "credentialid");
    } else url.searchParams.set("$where", where);
    url.searchParams.set("$limit", String(CITY_ROW_LIMIT));
    const rows = await fetchJson(url, { timeout: 12000, maxBytes: 4_000_000 });
    if (!Array.isArray(rows)) throw new SourceError("State roster returned no record array");
    if (sourceId === CHARITY_SOURCE && (rows.some((row) =>
      !isCharityRegistration(row) || String(row.city).toUpperCase() !== "NEW HAVEN") ||
      new Set(rows.map((row) => String(row.credentialid))).size !== rows.length))
      throw new SourceError("The State returned an invalid or duplicate New Haven charity registration.");
    return rows;
  });
}

async function parcelAddressPoints(parcel) {
  return cached(`state-location-points:${parcel.attributes.parcel_id}:${parcel.attributes.objectid}`, () => arcgis(LAYERS.addresses, {
    geometry: JSON.stringify(parcel.geometry),
    geometryType: "esriGeometryPolygon",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    where: "1=1",
    outFields: "objectid,house_number,full_street_name,street_name,suffix_type,unit,unit_type",
    returnGeometry: "true",
    resultRecordCount: String(ADDRESS_POINT_LIMIT),
  }));
}

async function cityPointsForAddress(localPoints, address) {
  const examples = localPoints.filter((feature) => cityAddress(feature) === address);
  const house = String(examples[0]?.attributes?.house_number ?? "");
  const streets = [...new Set(examples.map((feature) =>
    String(feature.attributes?.full_street_name ?? "").toUpperCase()).filter(Boolean))];
  if (!house || !streets.length) return null;
  const streetNames = [...new Set(examples.map((feature) =>
    String(feature.attributes?.street_name ?? "").toUpperCase()).filter(Boolean))];
  const streetClauses = [...streets.map((street) => `UPPER(full_street_name) = '${sqlString(street)}'`),
    ...streetNames.map((street) => `UPPER(street_name) = '${sqlString(street)}'`)];
  const where = `house_number = '${sqlString(house)}' AND (${streetClauses.join(" OR ")})`;
  return arcgis(LAYERS.addresses, {
    where,
    outFields: "objectid,house_number,full_street_name,street_name,suffix_type,unit,unit_type",
    outSR: "4326",
    returnGeometry: "true",
    resultRecordCount: String(ADDRESS_POINT_LIMIT),
  });
}

async function parcelAtPoint(point) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
  const data = await arcgis(LAYERS.parcels, {
    geometry: JSON.stringify(point),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "objectid,parcel_id",
    resultRecordCount: "3",
  });
  if (data.exceededTransferLimit || (data.features ?? []).length !== 1) return null;
  return data.features[0].attributes;
}

async function verifySiteAddress(localPoints, address, parcel) {
  const data = await cityPointsForAddress(localPoints, address);
  if (!data || data.exceededTransferLimit || (data.features ?? []).length >= ADDRESS_POINT_LIMIT)
    return { linked: false, incomplete: true };
  const matches = (data.features ?? []).filter((feature) => cityAddress(feature) === address);
  if (!matches.length) return { linked: false, incomplete: false };
  const pointGeometries = [...new Map(matches.map((feature) => {
    const point = feature.geometry;
    return [point ? `${point.x}:${point.y}` : `missing:${feature.attributes?.objectid}`, point];
  })).values()];
  if (pointGeometries.length > 25) return { linked: false, incomplete: true };
  const parcels = await Promise.all(pointGeometries.map(parcelAtPoint));
  if (parcels.some((row) => !row || Number(row.objectid) !== Number(parcel.attributes.objectid) ||
      Number(row.parcel_id) !== Number(parcel.attributes.parcel_id)))
    return { linked: false, ambiguous: true };
  return {
    linked: true,
    addressPointIds: matches.map((feature) => feature.attributes?.objectid).filter((id) => id != null),
    units: [...new Set(matches.map(({ attributes }) => normalizeBusinessUnit(attributes?.unit)).filter(Boolean))],
  };
}

// State rosters supply a site address, not a City parcel ID. Only a unique
// City address-point-to-parcel join can attach a State row to a parcel.
export async function stateLocationMatches(sourceId, parcel) {
  const definition = DATASETS[sourceId];
  if (!definition) throw new SourceError("Unknown State location source", 400);
  const points = await parcelAddressPoints(parcel);
  if (points.exceededTransferLimit || (points.features ?? []).length >= ADDRESS_POINT_LIMIT)
    return { matches: [], partial: true, warning: "City address points on this parcel exceeded the lookup limit; State site addresses were not linked." };
  const localPoints = points.features ?? [];
  if (!localPoints.length)
    return { matches: [], notLinked: true, warning: "The City returned no address points on this parcel, so State site addresses could not be joined." };
  const localAddresses = new Set(localPoints.map(cityAddress).filter(Boolean));
  const registry = sourceId === REGISTRATION_SOURCE;
  const { rows, truncated, failed = 0 } = registry ? await parcelRegistrationRows(localPoints)
    : await stateCityRows(sourceId).then((rows) => ({ rows, truncated: rows.length >= CITY_ROW_LIMIT }));
  const addressOf = (row) => registry ? businessAddress(row[definition.site]).address : normalizeAddress(row[definition.site]);
  const matchingRows = rows.filter((row) => localAddresses.has(addressOf(row)));
  const checks = new Map();
  let incompleteChecks = 0;
  let ambiguousChecks = 0;
  const matches = [];
  for (const row of matchingRows) {
    const address = addressOf(row);
    if (!checks.has(address)) {
      try {
        checks.set(address, await cached(
          `state-location-verified-site:${parcel.attributes.parcel_id}:${parcel.attributes.objectid}:${address}`,
          () => verifySiteAddress(localPoints, address, parcel),
        ));
      } catch {
        checks.set(address, { linked: false, incomplete: true });
      }
    }
    const check = checks.get(address);
    if (check.linked) matches.push({ row, siteField: definition.site,
      credentialField: definition.credential, datasetId: definition.id,
      addressPointIds: check.addressPointIds, units: check.units });
  }
  for (const check of checks.values()) if (check.incomplete) incompleteChecks++;
  for (const check of checks.values()) if (check.ambiguous) ambiguousChecks++;
  const incomplete = truncated || incompleteChecks > 0 || failed > 0;
  const notLinked = matchingRows.length > 0 && matches.length === 0 && !incomplete;
  const partial = incomplete || (registry && ambiguousChecks > 0);
  const warning = [
    truncated ? registry ? "The State Business Registry address lookup reached its limit. Results may be incomplete."
      : `The State returned at least ${CITY_ROW_LIMIT} New Haven rows; this roster check may be truncated.` : null,
    failed ? `${failed} State Business Registry address batch checks failed.` : null,
    incompleteChecks ? `${incompleteChecks} candidate site address${incompleteChecks === 1 ? "" : "es"} could not be verified against City parcel geometry.` : null,
    ambiguousChecks ? `${ambiguousChecks} site address${ambiguousChecks === 1 ? "" : "es"} had non-unique City parcel joins and were excluded.` : null,
    notLinked && !ambiguousChecks ? "State site address text matched a City address on this parcel, but did not establish a unique City parcel join." : null,
  ].filter(Boolean).join(" ") || null;
  return { matches, partial, notLinked, warning };
}
