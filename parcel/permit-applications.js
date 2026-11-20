import { z } from "zod";
import inventory from "../data/permit-applications.json" with { type: "json" };
import { questionPermitCatalog } from "../search-index/ask.js";
import { cached, SourceError } from "./http.js";
import { MUNICIPAL_PERMIT_TYPES_URL } from "./permit-types.js";
import { fingerprint, makeSearchCursor, readSearchCursor } from "./search-cursor.js";

const routes = ["citysquared", "department_portal", "in_person", "email", "mail", "directory"];
const associations = ["verified_application", "shared_instructions", "no_verified_application"];
const text = z.string().trim().min(1).max(160);
const identity = (value) => String(value ?? "").trim().toLowerCase();
const allowedHosts = new Set(["www.newhavenct.gov", "www.citysquared.com", "www.newhavenadu.com", "portal.ct.gov"]);

export const permitApplicationQuerySchema = z.strictObject({
  view: z.enum(["permit_types", "directory"]).default("permit_types"),
  q: text.optional(), department: text.optional(),
  permit_type: text.optional(), permit_type_id: z.string().regex(/^\d{1,12}$/).optional(),
  status: z.enum(associations).optional(), route: z.enum(routes).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().min(1).max(3000).optional(),
});

function checkedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedHosts.has(url.hostname) &&
      !url.username && !url.password && !url.port &&
      !/\/entity\/(?:application|permit)(?:\/|$)/i.test(decodeURIComponent(url.pathname + url.hash));
  } catch { return false; }
}

export function validatePermitApplicationInventory(data = inventory) {
  const { sources, applications, reviewed_on } = data;
  if (!z.iso.date().safeParse(reviewed_on).success || !sources.citysquared ||
      Object.values(sources).some(({ url }) => !checkedUrl(url)))
    throw new Error("Application inventory requires official source URLs and a review date");
  const ids = new Set();
  for (const entry of applications) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id) || ids.has(entry.id) ||
        !Object.hasOwn(sources, entry.source) || !routes.includes(entry.route) ||
        entry.instructions?.some(({ source }) => !Object.hasOwn(sources, source)) ||
        entry.forms?.some(({ url }) => !checkedUrl(url)) ||
        (entry.start_url && (!checkedUrl(entry.start_url) || entry.route !== "citysquared" ||
          new URL(entry.start_url).hostname !== "www.citysquared.com" ||
          new URL(entry.start_url).search || !entry.start_verified_on ||
          !z.iso.date().safeParse(entry.start_verified_on).success)))
      throw new Error(`Invalid application directory entry ${entry.id}`);
    ids.add(entry.id);
  }
}

validatePermitApplicationInventory();

async function sourceReachability(id, source) {
  return cached(`permit-application-source-v1:${id}:${source.url}`, async () => {
    const checked_at = new Date().toISOString();
    try {
      const response = await fetch(source.url, {
        signal: AbortSignal.timeout(4000), redirect: "manual", cache: "no-store",
        headers: { accept: "text/html,application/pdf" },
      });
      await response.body?.cancel();
      return { status: response.ok ? "reachable" : "unverified", checked_at,
        ...(response.ok ? {} : { warning: `Official URL returned HTTP ${response.status}.` }) };
    } catch {
      return { status: "unverified", checked_at, warning: "The official URL could not be checked." };
    }
  }, 6 * 3600);
}

function directoryApplication(entry, checks) {
  const source = checks.get(entry.source);
  const portal = checks.get("citysquared");
  const viaCitySquared = entry.route === "citysquared";
  const unavailable = source.status === "unverified" || (viaCitySquared && portal.status === "unverified");
  const start = viaCitySquared ? {
    method: entry.start_url ? "type_specific" : "portal_entry",
    url: entry.start_url ?? portal.url,
    ...(entry.portal_selection ? { selection: entry.portal_selection } : {}),
    ...(entry.start_verified_on ? { verified_on: entry.start_verified_on } : {}),
  } : { method: "city_instructions", url: source.url };
  return {
    application_id: entry.id, title: entry.title, department: entry.department,
    directory_source: source, filing_route: entry.route,
    start: { ...start, availability: unavailable || entry.route === "directory" ? "unverified" : "published_route" },
    scope: entry.scope ?? null,
    instructions: (entry.instructions ?? []).map(({ source, text }) => ({ text, source: checks.get(source) })),
    forms: [...(entry.forms ?? []), ...(entry.form_listings ?? []).map((title) =>
      ({ title, url: source.url, kind: "directory_listing" }))],
    reviewed_on: inventory.reviewed_on,
  };
}

function associationFor(definition, type) {
  if (definition.permit_types?.some((name) => identity(name) === identity(type.name)))
    return "verified_application";
  if (definition.shared_types?.some((name) => identity(name) === identity(type.name)) ||
      definition.shared_groups?.some((group) => identity(group) === identity(type.group)))
    return "shared_instructions";
  return null;
}

function strongestAssociation(rows) {
  return associations.find((status) => rows.some(({ association }) => association === status)) ?? associations[2];
}

function publishedDeleted(value) {
  return value === true || value === 1 || value === "1";
}

