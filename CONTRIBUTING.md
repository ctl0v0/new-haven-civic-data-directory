# Contributing

## Add or update a source

1. Copy templates/source.json to sources/a-stable-id.json. Match the filename to id.
2. Use only confirmed official or clearly attributed community sources. Preserve unknown costs, terms, contacts and refresh dates as unknown.
3. Write access steps another contributor can follow. Include direct, clickable links within How to access for each named source page, download, API, query or separate navigation destination needed to follow those steps. Use step_links; a link in evidence or related sources alone is not sufficient. Describe what each destination actually provides. If a destination is not yet known, say so rather than inventing a link.
4. Inspect a small sample when possible. Record its format and exact fields without assuming every year or layer has the same schema.
5. Add evidence URLs and short notes describing how they were checked. Say if a page was visible only through indexed search, returned 403, or required a browser.
6. Record checked_on when you perform a new check; changing wording alone does not refresh that date.
7. Run npm run build and review the static website before submitting a pull request.

Use HTTPS links. Do not enter credentials or private contact information. Prefer public departmental contacts. Dataset publishers remain responsible for their originals; entry maintainers own the documentation.

## Field conventions

- id: stable lowercase words joined by hyphens.
- source_type: official, official-vendor, or community.
- status: Source located, Access tested, Needs investigation, or In progress.
- formats: only inspected or explicitly advertised formats; clarify advertised-only access in limitations.
- fields: pairs of the source's field label and a plain-language meaning. Use an empty array if the schema is unverified.
- cost and terms: distinguish browser access from bulk exports and reuse rights. Do not turn unknown into free or open.
- evidence: URL and note describing the claim or check it supports.
- step_links: required nonempty list of objects with step (zero-based step index), label (exact text within that step), and url. The website makes that label clickable inside the access instruction.
- related: optional labeled links to separate sources or community copies.

A date the source claims to have been updated is not the date this directory checked it. Put reported update dates and their evidence in the entry's limitations or description until a structured update-date field is needed.

## Review

Check that all links point to the intended New Haven, Connecticut source; unrelated New Haven and New Hanover results can appear in search. Follow the How to access instructions and confirm that their necessary destinations are linked directly in the instructions. Review dates, field meanings, access scope, licensing and limitations. Confirm that missing data is described as unavailable rather than zero.

The build checks required fields, source IDs, status values, HTTPS links and evidence. It does not check remote link availability or certify data quality.

## Investigations and weekly meetings

Use the data-request issue form. Keep a short progress comment with sources checked, findings, unresolved questions and the next action. Use roadmap states in issue titles or comments; labels can be added when maintainers establish them. No pre-existing labels or GitHub Project are required.

Review a small set of active investigations at each meeting, assign a volunteer and record the result. Review each entry at least quarterly as a proposed starting cadence, and sooner after a contributor reports a change. Revisit the cadence once maintainers are assigned.

Prepare proposed city questions in docs/city-questions.md or in the relevant issue. Review before sending. Requests here are community investigations, not official records requests.

## Build readiness assessments

Every source requires build_readiness: level, summary, preparation (list), assessed_on, next_review_on, review_owner and evidence (URLs already in the source evidence list). Read the public [label definitions](https://new-haven-civic-data-directory.vercel.app/build-readiness.html). Level values are workflow-tested, sample-tested, preparation-needed and not-assessed. Match the judgment to the exact evidence; access method alone never earns a higher level. Preserve unknown preparation as unknown until an actual source sample is inspected.

Document a representative input, reproducible procedure and checked output before selecting workflow-tested. For sample-tested, state what the sample did and did not prove. Record remaining work for every other level. Include costs, terms and freshness uncertainties in the entry even when structured access succeeds.

Start with a quarterly review window (90 days), and reassess sooner after access failures, field/format changes, new evidence or corrections. Set review_owner to the volunteer responsible, or Unassigned honestly. Do not advance assessed_on or next_review_on merely because wording changed. Updating the record regenerates the page, catalog and agent brief. Copied briefs remain snapshots.

The weekly Review build readiness workflow flags overdue assessments and validates their structure. It does not query sources or certify data. Review-due flags also use the visitor’s current date on the site. Run node scripts/review-readiness.mjs to check reviews locally.
