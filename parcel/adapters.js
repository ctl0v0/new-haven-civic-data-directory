import { load } from "cheerio";
import { LAYERS, source, SOURCES } from "./config.js";
import {
  arcgis,
  cached,
  fetchBounded,
  fetchJson,
  sqlString,
  SourceError,
} from "./http.js";
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
  match: typeof match === "string" ? { method: match } : match,
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
      note: "This dated parcel-layer sale field is a single published attribute. Ownership History rows come from the assessor card when available.",
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

function assessorSaleDate(value) {
  const match = text(value)?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? parsed.toISOString().slice(0, 10)
    : null;
}

function assessorTableRows($, id, expectedHeadings) {
  const table = $(`#${id}`);
  const headings = table.find("tr").first().find("th").toArray()
    .map((cell) => text($(cell).text()));
  if (headings.join("|") !== expectedHeadings.join("|")) return null;
  const rows = table.find("tr").slice(1).toArray().map((row) =>
    $(row).find("td").toArray().map((cell) => text($(cell).text())),
  );
  return rows.every((cells) => cells.length === expectedHeadings.length)
    ? rows
    : null;
}

const assessorPending = new Map();
async function assessorData(parcel) {
  const id = Number(parcel.attributes.parcel_id);
  if (assessorPending.has(id)) return assessorPending.get(id);
  const pending = cached(`assessor-card:${id}`, async () => {
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
    const saleRows = assessorTableRows($, "MainContent_grdSales", [
      "Owner", "Sale Price", "Certificate", "Book & Page", "Instrument", "Sale Date",
    ]);
    const sales = saleRows?.map((cells) => ({
      owner: cells[0],
      sale_price: cells[1],
      certificate: cells[2],
      book_page: cells[3],
      instrument: cells[4],
      sale_date: assessorSaleDate(cells[5]),
      sale_date_as_published: cells[5],
    })) ?? null;
    const valuationTables = [
      ["MainContent_grdCurrentValueAppr", "appraised", true],
      ["MainContent_grdCurrentValueAsmt", "assessed", true],
      ["MainContent_grdHistoryValuesAppr", "appraised", false],
      ["MainContent_grdHistoryValuesAsmt", "assessed", false],
    ].map(([tableId, kind, current]) => ({
      tableId,
      kind,
      current,
      rows: assessorTableRows($, tableId, ["Valuation Year", "Improvements", "Land", "Total"]),
    }));
    return {
      attributes,
      buildingFacts: assessorBuildingFacts($, attributes),
      subareas: assessorSubareas($),
      sales,
      valuationTables,
      url,
    };
  });
  assessorPending.set(id, pending);
  try {
    return await pending;
  } finally {
    assessorPending.delete(id);
  }
}

// Read only uniquely labeled facts from the verified card. Repeated labels on
// multi-building cards are deliberately omitted rather than merged together.
function assessorBuildingFacts($, attributes) {
  const rows = $("tr").toArray().map((row) =>
    $(row).children("td").toArray().map((cell) => text($(cell).text())),
  ).filter((cells) => cells.length === 2 && cells.every(Boolean));
  const field = (keys, label) => {
    const direct = keys.map((key) => attributes[key])
      .filter((value) => value && value.replace(/:$/, "").trim().toLowerCase() !== label.toLowerCase());
    if (direct.length === 1) return direct[0];
    if (direct.length > 1) return null;
    const found = rows.filter(([name]) => name.replace(/:$/, "").trim().toLowerCase() === label.toLowerCase());
    return found.length === 1 ? found[0][1] : null;
  };
  const integer = (value) => /^\d[\d,]*$/.test(value ?? "") ? Number(value.replaceAll(",", "")) : null;
  const decimal = (value) => /^\d[\d,]*(?:\.\d+)?$/.test(value ?? "") ? Number(value.replaceAll(",", "")) : null;
  const count = integer(field(["lblBldgCount", "lblBuildingCount"], "Building Count"));
  const year = integer(field(["lblYearBuilt"], "Year Built"));
  const livingArea = integer(field(["lblLivingArea"], "Living Area"));
  const oneBuilding = count == null || count <= 1;
  const facts = {
    building_count: count,
    year_built: oneBuilding && year && year >= 1600 && year <= 2100 ? year : null,
    living_area_sq_ft: oneBuilding ? livingArea : null,
    land_size_acres: decimal(field(["lblLandSize", "lblLandAcres"], "Size (Acres)")),
    land_use_code: field(["lblLandUseCode"], "Use Code"),
    style: oneBuilding ? field(["lblStyle"], "Style") : null,
    model: oneBuilding ? field(["lblModel"], "Model") : null,
    stories: oneBuilding ? decimal(field(["lblStories"], "Stories")) : null,
  };
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== null));
}

