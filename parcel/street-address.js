export function normalizeAddress(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/\b(STREET|ST)\b/g, "ST")
    .replace(/\b(AVENUE|AVE|AV)\b/g, "AVE")
    .replace(/\b(ROAD|RD)\b/g, "RD")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
