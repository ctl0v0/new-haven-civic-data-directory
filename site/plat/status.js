export function statusTone(status) {
  const word = status.trim().toLowerCase();
  if (word.startsWith("partial") || word === "unavailable" || word === "parcel link unavailable") return "partial";
  if (/^(no records|outside|inactive flag)/.test(word)) return "none";
  if (["issued", "active", "returned records", "in service"].includes(word)) return "ok";
  if (["draft", "scheduled", "submitted", "case assigned"].includes(word)) return "pending";
  if (["void", "voided", "inactive", "expired", "not in service"].includes(word)) return "void";
  return "closed";
}
