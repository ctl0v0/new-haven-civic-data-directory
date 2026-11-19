#!/usr/bin/env python3
"""Refresh the official NHPS attendance-zone spreadsheet snapshot.

The NHPS JooDatabase catalog exports up to 100 rows per XLSX request. Its
alphabet filter covers the complete table without scraping individual pages.
Validation fails closed if a letter is truncated or the total differs from the
catalog's published result count.
"""

import datetime
import hashlib
import io
import json
from pathlib import Path
import re
import string
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile


SOURCE = "https://www.newhavenmagnetschools.com/index.php/enrollment/find-schools-in-your-attendance-zone"
DESTINATION = Path(__file__).resolve().parents[1] / "data" / "nhps-attendance.json"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*",
    "Content-Type": "application/x-www-form-urlencoded",
}
NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
EXPECTED_HEADERS = ["Id", "Published", "Street_Name", "Start", "End", "Kdg_8th", "High_School"]


def official_post(*, format="html", alpha="", search=""):
    body = urllib.parse.urlencode({
        "option": "com_joodb", "view": "catalog", "format": format,
        "reset": "false", "start": "0", "alpha": alpha, "search": search,
    }).encode()
    request = urllib.request.Request(SOURCE, data=body, headers=HEADERS)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                return response.read(), response.headers.get("Content-Type", "")
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def excel_cells(row, shared):
    values = {}
    for cell in row.findall("x:c", NS):
        letter = re.match(r"[A-Z]+", cell.attrib["r"]).group()
        value = cell.find("x:v", NS)
        if value is None:
            values[letter] = ""
        elif cell.attrib.get("t") == "s":
            values[letter] = shared[int(value.text)]
        else:
            values[letter] = value.text or ""
    return values


def export_rows(alpha):
    raw, content_type = official_post(format="xls", alpha=alpha)
    if "spreadsheetml.sheet" not in content_type:
        raise ValueError(f"{alpha}: NHPS did not return an XLSX export")
    with zipfile.ZipFile(io.BytesIO(raw)) as workbook:
        shared = ["".join(item.itertext()) for item in
                  ET.fromstring(workbook.read("xl/sharedStrings.xml")).findall("x:si", NS)]
        worksheet = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
        source_rows = worksheet.findall(".//x:sheetData/x:row", NS)
    if not source_rows or [excel_cells(source_rows[0], shared).get(key) for key in "ABCDEFG"] != EXPECTED_HEADERS:
        raise ValueError(f"{alpha}: NHPS export columns changed")
    rows = []
    for source_row in source_rows[1:]:
        cells = excel_cells(source_row, shared)
        row = {
            "id": int(cells.get("A", "0")),
            "street_name": cells.get("C", "").strip(),
            "start": cells.get("D", "").strip(),
            "end": cells.get("E", "").strip(),
            "k8_school": cells.get("F", "").strip(),
            "high_school": cells.get("G", "").strip(),
        }
        if (cells.get("B") != "1" or not row["street_name"].startswith(alpha.upper())
                or not row["k8_school"] or not row["high_school"]):
            raise ValueError(f"{alpha}: incomplete or unpublished NHPS row {row['id']}")
        rows.append(row)
    if len(rows) >= 100:
        raise ValueError(f"{alpha}: export reached 100-row page limit; refresh pagination must be updated")
    return rows


def main():
    page, content_type = official_post()
    if "html" not in content_type:
        raise ValueError("NHPS catalog did not return HTML")
    count = re.search(r"Results\s+\d+\s*-\s*\d+\s+of\s+(\d+)", page.decode("utf-8", "replace"))
    if not count:
        raise ValueError("NHPS catalog did not publish a result count")
    expected = int(count.group(1))
    rows = [row for letter in string.ascii_lowercase for row in export_rows(letter)]
    ids = [row["id"] for row in rows]
    if len(rows) != expected or len(set(ids)) != expected or expected < 800:
        raise ValueError(f"NHPS export incomplete: {len(rows)} rows, {len(set(ids))} IDs, {expected} published")
    rows.sort(key=lambda row: row["id"])
    canonical = json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()
    data = {
        "source_url": SOURCE,
        "retrieved_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "row_count": expected,
        "sha256": hashlib.sha256(canonical).hexdigest(),
        "rows": rows,
    }
    DESTINATION.parent.mkdir(exist_ok=True)
    lines = ["{", *[
        f'  "{key}": {json.dumps(data[key], ensure_ascii=False)},'
        for key in ("source_url", "retrieved_at", "row_count", "sha256")
    ], '  "rows": [', *[
        "    " + json.dumps(row, ensure_ascii=False, separators=(",", ":")) +
        ("," if index + 1 < len(rows) else "")
        for index, row in enumerate(rows)
    ], "  ]", "}"]
    DESTINATION.write_text("\n".join(lines) + "\n")
    print(f"Verified {expected} NHPS rows; SHA-256 {data['sha256']}; saved {DESTINATION}")


if __name__ == "__main__":
    main()
