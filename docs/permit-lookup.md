# New Haven permit lookup sample

The [canonical source entry](../sources/building-permits.json) documents New
Haven's Municity / CitySquared portal and the public JSON service used by
[Civic Fit's permit lookup](https://github.com/ctl0v0/civic-fit/blob/aaaccfdda4dda300e27fa7ea58dc77af7a764d50/src/lib/civic-data/municity-permits.ts).
This recipe repeats one commercial-property example without credentials,
dependencies or changes to city records. These vendor endpoints are not a
confirmed supported open-data API.

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

For other reviewed assessor MBLUs, split on `/`, trim and remove empty
segments, then join with spaces, retaining leading zeros. The sample
`241/ 0234/ 00200/ /` becomes `241 0234 00200`. Reject ambiguous matches.
When an MBLU is missing or does not match, a separately confirmed map pin can
provide another lookup route. A corner property's legal parcel address may
differ from a storefront address; independently review that association.

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

No recurring check is configured for this entry. Civic Fit's related feature
uses manually requested per-space lookups and separate admin review; this
recipe does not invoke Civic Fit, ingest records or publish candidates.
