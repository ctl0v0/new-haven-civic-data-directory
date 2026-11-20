# New Haven permit application directory

Open the private Data Guide and select **Permit applications**. Browse by permit type or by City directory entry. The guide reports the match count for the current filters and coverage for the full catalog. Directory entries remain available when the municipal catalog check fails.

The MCP tool `list_permit_applications` and protected `GET /api/v1/permit-applications` use the same read service. For an exact type lookup, pass `permit_type` or the published `permit_type_id`. Search uses `q`. Filter by `department`, `status` or `route`. Set `view=directory` to see City application entries and their associated types. Pass `next_cursor` back as `cursor` with the same filters to continue. The cursor expires when the catalog or reference data changes.

A verified association has a City application or walkthrough identified for that type or scenario. Shared instructions cover the department or activity without establishing the exact application. The City Plan ADU walkthrough applies to the documented `Addition` scenario. Its CitySquared department and type are shown alongside the portal entry link.

The reference inventory lives in `data/permit-applications.json`. It records official source links, reviewed application names, form links or directory listings, filing routes, and exact or shared catalog mappings. Live checks test public URL reachability. The manual review date and applicant menu status come from the latest reviewed evidence. An unreachable source leaves its reviewed reference visible with availability marked unverified.

When reviewing the current CitySquared applicant menu, use a permitted read-only session and stop before saving an application. Confirm the New Haven tenant, department and type, and retain only public links and published instructions. Classify direct CitySquared instructions separately from a City-published walkthrough. Add a type-specific start link only after verifying a reusable new-application destination and its check date. A form listed on a City directory can point to that listing until its direct download is verified.

Start with the [Permit & License Center](https://www.newhavenct.gov/government/departments-divisions/office-of-building-inspection-enforcement/permit-license-center-applications), [Building Department](https://www.newhavenct.gov/government/departments-divisions/office-of-building-inspection-enforcement/building-department-applications), and [CitySquared](https://www.citysquared.com/#/app/NewHavenCityCT/landing).
