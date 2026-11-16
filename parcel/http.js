import { getCache } from "@vercel/functions";

const memory = new Map();
const CACHE_VERSION = "parcel-v5";

export class SourceError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "SourceError";
    this.status = status;
  }
}

export async function fetchBounded(
  url,
  {
    accept = "application/json",
    timeout = 8000,
    maxBytes = 2_000_000,
    headers = {},
    method = "GET",
    body,
  } = {},
) {
  const response = await fetch(url, {
    method,
    body,
    headers: { accept, ...headers },
    signal: AbortSignal.timeout(timeout),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok)
    throw new SourceError(`Upstream returned HTTP ${response.status}`);
  if (Number(response.headers.get("content-length") || 0) > maxBytes)
    throw new SourceError("Upstream response exceeds limit");
  const reader = response.body?.getReader();
  if (!reader) throw new SourceError("Upstream response has no body");
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new SourceError("Upstream response exceeds limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

export async function fetchJson(url, options) {
  const body = await fetchBounded(url, options);
  try {
    return JSON.parse(body);
  } catch {
    throw new SourceError("Upstream returned malformed JSON");
  }
}

export async function readRequestText(request, maxBytes = 2048) {
  if (Number(request.headers.get("content-length") || 0) > maxBytes)
    throw new SourceError("Request too large", 413);
  const reader = request.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new SourceError("Request too large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

export async function arcgis(layer, parameters = {}) {
  const url = new URL(layer + "/query");
  const params = {
    f: "json",
    where: "1=1",
    outFields: "*",
    returnGeometry: "false",
    resultRecordCount: "100",
    ...parameters,
  };
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, String(value));
  // Parcel rings can exceed common proxy URL limits. ArcGIS Query accepts the
  // same parameters as a form body, preserving the full polygon intersection.
  const large = url.href.length > 1900;
  const data = await fetchJson(large ? layer + "/query" : url, {
    maxBytes: 8_000_000,
    timeout: 10000,
    ...(large
      ? {
          method: "POST",
          body: url.searchParams,
          headers: { "content-type": "application/x-www-form-urlencoded" },
        }
      : {}),
  });
  if (data.error)
    throw new SourceError(`ArcGIS error ${data.error.code ?? "unknown"}`);
  if (
    !Array.isArray(data.features) &&
    !Array.isArray(data.objectIds) &&
    typeof data.count !== "number"
  )
    throw new SourceError("ArcGIS response lacks records");
  return data;
}

export function sqlString(value) {
  return String(value).replaceAll("'", "''");
}

export async function cached(key, producer, ttl = 300) {
  const cacheKey = `${CACHE_VERSION}:${key}`;
  const local = memory.get(cacheKey);
  if (local && local.expires > Date.now()) return local.value;
  let remote;
  try {
    remote = await getCache({ namespace: "new-haven-parcel" }).get(cacheKey);
  } catch {
    /* local test/dev */
  }
  if (remote) return remote;
  const value = await producer();
  if (memory.size > 300) memory.clear();
  memory.set(cacheKey, { value, expires: Date.now() + ttl * 1000 });
  try {
    if (JSON.stringify(value).length < 1_800_000)
      await getCache({ namespace: "new-haven-parcel" }).set(cacheKey, value, {
        ttl,
        name: "parcel source lookup",
      });
  } catch {
    /* cache failure must not hide source results */
  }
  return value;
}

export function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
