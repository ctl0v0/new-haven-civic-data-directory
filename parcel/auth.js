import { createHmac, timingSafeEqual } from "node:crypto";
import { json } from "./http.js";

const COOKIE = "nh_parcel_pilot";
function configured() {
  return ["PILOT_PASSPHRASE", "PILOT_COOKIE_SECRET", "PILOT_API_TOKEN"].every(
    (key) =>
      typeof process.env[key] === "string" && process.env[key].length >= 24,
  );
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
  if (!configured()) return false;
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/i)?.[1];
  return Boolean(bearer && equal(bearer, process.env.PILOT_API_TOKEN));
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
