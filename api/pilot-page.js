import { authorized, missingPilotKeys, pilotConfigured } from "../parcel/auth.js";

const header =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Parcel pilot · New Haven Civic Data</title><link rel="stylesheet" href="/parcel.css"></head><body><a class="skip" href="#main">Skip to content</a><header><a href="/index.html">New Haven Civic Data Directory</a><span>Private parcel pilot</span></header><main id="main">';
const footer =
  "</main><footer>Independent research preview. Confirm consequential facts with the original source.</footer></body></html>";
const login =
  '<section class="login"><h1>Parcel pilot</h1><p>Enter the pilot passcode to search New Haven property records.</p><form method="post" action="/api/pilot-session"><label>Passcode <input type="password" name="passphrase" autocomplete="current-password" required></label><button>Enter pilot</button></form>';
const app =
  '<h1>New Haven parcel records</h1><p>Search by street address, parcel ID, MBLU or assessor account number. Results are source records, not an official property determination.</p><form id="search-form"><label for="query">Parcel search</label><div class="search-row"><input id="query" name="query" type="search" placeholder="165 Church Street" maxlength="160" required><button>Search</button></div></form><p id="status" role="status" aria-live="polite"></p><section id="candidates" hidden><h2>Choose a parcel</h2><div id="candidate-list"></div></section><section id="parcel-summary" hidden><h2 id="parcel-title"></h2><p id="parcel-identifiers"></p><p class="small">Retrieved records may be incomplete or out of date. Each group shows its source and coverage.</p></section><nav id="group-nav" aria-label="Parcel data groups"></nav><div id="groups"></div><section id="feed-section" hidden><h2>Activity timeline</h2><p>Dated source records only. This is not a change-tracking feed.</p><div id="feed"></div><button id="feed-more" type="button" hidden>Load more events</button></section><script src="/parcel.js" defer></script>';
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
          ? `<p>Pilot access is not configured. Missing: ${missingPilotKeys().join(", ")}.</p>`
          : body) +
        footer,
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, no-store",
          "X-Frame-Options": "DENY",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'self'",
        },
      },
    );
  },
};
