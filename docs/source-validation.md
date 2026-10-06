# Source validation

Use one shared [Validate civic sources workflow](https://github.com/ctl0v0/new-haven-civic-data-directory/actions/workflows/validate-sources.yml). Run all configured checks or select Alders/property. It also runs weekly. Reports and temporary verification exports are saved as seven-day workflow artifacts.

For local use, run `node scripts/validate-sources.mjs`, or append `alders` or `property`. Node.js 22 and Python 3 are required. No credentials or dependencies are needed for these public read-only source checks.

## Current checks
- Alders: fetch one official HTML page, find expected headings, preserve all representative rows, validate unique numbered wards, and report missing identifiers without guessing. The current city table has one empty WARD cell; the export preserves null.
- City property APIs: read parcel/address/zoning metadata and one JSON record per layer. Report missing expected fields and request failures. Attribute values are not logged.
- Finance, meetings/legislation and ward downloads: not configured yet. The report says so explicitly; an overall successful run does not mean every source is verified.

The registry is validation/sources.json. Small source-specific adapters share one runner and reporting format; a universal parser cannot correctly handle every API, HTML table and document.

## Results
- passed: the configured assertions succeeded. Inspect warnings for known data gaps.
- changed: expected fields, structure or check output were not confirmed.
- blocked: the source rejected or throttled the request.
- unavailable: a request or checker could not finish.
- not-configured: no suitable source check exists yet.

A 200 response alone is not a pass. Checks inspect expected content and small samples. Failures do not imply a source is unavailable in every browser or environment.

Checks use bounded requests and timeouts. They do not bypass authentication or anti-bot controls, certify accuracy/current officeholding/coverage/reuse rights, or automatically promote build readiness. Search tools support discovery rather than deterministic validation. Add browser automation only if a demonstrated source needs JavaScript.

## Maintenance
Review a changed or failed report, verify the source, and update canonical documentation and readiness evidence. Do not advance assessment dates because a schedule ran. Assign a review owner during weekly triage.

Parser tests use minimal synthetic fixtures based on observed formats. No residential addresses or phone values are written to reports. The temporary roster export contains published representative names and ward labels only; it is not a maintained city-data mirror.
