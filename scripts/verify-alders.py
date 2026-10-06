#!/usr/bin/env python3
"""One read-only roster check. No contact addresses or phone values are logged."""
import hashlib
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

SOURCE = "https://www.newhavenct.gov/government/departments-divisions/board-of-alders/list-of-alders"

class Tables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self.table = None
        self.row = None
        self.cell = None
        self.depth = 0
    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.depth += 1
            if self.depth == 1:
                self.table = []
        elif self.depth == 1 and tag == "tr":
            self.row = []
        elif self.depth == 1 and tag in ("td", "th"):
            self.cell = []
        elif self.cell is not None and tag in ("br", "p", "div"):
            self.cell.append(" ")
    def handle_data(self, value):
        if self.cell is not None:
            self.cell.append(value)
    def handle_endtag(self, tag):
        if self.depth == 1 and tag in ("td", "th") and self.cell is not None:
            if self.row is not None:
                self.row.append(re.sub(r"\s+", " ", "".join(self.cell)).strip())
            self.cell = None
        elif self.depth == 1 and tag == "tr" and self.row is not None:
            if self.row:
                self.table.append(self.row)
            self.row = None
        elif tag == "table":
            if self.depth == 1 and self.table is not None:
                self.tables.append(self.table)
                self.table = None
            self.depth = max(0, self.depth - 1)

def normalize(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())

def extract(html):
    parser = Tables()
    parser.feed(html)
    for table in parser.tables:
        for index, row in enumerate(table):
            headers = [normalize(value) for value in row]
            if "ward" not in headers:
                continue
            name_columns = [i for i, value in enumerate(headers) if value in ("name", "alder", "aldername", "representative")]
            if not name_columns:
                continue
            ward_index = headers.index("ward")
            name_index = name_columns[0]
            records = []
            for data in table[index + 1:]:
                if len(data) <= max(ward_index, name_index):
                    continue
                name = data[name_index].strip()
                ward_label = data[ward_index].strip()
                if not name:
                    raise ValueError("A roster row has an empty representative field")
                match = re.fullmatch(r"(?:Ward\s*)?([0-9]{1,2})(?:\s*-\s*[A-Za-z]+)?", ward_label, re.I)
                if ward_label and not match:
                    raise ValueError("A ward label has an unexpected format")
                records.append({"ward": int(match.group(1)) if match else None, "ward_label": ward_label or None, "representative": name})
            if records:
                return row, records
    raise ValueError("No readable roster table with ward and representative headings found")

def main():
    try:
        request = Request(SOURCE, headers={"User-Agent": "New-Haven-Civic-Data-Directory/1.0 (read-only source verification)", "Accept": "text/html"})
        with urlopen(request, timeout=30) as response:
            status = response.status
            content_type = response.headers.get("Content-Type", "")
            raw = response.read(3000001)
            if len(raw) > 3000000:
                raise ValueError("Page exceeds the verification size limit")
            html = raw.decode(response.headers.get_content_charset() or "utf-8", errors="replace")
        headings, records = extract(html)
        wards = [record["ward"] for record in records if record["ward"] is not None]
        if len(set(wards)) != len(wards):
            raise ValueError("Duplicate wards found; do not silently choose a representative")
        if len(records) != 30 or any(ward < 1 or ward > 30 for ward in wards):
            raise ValueError("Unexpected roster row count or ward range; manual review required")
        missing = sorted(set(range(1, 31)) - set(wards))
        unlabelled = sum(record["ward"] is None for record in records)
        warnings = ["The city HTML includes a representative row with no ward identifier. Preserve null; do not infer its ward from position."] if unlabelled else []
        output = {"source": SOURCE, "method": "Official HTML roster; ward label and representative columns only", "coverage": {"rosterRows": len(records), "numberedWards": len(wards), "missingNumberedWards": missing, "rowsWithoutWard": unlabelled}, "warnings": warnings, "records": records}
        Path("verification").mkdir(exist_ok=True)
        Path("verification/alders-roster-sample.json").write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"status": "passed", "httpStatus": status, "contentType": content_type, "headings": headings, "dataFingerprint": hashlib.sha256(json.dumps(sorted(records,key=lambda r: (r["ward_label"] or "",r["representative"])),sort_keys=True).encode()).hexdigest(), "rowsExtracted": len(records), "uniqueWards": len(set(wards)), "missingNumberedWards": missing, "rowsWithoutWard": unlabelled, "exportedFields": ["ward", "ward_label", "representative"], "warnings": warnings, "note": "Parsing passed, with coverage gaps reported separately. No contact values logged. Election dates, current officeholding and reuse rights are not verified."}))
    except HTTPError as error:
        print(json.dumps({"status": "failed", "httpStatus": error.code, "reason": "Official page rejected the read-only request; no roster data extracted."}))
        sys.exit(1)
    except (URLError, ValueError, TimeoutError) as error:
        print(json.dumps({"status": "failed", "reason": str(error)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
