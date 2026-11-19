import { fetchJson, SourceError } from "../parcel/http.js";
import { normalizeAddress } from "../parcel/resolve.js";

export const STATE_ROSTERS = Object.freeze({
  "ct-liquor-permits": { dataset: "gwv2-eswx", city: "permit_city",
    site: "permit_address", credential: "credential", status: "status",
    type: null, event_date: "effective_date",
    fields: ["dba", "backer", "permit_address", "permit_city", "credential",
      "effective_date", "expire_date", "status", "reason"] },
  "ct-child-care-licenses": { dataset: "h8mr-dn95", city: "city",
    site: "address2", credential: "licensenumber", status: "status",
    type: "licensetype", event_date: "effectivedate",
    fields: ["name", "address2", "city", "licensenumber", "licensetype",
      "effectivedate", "expirationdate", "status", "statusreason"] },
  "ct-cannabis-retail": { dataset: "42yd-3x3d", city: "city",
    site: "street", credential: "license", status: null,
    type: "type", event_date: null,
    fields: ["business", "dba", "street", "city", "license", "type"] },
});

function sourceDate(value) {
  if (!value) return null;
  const raw = String(value);
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/);
  if (iso) return iso[1];
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!us) return null;
  const date = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const parsed = Date.parse(`${date}T00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date ? date : null;
}

export async function stateRosterInventory(sourceId, { get = fetchJson } = {}) {
  const source = STATE_ROSTERS[sourceId];
  if (!source) throw new SourceError("Unknown State location roster", 400);
  const base = `https://data.ct.gov/resource/${source.dataset}.json`;
  const where = `upper(${source.city})='NEW HAVEN'`;
  const countUrl = new URL(base);
  countUrl.searchParams.set("$select", "count(*)");
  countUrl.searchParams.set("$where", where);
  const [countRows, info] = await Promise.all([
    get(countUrl, { timeout: 15000, maxBytes: 100000 }),
    get(`https://data.ct.gov/api/views/${source.dataset}.json`,
      { timeout: 15000, maxBytes: 2_000_000 }),
  ]);
  const count = Number(countRows?.[0]?.count);
  const publishedFields = new Set((info?.columns ?? []).map((column) => column.fieldName));
  if (!Number.isFinite(info?.rowsUpdatedAt) || info.rowsUpdatedAt <= 0)
    throw new SourceError("State roster publisher update time is unavailable");
  if (!Number.isSafeInteger(count) || count < 0 ||
      source.fields.some((field) => !publishedFields.has(field)))
    throw new SourceError("State roster count or published field schema is unavailable");
  return { source_id: sourceId, source, base, where, source_count: count,
    source_updated_at: Number.isFinite(info.rowsUpdatedAt) && info.rowsUpdatedAt > 0
      ? new Date(info.rowsUpdatedAt * 1000).toISOString() : null };
}

export async function stateRosterRows(inventory, offset, limit = 500, { get = fetchJson } = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > inventory.source_count ||
      !Number.isSafeInteger(limit) ||
      limit < 1 || limit > 500) throw new SourceError("Invalid State roster page", 400);
  const url = new URL(inventory.base);
  url.searchParams.set("$select", [":id", ...inventory.source.fields].join(","));
  url.searchParams.set("$where", inventory.where);
  url.searchParams.set("$order", ":id");
  url.searchParams.set("$offset", String(offset));
  url.searchParams.set("$limit", String(limit));
  const rows = await get(url, { timeout: 20000, maxBytes: 4_000_000 });
  if (!Array.isArray(rows) || rows.length !== Math.min(limit, inventory.source_count - offset))
    throw new SourceError("State roster page did not match the official count");
  return rows.map((row) => {
    const id = row[":id"];
    if (typeof id !== "string" || !/^row-[A-Za-z0-9_.~-]+$/.test(id) ||
        String(row[inventory.source.city] ?? "").toUpperCase() !== "NEW HAVEN")
      throw new SourceError("State roster row ID or city did not match the official page");
    const fields = Object.fromEntries(Object.entries(row).filter(([key]) => key !== ":id"));
    fields.normalized_site_address = normalizeAddress(row[inventory.source.site]);
    const sourceUrl = new URL(inventory.base);
    sourceUrl.searchParams.set("$where", `:id='${id}'`);
    return { record_id: id, source_url: sourceUrl.href,
      published_type: inventory.source.type ? row[inventory.source.type] ?? null : null,
      published_status: inventory.source.status ? row[inventory.source.status] ?? null : null,
      event_date: inventory.source.event_date ? sourceDate(row[inventory.source.event_date]) : null,
      fields };
  });
}
