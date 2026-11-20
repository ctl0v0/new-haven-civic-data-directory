import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { json } from "./http.js";

const COOKIE = "nh_parcel_pilot";
const REQUIRED_KEYS = [
  "PILOT_PASSPHRASE",
  "PILOT_COOKIE_SECRET",
  "PILOT_API_TOKEN",
];
export function missingPilotKeys() {
  return REQUIRED_KEYS.filter(
    (key) => typeof process.env[key] !== "string" || process.env[key].length < 24,
  );
}
export function pilotConfigurationIssues() {
  const issues = REQUIRED_KEYS.flatMap((key) => {
    const value = process.env[key];
    if (typeof value !== "string") return [`${key} (absent)`];
    if (value.length < 24) return [`${key} (too short)`];
    return [];
  });
  if (process.env.PILOT_API_KEYS && !parseApiKeys())
    issues.push("PILOT_API_KEYS (invalid JSON or entries)");
  return issues;
}
function configured() {
  return missingPilotKeys().length === 0;
}
function equal(left, right) {
  const a = Buffer.from(left ?? ""),
    b = Buffer.from(right ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}
function mac(text) {
  return createHmac("sha256", process.env.PILOT_COOKIE_SECRET)
    .update(text)
    .digest("base64url");
}
function parseApiKeys() {
  if (!process.env.PILOT_API_KEYS) return [];
  try {
    const keys = JSON.parse(process.env.PILOT_API_KEYS);
    if (
      !Array.isArray(keys) ||
      keys.length > 50 ||
      new Set(keys.map((item) => item.id)).size !== keys.length ||
      !keys.every(
        (item) =>
          item &&
          /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(item.id) &&
          /^[a-f0-9]{64}$/i.test(item.sha256) &&
          typeof item.active === "boolean",
      )
    ) return null;
    return keys;
  } catch {
    return null;
  }
}
export function issueCookie() {
  if (!configured()) throw Error("Pilot access is not configured");
  const value = String(Math.floor(Date.now() / 1000) + 7 * 86400);
  return `${COOKIE}=${value}.${mac(value)}; Path=/; Max-Age=${7 * 86400}; HttpOnly; Secure; SameSite=Strict`;
}
export function authorized(request) {
  if (!configured()) return false;
  if (authorizedBearer(request)) return true;
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!token) return false;
  const [exp, sig, ...extra] = token.split(".");
  return (
    !extra.length &&
    /^\d{10}$/.test(exp ?? "") &&
    Number(exp) > Date.now() / 1000 &&
    equal(sig, mac(exp))
  );
}
export function authorizedBearer(request) {
  return bearerIdentity(request) !== null;
}
export function bearerIdentity(request) {
  if (!configured()) return null;
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/i)?.[1];
  if (!bearer || bearer.length < 24 || bearer.length > 256) return null;
  const digest = createHash("sha256").update(bearer).digest("hex");
  const keys = parseApiKeys() ?? [];
  const invited = keys.find((item) => item.active && equal(item.sha256.toLowerCase(), digest));
  if (invited) return invited.id;
  if (
    process.env.PILOT_DISABLE_SHARED_TOKEN !== "1" &&
    equal(bearer, process.env.PILOT_API_TOKEN)
  ) return "legacy-shared";
  return null;
}
export function requirePilot(request) {
  return authorized(request)
    ? null
    : json(
        {
          error: configured()
            ? "Pilot access required"
            : "Pilot access is not configured",
        },
        configured() ? 401 : 503,
      );
}
export function checkPassphrase(value) {
  return configured() && equal(value, process.env.PILOT_PASSPHRASE);
}
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const a = new URL(origin),
      b = new URL(request.url);
    return a.origin === b.origin;
  } catch {
    return false;
  }
}
export function pilotConfigured() {
  return configured();
}

export function pilotPreviewEnabled(env = process.env) {
  return (env.VERCEL_ENV === "preview" && env.VERCEL_GIT_COMMIT_REF === "codex/parcel-pilot") ||
    (!env.VERCEL_ENV && env.QUERY_DEMO_ENABLED === "true");
}
