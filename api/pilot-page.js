import {
  authorized,
  pilotConfigurationIssues,
  pilotConfigured,
  pilotPreviewEnabled,
} from "../parcel/auth.js";
import { businessCategoryGroups, businessRadii, DEFAULT_BUSINESS_RADIUS,
  DEFAULT_STOREFRONT_RADIUS, GOOGLE_BUSINESS_MATCH_LIMIT, STOREFRONT_RADII } from "../parcel/nearby-business-count.js";

const header =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Parcel pilot · New Haven Civic Data</title><link rel="stylesheet" href="/leaflet/leaflet.css"><link rel="stylesheet" href="/parcel.css"></head><body><a class="skip" href="#main">Skip to content</a><header><a href="/index.html">New Haven Civic Data Directory</a><span>Private parcel pilot</span></header><main id="main">';
const footer =
  "</main><footer>Independent research preview. Confirm consequential facts with the original source.</footer></body></html>";
const login =
  '<section class="login"><h1>Parcel pilot</h1><p>Enter the pilot passcode to search New Haven property records.</p><form method="post" action="/api/pilot-session"><label>Passcode <input type="password" name="passphrase" autocomplete="current-password" required></label><button>Enter pilot</button></form>';
export { pilotPreviewEnabled as queryWorkbenchVisible };
const previewToolsVisible = pilotPreviewEnabled();
const askHidden = previewToolsVisible ? "" : " hidden";
const nearbyBusinessResearch = previewToolsVisible ? `
  <section id="nearby-business-research" aria-labelledby="nearby-business-title" data-match-limit="${GOOGLE_BUSINESS_MATCH_LIMIT}" hidden>
    <h2 id="nearby-business-title" tabindex="-1">Nearby place research</h2>
    <form id="nearby-business-form">
      <fieldset id="nearby-business-fields" aria-label="Nearby place filters" disabled>
        <div class="nearby-business-field"><label for="nearby-business-origin">Search from</label><select id="nearby-business-origin" name="origin" required><option value="">Choose a City address</option></select></div>
        <div class="nearby-business-field nearby-business-type-field">
          <label for="nearby-business-category">Place category</label>
          <select id="nearby-business-category" name="group" required>
            ${Object.keys(businessCategoryGroups).map((group) => `<option>${escapeHtml(group)}</option>`).join("")}
          </select>
        </div>
        <div class="nearby-business-field"><label for="nearby-business-radius">Radius</label><select id="nearby-business-radius" name="radius_meters">
          ${Object.entries(businessRadii).map(([meters, label]) => `<option value="${meters}"${Number(meters) === DEFAULT_BUSINESS_RADIUS ? " selected" : ""}>${label}</option>`).join("")}
        </select></div>
        <details id="nearby-business-subcategories">
          <summary>Subcategories <span id="nearby-business-selection">All types</span></summary>
          <p class="meta">Matches any checked type. Leave all unchecked to search the full category.</p>
          <div class="nearby-business-subcategory-tools">
            <input id="nearby-business-type-filter" type="search" aria-label="Filter subcategories" aria-controls="nearby-business-type-list" placeholder="Filter subcategories" autocomplete="off" maxlength="80">
            <button type="button" id="nearby-business-clear-types" class="secondary" hidden>Clear selections</button>
          </div>
          <div id="nearby-business-type-list" role="group" aria-label="Subcategories"></div>
          <p id="nearby-business-no-types" class="meta" role="status" hidden>No subcategories match.</p>
        </details>
        <button type="submit" id="nearby-business-count" disabled>Count places</button>
      </fieldset>
    </form>
    <template id="nearby-business-type-catalog">
      ${Object.entries(businessCategoryGroups).map(([group, entries]) => `<div data-group="${escapeHtml(group)}">${
        Object.entries(entries).map(([id, label]) => `<label><input type="checkbox" name="subcategory" value="${id}"> <span>${escapeHtml(label)}</span></label>`).join("")}</div>`).join("")}
    </template>
    <p id="nearby-business-origin-note" class="meta" hidden></p>
    <p id="nearby-business-status" role="status"></p>
    <div id="nearby-business-result" aria-live="polite" hidden></div>
  </section>` : "";
const storefrontResearch = previewToolsVisible ? `
  <section id="storefront-opportunity" aria-labelledby="storefront-opportunity-title" hidden>
    <h2 id="storefront-opportunity-title" tabindex="-1">Vacant storefront analysis</h2>
    <form id="storefront-opportunity-form">
      <fieldset id="storefront-opportunity-fields" disabled>
        <div class="storefront-input">
          <label for="storefront-origin">Storefront address</label>
          <select name="origin" id="storefront-origin" required></select>
        </div>
        <label class="storefront-check"><input type="checkbox" name="confirmed_vacancy" required> I’ve confirmed this storefront is vacant.</label>
        <div id="storefront-radius-options" hidden>
          <div class="storefront-input">
            <label for="storefront-radius">Search radius</label>
            <select id="storefront-radius" name="radius_meters">
              ${STOREFRONT_RADII.map((meters) => `<option value="${meters}"${meters === DEFAULT_STOREFRONT_RADIUS ? " selected" : ""}>${businessRadii[meters]}</option>`).join("")}
            </select>
          </div>
          <button id="storefront-radius-run" type="submit" value="radius" aria-controls="storefront-report" aria-describedby="storefront-status" formnovalidate disabled>Run neighborhood analysis</button>
        </div>
        <div id="storefront-walking-options" hidden>
          <details>
            <summary>Space and site checks <span class="meta">Optional</span></summary>
            <div class="storefront-input">
              <label for="storefront-area">Verified usable storefront area in square feet</label>
              <input type="number" name="storefront_sq_ft" id="storefront-area" min="1" max="1000000" step="1">
            </div>
            <p class="meta">Check a use if you’ve verified the space and basic building requirements for it.</p>
            <div id="storefront-space-checks" class="storefront-space-checks"></div>
          </details>
          <button id="storefront-run" type="submit" class="secondary" aria-controls="storefront-report" aria-describedby="storefront-status" disabled>Run walking analysis</button>
        </div>
      </fieldset>
    </form>
    <p id="storefront-status" role="status"></p>
    <div id="storefront-report" aria-live="polite" hidden></div>
  </section>` : "";
