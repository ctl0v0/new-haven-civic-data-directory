import { load } from "cheerio";
import { normalizeAddress } from "./resolve.js";
import { SourceError } from "./http.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const caseNumber = (value) => clean(value).toUpperCase();

function publicCaseUrl(href, propertyUrl) {
  if (!href) return propertyUrl;
  try {
    const url = new URL(href, propertyUrl);
    return url.origin === "https://lci.city" &&
      /^\/public\/case\/[A-Z0-9-]+$/i.test(url.pathname)
      ? url.href
      : propertyUrl;
  } catch {
    return propertyUrl;
  }
}

export function parseLciProperty(html, parcel, propertyUrl) {
  const $ = load(html);
  $("script,style,noscript").remove();
  const pid = Number(parcel.attributes.parcel_id);
  const publishedPid = $("body").text().match(/PID\s+(\d{1,12})\b/i)?.[1];
  if (!publishedPid || Number(publishedPid) !== pid)
    throw new SourceError("LCI page did not confirm the assessor PID");
  const expectedAddress = normalizeAddress(parcel.attributes.property_address);
  const publishedAddress = normalizeAddress($("h1").first().text());
  if (!expectedAddress || !publishedAddress || publishedAddress !== expectedAddress)
    throw new SourceError("LCI page did not confirm the parcel address");

  let section = null;
  let caseTables = 0;
  let truncated = false;
  const fines = new Map();
  const cases = [];
  // Only known public table columns are read. Case pages and their narratives
  // are never fetched or copied into the API response.
  $("h2,h3,h4,table").each((_, element) => {
    if (element.tagName !== "table") {
      const heading = clean($(element).text());
      section = /housing code cases/i.test(heading)
        ? "housing_code"
        : /anti-blight cases/i.test(heading)
          ? "anti_blight"
          : /money owed to the city/i.test(heading)
            ? "listed_fines"
            : null;
      return;
    }
    if (!section) return;
    const rows = $(element).find("tr").toArray();
    if (!rows.length) return;
    const headers = $(rows[0])
      .find("th,td")
      .toArray()
      .map((cell) => clean($(cell).text()).toLowerCase());
    const numberIndex = headers.findIndex((h) => /^(case|case #)$/.test(h));
    if (numberIndex < 0) return;
    const statusIndex = headers.indexOf("status");
    const dateIndex = headers.indexOf("date filed");
    const amountIndex = headers.indexOf("amount");
    if (section !== "listed_fines" && statusIndex >= 0 && dateIndex >= 0)
      caseTables++;
    if (rows.length > 501) truncated = true;
    for (const row of rows.slice(1, 501)) {
      const cells = $(row).find("th,td").toArray();
      const number = caseNumber($(cells[numberIndex]).text());
      if (!/^[A-Z]{1,4}-\d{2,4}-\d{1,8}$/.test(number)) continue;
      if (section === "listed_fines" && amountIndex >= 0) {
        const amount = clean($(cells[amountIndex]).text());
        if (/^\$[\d,]+\.\d{2}$/.test(amount))
          fines.set(number, Number(amount.slice(1).replaceAll(",", "")));
      } else if (section !== "listed_fines" && statusIndex >= 0 && dateIndex >= 0) {
        const filed = clean($(cells[dateIndex]).text());
        const timestamp = Date.parse(filed);
        cases.push({
          case_number: number,
          case_type: section,
          status: clean($(cells[statusIndex]).text()).slice(0, 80) || null,
          filed_date: Number.isFinite(timestamp)
            ? new Date(timestamp).toISOString().slice(0, 10)
            : null,
          source_url: publicCaseUrl($(cells[numberIndex]).find("a").attr("href"), propertyUrl),
        });
      }
    }
  });
  if (!caseTables)
    throw new SourceError("LCI page did not expose a recognized case table");
  return {
    cases: cases.slice(0, 200).map((item) => ({
      ...item,
      listed_fine_usd: fines.get(item.case_number) ?? null,
    })),
    truncated: truncated || cases.length > 200,
  };
}
