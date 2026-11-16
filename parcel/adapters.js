import { load } from "cheerio";
import curated from "./curated.json" with { type: "json" };
import { LAYERS, source, SOURCES } from "./config.js";
import {
  arcgis,
  cached,
  fetchBounded,
  fetchJson,
  sqlString,
  SourceError,
} from "./http.js";
import { normalizeAddress } from "./resolve.js";

const ISO = () => new Date().toISOString();
const text = (value) =>
  value == null ? null : String(value).replace(/\s+/g, " ").trim() || null;
const record = (
  id,
  sourceId,
  attributes,
  { eventDate = null, match = "exact", note = null, sourceUrl = null } = {},
) => ({
  id: `${sourceId}:${id}`,
  source_id: sourceId,
  source_record_id: String(id),
  event_date: eventDate,
  attributes,
  match: {
    method: match,
    confidence: match === "exact" ? "high" : "candidate",
  },
  note,
  source_url: sourceUrl ?? source(sourceId)?.url ?? null,
  retrieved_at: ISO(),
});
const result = (sourceId, items, { partial = false, warning = null } = {}) => ({
  source_id: sourceId,
  status: partial ? "partial" : items.length ? "ok" : "no_records",
  items,
  warning,
  coverage: source(sourceId)?.coverage ?? "",
  retrieved_at: ISO(),
});
const unavailable = (sourceId, reason = null) => ({
  source_id: sourceId,
  status: "unavailable",
  items: [],
  warning: reason ?? source(sourceId)?.coverage ?? "No verified parcel lookup",
  coverage: source(sourceId)?.coverage ?? "",
  retrieved_at: null,
});
const coded = (error) =>
  error instanceof SourceError
    ? error.message
    : error?.name === "TimeoutError"
      ? "Source timed out"
      : "Source request failed";
const polygonParams = (parcel) => ({
  geometry: JSON.stringify(parcel.geometry),
  geometryType: "esriGeometryPolygon",
  inSR: "4326",
  spatialRel: "esriSpatialRelIntersects",
  where: "1=1",
  returnGeometry: "false",
  outFields: "*",
  resultRecordCount: "1000",
});
const date = (value) => {
  if (!value) return null;
  const dotNet =
    typeof value === "string"
      ? value.match(/^\/Date\((\d+)(?:[+-]\d{4})?\)\/$/)
      : null;
  const time =
    typeof value === "number" || dotNet
      ? Number(dotNet?.[1] ?? value)
      : Date.parse(String(value));
  return Number.isFinite(time)
    ? new Date(time).toISOString().slice(0, 10)
    : null;
};

async function layerRecords(
  sourceId,
  layer,
  parcel,
  {
    eventField = null,
    match = "parcel-intersection",
    note = null,
    max = 1000,
  } = {},
) {
  const data = await arcgis(layer, {
    ...polygonParams(parcel),
    resultRecordCount: String(max),
  });
  const features = data.features ?? [];
  return result(
    sourceId,
    features.map((f) =>
      record(
        f.attributes?.objectid ?? f.attributes?.OBJECTID ?? features.indexOf(f),
        sourceId,
        f.attributes ?? {},
        {
          eventDate: eventField ? date(f.attributes?.[eventField]) : null,
          match,
          note,
        },
      ),
    ),
    {
      partial: Boolean(data.exceededTransferLimit),
      warning: data.exceededTransferLimit
        ? "Source returned a truncated page."
        : null,
    },
  );
}

async function parcelRecord(parcel) {
  return result("parcels", [
    record(parcel.attributes.objectid, "parcels", parcel.attributes, {
      eventDate: date(parcel.attributes.sale_date),
      note: "Published sale date is a parcel attribute, not a complete sale history.",
    }),
  ]);
}