const app = `
  <nav class="parcel-tabs" role="tablist" aria-label="Parcel explorer views">
    <button id="records-tab" type="button" role="tab" aria-selected="true" aria-controls="records-view">Search records</button>
    <button id="browse-tab" type="button" role="tab" aria-selected="false" aria-controls="browse-view">Browse parcel map</button>
    <button id="activity-tab" type="button" role="tab" aria-selected="false" aria-controls="activity-view"${askHidden}>Activity</button>
    <button id="guide-tab" type="button" role="tab" aria-selected="false" aria-controls="guide-view">Data guide</button>
    <button id="ask-tab" type="button" role="tab" aria-selected="false" aria-controls="ask-view"${askHidden}>Test a question</button>
  </nav>
  <div id="records-view" role="tabpanel" aria-labelledby="records-tab">
  <section class="search-panel" aria-labelledby="page-title">
    <p class="eyebrow">New Haven parcel explorer</p>
    <h1 id="page-title">What do city records say about this building?</h1>
    <p class="search-intro">Search an address or parcel ID to review building facts, business records, permits, and a dated history. Each result links back to its source.</p>
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
      <h2 id="parcel-title" tabindex="-1"></h2>
      <p id="parcel-identifiers" class="meta"></p>
      <p id="parcel-match" class="match-note" hidden></p>
      <div class="parcel-addresses">
        <h3>City-mapped addresses</h3>
        <div id="parcel-address-list" aria-live="polite"></div>
      </div>
      <p class="small parcel-overview-note">Records can be incomplete or old. A business address or license is evidence to check, not proof of current occupancy.</p>
      ${previewToolsVisible ? '<a id="parcel-report-link" class="parcel-report-link" hidden>Generate property report</a>' : ""}
      ${previewToolsVisible ? '<button id="nearby-business-open" class="secondary" type="button" aria-controls="nearby-business-research" aria-expanded="false">Research nearby places</button>' : ""}
      ${previewToolsVisible ? '<button id="storefront-opportunity-open" class="secondary" type="button" aria-controls="storefront-opportunity" aria-expanded="false">Analyze a vacant storefront</button>' : ""}
    </div><figure id="parcel-photo" class="parcel-photo" hidden>
      <img id="parcel-photo-image" alt="Verified parcel photo">
      <figcaption>Official parcel photo · date not published. <a id="parcel-photo-source" target="_blank" rel="noopener noreferrer">View source</a></figcaption>
    </figure></div>
  </section>
  ${nearbyBusinessResearch}
  ${storefrontResearch}
  <section id="snapshot" class="snapshot" aria-labelledby="snapshot-title" hidden>
    <div class="p-section__head"><h2 class="t-section" id="snapshot-title">At a glance</h2></div>
    <div id="snapshot-grid"></div>
    <div id="overview-counts"></div>
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
  <section id="feed-section" class="timeline-section" aria-labelledby="timeline-title" hidden>
    <div class="section-heading p-section__head"><div><p class="eyebrow">Dated records</p><h2 class="t-section" id="timeline-title">Timeline</h2></div><p>Source dates, not a change log. Undated contacts remain in the Activity records.</p></div>
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
          <div id="browse-use-key"><ul id="browse-use-legend" aria-label="Recorded use legend"></ul><p class="meta">The ochre outline marks the selected parcel. Unclassified parcels lack a verified use classification.</p></div>
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
  <section id="activity-view" role="tabpanel" aria-labelledby="activity-tab" hidden>
    <div class="city-activity">
      <h1>New Haven Activity</h1>
      <div class="activity-date-presets" role="group" aria-label="Quick date ranges">
        <button class="secondary" type="button" data-activity-days="7" aria-pressed="false">Past 7 days</button>
        <button class="secondary" type="button" data-activity-days="30" aria-pressed="false">Past 30 days</button>
      </div>
      <form id="activity-filters">
        <label>Neighborhood <select name="neighborhood"><option value="">All neighborhoods</option></select></label>
        <label>From <input name="from" type="date"></label>
        <label>Through <input name="to" type="date"></label>
        <label>Activity type <select name="activity">
          <option value="">All activity</option><option value="sale">Sales</option>
          <option value="permit">Permits</option><option value="license">Licenses</option>
          <option value="application">Applications</option><option value="review">Reviews</option>
          <option value="inspection">Inspections</option>
        </select></label>
        <button type="submit">Apply filters</button>
        <label id="activity-permit-type" hidden>Exact permit type
          <input name="permit_type" type="text" disabled list="activity-permit-types" maxlength="100" placeholder="Any permit type">
          <datalist id="activity-permit-types"></datalist>
        </label>
      </form>
      <p id="activity-status" role="status" aria-live="polite"></p>
      <details id="activity-coverage" hidden><summary>Source coverage</summary><ul id="activity-sources"></ul></details>
      <button id="activity-reset" class="secondary" type="button" hidden>Reset filters</button>
      <div id="activity-results"></div>
      <button id="activity-more" class="secondary" type="button" hidden>Load more activity</button>
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
  <script src="/leaflet/leaflet.js" defer></script><script src="/parcel.js" type="module"></script>`;
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}
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
