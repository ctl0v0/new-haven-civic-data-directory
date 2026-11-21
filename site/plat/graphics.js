import { calc, escape, sourceLink } from "./components.js";

const metersPerDegree = 111195;
const feetPerMeter = 1 / 0.3048;
const format = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fixed = (value) => Number(value.toFixed(2));
const validPoint = (point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);

function bounds(rings) {
  const points = rings.flat();
  if (!points.length || !points.every(validPoint)) return null;
  const west = Math.min(...points.map(([x]) => x));
  const east = Math.max(...points.map(([x]) => x));
  const south = Math.min(...points.map(([, y]) => y));
  const north = Math.max(...points.map(([, y]) => y));
  return { center: [(west + east) / 2, (south + north) / 2], delta: [east - west, north - south] };
}

export function projectAround([lon0, lat0]) {
  const longitudeFactor = metersPerDegree * Math.cos(lat0 * Math.PI / 180);
  return ([longitude, latitude]) => [(longitude - lon0) * longitudeFactor, (lat0 - latitude) * metersPerDegree];
}

const pointPath = (points) => points.map(([x, y]) => `${fixed(x)},${fixed(y)}`).join(" ");
const polygonsOf = (geometry) => geometry?.type === "Polygon" ? [geometry.coordinates]
  : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];