async function addressRecords(parcel) {
  const data = await arcgis(LAYERS.addresses, {
    ...polygonParams(parcel),
    resultRecordCount: "500",
  });
  return result(
    "addresses",
    (data.features ?? []).map((f) =>
      record(f.attributes?.objectid ?? 0, "addresses", f.attributes ?? {}, {
        match: "address-point-intersection",
      }),
    ),
    {
      partial: Boolean(data.exceededTransferLimit),
      warning:
        "Address points inside the parcel are spatial candidates; they do not prove a unit or legal address.",
    },
  );
}

async function assessorRecord(parcel) {
  const id = Number(parcel.attributes.parcel_id);
  const url = `https://gis.vgsi.com/newhavenct/Parcel.aspx?pid=${id}`;
  const html = await fetchBounded(url, {
    accept: "text/html,application/xhtml+xml",
    timeout: 9000,
    maxBytes: 5_000_000,
  });
  const $ = load(html);
  if (Number($("#MainContent_lblPid").first().text().trim()) !== id)
    throw new SourceError("Assessor card did not confirm parcel ID");
  const attributes = {};
  $('[id^="MainContent_"]').each((_, el) => {
    const key = $(el).attr("id");
    if (
      !key ||
      Object.keys(attributes).length >= 500 ||
      $(el).children('[id^="MainContent_"]').length
    )
      return;
    const value = text($(el).text());
    if (value)
      attributes[key.replace(/^MainContent_/, "")] = value.slice(0, 1000);
  });
  return result("assessor", [
    record(id, "assessor", attributes, {
      eventDate: date(attributes.lblSaleDate),
      sourceUrl: url,
      note: "Vision card fields are displayed as published; assessed values are not tax bills.",
    }),
  ]);
}

async function boundaryRecords(sourceId, layer, parcel) {
  const data = await arcgis(layer, polygonParams(parcel));
  return result(
    sourceId,
    (data.features ?? []).map((f) =>
      record(f.attributes?.objectid ?? 0, sourceId, f.attributes ?? {}, {
        match: "parcel-intersection",
      }),
    ),
    {
      partial: Boolean(data.exceededTransferLimit),
      warning: data.exceededTransferLimit
        ? "Boundary query was truncated."
        : null,
    },
  );
}

async function alderRecords(parcel) {
  const wards = await cached(`wards:${parcel.attributes.parcel_id}`, () =>
    boundaryRecords("wards", LAYERS.wards, parcel),
  );
  const numbers = [
    ...new Set(
      wards.items
        .map((item) => Number(item.attributes.ward))
        .filter(Number.isInteger),
    ),
  ];
  if (wards.status === "partial" || numbers.length !== 1)
    return unavailable(
      "alders",
      "Parcel does not have one unambiguous ward intersection.",
    );
  const html = await fetchBounded(source("alders").url, {
    accept: "text/html",
    maxBytes: 3_000_000,
    timeout: 9000,
  });
  const $ = load(html);
  for (const table of $("table").toArray()) {
    const rows = $(table)
      .find("tr")
      .toArray()
      .map((row) =>
        $(row)
          .find("th,td")
          .toArray()
          .map((cell) => text($(cell).text()) ?? ""),
      );
    const headingIndex = rows.findIndex(
      (row) =>
        row.some((cell) => /^ward$/i.test(cell)) &&
        row.some((cell) =>
          /^(name|alder|alder name|representative)$/i.test(cell),
        ),
    );
    if (headingIndex < 0) continue;
    const heads = rows[headingIndex].map((h) => h.toLowerCase());
    const wi = heads.indexOf("ward");
    const records = rows
      .slice(headingIndex + 1)
      .filter((row) => row[wi])
      .map((row) => ({
        ward: Number(
          row[wi].match(/^(?:ward\s*)?(\d{1,2})(?:\s*-\s*[a-z]+)?$/i)?.[1],
        ),
        fields: Object.fromEntries(heads.map((key, i) => [key, row[i] ?? ""])),
      }));
    const selected = records.filter((item) => item.ward === numbers[0]);
    if (selected.length !== 1)
      return unavailable(
        "alders",
        "Official roster has no unique identified row for this ward.",
      );
    return result("alders", [
      record(numbers[0], "alders", selected[0].fields, {
        note: "Roster officeholding and election changes require independent confirmation.",
      }),
    ]);
  }
  throw new SourceError("Official alder table is not readable");
}

