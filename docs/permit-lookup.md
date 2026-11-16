# Match New Haven permits to an address or parcel

The [canonical source entry](../sources/building-permits.json) documents New
Haven's Municity / CitySquared portal and its public JSON parcel queries.
This recipe starts with a property address or existing parcel record,
resolves its Municity parcel, and retrieves the permit and other records
associated with that parcel. It repeats one commercial-property example
without credentials, dependencies or changes to city records. These vendor
endpoints are not a confirmed supported open-data API.

## Choose the property to match

Use the [property assessment lookup](https://new-haven-civic-data-directory.vercel.app/sources/assessor.html)
or [parcel and address layers](https://new-haven-civic-data-directory.vercel.app/sources/gis-parcels.html)
to identify the property from its address and confirm its parcel and location.
An address can refer to multiple units or parcels. Resolve that ambiguity
before associating permits with it.

For a property with an assessor MBLU, split the identifier on `/`, trim and
remove empty segments, then join with spaces, retaining leading zeros. In the
tested example, `241/ 0234/ 00200/ /` becomes the Municity PrintKey
`241 0234 00200`. Compare the returned legal address with the original property;
this one example does not establish a universal identifier join.

If an MBLU is missing or has no match, coordinates independently confirmed to
lie on the property provide another lookup route. Check the returned parcel
identity and investigate multiple matches or differing addresses.

Keep identifier systems separate: Municity `Parcel_ID` identifies the parcel
used by its related-record endpoint. It is not the city GIS `parcel_id` or the
assessor's `account_number`. Retain each source identifier in its own field.

## Reproduce the sample

Run this Python 3 snippet. It requests a parcel by PrintKey, checks the same
parcel by location, then requests its related record groups. It prints only
the parcel identifier, group counts and selected field names. Full responses
remain in memory and are not saved or printed.

```sh
python3 - <<'PY'
import json
from urllib.parse import urlencode
from urllib.request import Request, urlopen

base = 'https://services5.municity5.com/M5Services/M5Service.svc'

def get(path, params=None):
    url = base + path + ('?' + urlencode(params) if params else '')
    request = Request(url, headers={'Accept': 'application/json', 'SourceId': '2'})
    with urlopen(request, timeout=20) as response:
        payload = response.read(10_000_001)
    assert len(payload) <= 10_000_000, 'Response exceeds sample size limit'
    return json.loads(payload)

search = get('/GetM5Data', {
    'Customer': 'NewHavenCityCT', 'entity': 'Parcel', 'entity_id': '',
    'fieldtype': 'text', 'mapid': '', 'mapobject': '', 'module': '',
    'numrecs': '5', 'operator': '=', 'pid': '', 'searchfield': 'PrintKey',
    'section': '', 'value': '241 0234 00200',
})
assert int(search['total']) == 1 and len(search['rows']) == 1
parcel = search['rows'][0]
assert parcel['Parcel_ID'] == 13397
assert parcel['PrintKey'] == '241 0234 00200'
assert parcel['LegalAddress'] == '155 TEMPLE ST'

point = get('/Mobile/SelectParcel', {
    'customer': 'NewHavenCityCT',
    'latitude': 41.30570527, 'longitude': -72.92722431,
})
point_rows = point.get('rows', [point])
assert len(point_rows) == 1
assert all(point_rows[0][key] == parcel[key]
           for key in ('Parcel_ID', 'PrintKey', 'LegalAddress'))

children = get('/Customer/NewHavenCityCT/Parcel/13397/Children')
selected_fields = {
    'Permit': ['Permit_ID', 'PermitNo', 'PermitType', 'PermStatus', 'PermitDate'],
    'Application': ['Application_ID', 'ApplicationNumber',
                    'PermitApplicationType', 'PermitApplicationStatus',
                    'ApplicationDate'],
    'License': ['License_ID', 'LicenseNumber', 'LicenseType', 'Status', 'Date'],
    'Certificate': ['Certificate_ID', 'CertificateNumber',
                    'CertificateType', 'CertificateDate'],
}
summary = {'parcel_id': parcel['Parcel_ID'], 'groups': {}}
for kind, fields in selected_fields.items():
    rows = children[kind]
    assert isinstance(rows, list) and rows, f'Expected sample {kind} records'
    assert all(isinstance(row, dict) for row in rows)
    assert all(any(field in row for row in rows) for field in fields)
    summary['groups'][kind] = {'count': len(rows), 'checked_fields': fields}
print(json.dumps(summary, indent=2))
PY
```

On November 16, 2026, both searches resolved parcel `13397`, PrintKey
`241 0234 00200`, legal address `155 TEMPLE ST`. Its related groups contained
98 permits, 38 applications, 17 licenses and one certificate. Those counts
precede de-duplication and may change. The recipe checks identity, structure
and selected fields rather than freezing those counts.

## Preserve the permit-to-property association

For each selected record, retain its parent Municity `Parcel_ID`, `PrintKey`
and `LegalAddress` alongside the record's kind, identifier, number, type,
status and date. This records which parcel query produced the result without
assuming that the permit identifier itself is a parcel identifier.

Compare the record's `LegalAddress`, when present, with the parent parcel and
the starting property address. A corner parcel, address range or building with
multiple units can have a different legal address from the address you started
with. Investigate the relationship and retain unresolved or ambiguous matches
separately. A parcel-level association alone does not identify an exact suite.

## Interpretation and remaining work

- Keep Permit, Application, License and Certificate identities separate.
  Applications can share numbers with issued permits; they should not be
  automatically counted as additional projects.
- Type, status and date fields differ across groups and can be null. An
  application is not a permit; a certificate's type needs interpretation;
  a historical license does not establish current validity.
- The response can contain nested contacts, owners, mailing information and
  personal details in descriptions. Use a field allowlist and review free
  text before storing or publishing. This directory includes no raw records.
- Matches establish parcel or building context, not an exact suite, current
  use, completion, legal compliance or permission to operate.
- This sample does not verify citywide coverage, complete property history,
  pagination, bulk extraction, inspection details, document downloads,
  interactive portal search, supported service guarantees or reuse terms.
  A missing record is not proof of absence.

## Automated checks

Run the same sample through the shared validation runner:

```sh
node scripts/validate-sources.mjs permits
```

The [weekly and on-demand workflow](https://github.com/ctl0v0/new-haven-civic-data-directory/actions/workflows/validate-sources.yml)
includes permits in its `all` selection and offers a separate `permits`
selection. The checker compares PrintKey and point results, requires the four
documented record groups and selected fields, and detects missing or duplicate
identifiers. Requests have time and response-size limits. Group counts are
not frozen at the original sample values.

Published summaries include group counts, selected field names, matching
checks, a fingerprint of selected non-contact fields, and the exact run and
code revision. Raw records, descriptions, contact details and documents are
not saved. Changed results and access failures use the existing source-review
workflow; routine checks do not advance readiness assessment dates.

`npm test` runs the synthetic-fixture regression tests without contacting
Municity. They cover identity mismatches and ambiguity, missing groups and
fields, duplicate identifiers, HTTP blocks, malformed responses, network
failures, size limits, ordering, source changes and publication privacy.
