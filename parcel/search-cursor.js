import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SourceError } from "./http.js";

export const fingerprint = (value) => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");

function secret() {
  const value = process.env.PILOT_COOKIE_SECRET;
  if (!value || value.length < 24) throw new SourceError("Search cursor signing is not configured");
  return value;
}

export function makeSearchCursor(state) {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function readSearchCursor(value, queryHash, sourceHash) {
  if (!value) return { offset: 0 };
  const text = String(value);
  if (text.length > 3000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text))
    throw new SourceError("Invalid search cursor", 400);
  const [body, signature] = text.split(".");
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const left = Buffer.from(signature), right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right))
    throw new SourceError("Invalid search cursor", 400);
  let state;
  try { state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); }
  catch { throw new SourceError("Invalid search cursor", 400); }
  if (state.v !== 1 || state.query !== queryHash || state.source !== sourceHash ||
      !Number.isSafeInteger(state.offset) || state.offset < 0 ||
      !Number.isSafeInteger(state.expires) || state.expires < Date.now())
    throw new SourceError("Search cursor changed or expired; restart the query", 409);
  return state;
}