function assessorSubareas($) {
  const tables = [];
  let malformedRows = 0;
  const heading = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const area = (value) => /^\d[\d,]*(?:\.\d+)?$/.test(value ?? "")
    ? Number(value.replaceAll(",", "")) : null;
  for (const table of $("table").toArray()) {
    const rows = $(table).find("tr").toArray()
      .filter((row) => $(row).closest("table")[0] === table);
    const headerIndex = rows.findIndex((row) => {
      const cells = $(row).children("th,td").toArray().map((cell) => heading($(cell).text()));
      return cells.length === 4 && cells[0] === "code" && cells[1] === "description" &&
        cells[2].replaceAll(" ", "") === "grossarea" &&
        cells[3].replaceAll(" ", "") === "livingarea";
    });
    if (headerIndex < 0) continue;
    const tableNumber = tables.length + 1;
    const items = [];
    for (const [rowIndex, row] of rows.slice(headerIndex + 1).entries()) {
      const cells = $(row).children("td").toArray().map((cell) => text($(cell).text()));
      if (!cells.length || !cells[0] || /^(?:total|ttl)\b/i.test(cells[0])) continue;
      if (cells.length !== 4 || !cells[1] || !/^[A-Za-z0-9-]{1,32}$/.test(cells[0])) {
        malformedRows++;
        continue;
      }
      const gross = area(cells[2]), living = area(cells[3]);
      if ((cells[2] && gross === null) || (cells[3] && living === null)) malformedRows++;
      items.push({
        table_number: tableNumber,
        row_number: rowIndex + 1,
        code: cells[0],
        description_as_published: cells[1],
        gross_area_sq_ft: gross,
        gross_area_as_published: cells[2],
        living_area_sq_ft: living,
        living_area_as_published: cells[3],
      });
    }
    tables.push(items);
  }
  return { tables, malformedRows };
}

async function assessorRecord(parcel) {
  const id = Number(parcel.attributes.parcel_id);
  const { attributes, buildingFacts, url } = await assessorData(parcel);
  return result("assessor", [
    record(id, "assessor", { ...attributes, building_facts: buildingFacts }, {
      eventDate: date(attributes.lblSaleDate),
      sourceUrl: url,
      note: "Vision card fields are displayed as published; assessed values are not tax bills.",
    }),
  ]);
}

async function assessorSubareaRecords(parcel) {
  const id = Number(parcel.attributes.parcel_id);
  const { subareas, url } = await assessorData(parcel);
  if (!subareas.tables.length)
    return unavailable("assessor-subareas", "The verified assessor card did not return a readable Building Sub-Areas table.");
  const items = subareas.tables.flatMap((table) => table.map((row) =>
    record(`${id}:${row.table_number}:${row.row_number}`, "assessor-subareas", row, {
      sourceUrl: url,
      note: "Assessor building subarea as published. Gross and living area are not a verified retail lease area or a zoning permission.",
    }),
  ));
  return result("assessor-subareas", items, {
    partial: subareas.malformedRows > 0,
    warning: subareas.malformedRows > 0
      ? `${subareas.malformedRows} assessor subarea rows could not be read completely.`
      : null,
  });
}

