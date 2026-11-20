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
// The query workbench is visible only in the protected pilot Preview. A
// production deployment never inherits it from a copied environment variable.
export function queryWorkbenchVisible(env = process.env) {
  return (env.VERCEL_ENV === "preview" &&
    env.VERCEL_GIT_COMMIT_REF === "codex/parcel-pilot") ||
    (!env.VERCEL_ENV && env.QUERY_DEMO_ENABLED === "true");
}
const askHidden = queryWorkbenchVisible() ? "" : " hidden";
const app = `
  <nav class="parcel-tabs" role="tablist" aria-label="Parcel explorer views">
    <button id="records-tab" type="button" role="tab" aria-selected="true" aria-controls="records-view">Search records</button>
    <button id="browse-tab" type="button" role="tab" aria-selected="false" aria-controls="browse-view">Browse parcel map</button>
    <button id="guide-tab" type="button" role="tab" aria-selected="false" aria-controls="guide-view">Data guide</button>
    <button id="ask-tab" type="button" role="tab" aria-selected="false" aria-controls="ask-view"${askHidden}>Test a question</button>
  </nav>
  <div id="records-view" role="tabpanel" aria-labelledby="records-tab">
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
  <div id="record-content-home"><div id="record-content" hidden>
  <div class="record-review-workspace">
    <nav id="group-nav" aria-label="Parcel data sections" hidden></nav>
    <div class="record-review-main">
  <section id="parcel-summary" class="parcel-hero" hidden>
    <div class="parcel-hero-layout"><div class="parcel-hero-copy">
      <p class="eyebrow">City parcel record</p>
      <h2 id="parcel-title"></h2>
      <p id="parcel-identifiers" class="meta"></p>
      <p id="parcel-match" class="match-note" hidden></p>
      <p class="small">Records can be incomplete or old. A business address or license is evidence to check, not proof of current occupancy.</p>
    </div><figure id="parcel-photo" class="parcel-photo" hidden>
      <img id="parcel-photo-image" alt="Verified parcel photo">
      <figcaption>Official parcel photo · date not published. <a id="parcel-photo-source" target="_blank" rel="noopener noreferrer">View source</a></figcaption>
    </figure></div>
  </section>
  <section id="school-attendance-summary" class="school-attendance-summary" aria-labelledby="school-attendance-title" hidden>
    <div class="section-heading"><div><p class="eyebrow">Address-specific record</p><h2 id="school-attendance-title">School Choice attendance zones</h2></div></div>
    <div id="school-attendance-results" aria-live="polite"></div>
  </section>
  <section id="parcel-map-section" class="map-panel" aria-labelledby="parcel-map-title" hidden>
    <div class="section-heading"><div><p class="eyebrow">Mapped parcel</p><h2 id="parcel-map-title">City parcel boundary</h2></div><p>The outline is a parcel boundary, not a building footprint.</p></div>
    <div class="map-workspace">
      <div id="parcel-map" role="region" aria-label="Map of the selected city parcel" tabindex="0" hidden></div>
      <div class="map-layers"><h3>Map layers</h3><p class="meta">Parcel facts and nearby street context are separate.</p><div id="map-layer-list" aria-live="polite"></div></div>
    </div>
    <p id="parcel-map-status" class="map-status" role="status" aria-live="polite"></p>
    <div id="map-context-notes" class="map-context-notes"></div>
    <p class="map-sources"><span class="map-swatch" aria-hidden="true"></span> Selected parcel boundary: <a href="https://gis.newhavenct.gov/server/rest/services/Hosted/New_Haven_Parcels_Authoritative_Parcel_Viewer/FeatureServer/0" target="_blank" rel="noopener noreferrer">New Haven GIS</a>. Visual backgrounds: <a href="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer" target="_blank" rel="noopener noreferrer">Esri street map</a> or <a href="https://cteco.uconn.edu/ctraster/rest/services/images/Ortho_2023_tiled/ImageServer" target="_blank" rel="noopener noreferrer">Connecticut 2023 aerial imagery</a>. Backgrounds do not establish parcel facts or current conditions.</p>
  </section>
  <section id="snapshot" class="snapshot" aria-labelledby="snapshot-title" hidden>
    <div class="section-heading"><div><p class="eyebrow">Start here</p><h2 id="snapshot-title">At a glance</h2></div><p>Plain-language facts from the records below.</p></div>
    <div id="overview-counts"></div>
    <div id="snapshot-grid" class="snapshot-grid"></div>
  </section>
  <section id="feed-section" class="timeline-section" aria-labelledby="timeline-title" hidden>
    <div class="section-heading"><div><p class="eyebrow">Dated records</p><h2 id="timeline-title">Timeline</h2></div><p>Source dates, not a change log. Undated contacts remain in the Activity records.</p></div>
    <div id="timeline-filters"></div>
    <ol id="feed" class="timeline"></ol>
    <button id="feed-more" type="button" class="secondary" hidden>Load more dated records</button>
  </section>
  <div id="groups" class="record-groups"></div>
  <section id="record-detail" class="record-detail" hidden></section>
  </div></div></div></div>
  </div>
  <section id="browse-view" role="tabpanel" aria-labelledby="browse-tab" hidden>
    <div class="browse-mobile-switch" role="group" aria-label="Browse view"><button id="mobile-map-tab" type="button" aria-pressed="true">Map</button><button id="mobile-records-tab" type="button" aria-pressed="false">Records</button></div>
    <div class="browse-workspace">
      <aside class="browse-sidebar">
        <p class="eyebrow">Official City parcel layer</p>
        <div class="browse-sidebar-heading"><h1>Browse parcels</h1><button id="browse-panel-toggle" type="button" class="secondary" aria-expanded="false">Expand panel</button></div>
        <p id="browse-intro">Pan and zoom, then select a parcel. Full records load only after you request them.</p>
        <div class="browse-use-controls">
          <label for="browse-parcel-display">Color parcels by</label>
          <select id="browse-parcel-display"><option value="use">Recorded use</option><option value="outlines">Outlines</option></select>
          <div id="browse-use-key"><ul id="browse-use-legend" aria-label="Recorded use legend"></ul><p class="meta">Unclassified parcels lack a verified use classification.</p></div>
        </div>
        <div id="browse-selection" aria-live="polite"><h2>Select a parcel</h2><p>Click a parcel outline to see its City ID, address and official photo.</p></div>
        <p id="browse-data-status" class="map-status" role="status" aria-live="polite"></p>
        <div id="browse-record-actions" class="browse-record-actions" hidden><button id="browse-open-records" type="button">View full records without map</button></div>
        <details id="browse-map-layers" class="browse-map-layers" hidden><summary>Map layers and sources</summary><p class="meta">The highlighted boundary is the selected City parcel. Nearby features are map context.</p><div id="browse-map-layer-list"></div><div id="browse-map-context-notes" class="map-context-notes"></div></details>
        <div id="browse-data-slot"></div>
        <p id="browse-map-status" class="map-status" role="status" aria-live="polite"></p>
        <p class="meta">Parcel boundaries and labels: New Haven GIS. Background: Esri street map or CT ECO aerial imagery. A municipal street-view or assessor building photo appears only after an exact parcel match. Images do not establish current conditions.</p>
      </aside>
      <div id="browse-map" role="region" aria-label="Browse New Haven parcel boundaries" tabindex="0"></div>
    </div>
  </section>
  <section id="guide-view" role="tabpanel" aria-labelledby="guide-tab" hidden>
    <div class="guide-shell"><aside class="guide-index" aria-label="Data guide navigation"><p class="eyebrow">Reference</p><h1>Data guide</h1><p>How the parcel records, REST API and MCP tools fit together.</p><nav id="guide-nav"></nav></aside><div id="guide-content" class="guide-content" aria-live="polite"></div><aside id="guide-example" class="guide-example" aria-label="Request and response example"></aside></div>
  </section>
  <section id="ask-view" role="tabpanel" aria-labelledby="ask-tab" hidden>
    <div class="ask-workspace">
      <div class="ask-heading"><h1>Test a question</h1><p>Write a question or choose the exact fields to search.</p></div>
      <div class="query-mode-bar"><div role="group" aria-label="Search mode">
        <button id="ask-language-mode" type="button" class="secondary" aria-pressed="true">Plain language</button>
        <button id="ask-fields-mode" type="button" class="secondary" aria-pressed="false">Field filters</button>
      </div><a id="ask-query-guide" href="/parcel?view=guide&amp;guide=query-explorer">Browse fields and permit types</a></div>
      <div id="ask-language">
      <form id="ask-form"><label for="ask-question">Question</label><div class="ask-form-row"><input id="ask-question" type="search" maxlength="1000" required placeholder="Show commercial parcels with electrical permits pulled in the past 30 days"><button type="submit">Preview search</button></div></form>
      <div class="ask-examples"><span>Examples</span><button type="button" data-ask-example="Show parcels with electrical permits pulled in the past 30 days">Electrical permits · 30 days</button><button type="button" data-ask-example="Show commercial parcels with electrical permits pulled in the past 30 days">Commercial + electrical</button><button type="button" data-ask-example="Show me new business licenses in East Rock neighborhood in the last 30 days">East Rock license issuance</button><button type="button" data-ask-example="Show me Contractor contacts who did water heater replacements in the last 30 days">Water Heater contractors</button></div>
      </div>
      <div id="ask-structured" hidden></div>
      <p id="ask-status" role="status" aria-live="polite"></p>
      <div id="ask-clarification" class="query-actions" hidden></div>
      <p id="ask-run-mode" class="meta" hidden></p>
      <button id="ask-without-commercial" type="button" class="secondary" hidden>Search without the Commercial filter</button>
      <div id="ask-interpretation" hidden></div>
      <form id="ask-filter-form" class="ask-filter-form" hidden><p class="eyebrow">Refine the interpretation</p><label><input id="ask-commercial" type="checkbox"> Commercial use codes</label><label>Permit group <input id="ask-permit-group" type="text" maxlength="100" placeholder="Electrical"></label><label>Exact permit type <input id="ask-permit-type" type="text" maxlength="100"></label><label>Published permit status <input id="ask-permit-status" type="text" maxlength="100"></label><label>Permit date: last <input id="ask-days" type="number" min="1" max="366" inputmode="numeric"> calendar days</label><label>City neighborhood <input id="ask-neighborhood" type="text" maxlength="80"></label><button type="submit" class="secondary">Run edited filters</button></form>
      <div id="ask-coverage" hidden></div>
      <ol id="ask-results" class="ask-results"></ol>
      <button id="ask-more" type="button" class="secondary" hidden>Load more results</button>
      <div id="ask-context" hidden></div>
    </div>
  </section>
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
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://cteco.uconn.edu https://server.arcgisonline.com https://gis.vgsi.com https://www.municitymedia.com; base-uri 'none'; form-action 'self'",
        },
      },
    );
  },
};
