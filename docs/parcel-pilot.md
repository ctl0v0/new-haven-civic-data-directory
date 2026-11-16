# Parcel data pilot

This pilot starts from an official New Haven parcel record. It queries public sources at request time and caches successful lookups for five minutes using Vercel Runtime Cache, with an in-process fallback for local development. It does not store a parcel dataset or source history. The static directory remains public; the pilot page, REST routes and MCP endpoint require private access.

## Run and configure

Use Node.js 24 or later. Run `npm ci`, `npm test`, and `npm run build`. For a local Vercel preview, set the variables below in `.env.local` and run `npx vercel dev` in a linked Vercel project. Do not commit the env file.

| Variable | Use |
| --- | --- |
| `PILOT_PASSPHRASE` | Shared passcode for the `/parcel` browser login. |
| `PILOT_COOKIE_SECRET` | Signs seven-day, secure, HTTP-only pilot cookies. |
| `PILOT_API_TOKEN` | Bearer token for API clients and MCP clients. |
| `PILOT_API_KEYS` | Optional JSON array of invited client IDs and SHA-256 token hashes. |
| `PILOT_DISABLE_SHARED_TOKEN` | Set to `1` after individual keys work to revoke the shared API token. |

Each value must contain at least 24 characters. Configure all three as sensitive Vercel environment variables before testing a deployed preview. The endpoints fail closed when any value is missing. Rotate the passcode and token after the pilot; changing the cookie secret invalidates active browser sessions. The browser and API use the same private access policy, while MCP requires the bearer token. Do not put the bearer token in the browser page or a public client configuration.

For the invited pilot, generate one random token per person and store only its SHA-256 hash in `PILOT_API_KEYS`. Example entry: `[{"id":"reviewer_1","sha256":"<64 lowercase hex characters>","active":true}]`. Generate a token with `node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'` and calculate its hash locally with `node -e 'console.log(require("node:crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' '<token>'`. Share the raw token privately with that reviewer and never commit it. Set `active` to `false` or remove the entry, then redeploy, to revoke access. Once clients have moved to their own keys, set `PILOT_DISABLE_SHARED_TOKEN=1` and redeploy. The shared token remains required as an existing configuration value for now, even while disabled. Runtime logs include route, status and client ID, without parcel queries or tokens.

After adding or changing Vercel variables, create a new deployment for the selected environment; an existing deployment keeps its original environment snapshot. For a branch-specific Preview pilot, scope all three values to the same Git branch.

For any wider rollout, add rate limits at the deployment edge and review the access terms and request budgets of each upstream source. This pilot uses bounded request sizes, timeouts, fixed upstream hosts, and a short cache; it is not a bulk downloader.

## Review flow

Open `/parcel`, enter the pilot passcode, and search by address, parcel ID, MBLU or assessor account number. If a query yields multiple parcel records, choose an official parcel ID and object ID. The page shows six groups, source status and coverage, raw public record fields, original links, and a dated activity timeline. No map is needed for this review flow. The URL can preserve a selected parcel ID and object ID for another authenticated reviewer.

The resolver checks the city's parcel-address field and matching city address points for every street-address search. It intersects address-point coordinates with parcel polygons, so a building address can surface a parcel whose listed address differs from the search. That difference is labeled on the candidate; the resolver does not silently choose between parcels. Address-point association is spatial evidence, not proof of a legal address. It preserves every zoning polygon returned for a parcel. Parcel geometry is returned in longitude and latitude for intersections. A documented alias for 50 Fitch Street is included only for a reviewed planning case.

The parcel-address route requires the searched house number and an exact normalized returned address. This prevents a search for `3 Edwards St` from listing `30`, `34` or `360 Edwards St` ahead of the address-point parcel. In the live source, the `3 Edwards St` address point intersects parcel 10386, whose official parcel address is `990 State St`. That relationship is shown as a spatial candidate; it is not an assertion that every business using 3 Edwards occupied the parcel.

## REST API

Send `Authorization: Bearer <PILOT_API_TOKEN>` from a private client. A signed browser session cookie also works for REST. Responses use `Cache-Control: private, no-store` even though upstream lookups are cached inside the server. Failed sources are reported per source so a missing result is distinguishable from an unavailable source.

| Route | Purpose |
| --- | --- |
| `POST /api/v1/resolve` with JSON `{"query":"165 Church Street"}` | Resolve to zero, one, or multiple official parcel candidates. |
| `GET /api/v1/parcel?parcel_id=...&objectid=...` | Selected parcel identity and available groups. |
| `GET /api/v1/overview?parcel_id=...&objectid=...` | Compact counts, source statuses and five recent dated record references. |
| `GET /api/v1/records?parcel_id=...&objectid=...&group=property&limit=25&cursor=...` | One grouped, paginated page of source records and source statuses. |
| `GET /api/v1/feed?parcel_id=...&objectid=...&limit=25&cursor=...` | Dated source records, newest first. |
| `GET /api/v1/sources` | Source catalog, modes, limitations and deliberate exclusions. |