async function assessorSalesRecords(parcel) {
  const id = Number(parcel.attributes.parcel_id);
  const { sales, url } = await assessorData(parcel);
  if (!sales)
    return unavailable("assessor-sales", "The assessor card did not return a readable Ownership History table.");
  return result(
    "assessor-sales",
    sales.map((sale, index) =>
      record(`${id}:${sale.sale_date ?? "undated"}:${sale.book_page ?? index}:${index}`, "assessor-sales", sale, {
        eventDate: sale.sale_date,
        sourceUrl: url,
        note: "Ownership History row as published by the assessor. A $0 sale price is not interpreted as market value; the table may not contain every recorded transfer.",
      }),
    ),
  );
}

async function assessorValuationRecords(parcel) {
  const id = Number(parcel.attributes.parcel_id);
  const { valuationTables, url } = await assessorData(parcel);
  const available = valuationTables.filter((table) => table.rows !== null);
  if (!available.length)
    return unavailable("assessor-valuations", "The assessor card did not return readable valuation tables.");
  const items = available.flatMap((table) => table.rows.map((cells, index) =>
    record(`${id}:${table.kind}:${table.current ? "current" : "history"}:${cells[0] ?? "undated"}:${index}`, "assessor-valuations", {
      valuation_year: cells[0],
      valuation_type: table.kind,
      table_section: table.current ? "current" : "history",
      improvements: cells[1],
      land: cells[2],
      total: cells[3],
    }, {
      sourceUrl: url,
      note: "Assessor valuation row as published. Valuation year is not an exact event date, and assessed value is not a tax bill.",
    }),
  ));
  return result("assessor-valuations", items, {
    partial: available.length !== valuationTables.length,
    warning: available.length !== valuationTables.length
      ? "One or more assessor valuation tables were not returned in a readable format."
      : null,
  });
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
            match: {
              method: "exact",
              parcel_field: "parcel_id",
              source_field: "PID",
              value: String(id),
              address_confirmed: true,
            },
            note: "Public LCI case metadata. Listed fines and case status require confirmation at the source; complaint details are omitted.",
          },
        ),
      ),
      {
        partial: parsed.truncated || parsed.missing_sections.length > 0,
        warning: [
          parsed.truncated ? "LCI case list was truncated at 200 records." : null,
          parsed.missing_sections.length
            ? `LCI did not confirm these case sections: ${parsed.missing_sections.join(", ")}.`
            : null,
          "Only case metadata and listed case fines are returned; licensing status is not checked.",
        ].filter(Boolean).join(" "),
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
      record(f.attributes?.objectid ?? f.attributes?.OBJECTID ?? 0, sourceId, f.attributes ?? {}, {
        match: "parcel-intersection",
        sourceUrl: sourceId.includes("historic-districts") &&
          (f.attributes?.objectid ?? f.attributes?.OBJECTID) != null
          ? `${layer}/${f.attributes?.objectid ?? f.attributes?.OBJECTID}`
          : null,
        note: sourceId.includes("historic-districts")
          ? "Mapped district intersection is geographic context; confirm requirements with the responsible office."
          : null,
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

async function brownfieldRecords(parcel) {
  const pid = String(parcel.attributes.parcel_id ?? "").trim();
  const mblu = text(parcel.attributes.mblu);
  if (!pid && !mblu) return unavailable("ct-brownfields", "Parcel has no official identifier for the DEEP Site Parcel field.");
  // Query the bounded New Haven subset because the State and City can print
  // the same MBLU with either slashes or spaces. Never match on site address.
  const features = [];
  let truncated = false;
  for (let offset = 0; offset < 5000; offset += 1000) {
    const data = await arcgis(LAYERS.ctBrownfields, {
      where: "Site_Town IN ('New Haven','NEW HAVEN')",
      outFields: "OBJECTID,Site_Town,Site_Name,Site_Addre,Site_Parce,Parcel_Acr,Program,Program_Ap,Funding_So",
      orderByFields: "OBJECTID",
      resultOffset: String(offset),
      resultRecordCount: "1000",
    });
    features.push(...(data.features ?? []));
    if (!data.exceededTransferLimit && (data.features ?? []).length < 1000) break;
    if (offset === 4000) truncated = true;
  }
  const rows = features.filter(({ attributes: a }) => {
    const siteParcel = text(a?.Site_Parce);
    return text(a?.Site_Town)?.toUpperCase() === "NEW HAVEN" && Boolean(siteParcel) && (
      [pid.toUpperCase(), mblu?.toUpperCase()].filter(Boolean).includes(siteParcel.toUpperCase()) ||
      (Boolean(mblu) && printKey(siteParcel) === printKey(mblu))
    );
  });
  return result("ct-brownfields", rows.map(({ attributes: a }) =>
    record(a.OBJECTID, "ct-brownfields", {
      site_name: text(a.Site_Name),
      site_address_as_published: text(a.Site_Addre),
      site_parcel_as_published: text(a.Site_Parce),
      parcel_acres_as_published: a.Parcel_Acr ?? null,
      program: text(a.Program),
      program_approval_date_as_published: text(a.Program_Ap),
      funding_source: text(a.Funding_So),
      inventory_updated: "2026-02-19",
    }, {
      match: text(a.Site_Parce)?.toUpperCase() === pid.toUpperCase() ? "assessor-id-exact" : "mblu-exact",
      sourceUrl: `${LAYERS.ctBrownfields}/${a.OBJECTID}`,
      note: "DEEP inventory listing for the published parcel ID; it does not establish current contamination or cleanup status.",
    }),
  ), {
    partial: truncated,
    warning: truncated ? "DEEP New Haven query exceeded the 5,000-row request limit." : null,
  });
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
  "Occupant",
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
  if (kind === "Occupant")
    return {
      occupant_name: text(row.Name),
      business_name: text(row.BusinessName),
      occupancy_type: text(row.OccupancyType),
      recorded_address: text(row.LegalAddress ?? row.Addr1),
      inactive: row.InActive == null ? null : [true, 1, "true", "1"].includes(row.InActive),
      created_date: date(row.CreatedDate),
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
  const parcelUrl = `https://www.municityconnect.com/#/app/NewHavenCityCT/entity/Parcel/${Number(vendor.Parcel_ID)}`;
  const items = [];
  const categoryCounts = Object.fromEntries(
    MUNICIPAL_CATEGORIES.map((kind) => [kind, null]),
  );
  const missingCategories = MUNICIPAL_CATEGORIES.filter(
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
    ["Occupant", "Occupant_ID", ["CreatedDate"]],
    ["Certificate", "Certificate_ID", ["CertificateDate", "CreatedDate"]],
  ]) {
    const rows = children[kind];
    if (rows == null) continue;
    if (!Array.isArray(rows))
      throw new SourceError(`Vendor ${kind} records are malformed`);
    categoryCounts[kind] = 0;
    if (rows.length > 500) truncatedCategories.push(kind);
    for (const [index, row] of rows.slice(0, 500).entries()) {
      if (
        text(row?.Parcel_ID) &&
        Number(row.Parcel_ID) !== Number(vendor.Parcel_ID)
      )
        continue;
      if (
        kind === "Document" &&
        (![true, 1, "true", "1"].includes(row?.Public) ||
          [true, 1, "true", "1"].includes(row?.Deleted))
      )
        continue;
      if (
        kind === "Occupant" &&
        [true, 1, "true", "1"].includes(row?.Deleted)
      )
        continue;
      const eventDate =
        dateKeys.map((key) => date(row?.[key])).find(Boolean) ?? null;
      const sourceUrl =
        kind === "Document"
          ? publicDocumentUrl(row) ?? parcelUrl
          : parcelUrl;
      items.push(
        {
          ...record(
            `${kind.toLowerCase()}:${row?.[idKey] ?? index}`,
            "municity",
            municipalChildAttributes(kind, row),
            {
              eventDate,
              sourceUrl,
              match: {
                method: "exact",
                parcel_field: "mblu",
                source_field: "PrintKey",
                value: key,
                vendor_parcel_id: Number(vendor.Parcel_ID),
              },
              note:
                kind === "Complaint"
                  ? "Municipal complaint case metadata; narrative and personal contact fields are omitted."
                  : kind === "Contact"
                    ? "Municipal parcel-linked contact summary; verify the role and whether it is current."
                    : kind === "Document"
                      ? "Public municipal document metadata; the linked file is hosted by the source."
                      : kind === "Occupant"
                        ? "Municipal occupant row returned for this verified parcel. An absent inactive flag does not establish current occupancy."
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
          match: item.match,
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
      vendor.missing_categories?.includes("License")
        ? "The vendor omitted its License category for this parcel, so absence of municipal licenses cannot be confirmed."
        : vendor.truncated_categories?.includes("License")
          ? "The vendor License category exceeded the 500-record limit; results are incomplete."
          : "Named municipal licenses may be historical, expired or void. Confirm status with the city.",
  });
}

async function municipalOccupantRecords(parcel) {
  const vendor = await getSourceRecords("municity", parcel);
  if (vendor.status === "unavailable")
    return unavailable(
      "municipal-occupants",
      `Municipal occupant lookup unavailable: ${vendor.warning}`,
    );
  const items = vendor.items
    .filter((item) => item.category === "Occupant")
    .map((item) =>
      record(item.source_record_id, "municipal-occupants", item.attributes, {
        eventDate: item.event_date,
        match: item.match,
        sourceUrl: item.source_url,
        note: "Municipal occupant row attached to the verified parcel. The source name and inactive flag do not establish a current tenant or business operation.",
      }),
    );
  const missing = vendor.missing_categories?.includes("Occupant");
  const truncated = vendor.truncated_categories?.includes("Occupant");
  return result("municipal-occupants", items, {
    partial: missing || truncated,
    warning: missing
      ? "The vendor omitted its Occupant category for this parcel; absence of occupant rows cannot be confirmed."
      : truncated
        ? "The vendor Occupant category exceeded the 500-record limit; results are incomplete."
        : "Municipal occupant rows can be historical. Only source-reported inactive flags are shown.",
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
        note: "Managed-lot status does not establish current parcel use.",
      }),
    ),
    { partial: Boolean(data.exceededTransferLimit) },
  );
}

const ADAPTERS = Object.freeze({
  parcels: parcelRecord,
  addresses: addressRecords,
  assessor: assessorRecord,
  "assessor-subareas": assessorSubareaRecords,
  "assessor-sales": assessorSalesRecords,
  "assessor-valuations": assessorValuationRecords,
  zoning: (p) => boundaryRecords("zoning", LAYERS.zoning, p),
  wards: (p) => boundaryRecords("wards", LAYERS.wards, p),
  neighborhoods: (p) =>
    boundaryRecords("neighborhoods", LAYERS.neighborhoods, p),
  "local-historic-districts": (p) =>
    boundaryRecords("local-historic-districts", LAYERS.localHistoricDistricts, p),
  "state-historic-districts": (p) =>
    boundaryRecords("state-historic-districts", LAYERS.stateHistoricDistricts, p),
  "ct-brownfields": brownfieldRecords,
  alders: alderRecords,
  cmt: cmtDistrictRecords,
  "cmt-contacts": cmtContactRecords,
  municity: municityRecords,
  "municipal-business-licenses": municipalBusinessRecords,
  "municipal-occupants": municipalOccupantRecords,
  "lci-cases": lciCaseRecords,
  "managed-lots": managedLotRecords,
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
