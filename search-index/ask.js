import { generateText, Output } from "ai";
import { z } from "zod";
import { getDataContext, commercialUseCodes, reviewedUseCodeValues } from "../parcel/data-context.js";
import { MUNICIPAL_PERMIT_TYPES_URL, municipalPermitTypes } from "../parcel/permit-types.js";
import { SourceError } from "../parcel/http.js";
import { searchParcelPermits } from "../parcel/permit-search.js";
import { indexQuery, indexConfigured } from "./db.js";
import { searchIndexedParcels, searchIndexedRecords } from "./search.js";
import { MUNICIPAL_LICENSE_SOURCE } from "./municipal-licenses.js";

const interpretationSchema = z.object({
  intent: z.enum(["search", "clarify", "unsupported"]),
  commercial: z.boolean(),
  permit_type: z.string().nullable(),
  permit_group: z.string().nullable(),
  permit_status: z.string().nullable(),
  permit_days: z.number().int().min(1).max(366).nullable(),
  neighborhood: z.string().nullable(),
  clarification: z.string().nullable(),
});
const editedFiltersSchema = interpretationSchema.omit({ intent: true, clarification: true }).strict();

export function newHavenToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function recentCalendarDates(days, now = new Date()) {
  if (!Number.isInteger(days) || days < 1 || days > 366)
    throw new SourceError("Invalid relative date window", 400);
  const to = newHavenToday(now);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86400_000)
    .toISOString().slice(0, 10);
  return { from, to, meaning: `${days} New Haven calendar dates including today` };
}

// A small exact grammar makes the first spoken example testable without an AI
// gateway. Other phrasing still goes through the constrained interpreter.
// Unrecognized words never get silently discarded from the question.
export function interpretBaselineQuestion(question) {
  const text = String(question ?? "").trim().toLowerCase().replace(/[?.!]$/, "")
    .replace(/\s+/g, " ");
  const match = text.match(/^(?:show(?: me)?|find|list) (?:all )?(?:the )?(?:parcels,? )?(commercial )?parcels (?:that )?(?:have had|had|have|with) electrical permits (?:pulled )?in (?:the )?(?:past|last|previous) (\d{1,3}) days?$/);
  if (!match) return null;
  const days = Number(match[2]);
  if (days < 1 || days > 366) return null;
  return { intent: "search", commercial: Boolean(match[1]),
    permit_type: null, permit_group: "Electrical", permit_status: null,
    permit_days: days, neighborhood: null, clarification: null };
}

