import { normalizeAddress } from "../parcel/resolve.js";

// The two explicit parent relationships in the November 20 City source audit.
// Each refresh must reproduce the publisher's relationship and agree with City GIS.
const reviewed = new Map([
  ["27403", { child: "317 0213 00103", parent: "317 0213 00100" }],
  ["27404", { child: "263 0135 00101", parent: "263 0135 00100" }],
]);
const key = (value) => String(value ?? "").replace(/[/\s]+/g, " ").trim().toUpperCase();
export const isReviewedSubparcel = (id) => reviewed.has(String(id));

export function reviewedSubparcelEvidence(fields, officialParcel) {
  const vendorId = String(fields.Parcel_ID ?? "");
  const rule = reviewed.get(vendorId);
  if (!rule || String(officialParcel?.Parcel_ID) !== vendorId || key(officialParcel.PrintKey) !== rule.child)
    return null;
  const keys = [fields.PrintKey, fields.PrintKey_Parcel].map(key).filter(Boolean);
  if (!keys.length || keys.some((value) => value !== rule.child)) return null;
  const address = normalizeAddress(fields.LegalAddress);
  if (!address || address !== normalizeAddress(officialParcel.LegalAddress)) return null;
  const notes = [officialParcel.ParcelNote, officialParcel.ParcelNote2].map((value) => String(value ?? ""));
  const references = notes.flatMap((note) => [...note.matchAll(/\b(?:PORTION\s+OF|PART\s+OF|P\/O)\s+(\d{3}[ /]+\d{4}[ /]+\d{5})\b/gi)]);
  if (!references.length || references.some((match) => key(match[1]) !== rule.parent)) return null;
  return { vendor_parcel_id: vendorId, subparcel_mblu: rule.child, city_parent_mblu: rule.parent,
    published_relationship: references[0][0], normalized_address: address,
    source_url: `https://www.municityconnect.com/#/app/NewHavenCityCT/entity/Parcel/${vendorId}` };
}