export function platDrawing(feature, layers, sourceUrl) {
  const polygons = polygonsOf(feature?.geometry);
  const extent = bounds(polygons.flat());
  if (!extent || !extent.delta.every((n) => n > 0)) return "";
  const { center, delta } = extent;
  const [east, north] = projectAround(center)([center[0] + delta[0], center[1] + delta[1]]);
  const scale = Math.min(440 / Math.abs(east), 300 / Math.abs(north));
  if (!Number.isFinite(scale) || scale <= 0) return "";
  const project = projectAround(center);
  const toPixel = ([x, y]) => [320 + x * scale, 236 + y * scale];
  const pixel = (point) => toPixel(project(point));
  const rings = polygons.flat().map((ring) => ring.map(pixel));
  const boundary = rings.map((ring) => `M${pointPath(ring)} Z`).join(" ");
  const gridMeters = Math.max(10, Math.ceil(12 / (10 * scale)) * 10);
  const step = scale * gridMeters;
  const grid = [
    ...Array.from({ length: Math.floor(640 / step) + 1 }, (_, i) => `M${fixed(320 % step + step * i)},0 V460`),
    ...Array.from({ length: Math.floor(460 / step) + 1 }, (_, i) => `M0,${fixed(236 % step + step * i)} H640`),
  ].join(" ");
  const edges = polygons.flatMap(([outer]) => {
    const points = outer.map(pixel);
    const signedArea = points.slice(1).reduce((sum, [x, y], i) => sum + points[i][0] * y - x * points[i][1], 0);
    return points.slice(1).flatMap(([x, y], i) => {
      const [x0, y0] = points[i];
      const dx = x - x0;
      const dy = y - y0;
      const length = Math.hypot(dx, dy);
      if (!length) return [];
      const direction = signedArea < 0 ? -1 : 1;
      return [{ x0, y0, dx, dy, length, nx: direction * dy / length, ny: -direction * dx / length }];
    });
  });
  const dimensions = edges.filter(({ length }) => length / scale >= 6 && length >= 28).map(({ x0, y0, dx, dy, length, nx, ny }) => {
    const x = fixed(x0 + dx / 2 - nx * 16);
    const y = fixed(y0 + dy / 2 - ny * 16);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const upright = angle > 90 ? angle - 180 : angle < -90 ? angle + 180 : angle;
    return `<text class="dim" text-anchor="middle" x="${x}" y="${y}" transform="rotate(${fixed(upright)},${x},${y})">${format.format(Math.round(length / scale * feetPerMeter))} ft</text>`;
  }).join("");
  const mapped = (id) => (layers.find((layer) => layer.id === id)?.features ?? [])
    .filter(({ geometry }) => geometry?.type === "Point" && validPoint(geometry.coordinates));
  const addressLabels = new Map();
  for (const { geometry, properties: p } of mapped("parcel-addresses")) {
    if (!p.house_number) continue;
    const [x, y] = pixel(geometry.coordinates);
    const [edge] = edges.map((edge) => {
      const { x0, y0, dx, dy, length } = edge;
      const t = Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / length ** 2));
      return { edge, t, distance: Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)) };
    }).sort((a, b) => a.distance - b.distance);
    if (!edge) continue;
    if (!addressLabels.has(edge.edge)) addressLabels.set(edge.edge, []);
    addressLabels.get(edge.edge).push({ t: edge.t, x, y, p });
  }
  const addresses = [...addressLabels].flatMap(([edge, labels]) => {
    const { x0, y0, dx, dy, length, nx, ny } = edge;
    let previous = -Infinity;
    return labels.sort((a, b) => a.t - b.t).map(({ t, x, y, p }) => {
      const along = Math.max(t * length, previous + 18);
      previous = along;
      const labelX = fixed(Math.min(585, Math.max(55, x0 + dx * along / length + nx * 36)));
      const labelY = fixed(Math.min(427, Math.max(27, y0 + dy * along / length + ny * 36)));
      const label = [p.house_number, p.unit].filter(Boolean).join("·");
      const title = [p.house_number, p.full_street_name, p.unit ? `Unit ${p.unit}` : null].filter(Boolean).join(" ");
      return `<g><title>${escape(title)}</title><path class="leader" d="M${fixed(x)},${fixed(y)} L${labelX},${labelY}" fill="none"/>
        <circle class="addr-dot" cx="${fixed(x)}" cy="${fixed(y)}" r="3"/>
        <text class="addr-label" x="${labelX}" y="${labelY - 3}" text-anchor="${nx < 0 ? "end" : "start"}">${escape(label)}</text></g>`;
    });
  }).join("");
  const stops = mapped("transit-stops").flatMap(({ geometry, properties }) => {
    const [x, y] = pixel(geometry.coordinates);
    return x >= 12 && x <= 628 && y >= 12 && y <= 448
      ? [`<rect class="stop" x="${fixed(x - 5)}" y="${fixed(y - 5)}" width="10" height="10" rx="2"><title>${escape(properties.StopName ?? "Mapped bus stop")}</title></rect>`] : [];
  }).join("");
  const scaleMeters = 10 ** Math.floor(Math.log10(100 / scale));
  const bar = fixed(scaleMeters * scale);
  const scaleFeet = scaleMeters * feetPerMeter;
  const feetLabel = scaleFeet < 1 ? scaleFeet.toPrecision(1) : format.format(Math.round(scaleFeet));
  return `<figure class="p-figure p-hero__plat">
    <p class="t-label report-hero-label">Parcel outline</p>
    <div class="p-figure__frame p-plat" id="plat-drawing"><svg viewBox="0 0 640 460" role="img" aria-label="City parcel boundary drawn to scale, with computed edge lengths and mapped address points">
      <path class="grid" d="${grid}" fill="none"/>
      <path class="parcel" d="${boundary}" fill-rule="evenodd"/>
      ${dimensions}<g data-layer="addresses">${addresses}</g><g data-layer="stops">${stops}</g>
      <g transform="translate(599 37)"><circle r="17" class="north-ring"/><text y="-21" text-anchor="middle" class="scale-text">N</text>
        <path class="north" d="M0,-12 L6,9 L0,5 L-6,9Z"/></g>
      <rect x="19" y="429" width="${bar}" height="6" class="scale-bar"/>
      <text x="19" y="422" class="scale-text">${format.format(scaleMeters)} m · ${feetLabel} ft</text>
    </svg></div>
    <figcaption class="p-figure__cap t-caption"><span>${calc("Dimensions from mapped geometry")}</span>
      ${sourceLink(sourceUrl, "City GIS parcel")}</figcaption>
    ${addresses || stops ? `<fieldset class="p-layers"><legend class="sr-only">Plat drawing layers</legend>
      ${addresses ? '<label class="p-chip"><input type="checkbox" data-plat-layer="addresses" checked> Address points</label>' : ""}
      ${stops ? '<label class="p-chip"><input type="checkbox" data-plat-layer="stops" checked> Transit stops</label>' : ""}
    </fieldset>` : ""}</figure>`;
}