function printKey(value) {
  return (
    text(value)
      ?.split("/")
      .map((x) => x.trim())
      .filter(Boolean)
      .join(" ")
      .toUpperCase() ?? null
  );
}
async function municityRecords(parcel) {
  const key = printKey(parcel.attributes.mblu);
  if (!key)
    return unavailable(
      "municity",
      "Parcel has no MBLU for a safe vendor lookup.",
    );
  const base = "https://services5.municity5.com/M5Services/M5Service.svc";
  const search = new URL(base + "/GetM5Data");
  for (const [name, value] of Object.entries({
    Customer: "NewHavenCityCT",
    entity: "Parcel",
    entity_id: "",
    fieldtype: "text",
    mapid: "",
    mapobject: "",
    module: "",
    numrecs: "5",
    operator: "=",
    pid: "",
    searchfield: "PrintKey",
    section: "",
    value: key,
  }))
    search.searchParams.set(name, value);
  const opts = {
    headers: { SourceId: "2" },
    timeout: 10000,
    maxBytes: 10_000_000,
  };
  const found = await fetchJson(search, opts);
  if (found.rows === "" && Number(found.total) === 0)
    return unavailable(
      "municity",
      "Vendor has no matching parcel; permit coverage could not be checked.",
    );
  if (!Array.isArray(found.rows) || found.rows.length !== 1)
    return unavailable("municity", "Vendor parcel match is ambiguous.");
  const vendor = found.rows[0];
  if (
    printKey(vendor.PrintKey) !== key ||
    !Number.isSafeInteger(Number(vendor.Parcel_ID))
  )
    return unavailable(
      "municity",
      "Vendor parcel identity did not match the reviewed MBLU.",
    );
  const children = await fetchJson(
    `${base}/Customer/NewHavenCityCT/Parcel/${Number(vendor.Parcel_ID)}/Children`,
    opts,
  );
  const items = [];
  const permitNumbers = new Set(
    (Array.isArray(children.Permit) ? children.Permit : [])
      .map((row) => text(row?.PermitNo ?? row?.PermitNumber)?.toUpperCase())
      .filter(Boolean),
  );
  for (const [kind, idKey, dateKeys] of [
    ["Permit", "Permit_ID", ["PermitDate", "CreatedDate"]],
    ["Application", "Application_ID", ["ApplicationDate", "CreatedDate"]],
    ["License", "License_ID", ["IssueDate", "CreatedDate"]],
    ["Certificate", "Certificate_ID", ["CertificateDate", "CreatedDate"]],
  ]) {
    const rows = children[kind];
    if (rows == null) continue;
    if (!Array.isArray(rows))
      throw new SourceError(`Vendor ${kind} records are malformed`);
    for (const [index, row] of rows.slice(0, 500).entries()) {
      if (
        kind === "Application" &&
        permitNumbers.has(text(row?.ApplicationNumber)?.toUpperCase())
      )
        continue;
      const eventDate =
        dateKeys.map((key) => date(row?.[key])).find(Boolean) ?? null;
      items.push(
        record(
          `${kind.toLowerCase()}:${row?.[idKey] ?? index}`,
          "municity",
          row,
          {
            eventDate,
            sourceUrl: source("municity").url,
            note: `Vendor ${kind.toLowerCase()} record; recorded status does not prove completion.`,
          },
        ),
      );
    }
  }
  return result("municity", items, {
    partial: ["Permit", "Application", "License", "Certificate"].some(
      (kind) => children[kind]?.length > 500,
    ),
    warning:
      "Permit, application, license and certificate stages remain distinct.",
  });
}

