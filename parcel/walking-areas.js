import { fetchJson, SourceError } from "./http.js";

export const WALK_MINUTES = [10, 20];
export const WALK_SOURCE = "https://playground.heigit.org/";
const WALK_ENDPOINT = "https://api.heigit.org/openrouteservice/v2/isochrones/foot-walking";
const MIN_GOOGLE_AREA_SQ_M = 1556.86;
const MAX_GOOGLE_VERTICES = 7000;

function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function inExtent([x, y], [ax, ay], [bx, by]) {
  return x >= Math.min(ax, bx) && x <= Math.max(ax, bx) &&
    y >= Math.min(ay, by) && y <= Math.max(ay, by);
}

function segmentsIntersect(a, b, c, d) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return (abC === 0 && inExtent(c, a, b)) || (abD === 0 && inExtent(d, a, b)) ||
    (cdA === 0 && inExtent(a, c, d)) || (cdB === 0 && inExtent(b, c, d)) ||
    (abC * abD < 0 && cdA * cdB < 0);
}

export function walkingAreaContains(ring, point) {
  const [x, y] = point;
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1];
    const b = ring[i];
    if (cross(a, b, point) === 0 && inExtent(point, a, b)) return true;
    if ((a[1] > y) !== (b[1] > y) && x < a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]))
      inside = !inside;
  }
  return inside;
}

function googleRing(geometry, origin) {
  // Aggregate accepts one exterior ring. Keep the router's boundary intact.
  if (geometry?.type !== "Polygon" || geometry.coordinates?.length !== 1)
    throw new Error("The walking area does not have a single boundary Google Maps can search.");
  const ring = geometry.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > MAX_GOOGLE_VERTICES ||
      !ring.every((point) => Array.isArray(point) && point.length === 2 &&
        point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90))
    throw new Error("The walking area has an invalid boundary.");
  const nodes = ring.slice(0, -1);
  if (nodes[0].join() !== ring.at(-1).join() || new Set(nodes.map((point) => point.join())).size !== nodes.length)
    throw new Error("The walking area has an invalid boundary.");
  const [longitude, latitude] = origin;
  if (!walkingAreaContains(ring, origin) ||
      nodes.some(([lon, lat]) => Math.abs(lon - longitude) > 0.06 || Math.abs(lat - latitude) > 0.06))
    throw new Error("The walking area could not be matched to the selected City address point.");
  let twiceArea = 0;
  for (let i = 0; i < nodes.length; i++) {
    twiceArea += cross(origin, ring[i], ring[i + 1]);
    for (let j = i + 2; j < nodes.length; j++) {
      if (i === 0 && j === nodes.length - 1) continue;
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1]))
        throw new Error("The walking area boundary crosses itself.");
    }
  }
  const area = Math.abs(twiceArea) / 2 * 111195 ** 2 * Math.cos(latitude * Math.PI / 180);
  if (area < MIN_GOOGLE_AREA_SQ_M) throw new Error("The walking area is too small for Google Maps to search.");
  return twiceArea > 0 ? ring : [...ring].reverse();
}

export async function walkingAreas(origin, key) {
  const coordinates = [origin.longitude, origin.latitude];
  let response;
  try {
    response = await fetchJson(WALK_ENDPOINT, {
      accept: "application/geo+json, application/json",
      method: "POST", timeout: 10000, maxBytes: 1_000_000,
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: [coordinates], range_type: "time",
        range: WALK_MINUTES.map((minutes) => minutes * 60), location_type: "start",
      }),
    });
  } catch (error) {
    const status = error.upstreamStatus;
    const message = status === 429 ? "The walking service reached its quota. Try again later."
      : [401, 403].includes(status) ? "The walking service denied access. Check the HeiGIT key and its openrouteservice permissions."
        : error.name === "TimeoutError" ? "The walking service timed out. Try again later."
          : "The walking service could not calculate an area from the selected address.";
    const unavailable = new SourceError(message, status === 429 ? 429 : [401, 403].includes(status) ? 503 : 502);
    unavailable.upstreamStatus = status;
    unavailable.upstreamErrorType = error.cause?.code ?? error.name;
    throw unavailable;
  }
  return WALK_MINUTES.map((minutes) => {
    const matches = response?.type === "FeatureCollection" && Array.isArray(response.features)
      ? response.features.filter((feature) => feature?.properties?.value === minutes * 60) : [];
    if (matches.length !== 1)
      return { minutes, status: "unavailable", reason: "The walking service did not return this walking window." };
    try {
      return { minutes, status: "ok", ring: googleRing(matches[0].geometry, coordinates) };
    } catch (error) {
      return { minutes, status: "unavailable", reason: error.message };
    }
  });
}