function businessLicenseQuestion(question) {
  const match = question.match(/^(?:show(?: me)?|find|list) (?:all )?(?:the )?(?:new|recent|issued) (?:city |municipal )?business licenses (?:issued )?in (?:the )?([a-z][a-z .'-]{1,70}?)(?: neighborhood)? in (?:the )?(?:past|last|previous) (\d{1,3}) days?[?.!]?$/i);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 366) return null;
  return { neighborhood: match[1].trim(), days: Number(match[2]) };
}

function permitContactQuestion(question) {
  const match = question.trim().replace(/\s+/g, " ").match(
    /^(?:show(?: me)?|find|list) (?:all )?(?:the )?(?:public )?([a-z][a-z -]{1,60}?) contacts (?:who did|for|on|listed on) (.+?) (?:in|over|during) (?:the )?(?:past|last|previous) (\d{1,3}) days?[?.!]?$/i);
  if (!match || Number(match[3]) < 1 || Number(match[3]) > 366) return null;
  const type = match[2].replace(/\s+permits?$/i, "").trim();
  const replacement = /^water[ -]+heater replacements?$/i.test(type);
  return { role: match[1].trim(),
    permitType: /^water[ -]+heater$/i.test(type) || replacement ? "Water Heater" : type,
    ...(replacement ? { terms: ["replace", "replacing", "change out", "change-out"] } : {}),
    days: Number(match[3]) };
}

export async function interpretQuestion(question, typeNames, groupNames) {
  const baseline = interpretBaselineQuestion(question);
  if (baseline && groupNames.includes("Electrical")) return baseline;
  const context = getDataContext().entries.filter((entry) => ["city-use-code",
    "municipal-permit-type", "municipal-permit-group", "municipal-permit-date", "municipal-permit-status",
    "city-neighborhood", "search-coverage"].includes(entry.id));
  const { output } = await generateText({
    model: "openai/gpt-4.1-mini",
    maxOutputTokens: 256,
    abortSignal: AbortSignal.timeout(12_000),
    output: Output.object({ schema: interpretationSchema }),
    system: `Translate a New Haven parcel question to a bounded search intent. Use only the listed official field meanings and published permit catalog. Do not answer the question or invent records. Use permit_group Electrical for broad "electrical permits"; the exact PermitType "Electrical Permit" is only one of many types in that group. Use permit_type only when the question names one exact published type. Never set both. If the type or meaning is ambiguous, return clarify. 'Pulled' means PermitDate, not issued. A relative number of days is a calendar-date window; return the number, not calculated dates. Commercial is a service grouping of reviewed City use codes, never zoning or units_commercial. Only commercial, permit group/type/status/date, and City neighborhood are supported. Return unsupported for other requested criteria. Context: ${JSON.stringify(context)}. Official permit groups: ${JSON.stringify(groupNames)}. Official permit type names: ${JSON.stringify(typeNames)}.`,
    prompt: question,
  });
  return output;
}

function canonicalType(name, names) {
  return names.find((item) => item.toUpperCase() === String(name ?? "").trim().toUpperCase()) ?? null;
}

export async function questionPermitCatalog({ query = indexQuery,
  live = municipalPermitTypes, configured = indexConfigured,
  now = new Date() } = {}) {
  if (configured()) try {
    const [run] = await query(`SELECT r.id, r.status, r.expected_count,
      r.returned_count, r.finished_at FROM search_active_runs a
      JOIN search_source_runs r ON r.id = a.run_id
      WHERE a.source_id = 'municity-permit-types' AND a.scope_key = 'all'`);
    if (run?.status === "complete" &&
        Number(run.expected_count) === Number(run.returned_count) &&
        now.getTime() - Date.parse(run.finished_at) <= 48 * 3600_000) {
      const rows = await query(`SELECT record_id, fields->>'group' AS group_name
        FROM search_records WHERE run_id = $1 AND source_id = 'municity-permit-types'
        ORDER BY record_id`, [run.id]);
      if (rows.length === Number(run.returned_count) &&
          rows.every((row) => row.record_id) &&
          new Set(rows.map((row) => row.record_id.toUpperCase())).size === rows.length) {
        const groups = new Map();
        for (const row of rows) {
          if (!groups.has(row.group_name)) groups.set(row.group_name, []);
          groups.get(row.group_name).push({ name: row.record_id });
        }
        return { partial: false, source_url: MUNICIPAL_PERMIT_TYPES_URL,
          retrieved_at: run.finished_at, method: "verified_index", distinct_type_names: rows.length,
          groups: [...groups].map(([name, types]) =>
          ({ name, types })) };
      }
    }
  } catch { /* Check the live official catalog below. */ }
  return live();
}

export async function askIndexedParcels(input = {}, { interpret = interpretQuestion,
  catalog = questionPermitCatalog, search = searchIndexedParcels,
  searchRecords = searchIndexedRecords,
  searchPermitWork = searchParcelPermits,
  query = indexQuery, now = new Date() } = {}) {
  const edited = input.filters != null;
  const question = edited ? "Edited search filters" : String(input.question ?? "").trim();
  if (!question || question.length > 500 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(question))
    throw new SourceError("Question must be 1–500 characters", 400);
  const license = !edited && businessLicenseQuestion(question.replace(/\s+/g, " "));
  if (license) {
    const window = recentCalendarDates(license.days, now);
    const criteria = { source_id: MUNICIPAL_LICENSE_SOURCE, neighborhood: license.neighborhood,
      event_date_from: window.from, event_date_to: window.to, limit: 25 };
    const searchResult = await searchRecords(criteria);
    const checksComplete = searchResult.coverage?.source_checks?.every(({ status }) => status === "complete");
    return { status: searchResult.complete_for_query ? "ready" :
      checksComplete && searchResult.next_cursor ? "paging" : "coverage_limited",
      question, interpretation: { intent: "search", neighborhood: license.neighborhood,
        activity: "municipal_business_license_issuance", date_field: "IssueDate", date_window: window },
      criteria, search_result: searchResult,
      context: getDataContext({ source_id: MUNICIPAL_LICENSE_SOURCE }).entries };
  }
  let typeNames, groupNames;
  try {
    const listed = await catalog();
    if (listed.partial || !Array.isArray(listed.groups)) throw Error("Incomplete catalog");
    typeNames = listed.groups.flatMap((group) => group.types.map((type) => type.name));
    groupNames = listed.groups.map((group) => group.name).filter(Boolean);
  } catch {
    return { status: "unavailable", question,
      reason: "The official municipal permit type catalog could not be checked." };
  }
  const contact = !edited && permitContactQuestion(question);
  if (contact) {
    const permitType = canonicalType(contact.permitType, typeNames);
    if (!permitType) return { status: "clarify", question,
      clarification: "Choose an exact type from the official permit catalog for a contact search." };
    const window = recentCalendarDates(contact.days, now);
    const criteria = { scope: "city", permit_types: [permitType],
      permit_date_from: window.from, permit_date_to: window.to,
      contact_role: contact.role, require_contact_role: true, scan_limit: 6,
      ...(contact.terms ? { permit_description_terms: contact.terms } : {}) };
    const searchResult = await searchPermitWork(criteria);
    return { status: searchResult.complete_for_query ? "ready" :
      searchResult.next_cursor ? "paging" : "coverage_limited", question, search_method: "contacts",
      interpretation: { intent: "search", activity: "permit_contacts", permit_type: permitType,
        contact_role: contact.role, date_field: "PermitDate", date_window: window,
        ...(contact.terms ? { permit_description_terms: contact.terms } : {}) },
      criteria, search_result: searchResult,
      context: getDataContext().entries.filter(({ id }) =>
        ["municipal-permit-date", "municipal-permit-contact-role"].includes(id)) };
  }
  let parsed;
  if (edited) {
    try { parsed = { ...editedFiltersSchema.parse(input.filters),
      intent: "search", clarification: null }; }
    catch { throw new SourceError("Edited filters must use the supported search fields", 400); }
  } else {
    try { parsed = interpretationSchema.parse(await interpret(question, typeNames, groupNames)); }
    catch { return { status: "unavailable", question,
      reason: "The question interpreter could not return validated search criteria." }; }
  }
  if (parsed.intent !== "search") return { status: parsed.intent, question,
    clarification: parsed.clarification ?? "Please narrow the question to published parcel and permit fields.",
    context: getDataContext({ term: "permit" }).entries };
  const explicitDays = question.match(/\b(?:last|past|previous)\s+(\d{1,3})\s+days?\b/i);
  if ((/\bcommercial\b/i.test(question) && !parsed.commercial) ||
      (/\belectrical\s+permits\b/i.test(question) &&
        !/^electrical$/i.test(parsed.permit_group ?? "")) ||
      (explicitDays && Number(explicitDays[1]) !== parsed.permit_days))
    return { status: "clarify", question,
      clarification: "The interpreted filters did not preserve every explicit part of the question. Please revise the question or choose the filters directly." };
  const permitType = parsed.permit_type ? canonicalType(parsed.permit_type, typeNames) : null;
  const permitGroup = parsed.permit_group ? canonicalType(parsed.permit_group, groupNames) : null;
  if (parsed.permit_type && !permitType) return { status: "clarify", question,
    clarification: "Choose an exact permit type from the official municipal catalog." };
  if (parsed.permit_group && !permitGroup) return { status: "clarify", question,
    clarification: "Choose a published permit group from the official municipal catalog." };
  if (permitType && permitGroup) return { status: "clarify", question,
    clarification: "Choose either one exact permit type or one published permit group." };
  if ((parsed.permit_days || parsed.permit_status) && !permitType && !permitGroup)
    return { status: "clarify", question,
      clarification: "Which published municipal permit type or group should be searched?" };
  const dateWindow = parsed.permit_days ? recentCalendarDates(parsed.permit_days, now) : null;
  const interpretation = { ...parsed, permit_type: permitType,
    permit_group: permitGroup, date_window: dateWindow };
  const requirements = [];
  let codeReview = null;
  if (parsed.commercial) {
    const codes = commercialUseCodes();
    const reviewed = reviewedUseCodeValues();
    if (!codes?.length || !reviewed) codeReview = "The official City use-code definitions have not been fully reviewed.";
    else if (!indexConfigured()) codeReview = "The City parcel index is not connected.";
    else {
      try {
        const values = await query(`SELECT DISTINCT upper(trim(fields->>'use_code')) AS code
          FROM search_records WHERE source_id = 'parcels' AND run_id =
          (SELECT run_id FROM search_active_runs WHERE source_id = 'parcels' AND scope_key = 'all')
          AND nullif(trim(fields->>'use_code'), '') IS NOT NULL`);
        const unseen = values.map((row) => row.code).filter((code) => !reviewed.has(code));
        if (unseen.length) codeReview = `${unseen.length} published City use codes have no reviewed definition.`;
      } catch { codeReview = "The published City use codes could not be checked against the reviewed definitions."; }
    }
    if (!codeReview) requirements.push({ source_id: "parcels", one_of: { use_code: codes } });
  }
  if (codeReview) return { status: "blocked", question, interpretation,
    reason: codeReview, context: getDataContext().entries.filter((entry) =>
      ["city-use-code", "commercial-parcel-query", "municipal-permit-group",
        "search-coverage"].includes(entry.id)) };
  if (parsed.neighborhood?.trim()) {
    let neighborhood = parsed.neighborhood.trim();
    let neighborhoodField = "neighborhood";
    if (indexConfigured()) try {
      const names = await query(`SELECT DISTINCT fields->>'neighborhood' AS name,
        fields->>'neighborhood_label' AS label FROM search_records
        WHERE source_id = 'neighborhoods' AND run_id =
          (SELECT run_id FROM search_active_runs WHERE source_id = 'neighborhoods' AND scope_key = 'all')`);
      if (names.length) {
        const found = names.find((row) => [row.name, row.label].some((value) =>
          String(value ?? "").trim().toUpperCase() === neighborhood.toUpperCase()));
        if (!found) return { status: "clarify", question,
          clarification: `The City neighborhood index does not publish "${neighborhood}" as a neighborhood name.` };
        if (!found.name) neighborhoodField = "neighborhood_label";
        neighborhood = found.name || found.label;
      }
    } catch { return { status: "unavailable", question,
      reason: "The official City neighborhood names could not be checked." }; }
    requirements.push({ source_id: "neighborhoods",
      equals: { [neighborhoodField]: neighborhood } });
  }
  if (permitType || permitGroup) {
    const requirement = { source_id: "municity",
      ...(permitType ? { equals: { PermitType: permitType } }
        : { permit_group: permitGroup }) };
    if (parsed.permit_status) requirement.equals ??= {};
    if (parsed.permit_status) requirement.equals.PermStatus = parsed.permit_status.trim();
    if (dateWindow) {
      requirement.event_date_from = dateWindow.from;
      requirement.event_date_to = dateWindow.to;
    }
    requirements.push(requirement);
  }
  if (!requirements.length) return { status: "clarify", question,
    clarification: "Specify a commercial parcel, City neighborhood, or published municipal permit type or group." };
  const criteria = { requirements, limit: 25 };
  const searchResult = await search(criteria);
  const checksComplete = searchResult.coverage?.source_checks?.every((check) =>
    check.status === "complete") ?? false;
  return { status: searchResult.complete_for_query ? "ready" :
    checksComplete && searchResult.next_cursor ? "paging" : "coverage_limited",
    question, interpretation, criteria, search_result: searchResult,
    context: getDataContext().entries.filter((entry) => ["commercial-parcel-query",
      "municipal-permit-group", "municipal-permit-date", "municipal-permit-status", "exact-parcel-join",
      "search-coverage"].includes(entry.id)) };
}