async function managedLotRecords(parcel) {
  const mblu = text(parcel.attributes.mblu);
  if (!mblu)
    return unavailable(
      "managed-lots",
      "Parcel has no MBLU for the exact MBP lookup.",
    );
  const data = await arcgis(LAYERS.managedLots, {
    where: `UPPER(mbp) = '${sqlString(mblu.toUpperCase())}'`,
    outFields: "*",
    resultRecordCount: "100",
  });
  return result(
    "managed-lots",
    (data.features ?? []).map((f) =>
      record(f.attributes?.objectid ?? 0, "managed-lots", f.attributes ?? {}, {
        match: "inferred-exact-mblu",
        note: "Managed lot is not evidence of vacancy or availability.",
      }),
    ),
    { partial: Boolean(data.exceededTransferLimit) },
  );
}

async function planningRecords(parcel) {
  const matches = curated.cases.filter(
    (item) => item.parcelId === Number(parcel.attributes.parcel_id),
  );
  return result(
    "planning",
    matches.map((item) =>
      record(
        item.id,
        "planning",
        { title: item.title, note: item.note, reviewed_on: curated.reviewedOn },
        {
          eventDate: item.eventDate,
          sourceUrl: item.sourceUrl,
          match: "reviewed-document",
        },
      ),
    ),
  );
}

async function socrataRecords(sourceId, parcel) {
  const address = normalizeAddress(parcel.attributes.property_address);
  if (!address)
    return unavailable(
      sourceId,
      "Parcel has no address for an exact source lookup.",
    );
  const id = sourceId === "business-master" ? "n7gp-d28j" : "ngch-56tr";
  const field = sourceId === "business-master" ? "billingstreet" : "address";
  const url = new URL(`https://data.ct.gov/resource/${id}.json`);
  const parts = address.match(/^(\d+)\s+(.+)$/);
  if (!parts)
    return unavailable(
      sourceId,
      "Parcel address cannot be safely compared with state addresses.",
    );
  const street = parts[2].replace(/\s+(ST|AVE|RD)$/, "").replaceAll(" ", "%");
  url.searchParams.set(
    "$where",
    `upper(${field}) like '${sqlString(parts[1] + "%" + street)}%' AND upper(${sourceId === "business-master" ? "billingcity" : "city"}) = 'NEW HAVEN'`,
  );
  url.searchParams.set("$limit", "100");
  const rows = await fetchJson(url, { timeout: 9000, maxBytes: 4_000_000 });
  if (!Array.isArray(rows))
    throw new SourceError("State source returned malformed rows");
  const matching = rows.filter(
    (row) => normalizeAddress(row[field]) === address,
  );
  return result(
    sourceId,
    matching.map((row, index) =>
      record(row.id ?? row.credentialid ?? index, sourceId, row, {
        match: "address-candidate",
        eventDate: date(row.date_registration ?? row.issuedate),
        note: "Address is a candidate connection only; it does not establish occupancy, ownership or current use.",
      }),
    ),
    {
      partial: rows.length === 100,
      warning: "Candidates are shown separately from confirmed parcel records.",
    },
  );
}