`objectid` is required when an official `parcel_id` maps to more than one source feature. Page size is capped at 50. Each record carries its source ID, source record ID, fields, match method, source URL, source event date where known, and retrieval time. The feed contains dated source records; it does not detect changes between requests. The API does not claim that an empty source response proves that no event exists.

## MCP

`/mcp` exposes Streamable HTTP MCP with stateless requests and bearer authentication. It registers `resolve_parcel`, `get_parcel`, `get_parcel_overview`, `get_parcel_records`, `get_parcel_feed`, and `list_sources`, plus source-coverage and matching-method resources. Start with `resolve_parcel`, then `get_parcel_overview`; request one group with `get_parcel_records` only when details are needed. The MCP tools call the same service as REST, including ambiguity and partial-source behavior. Point an MCP client at `https://<deployment>/mcp` and send `Authorization: Bearer <individual pilot token>` on each request. Keep this token in the client's private secret store.

## Source coverage

The machine-readable catalog is published in `dist/parcel-source-catalog.json` and returned by `/api/v1/sources`. `live` means the adapter makes a source request when queried; it does not certify source completeness or currentness. `curated` means selected, reviewed evidence only. `gap` means no safe parcel association has been verified. `paused` means deliberately excluded from collection for now. Runtime source errors appear as `unavailable`, and truncated responses as `partial`.

| Group | Live or curated | Visible gaps |
| --- | --- | --- |
| Property | City parcels and address points; Vision assessor card | Tax bill and City Clerk land-record search links only; no automated parcel joins or balances. Commercial vacancy is also a gap. |
| Geography | Zoning, wards, neighborhoods | Boundary currency and zoning interpretation remain source limitations |
| Representation | Board of Alders roster through an unambiguous ward; city GIS CMT district intersections and provisional GIS contact fields | CMT contact details can differ from the city CMT page and require confirmation. |
| Activity | Municity children, LCI Case HQ case metadata, LCI managed lots, selected planning case | LCI licensing and other inspection or enforcement feeds remain unverified. |
| Business | Named municipal license records linked by the parcel MBLU; CT Business Registry Master and State Licenses address candidates | Registry principals require a reviewed entity join |
| Nearby | Complete Streets projects within 250 feet | Service requests; area context is paused |

Meetings, agendas and legislation, and budgets and monthly finance reports are outside this pilot's scope. CMT meeting schedules are not collected. State address matches are candidate links and do not prove occupancy, ownership or current use. Managed lots do not prove vacancy. Nearby records are kept in their own group. The Complete Streets source appears stale, so its event status needs original-source review.

CMT districts are resolved at request time by intersecting the official parcel geometry with the city's CMT district FeatureServer. Every intersecting district is returned; overlapping districts are marked partial rather than selecting one. The same city GIS layer provides manager, neighborhood specialist and chair contact fields. Those contacts are marked provisional because the city's CMT webpage can differ from the GIS layer. No district shapes or contact roster is stored in this project.

Named municipal business licenses are a compact view of the same live Municity parcel children shown in Activity. The verified MBLU links them to the parcel, and the business group preserves the vendor's license status and recorded address. For parcel 10386, this includes a historical `Weary Hobo LLC aka Bar August` food-service license whose vendor status is `Void`. The municipal record lists `990 State St`; it does not independently establish the historical `3 Edwards St` business address. No business roster or address alias is stored locally.

LCI is queried at request time by the assessor PID. The adapter requires matching PID and address on the public property page and returns only case number, type, status, filed date, listed case fine, and link. It does not fetch case-detail pages, complaint narratives, or attachments. A listed fine is source-reported and should be confirmed before use. The real-estate tax and land-record sources expose links and honest `unavailable` statuses until a permitted live lookup and parcel join are verified. SearchIQS is not scraped. The API stores no parcel dataset, snapshots, or change history; successful lookups use the existing five-minute runtime cache.

## Verification and limits

`npm test` covers private access, ambiguous parcel IDs, multiple intersecting zoning records, partial feed behavior when an upstream fails, and MCP initialization. `npm run build` validates the original directory and emits the pilot source catalog. Live upstream smoke tests should use at least one known parcel, one ambiguous or missing address, and each live adapter from the deployed preview before inviting reviewers. Network requests from the implementation workspace to New Haven GIS were blocked by the workspace proxy during development, so those live checks remain a deployment gate. Public source terms, historical coverage, and field freshness still need source-level review.
