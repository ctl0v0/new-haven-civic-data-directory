import { z } from "zod";
import { businessCategories, businessRadii, DEFAULT_STOREFRONT_RADIUS } from "../parcel/nearby-business-count.js";

const id = z.string().regex(/^\d{1,12}$/);
export const renterStorefrontSchema = z.strictObject({
  address: z.string().trim().max(160).regex(/^\d{1,6}\s+\S[^\x00-\x1f]*$/),
  parcel_id: id.optional(),
  objectid: id.optional(),
}).refine(({ parcel_id, objectid }) => Boolean(parcel_id) === Boolean(objectid));

const streetAddress = /(?<![\d/.])\b\d{1,6}\s+(?:(?:[a-z][a-z0-9.'’-]*|\d+(?:st|nd|rd|th))\s+){1,7}(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|place|pl|court|ct|way|terrace|ter|parkway|pkwy|circle|cir)\b(?:\.?\s*(?:(?:suite|ste\.?|unit|apt\.?)\s+|#\s*)[a-z0-9-]+)?/i;
const hoodWords = /\b(?:hoods?|kitchen (?:ventilation|exhaust))\b/i;
const shortlist = /\b(?:vacanc(?:y|ies)|vacant|(?:listed|available|open) (?:storefronts?|spaces?)|storefront (?:listings|options)|spaces? for lease)\b/i;
const nearby = /\b(?:nearby|(?:near|around) (?:here|there|\d)|within|close to)\b/i;
const unsupportedRadius = /\b(?:walking|walk|driving|drive)\b/i;
const categoryNames = Object.entries(businessCategories).flatMap(([id, label]) => {
  const single = label.toLowerCase().replace(/s$/, "");
  return [...new Set([label.toLowerCase(), single, id.replaceAll("_", " ")])].map((name) => [name, id]);
}).sort(([a], [b]) => b.length - a.length);
const categoryFor = (question) => {
  const words = ` ${question.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ")} `;
  return categoryNames.find(([name]) => words.includes(` ${name} `))?.[1];
};

function radiusFor(question) {
  if (unsupportedRadius.test(question)) return null;
  const meters = question.match(/\b(\d+)\s*(?:meters?|metres?|m)\b/i)?.[1];
  if (meters) return Object.hasOwn(businessRadii, meters) ? Number(meters) : null;
  if (/\b(?:quarter(?: of (?:a|one))?|0\.25|1\/4)[ -]?(?:a[ -])?mile\b|¼\s*mile/i.test(question)) return 402;
  if (/\b(?:half(?: of (?:a|one))?|0\.5|1\/2)[ -]?(?:a[ -])?mile\b|½\s*mile/i.test(question)) return 805;
  const mile = question.match(/\b(\d+(?:\.\d+)?|one|two|a)[ -]miles?\b/i)?.[1]?.toLowerCase();
  if (mile) return ["1", "one", "a"].includes(mile) ? 1609 : ["2", "two"].includes(mile) ? 3219 : null;
  if (/\b(?:\d+|three|four|five)\s*(?:miles?|km|kilometers?|feet|ft|minutes?)\b/i.test(question)) return null;
  return DEFAULT_STOREFRONT_RADIUS;
}

function neighborhoodFor(question) {
  const locations = question.matchAll(/\bin\s+(?:the\s+)?([a-z][a-z .’'-]{0,79}?)(?=\s+(?:neighborhood|with|have|that|which|for|where|in)\b|[?!.,]|$)/gi);
  for (const [, location] of locations) {
    const name = location.trim().replace(/^new haven['’]s\s+/i, "");
    if (!/^(?:city of\s+)?new haven(?:\s+(?:ct|connecticut))?$/i.test(name)) return name;
  }
}

function sectionFor(question) {
  if (/\b(?:landlord|(?:lease|rental) terms?|rent price|pop[ -]?up|month.to.month|short.term leas(?:e|ing)|(?:one|five|\d+)[ -]year lease)\b/i.test(question)) return "lease";
  if (hoodWords.test(question) || /\b(?:was it inspected|did (?:it|the hood) pass)\b/i.test(question)) return "hood";
  if (/\b(?:zoning|zoned|where can i check|allowed (?:here|there)|can i open a .+ (?:here|there))\b/i.test(question)) return "zoning";
  if (/\b(?:square (?:feet|footage)|sq\.?\s*ft|retail space|floor area|basement|ground.floor|how (?:big|much space)|building subareas)\b/i.test(question)) return "space";
  if (/\b(?:what permits? or applications?|what .{0,60}(?:need|apply|look at) .{0,40}open|how (?:do i|to) apply|food service (?:license|application)|application forms?)\b/i.test(question)) return "applications";
  if (/\b(?:former|previous|past (?:occupants?|businesses?|restaurants?)|before|used to be|what (?:business|restaurant) was|who (?:was|occupied|operated))\b/i.test(question)) return "history";
  return null;
}

export function planRenterQuestion(question, selected) {
  const address = question.match(streetAddress)?.[0];
  const storefront = address && address.toLowerCase() !== selected?.address.toLowerCase()
    ? { address } : selected ?? (address ? { address } : null);
  const wantsShortlist = !address && shortlist.test(question) &&
    (!selected || /\b(?:which|list|show|find)\b.*\b(?:vacancies|storefronts|spaces)\b/i.test(question));
  const clarification = (reason, reason_code = "renter_storefront") => ({ status: "clarify", question, reason, reason_code });
  const planned = (tool, args) => ({ status: "planned", question, renter_plan: { tool, arguments: args } });
  if (wantsShortlist) {
    if (/(?:\bin\s+(?:the\s+)?(?:east rock|westville|downtown)\s+or\s+)|\b(?:near|within)\s+\d/i.test(question))
      return clarification("Choose one City neighborhood for the shortlist, or search all of New Haven.", "renter_neighborhood");
    return planned("search_commercial_vacancies", { neighborhood: neighborhoodFor(question), hood_permit: hoodWords.test(question) });
  }

  const category = nearby.test(question) && (storefront || /\b(?:google|restaurant|restaurants)\b/i.test(question))
    ? categoryFor(question) : null;
  if (category) {
    if (!storefront) return clarification("Select a storefront or enter its street address to run the nearby search.");
    const radius_meters = radiusFor(question);
    if (radius_meters === null)
      return clarification("Choose a straight-line radius of a quarter mile, half mile, one mile, or two miles.", "renter_radius");
    return planned("count_nearby_places", { storefront, category, radius_meters });
  }

  const section = sectionFor(question);
  if (!section || (!storefront && !/\b(?:here|there|this (?:storefront|address|space|place)|the landlord|the hood|was it inspected)\b/i.test(question))) return null;
  if (!storefront) return clarification("Select a storefront or enter its street address for this follow-up.");
  return planned("get_commercial_storefront_evidence", { storefront, section });
}
