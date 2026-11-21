import { LAYERS } from "./config.js";
import { arcgis, cached, fetchJson, sqlString, SourceError } from "./http.js";
import { normalizeAddress } from "./street-address.js";

export { normalizeAddress } from "./street-address.js";
function candidate(feature, method, searchedAddress = null) {
  const a = feature.attributes ?? {};
  const listedAddress = normalizeAddress(a.property_address);
  const differentAddress =
    searchedAddress && listedAddress && listedAddress !== searchedAddress;
  return {
    parcel_id: a.parcel_id,
    objectid: a.objectid,
    address: a.property_address ?? null,
    mblu: a.mblu ?? null,
    account_number: a.account_number ?? null,
    match: {
      method,
      ...(differentAddress
        ? {
            note:
              method === "address-point-intersection"
                ? "The searched address point intersects this parcel, but the parcel lists a different address. Confirm the building before selecting it."
                : "The parcel's listed address is not an exact match to the search.",
          }
        : {}),
    },
  };
}
function unique(items) {
  return [
    ...new Map(
      items.map((item) => [`${item.parcel_id}:${item.objectid}`, item]),
    ).values(),
  ];
}

export async function resolveParcel(query) {
  const q = String(query ?? "").trim();
  if (!q || q.length > 160 || /[\x00-\x1f]/.test(q))
    throw new SourceError("Enter a valid address or parcel identifier", 400);
  return cached("resolve:" + normalizeAddress(q), async () => {
    const normalized = normalizeAddress(q);
    const numeric = /^\d{1,12}$/.test(q) ? Number(q) : null;
    const parts =
      !q.includes("/") && /[A-Z]{2}/.test(normalized)
        ? normalized.match(/^(\d{1,6})\s+(.+)$/)
        : null;
    const queries = [];
    if (numeric !== null && Number.isSafeInteger(numeric)) {
      queries.push({ where: `parcel_id = ${numeric}`, method: "parcel-id" });
      queries.push({
        where: `account_number = '${sqlString(q)}'`,
        method: "account-number",
      });
    } else {
      queries.push({
        where: `UPPER(mblu) = '${sqlString(q.toUpperCase())}'`,
        method: "mblu",
      });
      if (parts)
        queries.push({
          where: `UPPER(property_address) = '${sqlString(normalized)}'`,
          method: "parcel-address",
        });
    }
    const results = await Promise.allSettled(
      queries.map(async ({ where, method }) => {
        const data = await arcgis(LAYERS.parcels, {
          where,
          outFields: "objectid,parcel_id,property_address,mblu,account_number",
          resultRecordCount: "25",
        });
        return {
          items: (data.features ?? [])
            .filter(
              (f) =>
                method !== "parcel-address" ||
                normalizeAddress(f.attributes?.property_address) === normalized,
            )
            .map((f) =>
              candidate(f, method, method === "parcel-address" ? normalized : null),
            ),
          truncated: Boolean(data.exceededTransferLimit),
        };
      }),
    );
    const matches = unique(
      results.flatMap((r) => (r.status === "fulfilled" ? r.value.items : [])),
    );
    let truncated = results.some(
      (r) => r.status === "fulfilled" && r.value.truncated,
    );
    const errors = results.filter((r) => r.status === "rejected").length;
    let fallbackUnavailable = false;
    if (parts) {
      const house = Number(parts[1]);
      const street = parts[2].replace(/\s+(ST|AVE|RD)$/, "");
      const metadata = await cached("address-schema", () =>
        fetchJson(LAYERS.addresses + "?f=pjson", { timeout: 8000 }),
      ).catch(() => null);
      const numericHouse =
        metadata?.fields?.find((f) => f.name === "house_number")?.type !==
        "esriFieldTypeString";
      const addressRows = await arcgis(LAYERS.addresses, {
        where: `house_number = ${numericHouse ? house : `'${house}'`} AND UPPER(street_name) LIKE '${sqlString(street)}%'`,
        outFields:
          "objectid,house_number,full_street_name,street_name,suffix_type,unit",
        returnGeometry: "true",
        outSR: "4326",
        resultRecordCount: "25",
      }).catch(() => {
        fallbackUnavailable = true;
        return null;
      });
      if (addressRows?.exceededTransferLimit) truncated = true;
      const points = [
        ...new Map(
          (addressRows?.features ?? [])
            .filter((row) => {
              const a = row.attributes ?? {};
              const streetName =
                a.full_street_name ?? `${a.street_name ?? ""} ${a.suffix_type ?? ""}`;
              return normalizeAddress(`${a.house_number ?? ""} ${streetName}`) === normalized;
            })
            .map((row) => row.geometry)
            .filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))
            .map((p) => [`${p.x}:${p.y}`, p]),
        ).values(),
      ];
      if (points.length > 5) truncated = true;
      const spatial = await Promise.allSettled(
        points
          .slice(0, 5)
          .map((p) =>
            arcgis(LAYERS.parcels, {
              geometry: JSON.stringify({
                x: p.x,
                y: p.y,
                spatialReference: { wkid: 4326 },
              }),
              geometryType: "esriGeometryPoint",
              inSR: "4326",
              spatialRel: "esriSpatialRelIntersects",
              outFields:
                "objectid,parcel_id,property_address,mblu,account_number",
              resultRecordCount: "10",
            }),
          ),
      );
      for (const item of spatial) {
        if (item.status === "rejected") {
          fallbackUnavailable = true;
          continue;
        }
        matches.push(
          ...(item.value.features ?? []).map((f) =>
            candidate(f, "address-point-intersection", normalized),
          ),
        );
        if (item.value.exceededTransferLimit) truncated = true;
      }
    }
    const candidates = unique(matches).filter((item) =>
      Number.isSafeInteger(Number(item.parcel_id)),
    );
    if (candidates.length > 25) truncated = true;
    return {
      query: q,
      status:
        candidates.length === 1 && !truncated
          ? "resolved"
          : candidates.length
            ? "ambiguous"
            : errors === queries.length || fallbackUnavailable
              ? "unavailable"
              : "not_found",
      candidates: candidates.slice(0, 25),
      truncated,
      warnings: [
        ...(truncated
          ? ["Search reached a source result limit; refine the query."]
          : []),
        ...(errors || fallbackUnavailable
          ? ["One search route was unavailable."]
          : []),
      ],
    };
  });
}

