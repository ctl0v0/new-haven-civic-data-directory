# Investigation roadmap

## V1

Six initial entries cover Alders, assessments, parcels, finance, ward boundaries and meetings/legislation. Ward boundaries and legislative records are modest additions to the original four areas: they support finding representatives by location and tracking government decisions.

The static website, JSON catalog, source template and GitHub request/correction forms are part of V1. An entry may be published with clearly described gaps; publication does not mean access has been fully verified.

## Current priorities

| Priority | Investigation | Current state | Next action |
| --- | --- | --- | --- |
| 1 | Official roster and contacts | Source located | Inspect the city page in a browser and identify the correction route |
| 1 | Assessment schema and bulk access | City API metadata and one-record query verified; browser landing page inspected | Compare a known property across sources; clarify valuation dates, exports, fees and terms |
| 1 | Parcels, addresses and zoning | Three city API metadata/one-record JSON checks passed | Test geometry, spatial matching, pagination, terms and freshness |
| 1 | Ward boundaries | Needs investigation | Locate a current downloadable layer and confirm effective date |
| 1 | Finance access | Official reports located; file-level access and coverage checks in progress | Check current city downloads and published maintenance contact |
| 1 | Legistar | Calendar inspected | Inspect one agenda and record; investigate supported exports |
| 2 | Website launch | Live on Vercel with separate source pages | Continue usability review and source corrections |

All investigation owners are unassigned. Request one small task at a weekly meeting; do not imply a city partnership exists.

## Request workflow

**Triage → Investigating → Awaiting information → Documented**

Use Deferred with a reason for requests that cannot currently proceed. Return an investigation to an earlier state when access changes. Close only when the useful result, limitations and outstanding work are recorded.

A request should specify its intended use, geography, time span, fields, already checked sources, and optionally a comparable city's example. Investigate existing records before proposing new collection infrastructure. Draft any city outreach for review.

## Additional candidates

| Candidate | What it could enable | Why investigate | Gate before inclusion as a usable source |
| --- | --- | --- | --- |
| Building permits and inspections | Development tracking and property research | Hartford and Cambridge publish useful precedents | Confirm New Haven source, fields, coverage, bulk access, fees and terms |
| Service requests | Neighborhood maintenance analysis | Somerville and Hartford publish service-request data; New Haven has SeeClickFix discovery routes | Verify supported read access, geographic scope, historic coverage and permitted reuse |
| Zoning and land use | Site-selection and planning tools | City zoning map discovery pages already exist | City layer and small JSON query verified; confirm classifications, effective dates and spatial access |

These are candidates, not verified New Haven datasets. Do not expand V1 with all three before volunteers and practical access paths exist.

## Future backlog

Vendor payments and procurement; parks and public facilities; transportation; environmental conditions; aggregated demographic reference data.

Later capabilities: community-maintained exports, documented refresh jobs and checksums, APIs and a small MCP server. Start these only for a specific need with an assigned maintainer, established acquisition/usage terms and an achievable refresh process. No such infrastructure is required for this directory's launch.

## V1 completion

A visitor can browse without using GitHub, open source details, understand access and limitations, and reach the original source. An agent can read source JSON or the generated catalog. Contributors can request data or propose a correction. Every entry has evidence and explicit unknowns; remaining access checks have next actions.
