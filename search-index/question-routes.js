import { MUNICIPAL_LICENSE_SOURCE } from "./municipal-licenses.js";
import { CHARITY_SOURCE } from "../parcel/charity-registrations.js";

export const permitFields = ["PermitNo", "PermitType", "PermStatus", "PermitDate", "LegalAddress"];
export const contactFields = ["Fullname", "ContactRole", "CompanyName", "Phone", "Email", "EMailAddress", "ContactLicenseNumber"];
const permitInclude = { source_id: "municity", fields: permitFields };
const city = { kind: "city" };
const categoryByPhrase = { commercial: "business_space", "strictly commercial": "commercial_only",
  residential: "residential", "mixed-use": "mixed_use", "mixed use": "mixed_use" };
const tradeNames = { plumbing: "Plumbing", electrical: "Electrical", mechanical: "Mechanical", building: "Building" };
const action = /^(?:show(?: me)?|find|list|pull|any) (?:all )?(?:the )?/i;
const street = String.raw`\d{1,6}[A-Za-z]? [a-z0-9.' -]{1,90} (?:st(?:reet)?|av(?:e(?:nue)?)?|r(?:d|oad)|blvd|boulevard|pl(?:ace)?|dr(?:ive)?|ct|court|ln|lane|ter(?:race)?|way)`;
const permitNumberPattern = String.raw`[A-Z]{1,8}-\d{2,4}-\d{1,12}`;
export const permitNumber = new RegExp(`^${permitNumberPattern}$`, "i");

function permitHistory(text) {
  const address = text.match(new RegExp(String.raw`^(?:(?:what|which) permits? (?:were pulled|are|were) (?:for|at)|(?:show(?: me)?|find|list) (?:all )?(?:the )?permits? (?:for|at)) (${street})(?:[?.!] Which records list that exact address)?$`, "i"));
  if (address) return { scope: { kind: "address", address: address[1] }, requirements: [],
    include: [{ ...permitInclude, record_category: "Permit" }] };
  const history = text.match(new RegExp(String.raw`^(?:what business licenses (?:have been associated with|are|were) |(?:show(?: me)?|find|list) (?:the )?business licenses (?:for|at) )(${street})(?: over time)?(?:[?.!] Keep expired licenses visible)?$`, "i"));
  if (history) return { scope: { kind: "address", address: history[1] }, requirements: [],
    include: [{ source_id: MUNICIPAL_LICENSE_SOURCE }] };
  const detail = text.match(new RegExp(String.raw`^what happened after permit (${permitNumberPattern}) was filed[?.!] (?:show|return) (?:the )?linked application, reviews, (?:and )?inspections(?:,? and their dates)?$`, "i"));
  const exact = detail ?? text.match(new RegExp(String.raw`^(?:(?:show(?: me)?|find|look up|give me) (?:the )?permit) (${permitNumberPattern})$`, "i"));
  if (exact) return { scope: city, requirements: [{ source_id: "municity", equals: { PermitNo: exact[1].toUpperCase() } }],
    include: [permitInclude, ...(detail ? ["permit-applications", "permit-reviews", "permit-inspections"]
      .map((source_id) => ({ source_id })) : [])] };
  return null;
}

export function explicitParcelUse(question) {
  const phrase = question.match(/\b(strictly commercial|commercial|residential|mixed[- ]use) (?:parcels|properties)\b/i)?.[1]
    ?? question.match(/\b(?:parcel|recorded parcel) use (?:is|of) (strictly commercial|commercial|residential|mixed[- ]use)\b/i)?.[1];
  if (phrase) return categoryByPhrase[phrase.toLowerCase()];
  return /\bby commercial,? i mean (?:the )?recorded (?:parcel use|use of (?:the )?parcel)\b/i.test(question)
    ? "business_space" : null;
}