export async function loadParcel(parcelId, objectId = null) {
  if (!/^\d{1,12}$/.test(String(parcelId ?? "")))
    throw new SourceError("Invalid parcel ID", 400);
  if (objectId !== null && !/^\d{1,12}$/.test(String(objectId)))
    throw new SourceError("Invalid parcel object ID", 400);
  return cached(`parcel-feature:${Number(parcelId)}:${objectId === null ? "all" : Number(objectId)}`, async () => {
    const data = await arcgis(LAYERS.parcels, {
      where: `parcel_id = ${Number(parcelId)}`,
      outFields: "*",
      returnGeometry: "true",
      outSR: "4326",
      resultRecordCount: "100",
    });
    const wkid = data.spatialReference?.latestWkid ?? data.spatialReference?.wkid;
    if (wkid && wkid !== 4326)
      throw new SourceError(
        "Parcel geometry was not returned in longitude and latitude",
      );
    if (data.exceededTransferLimit)
      throw new SourceError(
        "Parcel ID returns too many records; refine selection",
        409,
      );
    const features = (data.features ?? []).filter(
      (f) => Number(f.attributes?.parcel_id) === Number(parcelId),
    );
    const selected =
      objectId === null
        ? features
        : features.filter(
            (f) => Number(f.attributes?.objectid) === Number(objectId),
          );
    if (!selected.length) throw new SourceError("Parcel not found", 404);
    if (selected.length !== 1)
      throw new SourceError(
        "Parcel ID is ambiguous; select a source object ID",
        409,
      );
    const feature = selected[0];
    const featureWkid = feature.geometry?.spatialReference?.latestWkid ??
      feature.geometry?.spatialReference?.wkid;
    if (featureWkid && featureWkid !== 4326)
      throw new SourceError("Parcel geometry was not returned in longitude and latitude");
    if (!Array.isArray(feature.geometry?.rings))
      throw new SourceError("Parcel geometry unavailable");
    return feature;
  });
}