export const categoryNames = {
  permit: "Permits and applications", license: "Licenses and registrations", document: "Documents",
  enforcement: "Complaints and cases", sale: "Sales",
};
export const glyph = (category) => `<span class="p-glyph" data-cat="${category}" aria-hidden="true"></span>`;
export function timelineChart(years, reportYear) {
  const dates = [...years.keys()].map(Number);
  const first = Math.min(...dates);
  const last = Math.max(reportYear, ...dates);
  // The list preserves every published year and event, including dates far outside the chart range.
  const start = Math.max(first, last - 170);
  const width = Math.max(1000, (last - start + 1) * 27 + 80);
  const axis = Math.max(145, ...[...years.values()].map((rows) => rows.length * 15 + 28));
  const height = axis + 42;
  const x = (year) => 42 + (year - start) / Math.max(1, last - start) * (width - 84);
  const ticks = Array.from({ length: last - start + 1 }, (_, i) => start + i).map((year) => {
    const col = fixed(x(year));
    return `<path class="tick" d="M${col},${axis}v5"/>${year === start || year === last || year % 5 === 0 || years.has(String(year))
      ? `<text class="tick-label" x="${col}" y="${axis + 19}" text-anchor="middle">${year}</text>` : ""}`;
  }).join("");
  const marks = [...years].filter(([year]) => Number(year) >= start).map(([year, rows]) => rows.slice().reverse().map((row, index) => {
    const label = `${row.title} · ${row.dateText} · ${row.dateLabel}`;
    return `<a class="mark" data-cat="${row.eventCategory}" href="#${row.id}" aria-label="${escape(label)}"
      transform="translate(${fixed(x(Number(year)))},${axis - 13 - index * 15})"><title>${escape(label)}</title>
      ${categoryShape(row.eventCategory)}</a>`;
  }).join("")).join("");
  return `<div class="p-timeline__chart" tabindex="0" aria-label="Scrollable chart of dated parcel records">
    <svg viewBox="0 0 ${width} ${height}" aria-label="Dated parcel records from ${start} to ${last}">
      <path class="axis" d="M25,${axis} H${width - 25}"/>${ticks}${marks}</svg></div>`;
}

function categoryShape(category) {
  if (category === "license") return '<rect class="shape" x="-5" y="-5" width="10" height="10"/>';
  if (category === "document") return '<path class="shape" d="M0,-6 6,0 0,6 -6,0Z"/>';
  if (category === "enforcement") return '<path class="shape" d="M0,-6 6,5 -6,5Z"/>';
  return '<circle class="shape" r="5"/>';
}

export function publishedNumber(value) {
  const text = String(value ?? "").trim();
  return /^(?:\$\s*)?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(text)
    ? Number(text.replace(/[\s$,]/g, "")) : null;
}

export function valuationBars(rows) {
  const amount = (row, key) => publishedNumber(row.item.attributes[key]);
  const max = Math.max(0, ...rows.map((row) => Math.max(amount(row, "total") ?? 0,
    (amount(row, "land") ?? 0) + (amount(row, "improvements") ?? 0))));
  if (!max) return "";
  return `<div class="p-valbars">${rows.map((row) => {
    const { valuation_year: year, valuation_type: kind, land, improvements, total, table_section: period } = row.item.attributes;
    const a = amount(row, "land");
    const b = amount(row, "improvements");
    return `<div class="p-valbar" data-kind="${escape(kind)}"><a class="p-valbar__year" href="#${row.id}">${escape(year ?? "")}</a>
      <span class="p-valbar__kind">${escape(kind ?? "")}</span>
      ${a !== null && b !== null ? `<svg class="p-valbar__track" viewBox="0 0 ${max} 16" preserveAspectRatio="none" role="img"
        aria-label="${escape(`${period ?? ""} ${kind ?? ""} valuation. Land ${land}. Improvements ${improvements}.`)}">
        <rect class="p-valbar__land" width="${a}" height="16"/><rect class="p-valbar__imp" x="${a}" width="${b}" height="16"/>
      </svg>` : "<span></span>"}
      <span class="p-valbar__total">${escape(amount(row, "total") === null ? total ?? "" : money.format(amount(row, "total")))}</span></div>`;
  }).join("")}</div><p class="t-caption"><span class="p-swatch p-valbar__land"></span>Land
    <span class="p-swatch p-valbar__imp"></span>Improvements</p>`;
}

export function areaBars(rows) {
  const max = Math.max(0, ...rows.map(({ item }) => publishedNumber(item.attributes.gross_area_sq_ft) ?? 0));
  if (!max) return "";
  return `<div class="p-areas">${rows.map(({ item, id, title }) => {
    const gross = publishedNumber(item.attributes.gross_area_sq_ft);
    const living = publishedNumber(item.attributes.living_area_sq_ft);
    if (gross === null) return "";
    return `<div class="p-area"><a href="#${id}">${escape(title)}</a>
      <svg class="p-area__bar" viewBox="0 0 ${max} 14" preserveAspectRatio="none" role="img"
        aria-label="${format.format(gross)} gross square feet${living === null ? "" : `, ${format.format(living)} living square feet`}">
        <rect class="p-area__fill" width="${gross}" height="14"/></svg>
      <span class="p-area__num">${format.format(gross)} ft²</span></div>`;
  }).join("")}</div>`;
}
