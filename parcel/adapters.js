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
import { parseLciProperty } from "./lci.js";

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
  source_url: source(sourceId)?.url ?? null,
  verification_url: source(sourceId)?.verification_url ?? null,
  retrieved_at: ISO(),
});
const unavailable = (sourceId, reason = null) => ({
  source_id: sourceId,
  status: "unavailable",
  items: [],
  warning: reason ?? source(sourceId)?.coverage ?? "No verified parcel lookup",
  coverage: source(sourceId)?.coverage ?? "",
  source_url: source(sourceId)?.url ?? null,
  verification_url: source(sourceId)?.verification_url ?? null,
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

async function lciCaseRecords(parcel) {
  const id = Number(parcel.attributes.parcel_id);
  if (!Number.isSafeInteger(id) || id <= 0)
    return unavailable(
      "lci-cases",
      "Parcel has no valid assessor PID for LCI lookup.",
    );
  const url = `https://lci.city/public/property/${id}`;
  const html = await fetchBounded(url, {
    accept: "text/html,application/xhtml+xml",
    timeout: 9000,
    maxBytes: 3_000_000,
  });
  const parsed = parseLciProperty(html, parcel, url);
  return {
    ...result(
      "lci-cases",
      parsed.cases.map((item) =>
        record(
          item.case_number,
          "lci-cases",
          {
            case_number: item.case_number,
            case_type: item.case_type,
            status: item.status,
            filed_date: item.filed_date,
            listed_fine_usd: item.listed_fine_usd,
          },
          {
            eventDate: item.filed_date,
            sourceUrl: item.source_url,
            note: "Public LCI case metadata. Listed fines and case status require confirmation at the source; complaint details are omitted.",
          },
        ),
      ),
      {
        partial: parsed.truncated,
        warning: parsed.truncated
          ? "LCI case list was truncated at 200 records."
          : "Only case metadata and listed case fines are returned; licensing status is not checked.",
      },
    ),
    source_url: url,
  };
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

async function cmtFeatures(parcel) {
  const key = `cmt-layer:${parcel.attributes.parcel_id}:${parcel.attributes.objectid}`;
  return cached(key, () =>
    arcgis(LAYERS.cmt, {
      ...polygonParams(parcel),
      outFields:
        "objectid,district_num,district_name,district_manager,dm_email,dm_phone,neighborhood_specialist,ns_email,ns_phone,cmt_chair,cmt_email,cmt_phone",
      resultRecordCount: "100",
    }),
  );
}

async function cmtDistrictRecords(parcel) {
  const data = await cmtFeatures(parcel);
  const features = data.features ?? [];
  const items = features.map(({ attributes: a = {} }) =>
    record(
      a.objectid,
      "cmt",
      {
        district_num: text(a.district_num),
        district_name: text(a.district_name),
      },
      {
        match: "parcel-intersection",
        sourceUrl: LAYERS.cmt,
        note: "City GIS district intersecting the parcel; boundary currency is not independently confirmed.",
      },
    ),
  );
  const ambiguous = new Set(
    features.map((f) => text(f.attributes?.district_num)).filter(Boolean),
  ).size > 1;
  return result("cmt", items, {
    partial: Boolean(data.exceededTransferLimit || ambiguous),
    warning: data.exceededTransferLimit
      ? "CMT district query was truncated."
      : ambiguous
        ? "Parcel intersects more than one CMT district; choose no single district without review."
        : null,
  });
}

async function cmtContactRecords(parcel) {
  const data = await cmtFeatures(parcel);
  const features = data.features ?? [];
  const items = features.map(({ attributes: a = {} }) =>
    record(
      a.objectid,
      "cmt-contacts",
      {
        district_num: text(a.district_num),
        district_name: text(a.district_name),
        district_manager: text(a.district_manager),
        dm_email: text(a.dm_email),
        dm_phone: text(a.dm_phone),
        neighborhood_specialist: text(a.neighborhood_specialist),
        ns_email: text(a.ns_email),
        ns_phone: text(a.ns_phone),
        cmt_chair: text(a.cmt_chair),
        cmt_email: text(a.cmt_email),
        cmt_phone: text(a.cmt_phone),
      },
      {
        match: "parcel-intersection",
        sourceUrl: LAYERS.cmt,
        note: "City GIS contact fields may disagree with the city CMT page. Confirm current people and contact details before use.",
      },
    ),
  );
  return result("cmt-contacts", items, {
    partial: Boolean(items.length || data.exceededTransferLimit),
    warning: items.length
      ? "GIS-published contacts are provisional. Confirm them on the linked city CMT page."
      : null,
  });
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
  const wardContacts = wards.items
    .map((item) => item.attributes)
    .filter(
      (attributes) =>
        Number(attributes.ward) === numbers[0] && text(attributes.alder_name),
    );
  const fallback = () => {
    if (
      !wardContacts.length ||
      new Set(wardContacts.map((item) => text(item.alder_name))).size !== 1
    )
      return unavailable(
        "alders",
        "Board roster is unavailable and the ward layer has no unambiguous alder contact.",
      );
    return result(
      "alders",
      [
        record(numbers[0], "alders", wardContacts[0], {
          match: "city-ward-layer",
          sourceUrl: LAYERS.wards,
          note: "City ward-layer contact. Verify current officeholding with the Board of Alders.",
        }),
      ],
      {
        partial: true,
        warning:
          "Board roster could not be checked; this contact comes from the city ward layer and may be out of date.",
      },
    );
  };
  const html = await fetchBounded(source("alders").url, {
    accept: "text/html",
    maxBytes: 3_000_000,
    timeout: 9000,
  }).catch(() => null);
  if (!html) return fallback();
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
    if (selected.length !== 1) return fallback();
    return result("alders", [
      record(numbers[0], "alders", selected[0].fields, {
        note: "Roster officeholding and election changes require independent confirmation.",
      }),
    ]);
  }
  return fallback();
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

const MUNICIPAL_CATEGORIES = [
  "Document",
  "Application",
  "Complaint",
  "Contact",
  "License",
  "Permit",
  "Certificate",
];

function publicDocumentUrl(row) {
  if (
    ![true, 1, "true", "1"].includes(row?.Public) ||
    [true, 1, "true", "1"].includes(row?.Deleted) ||
    ![true, 1, "true", "1"].includes(row?.UrlExists)
  )
    return null;
  try {
    const url = new URL(row.Url);
    return url.protocol === "https:" &&
      (url.hostname === "municitymedia.com" ||
        url.hostname.endsWith(".municitymedia.com"))
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function municipalChildAttributes(kind, row) {
  if (kind === "Document")
    return {
      document_name: text(row.Name ?? row.FilenameWeb),
      document_type: text(row.Type),
      section: text(row.Section),
      modified_date: date(row.Modified),
      public_document_url: publicDocumentUrl(row),
    };
  if (kind === "Complaint")
    return {
      complaint_number: text(row.ComplaintNo),
      complaint_type: text(row.CompType),
      status: text(row.CompStatus),
      filed_date: date(row.Date),
      recorded_address: text(row.LegalAddress ?? row.Address),
    };
  if (kind === "Contact")
    return {
      contact_name: text(
        row.Fullname ??
          [row.ContactFirstName, row.ContactLastName].filter(Boolean).join(" "),
      ),
      contact_role: text(row.ContactRole),
      contact_type: text(row.ContactType),
      primary_owner: [true, 1, "true", "1"].includes(row.PrimaryOwner),
    };
  return row;
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
  const categoryCounts = Object.fromEntries(
    MUNICIPAL_CATEGORIES.map((kind) => [kind, 0]),
  );
  const missingCategories = MUNICIPAL_CATEGORIES.slice(0, 6).filter(
    (kind) => children[kind] == null,
  );
  const truncatedCategories = [];
  for (const [kind, idKey, dateKeys] of [
    ["Document", "Document_ID", ["Modified", "CreatedDate"]],
    ["Complaint", "Complaint_ID", ["Date", "CreatedDate"]],
    ["Contact", "Contact_ID", ["Modified", "CreatedDate"]],
    ["Permit", "Permit_ID", ["PermitDate", "CreatedDate"]],
    ["Application", "Application_ID", ["ApplicationDate", "CreatedDate"]],
    ["License", "License_ID", ["IssueDate", "CreatedDate"]],
    ["Certificate", "Certificate_ID", ["CertificateDate", "CreatedDate"]],
  ]) {
    const rows = children[kind];
    if (rows == null) continue;
    if (!Array.isArray(rows))
      throw new SourceError(`Vendor ${kind} records are malformed`);
    if (rows.length > 500) truncatedCategories.push(kind);
    for (const [index, row] of rows.slice(0, 500).entries()) {
      if (
        kind === "Document" &&
        (![true, 1, "true", "1"].includes(row?.Public) ||
          [true, 1, "true", "1"].includes(row?.Deleted))
      )
        continue;
      const eventDate =
        dateKeys.map((key) => date(row?.[key])).find(Boolean) ?? null;
      const sourceUrl =
        kind === "Document"
          ? publicDocumentUrl(row) ?? source("municity").url
          : source("municity").url;
      items.push(
        {
          ...record(
            `${kind.toLowerCase()}:${row?.[idKey] ?? index}`,
            "municity",
            municipalChildAttributes(kind, row),
            {
              eventDate,
              sourceUrl,
              note:
                kind === "Complaint"
                  ? "Municipal complaint case metadata; narrative and personal contact fields are omitted."
                  : kind === "Contact"
                    ? "Municipal parcel-linked contact summary; verify the role and whether it is current."
                    : kind === "Document"
                      ? "Public municipal document metadata; the linked file is hosted by the source."
                      : `Vendor ${kind.toLowerCase()} record; recorded status does not prove completion.`,
            },
          ),
          category: kind,
        },
      );
      categoryCounts[kind] += 1;
    }
  }
  return {
    ...result("municity", items, {
      partial: Boolean(missingCategories.length || truncatedCategories.length),
      warning: [
        "Category counts reflect returned public records. Private or deleted documents are omitted.",
        missingCategories.length
          ? `Missing vendor categories: ${missingCategories.join(", ")}.`
          : null,
        truncatedCategories.length
          ? `Vendor categories exceeded the 500-record limit: ${truncatedCategories.join(", ")}.`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    }),
    category_counts: categoryCounts,
    missing_categories: missingCategories,
    truncated_categories: truncatedCategories,
  };
}

async function municipalBusinessRecords(parcel) {
  const vendor = await getSourceRecords("municity", parcel);
  if (vendor.status === "unavailable")
    return unavailable(
      "municipal-business-licenses",
      `Municipal license lookup unavailable: ${vendor.warning}`,
    );
  const items = vendor.items
    .filter(
      (item) =>
        item.source_record_id.startsWith("license:") &&
        text(item.attributes?.BusinessName),
    )
    .map((item) => {
      const a = item.attributes;
      return record(
        item.source_record_id,
        "municipal-business-licenses",
        {
          business_name: text(a.BusinessName),
          license_number: text(a.LicenseNumber),
          license_type: text(a.LicenseType),
          status: text(a.Status),
          recorded_address: text(a.LegalAddress ?? a.Addr1),
          expiration_date: date(a.ExpirationDate),
        },
        {
          eventDate: item.event_date,
          match: "exact",
          sourceUrl: item.source_url,
          note: "Municipal license linked by verified parcel MBLU. Its recorded address and status do not prove where or whether the business currently operates.",
        },
      );
    });
  return result("municipal-business-licenses", items, {
    partial:
      vendor.missing_categories?.includes("License") ||
      vendor.truncated_categories?.includes("License"),
    warning:
      "Named municipal licenses may be historical, expired or void. Confirm status with the city.",
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
  const listedAddress = normalizeAddress(parcel.attributes.property_address);
  const addressPoints = await getSourceRecords("addresses", parcel);
  const pointAddresses = addressPoints.items.map((item) => {
    const a = item.attributes ?? {};
    const street =
      a.full_street_name ?? `${a.street_name ?? ""} ${a.suffix_type ?? ""}`;
    return normalizeAddress(`${a.house_number ?? ""} ${street}`);
  });
  const addresses = [...new Set([listedAddress, ...pointAddresses])].filter(
    (address) => /^\d{1,6}\s+.+$/.test(address),
  );
  if (!addresses.length)
    return unavailable(sourceId, "Parcel has no comparable city address.");
  const selectedAddresses = addresses.slice(0, 15);
  const id = sourceId === "business-master" ? "n7gp-d28j" : "ngch-56tr";
  const field = sourceId === "business-master" ? "billingstreet" : "address";
  const url = new URL(`https://data.ct.gov/resource/${id}.json`);
  const clauses = selectedAddresses.map((address) => {
    const parts = address.match(/^(\d+)\s+(.+)$/);
    const street = parts[2]
      .replace(/\s+(ST|AVE|RD)$/, "")
      .replaceAll(" ", "%");
    return `upper(${field}) like '${sqlString(parts[1] + "%" + street)}%'`;
  });
  url.searchParams.set(
    "$where",
    `(${clauses.join(" OR ")}) AND upper(${sourceId === "business-master" ? "billingcity" : "city"}) = 'NEW HAVEN'`,
  );
  url.searchParams.set("$limit", "200");
  const rows = await fetchJson(url, { timeout: 9000, maxBytes: 4_000_000 });
  if (!Array.isArray(rows))
    throw new SourceError("State source returned malformed rows");
  const selected = new Set(selectedAddresses);
  const matching = rows
    .map((row) => ({ row, address: normalizeAddress(row[field]) }))
    .filter(({ address }) => selected.has(address));
  return result(
    sourceId,
    matching.map(({ row, address }, index) =>
      record(
        row.id ?? row.credentialid ?? index,
        sourceId,
        {
          ...row,
          matched_address: address,
          address_basis:
            address === listedAddress ? "parcel-listed" : "city-address-point",
        },
        {
          match:
            address === listedAddress
              ? "address-candidate"
              : "address-point-candidate",
          eventDate: date(row.date_registration ?? row.issuedate),
          note: `${sourceId === "business-master" ? "Registry billing address" : "State credential address"} matches ${address === listedAddress ? "the listed parcel address" : "a city address point on this parcel"}. This is a candidate connection; it does not establish occupancy, ownership or current use.`,
        },
      ),
    ),
    {
      partial:
        rows.length === 200 ||
        addresses.length > selectedAddresses.length ||
        ["partial", "unavailable"].includes(addressPoints.status),
      warning:
        "Candidates use the parcel-listed address and city address points. Registry billing and credential addresses do not prove business location. Address-point or state result limits may omit candidates.",
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
  cmt: cmtDistrictRecords,
  "cmt-contacts": cmtContactRecords,
  municity: municityRecords,
  "municipal-business-licenses": municipalBusinessRecords,
  "lci-cases": lciCaseRecords,
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
