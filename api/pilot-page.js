import {
  authorized,
  pilotConfigurationIssues,
  pilotConfigured,
} from "../parcel/auth.js";

const header =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Parcel pilot · New Haven Civic Data</title><link rel="stylesheet" href="/leaflet/leaflet.css"><link rel="stylesheet" href="/parcel.css"></head><body><a class="skip" href="#main">Skip to content</a><header><a href="/index.html">New Haven Civic Data Directory</a><span>Private parcel pilot</span></header><main id="main">';
const footer =
  "</main><footer>Independent research preview. Confirm consequential facts with the original source.</footer></body></html>";
const login =
  '<section class="login"><h1>Parcel pilot</h1><p>Enter the pilot passcode to search New Haven property records.</p><form method="post" action="/api/pilot-session"><label>Passcode <input type="password" name="passphrase" autocomplete="current-password" required></label><button>Enter pilot</button></form>';
const app = `
  <section class="search-panel" aria-labelledby="page-title">
    <p class="eyebrow">New Haven parcel explorer</p>
    <h1 id="page-title">What do city records say about this building?</h1>
    <p>Search an address or parcel ID to review building facts, business records, permits, and a dated history. Each result links back to its source.</p>
    <form id="search-form">
      <label for="query">Address, parcel ID, MBLU, or assessor account</label>
      <div class="search-row"><input id="query" name="query" type="search" placeholder="869 Whalley Ave" maxlength="160" required><button>Explore parcel</button></div>
    </form>
    <p class="search-examples">Try <button type="button" data-example="3 Edwards St">3 Edwards St</button> or <button type="button" data-example="869 Whalley Ave">869 Whalley Ave</button></p>
    <p id="status" role="status" aria-live="polite"></p>
  </section>
  <section id="candidates" class="panel" hidden><h2>Choose a parcel</h2><p>More than one city parcel may match an address. Review the listed address before choosing.</p><div id="candidate-list"></div></section>
  <section id="parcel-summary" class="parcel-hero" hidden>
    <p class="eyebrow">City parcel record</p>
    <h2 id="parcel-title"></h2>
    <p id="parcel-identifiers" class="meta"></p>
    <p id="parcel-match" class="match-note" hidden></p>
    <p class="small">Records can be incomplete or old. A business address or license is evidence to check, not proof of current occupancy.</p>
  </section>
  <section id="parcel-map-section" class="map-panel" aria-labelledby="parcel-map-title" hidden>
    <div class="section-heading"><div><p class="eyebrow">Mapped parcel</p><h2 id="parcel-map-title">City parcel boundary</h2></div><p>The outline is a parcel boundary, not a building footprint.</p></div>
    <div id="parcel-map" role="region" aria-label="Map of the selected city parcel" tabindex="0" hidden></div>
    <p id="parcel-map-status" class="map-status" role="status" aria-live="polite"></p>
    <p class="map-sources"><span class="map-swatch" aria-hidden="true"></span> Selected parcel boundary: <a href="https://gis.newhavenct.gov/server/rest/services/Hosted/New_Haven_Parcels_Authoritative_Parcel_Viewer/FeatureServer/0" target="_blank" rel="noopener noreferrer">New Haven GIS</a>. Background: <a href="https://cteco.uconn.edu/ctraster/rest/services/images/Ortho_2023_tiled/ImageServer" target="_blank" rel="noopener noreferrer">Connecticut 2023 aerial imagery</a>. The imagery does not show current occupancy or conditions.</p>
  </section>
  <section id="snapshot" class="snapshot" aria-labelledby="snapshot-title" hidden>
    <div class="section-heading"><div><p class="eyebrow">Start here</p><h2 id="snapshot-title">At a glance</h2></div><p>Plain-language facts from the records below.</p></div>
    <div id="snapshot-grid" class="snapshot-grid"></div>
  </section>
  <nav id="group-nav" aria-label="Jump to parcel sections" hidden></nav>
  <section id="feed-section" class="timeline-section" aria-labelledby="timeline-title" hidden>
    <div class="section-heading"><div><p class="eyebrow">Dated records</p><h2 id="timeline-title">Timeline</h2></div><p>Source dates, not a change log. A document or contact date may only mark an update to that record.</p></div>
    <ol id="feed" class="timeline"></ol>
    <button id="feed-more" type="button" class="secondary" hidden>Load more dated records</button>
  </section>
  <div id="groups" class="record-groups"></div>
  <script src="/leaflet/leaflet.js" defer></script><script src="/parcel.js" defer></script>`;
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export default {
  fetch: (request) => {
    if (request.method !== "GET")
      return new Response("Method not allowed", { status: 405 });
    const denied =
      new URL(request.url).searchParams.get("access") === "denied"
        ? '<p role="alert">Passcode not accepted.</p>'
        : "";
    const body = authorized(request) ? app : login + denied + "</section>";
    return new Response(
      header +
        (!pilotConfigured()
          ? `<p>Pilot access is not configured. ${pilotConfigurationIssues().join(", ")}. Runtime: ${escapeHtml(process.env.VERCEL_ENV ?? "local")}; branch: ${escapeHtml(process.env.VERCEL_GIT_COMMIT_REF ?? "unknown")}.</p>`
          : body) +
        footer,
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, no-store",
          "X-Frame-Options": "DENY",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://cteco.uconn.edu; base-uri 'none'; form-action 'self'",
        },
      },
    );
  },
};
