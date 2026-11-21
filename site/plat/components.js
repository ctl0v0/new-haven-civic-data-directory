import { statusTone } from "./status.js";

export const escape = (value) => String(value).replace(/[&<>"']/g,
  (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function sourceLink(url, label, name) {
  const href = safeUrl(url);
  return href ? `<a class="p-src" href="${escape(href)}" rel="noreferrer"${name ? ` aria-label="${escape(name)}"` : ""}>${escape(label)}</a>` : "";
}

const iconPaths = {
  brand: '<path d="M3 4 10 1.5 16 7l-2 6-6 3-5-5z" fill="var(--parcel)" stroke="currentColor" stroke-width="1.5"/>',
  copy: '<path d="M6 6h8v8H6zM11 4V3H3v8h1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  warning: '<path d="M9 2 17 16H1z M9 7v4m0 2h.01" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
};
export function icon(name, className = "") {
  return `<svg class="${className}" viewBox="0 0 18 18" aria-hidden="true">${iconPaths[name]}</svg>`;
}

export const pill = (status, tone) => status
  ? `<span class="p-pill status" data-tone="${tone ?? statusTone(status)}">${escape(status)}</span>` : "";
export const calc = (text) => `<span class="p-calc">${escape(text)}</span>`;

export function fields(entries) {
  if (!entries.length) return "";
  return `<dl class="p-kv record-fields">${entries.map(([label, value]) =>
    `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl>`;
}

export function verbatim(rows, { anchors = false } = {}) {
  return `<details class="p-fields" open>
    <summary>Published fields <span class="p-count">${rows.reduce((sum, { raw }) => sum + raw.length, 0)}</span></summary>
    <div class="p-fields__body">${rows.map(({ raw, id, item, title }) => `<div class="p-fields__record" data-verbatim-for="${id}"${anchors ? ` id="${id}"` : ""}>
      ${anchors ? `<h4 class="p-record__title" tabindex="-1">${escape(title)}</h4>`
        : rows.length > 1 ? `<p><strong>${escape(title)}</strong></p>` : ""}
      <dl>${raw.map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join("")}</dl>
      <div class="p-fields__ids"><span class="t-id">${id}</span>
        ${sourceLink(item.source_url, "Open source", `Open source for ${title}`)}</div></div>`).join("")}</div>
    </details>`;
}

export function section(id, title, content, { note = "", stat = "", attrs = "" } = {}) {
  return `<section class="p-section report-section" id="${id}" aria-labelledby="${id}-heading"${attrs}>
    <header class="p-section__head"><div class="p-section__titlerow">
      <h2 class="t-section" id="${id}-heading" tabindex="-1">${escape(title)}</h2>
      ${stat ? `<p class="p-section__stats t-caption">${escape(stat)}</p>` : ""}</div>
      ${note ? `<p class="p-section__note">${escape(note)}</p>` : ""}</header>
    ${content}</section>`;
}
export function panel(title, content, { id = "", count } = {}) {
  return content ? `<div class="p-panel"${id ? ` id="${id}"` : ""}>
    <div class="p-panel__head"><h3 class="t-group"${id ? ' tabindex="-1"' : ""}>${escape(title)}</h3>
      ${count == null ? "" : `<span class="p-count">${count}</span>`}</div>${content}</div>` : "";
}
export const split = (left, right, ratio = "") => left && right
  ? `<div class="p-split"${ratio ? ` data-ratio="${ratio}"` : ""}>${left}${right}</div>` : left || right;
export const stack = (...parts) => `<div class="p-stack">${parts.join("")}</div>`;

export function factTile({ label, value, sub = "", subHref, foot = "", href, figure = false }) {
  return `<article class="p-fact"><p class="t-label">${escape(label)}</p>
    ${value ? `<p class="p-fact__value${figure ? " t-figure" : ""}">${href
      ? `<a href="#${href}">${escape(value)}</a>` : escape(value)}</p>`
      : '<p class="p-fact__miss">Not in returned records</p>'}
    ${sub ? `<p class="p-fact__sub">${subHref ? `<a href="#${subHref}">${escape(sub)}</a>` : escape(sub)}</p>` : ""}
    ${foot ? `<div class="p-fact__foot">${foot}</div>` : ""}</article>`;
}

export function ledger(headers, rows, { label, className = "p-ledger" } = {}) {
  return `<div class="p-tablewrap"><table class="${className}"${label ? ` aria-label="${escape(label)}"` : ""}>
    <thead><tr>${headers.map((heading) => `<th scope="col">${heading}</th>`).join("")}</tr></thead>
    ${rows}</table></div>`;
}

export const coverageLabels = {
  ok: "Returned records", no_records: "No records returned", partial: "Partial response",
  unavailable: "Unavailable", not_linked: "Parcel link unavailable", not_integrated: "Outside current coverage",
  unverified_map_source: "Outside current coverage",
};
export function coverageState(entry) {
  if (["unavailable", "not_linked", "not_integrated", "unverified_map_source"].includes(entry.status)) return entry.status;
  return entry.count_established === false || entry.omitted_categories?.length ? "partial" : entry.status;
}
export function coverageTone(entry) {
  const status = coverageState(entry);
  if (["not_integrated", "unverified_map_source"].includes(status)) return "outside";
  return statusTone(coverageLabels[status] ?? "Unavailable");
}
export function coveragePill(entry) {
  return pill(coverageLabels[coverageState(entry)] ?? "Unavailable", coverageTone(entry));
}
export function coverageBar(entries) {
  const labels = { ok: "returned", partial: "incomplete", none: "no records", outside: "outside coverage" };
  const parts = Object.keys(labels).map((tone) => [tone, entries.filter((entry) => coverageTone(entry) === tone).length]);
  const width = Math.max(1, entries.length);
  let offset = 0;
  const segments = parts.filter(([, count]) => count > 0).map(([tone, count]) => {
    const segment = `<rect data-tone="${tone}" x="${offset}" y="0" width="${count}" height="1"/>`;
    offset += count;
    return segment;
  });
  return `<svg class="p-coverbar" viewBox="0 0 ${width} 1" preserveAspectRatio="none" role="img"
    aria-label="${parts.map(([tone, count]) => `${count} ${labels[tone]}`).join(", ")}">${segments.join("")}</svg>`;
}

export function coverageNote(content) {
  return content ? `<div class="p-coverage coverage-note">${icon("warning")}<div>${content}</div></div>` : "";
}

export function sourceChecks(entries) {
  const rows = entries.filter(({ entry }) => coverageState(entry) !== "ok");
  return rows.length ? `<div class="p-checks">${rows.map(({ entry, title }) => `<div class="p-check">
    <div><p class="p-check__name">${sourceLink(entry.source_url, title) || escape(title)}</p>
      ${entry.warning || entry.note || entry.coverage ? `<p class="t-caption">${escape(entry.warning || entry.note || entry.coverage)}</p>` : ""}</div>
    ${coveragePill(entry)}</div>`).join("")}</div>` : "";
}