export async function listPermitApplications(input = {}, {
  catalog = questionPermitCatalog, check = sourceReachability,
} = {}) {
  const parsed = permitApplicationQuerySchema.safeParse(input);
  if (!parsed.success) throw new SourceError("Invalid permit application filters", 400);
  const { cursor, limit, ...filters } = parsed.data;
  const { view, q, department, permit_type, permit_type_id, status, route } = filters;
  const [official, checks] = await Promise.all([
    Promise.resolve().then(() => catalog()).catch(() => null),
    Promise.all(Object.entries(inventory.sources).map(async ([id, source]) => {
      const result = await Promise.resolve().then(() => check(id, source)).catch(() =>
        ({ status: "unverified", warning: "The official URL could not be checked." }));
      return [id, { id, ...source, ...result, last_reviewed_on: inventory.reviewed_on }];
    })).then((rows) => new Map(rows)),
  ]);
  const types = (official?.groups ?? []).flatMap(({ name: group, types }) => types.map((type) => ({ ...type, group })));
  const directory = inventory.applications.map((entry) => ({
    entry, value: directoryApplication(entry, checks), linked_types: [],
  }));
  const typeRows = types.map((type) => {
    const applications = directory.flatMap(({ entry, value, linked_types }) => {
      const association = associationFor(entry, type);
      if (!association) return [];
      const deleted = type.deleted_as_published ?? null;
      linked_types.push({ name: type.name, permit_type_id: type.permit_type_id ?? null,
        group: type.group, deleted_as_published: deleted, association });
      return [{ ...value, association,
        ...(publishedDeleted(deleted) ? { start: { ...value.start, availability: "unverified" } } : {}),
      }];
    });
    return {
      permit_type: type.name, permit_type_id: type.permit_type_id ?? null, permit_group: type.group,
      deleted_as_published: type.deleted_as_published ?? null, status: strongestAssociation(applications), applications,
    };
  }).sort((a, b) => a.permit_type.localeCompare(b.permit_type) ||
    String(a.permit_type_id).localeCompare(String(b.permit_type_id)));
  const directoryRows = directory.map(({ value, linked_types }) => ({
    ...value, linked_types: linked_types.sort((a, b) => a.name.localeCompare(b.name)),
    status: official ? strongestAssociation(linked_types) : null,
  })).sort((a, b) => a.department.localeCompare(b.department) || a.title.localeCompare(b.title) ||
    a.application_id.localeCompare(b.application_id));
  const matchesType = ({ name, permit_type_id: id }) =>
    (!permit_type || identity(name) === identity(permit_type)) && (!permit_type_id || String(id) === permit_type_id);
  const matchesEntry = (entry) => (!department || identity(entry.department) === identity(department)) &&
    (!route || entry.filing_route === route);
  const matchesText = (...values) => !q || identity(values.filter(Boolean).join(" ")).includes(identity(q));

  const selected = view === "directory"
    ? directoryRows.flatMap((row) => {
      const linked_types = row.linked_types.filter(matchesType);
      const association = official ? strongestAssociation(linked_types) : null;
      if ((status && status !== association) || !matchesEntry(row) ||
          ((permit_type || permit_type_id) && !linked_types.length) ||
          !matchesText(row.title, row.department, ...linked_types.map(({ name }) => name))) return [];
      return [{ ...row, linked_types, status: association }];
    })
    : typeRows.flatMap((row) => {
      if (!matchesType({ name: row.permit_type, permit_type_id: row.permit_type_id }))
        return [];
      const applications = row.applications.filter(matchesEntry);
      const association = strongestAssociation(applications);
      if ((status && status !== association) || ((department || route) && !applications.length) ||
          !matchesText(row.permit_type, row.permit_group, ...applications.flatMap(({ title, department }) => [title, department])))
        return [];
      return [{ ...row, applications, status: association }];
    });
  const queryHash = fingerprint({ kind: "permit-applications", ...filters });
  const sourceHash = fingerprint({ inventory, retrieved_at: official?.retrieved_at ?? null, types });
  const { offset } = readSearchCursor(cursor, queryHash, sourceHash);
  const more = offset + limit < selected.length;
  return {
    view, items: selected.slice(offset, offset + limit), filtered_total: selected.length,
    next_cursor: more ? makeSearchCursor({ v: 1, query: queryHash, source: sourceHash,
      offset: offset + limit, expires: Date.now() + 30 * 60_000 }) : null,
    coverage: {
      catalog: { status: !official ? "unavailable" : official.partial ? "partial" : "checked",
        source_url: MUNICIPAL_PERMIT_TYPES_URL, retrieved_at: official?.retrieved_at ?? null,
        method: official ? official.method ?? "live" : null },
      reviewed_on: inventory.reviewed_on,
      permit_type_count: official ? types.length : null,
      type_counts: official ? Object.fromEntries(associations.map((status) =>
        [status, typeRows.filter((row) => row.status === status).length])) : null,
      directory_entry_count: directoryRows.length,
      directory_entries_without_type_link: official && !official.partial
        ? directoryRows.filter((row) => !row.linked_types.length).length : null,
      citysquared_menu: { status: inventory.citysquared_menu_status, note: inventory.citysquared_menu_note,
        source_url: checks.get("citysquared").url, last_reviewed_on: inventory.reviewed_on },
      source_checks: [...checks.values()],
    },
    filters: { departments: [...new Set(directoryRows.map(({ department }) => department))].sort() },
  };
}
