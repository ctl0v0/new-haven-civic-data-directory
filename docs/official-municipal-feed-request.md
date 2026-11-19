# Draft request for an official recurring New Haven municipal record feed

This is a technical request to review with the City of New Haven and its municipal record-system operator. It has **not** been sent. The parcel MCP currently reads public City and State records and preserves their source IDs and links. It needs a documented, repeatable citywide source before it can make complete citywide claims about municipal work and business records.

## What the public service establishes today

The City's public Municity permit type catalog listed 269 types in the November 19, 2026 check. Two searches reached the checked 10,000-row response bound (`Building Permit` and `Electrical Permit`); two returned malformed JSON (`Plumbing Permit` and `Rehab-Residential`). The other 265 type runs indexed 70,600 distinct published permit IDs. Of those, 19,943 lacked a verified link to a City parcel. A sampled `Heating Permit` row had no `PrintKey`, `Parcel_ID`, or `LegalAddress` in either the type search or exact-ID search. These observations describe the public responses checked; they are not assertions about the City's complete underlying database.

The public parcel service can return Permit, Application, Complaint, Contact, License, Occupant, Document and Certificate children for a verified vendor parcel. A permit or application can return public Fee, Task, Inspection, Document, Contact, Flag and Communication metadata. The service sometimes omits category keys. An omitted category does not establish a zero count.

An exact-ID check of official permit rows found `Hood - C` records `571466` and `572909` with nonblank `PrintKey`, `PrintKey_Parcel`, and vendor `Parcel_ID` values that did not join to the current City MBLU index. Another checked `Gas Service Lateral` row (`511821`) published `LegalAddress` but neither parcel field; record `513516` published all three. These are examples for crosswalk review, not inferred City parcel assignments. The index now retains the vendor identifiers when a type refresh returns them, and a read-only address-point audit measures candidate matches and disagreements before any address-based linkage is considered.

## Requested delivery

Please identify a supported **recurring machine-readable export or documented paged API** for the public New Haven records below. CSV, JSON, or a documented API is suitable if it provides a stable snapshot or cursor, published record IDs, a total row count, an extraction or revision time, and a way to detect changed and deleted records. A one-time PDF or undocumented response-size increase would not meet the completeness requirement.

1. **Permit parents:** `Permit_ID`, permit number, exact published type and status, all published date fields, `Application_ID`, `Parcel_ID`, `PrintKey`, `PrintKey_Parcel`, `LegalAddress`, and the source's parcel association fields. Please document the meaning of each date and whether it is a permit, application, review, issuance, or modification date.
2. **Related work rows:** Applications, public fees and payments, public review tasks and reviewing departments, inspections, public contact roles, and public document metadata. Please provide stable IDs, parent IDs, status and date fields, and whether each relation is complete for an entity. Document file contents, complaint narratives, internal notes and communication bodies are outside this request.
3. **Other parcel children:** Public business licenses, occupants, complaints and certificates, with stable IDs, source-published status, addresses, parcel relationship and historical/voided rows. Please specify whether a missing category means zero records or an incomplete/omitted response.
4. **Parcel crosswalk:** A supported mapping from the vendor's `Parcel_ID` and `PrintKey` to the City's authoritative parcel PID/MBLU or another official parcel identifier. Please include alternate and historical address relationships only where explicitly recorded. Records without a parcel relationship should remain identifiable as such.
5. **Completeness controls:** Count and ID inventory by entity and, where applicable, permit type; stable page ordering or cursor semantics; maximum page size; change and deletion semantics; publisher update time; and a public-field definition for contact details.

## Validation before import

We will compare each delivered count with unique IDs and fetched rows, repeat a page or snapshot check, reject conflicting duplicate IDs, and retain a source-run ledger with any missing, ambiguous or unlinked parcel association. A failed refresh will not replace the last validated run. Historical statuses and dates will remain source-labeled. We will test known public records, including Hood - C permit `M-23-00357` on City parcel `12846`, before enabling citywide MCP predicates. Application approval will be filtered by its own published field or a specifically labeled review-task status/date; `PermitDate` will not be relabeled as approval.