function nearFeet(point, parcel) {
  if (
    !Array.isArray(point) ||
    !Number.isFinite(point[0]) ||
    !Number.isFinite(point[1])
  )
    return null;
  const scaleX = 364000 * Math.cos((point[1] * Math.PI) / 180),
    scaleY = 364000;
  let best = Infinity;
  for (const ring of parcel.geometry.rings ?? [])
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1],
        b = ring[i];
      const x = (point[0] - a[0]) * scaleX,
        y = (point[1] - a[1]) * scaleY;
      const dx = (b[0] - a[0]) * scaleX,
        dy = (b[1] - a[1]) * scaleY;
      const t = Math.max(
        0,
        Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy || 1)),
      );
      best = Math.min(best, Math.hypot(x - t * dx, y - t * dy));
    }
  return Number.isFinite(best) ? Math.round(best) : null;
}
async function completeStreetsRecords(parcel) {
  const params = {
    ...polygonParams(parcel),
    distance: "250",
    units: "esriSRUnit_Foot",
    resultRecordCount: "250",
    returnGeometry: "true",
    outSR: "4326",
  };
  const layers = [
    ["point", LAYERS.streetsPoints],
    ["line", LAYERS.streetsLines],
  ];
  const responses = await Promise.allSettled(
    layers.map(async ([kind, layer]) => ({
      kind,
      data: await arcgis(layer, params),
    })),
  );
  const successes = responses
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
  if (!successes.length)
    throw new SourceError("Complete Streets layers were unavailable");
  const items = successes.flatMap(({ kind, data }) =>
    (data.features ?? []).map((f) => {
      const coordinates =
        kind === "point"
          ? [[f.geometry?.x, f.geometry?.y]]
          : (f.geometry?.paths ?? []).flat();
      const distances = coordinates
        .map((p) => nearFeet(p, parcel))
        .filter(Number.isFinite);
      const distance = distances.length ? Math.min(...distances) : null;
      return record(
        `${kind}:${f.attributes?.OBJECTID ?? 0}`,
        "complete-streets",
        {
          ...f.attributes,
          geometry_kind: kind,
          approx_distance_feet: distance,
        },
        {
          match: "within-250-feet",
          eventDate: date(f.attributes?.ConstBegin),
          note: "Nearby project from a source last edited in 2022; distance is approximate and recorded status may be stale.",
        },
      );
    }),
  );
  return result("complete-streets", items, {
    partial:
      successes.length < layers.length ||
      successes.some((x) => x.data.exceededTransferLimit),
    warning:
      "Within 250 feet of parcel geometry. Approximate distances are in feet. These are nearby projects, not parcel records.",
  });
}

const ADAPTERS = Object.freeze({
  parcels: parcelRecord,
  addresses: addressRecords,
  assessor: assessorRecord,
  zoning: (p) => boundaryRecords("zoning", LAYERS.zoning, p),
  wards: (p) => boundaryRecords("wards", LAYERS.wards, p),
  neighborhoods: (p) =>
    boundaryRecords("neighborhoods", LAYERS.neighborhoods, p),
  alders: alderRecords,
  municity: municityRecords,
  "managed-lots": managedLotRecords,
  planning: planningRecords,
  "business-master": (p) => socrataRecords("business-master", p),
  "state-licenses": (p) => socrataRecords("state-licenses", p),
  "complete-streets": completeStreetsRecords,
});

export async function getSourceRecords(sourceId, parcel) {
  const definition = source(sourceId);
  if (!definition) throw new SourceError("Unknown source", 400);
  if (!ADAPTERS[sourceId]) return unavailable(sourceId);
  const id = Number(parcel.attributes.parcel_id);
  try {
    return await cached(
      `source:${sourceId}:${id}:${parcel.attributes.objectid}`,
      () => ADAPTERS[sourceId](parcel),
    );
  } catch (error) {
    return unavailable(sourceId, coded(error));
  }
}

export async function getGroup(group, parcel) {
  const definitions = SOURCES.filter((item) => item.group === group);
  if (!definitions.length) throw new SourceError("Unknown group", 400);
  const sources = await Promise.all(
    definitions.map((item) => getSourceRecords(item.id, parcel)),
  );
  const items = sources.flatMap((item) => item.items);
  return {
    group,
    parcel_id: Number(parcel.attributes.parcel_id),
    sources: sources.map(({ items, ...rest }) => ({
      ...rest,
      count: items.length,
    })),
    items,
    partial: sources.some(
      (item) => item.status === "unavailable" || item.status === "partial",
    ),
  };
}

export function pageItems(items, cursor, limit = 25) {
  const n = Number(cursor ?? 0);
  if (!Number.isSafeInteger(n) || n < 0 || n > 10000)
    throw new SourceError("Invalid cursor", 400);
  const size = Math.min(Math.max(Number(limit) || 25, 1), 50);
  return {
    items: items.slice(n, n + size),
    next_cursor: n + size < items.length ? String(n + size) : null,
    total: items.length,
  };
}
