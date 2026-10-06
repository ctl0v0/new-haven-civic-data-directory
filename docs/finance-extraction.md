# Working with official finance PDFs

Use the original city reports as the authority. The directory demonstrates a small extraction path; it documents the exact scope and remaining preparation.

## Reproduce the check

Clone this repository, use Python 3, install `pypdf==5.9.0`, and run:

```sh
python3 -m pip install pypdf==5.9.0
python3 scripts/verify-finance.py
```

You can also run **Validate civic sources** in GitHub Actions with **finance** selected. It discovers the latest dated monthly link and an adopted-budget link, downloads one PDF from each series, and inspects at most the first 12 pages. Downloads are bounded to 20 MB each. The weekly run uses the same checks and publishes a status with a link to its run.

The October 6 check inspected [June 2026](https://www.newhavenct.gov/home/showpublisheddocument/29672/639231785179270000) and the [2025–2026 adopted budget](https://www.newhavenct.gov/home/showpublisheddocument/27540/639026920500400000). Plain text extraction worked; PDF layout-mode extraction failed during initial investigation. Text extraction may still lose characters or spaces and does not establish correct table structure.

## The tested example

`verification/finance-row-sample.json` records one **Real Estate** revenue row from PDF viewer page 7 of the monthly sample, including its source link and reporting month. The checker verifies:

- Cumulative collections divided by approved budget match the displayed percentage, rounded to two decimals.
- Year-end forecast minus approved budget matches the displayed variance.

Amounts use decimal arithmetic. Parenthesized currency is negative. These checks support one row; they do not certify full report totals or any other table. The annual sample was inspected for text only.

## Extend the extraction carefully

Preserve source URL, PDF page, report type, fiscal year, reporting month, extraction date, account label, original heading and validation status alongside extracted values. These are suggested provenance fields, not an official city schema.

Start with one table, manually compare every column against the PDF, then validate totals and a second month before generalizing. Preserve both raw text and normalized values while checking; never replace missing values with zero by default. Keep monthly collections separate from cumulative year-to-date totals and year-end forecasts. Confirm whether a report was revised before comparing versions.

Budgets, monthly reports and audits have different roles and may use different accounting bases. Validate expenditure and annual-budget tables separately from this revenue example. OCR is only appropriate after checking that the needed pages cannot yield useful text.

The inspected covers contain rights notices. No open reuse or redistribution license has been verified. Clarify permissions before republishing documents or derived datasets. No official finance API or CSV export was confirmed.
