# Website data-request intake plan

## Goal
Let visitors request New Haven data from the website without a GitHub account. GitHub issues remain the investigation tracker.

## Visitor experience
Add a separate Request data page linked from the existing navigation. Require a short request title, the data/fields needed, and intended use. Optional fields: geography/time span, sources already checked, other-city example links, and preferred access format. Match the existing GitHub request form.

Before submission, state plainly: requests will be published as public GitHub issues; do not include personal or confidential information. Do not collect private email addresses in V1. Offer an optional public attribution name only if needed later.

Show accessible validation and submission progress. Preserve entered text after errors. On confirmed success, display a link to the created issue. Keep the direct GitHub form as a fallback.

## Small implementation
Keep the generated static directory and add one Vercel Node.js function at /api/data-request. Accept POST only. Validate bounded field lengths and total payload size on the server. The destination repository is fixed server-side; visitors cannot choose repositories, assignees or labels.

Create a consistently formatted GitHub issue with the request fields and an indication that it came from the website. Treat submitted text as untrusted content and avoid unsolicited account mentions. Do not log request bodies.

Use a fine-grained GitHub token scoped to this repository with Issues read/write permission, expiration and a rotation owner. Store it only as a server-side Vercel environment variable. The existing Codex connector does not give the website runtime a credential.

## Abuse protection and errors
Use Cloudflare Turnstile with mandatory server-side verification, a hidden spam-trap field, and request/body limits. Add a Vercel firewall rate-limit rule if available for the current plan; do not rely on in-memory serverless rate limiting. No database is needed for the first version.

Reject invalid or failed spam checks before contacting GitHub. Disable duplicate clicks during submission. Never claim success before GitHub confirms issue creation. On uncertain upstream/network failures, warn that a request may have been received and link to existing requests before retrying; do not automatically retry writes.

## Delivery sequence
1. Implement the static form and server function; test validation, spam rejection, public posting notice, success, failure and credential absence.
2. Configure the repository-scoped token and Turnstile keys through provider settings. Restrict secrets and allowed hostnames to intended deployments; previews must not silently write to production.
3. Verify form/function coexistence with the static build and existing source pages.
4. Run one clearly identified end-to-end test and check that the issue body is correct and secrets are absent from site output/logs.
5. Enable the website form and document triage ownership. Requests start unassigned; maintainers review them at weekly meetings.

## Launch prerequisites
A repository-scoped GitHub credential and Turnstile configuration must be provisioned securely. Select one intake steward to review requests. Anonymous issue creation should remain disabled until credentials and spam verification are configured.

## Completion criteria
A visitor without a GitHub account can submit a valid request and receive its public issue link. Invalid/spam submissions create no issue. Existing browsing and direct GitHub submission still work. No database, user accounts, attachments or automatic agent actions are introduced.

## References
- [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js)
- [GitHub issue creation API](https://docs.github.com/en/rest/issues/issues#create-an-issue)
- [Turnstile server verification](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