export function exactRecordQuestion(question, window) {
  const text = question.replace(/[?.!]$/, "");
  const history = !window && permitHistory(text);
  if (history) return { plan: history };
  const charity = !window && text.match(/^(?:show(?: me)?|find|list|what are|which are) (?:the )?(?:(?:state|ct|connecticut) )?public charit(?:ies|y registrations)(?: (at|for|in) (.+?)(?: neighborhood)?)?$/i);
  if (charity) {
    const [, relation, location] = charity;
    const include = [{ source_id: CHARITY_SOURCE }];
    if (/^(?:at|for)$/i.test(relation ?? "")) {
      if (!new RegExp(`^${street}$`, "i").test(location)) return null;
      return { plan: { scope: { kind: "address", address: location }, requirements: [], include } };
    }
    const scope = location && !/^new haven$/i.test(location) ? { kind: "neighborhood", name: location } : city;
    return { plan: { scope, requirements: [{ source_id: CHARITY_SOURCE }], include } };
  }
  if (/^which parcels have (?:connecticut|ct|state) liquor (?:permits|licenses) linked to them(?:[?.!] show (?:the )?business name, licensed address, and (?:published )?status)?$/i.test(text)) {
    const source_id = "ct-liquor-permits";
    return { plan: { scope: city, requirements: [{ source_id }],
      include: [{ source_id, fields: ["dba", "permit_address", "status", "credential"] }] } };
  }

  let subject = text;
  let withZoning = false;
  if (window) {
    const rest = text.slice(window.end).trim();
    const contactDetails = /^[?.!] include (?:the )?company, published business phone, and permit link$/i.test(rest);
    withZoning = /^[?.!] (?:show|include) (?:the )?recorded parcel use and zoning(?: for each)?$/i.test(rest);
    if (rest && !contactDetails && !withZoning && !/^(?:[?.!] (?:give me|show|include) (?:the )?(?:published )?permit date|[?.!] (?:show|include) (?:the )?listed contractors)$/i.test(rest))
      return null;
    subject = text.slice(0, window.start).trim();
    const replacements = subject.match(/^who pulled permits for water heater replacements in (?:the )?([a-z][a-z .'-]{1,68}?)$/i);
    if (replacements && /listed contractors$/i.test(rest))
      return { exactType: "Water Heater", plan: { scope: { kind: "neighborhood", name: replacements[1] },
        requirements: [{ source_id: "municity", equals: { PermitType: "Water Heater" },
          date: { field: "PermitDate", from: window.from, to: window.to } }],
        include: [permitInclude, { source_id: "permit-contacts", fields: contactFields }], contact_role: "Contractor",
        require_contact_role: true, permit_description_terms: ["replace", "replacing", "change out", "change-out"] } };
    const contactType = subject.match(/^(?:show(?: me)?|find|list) (?:listed )?contractor contacts (?:on|for) ([a-z][a-z0-9 /()-]{1,90} - [A-Z]) permits? (?:dated|pulled)$/i)?.[1];
    if (contactType && (contactDetails || !rest)) return { exactType: contactType, plan: { scope: city,
      requirements: [{ source_id: "municity", equals: { PermitType: contactType },
        date: { field: "PermitDate", from: window.from, to: window.to } }],
      include: [permitInclude, { source_id: "permit-contacts", fields: ["Fullname", "ContactRole", "CompanyName", "Phone"] }],
      contact_role: "Contractor", require_contact_role: true } };
    if (contactDetails) return null;
  }
  if (!action.test(subject)) return null;
  subject = subject.replace(action, "");
  const description = subject.match(/ where (?:the )?description (?:actually )?(?:says|contains|mentions) ["“'‘]([^"”'’]{1,80})["”'’]$/i);
  if (description) subject = subject.slice(0, description.index);
  subject = subject.replace(/,? regardless of how the parcel is classified$/i, "");
  const prefix = subject.match(/^(strictly commercial|commercial|residential|mixed[- ]use) parcels(?: in (?:the )?([a-z][a-z .'-]{1,68}?)(?: neighborhood)?)? with (?:an? )?/i);
  const suffix = subject.match(/ on (strictly commercial|commercial|residential|mixed[- ]use) parcels$/i);
  const use = prefix ?? suffix;
  if (use) subject = subject.replace(use[0], "").trim();
  const location = subject.match(/ permits? (?:pulled |dated )?in (?:the )?([a-z][a-z .'-]{1,68}?)(?: neighborhood)?$/i);
  if (location) subject = subject.slice(0, location.index) + " permits";
  subject = subject.replace(/ (?:pulled|dated)$/i, "");
  const hoodFamily = /^(?:(?:kitchen )?hood(?:[- ]related)? permits|permits for (?:kitchen )?hoods?)$/i.test(subject);
  const trade = subject.match(/^(?:(?:(?:all )?kinds of )?(plumbing|electrical|mechanical|building) permits|permits for (plumbing|electrical|mechanical|building))$/i);
  const named = subject.match(/^permits? of (?:the )?(?:exact )?type ["“']?([^"”']{1,100}?)["”']?$/i)
    ?? subject.match(/^([a-z][a-z0-9 /()-]{1,90} - [A-Z]) permits?$/i);
  if (!trade && !named && !hoodFamily) return null;
  const requirements = [{ source_id: "municity",
    ...(trade ? { permit_group: tradeNames[(trade[1] ?? trade[2]).toLowerCase()] }
      : named ? { equals: { PermitType: named[1].trim() } } : {}),
    ...(window ? { date: { field: "PermitDate", from: window.from, to: window.to } } : {}) }];
  const neighborhood = location?.[1] ?? prefix?.[2];
  if (location && prefix?.[2]) return null;
  return { exactType: named?.[1].trim(), hoodFamily, plan: { scope: neighborhood ? { kind: "neighborhood", name: neighborhood } : city,
    requirements, include: [permitInclude, ...(withZoning ? [{ source_id: "parcels", fields: ["use_code"] }, { source_id: "zoning" }] : [])],
    ...(use ? { parcel_use_category: categoryByPhrase[use[1].toLowerCase()] } : {}),
    ...(description ? { permit_description_terms: [description[1].replace(/^([a-z]+)[.!?]$/i, "$1")] } : {}) } };
}
