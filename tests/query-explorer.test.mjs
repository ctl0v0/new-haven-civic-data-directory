import assert from "node:assert/strict";
import test from "node:test";
import { indexedQueryValues, searchCapabilities } from "../parcel/search-capabilities.js";
import { indexedLicenseExport, licenseCsv } from "../search-index/license-export.js";
import { indexedQueryRequest, indexedQueryTool } from "../site/query-explorer.js";
import { askIndexedParcels } from "../search-index/ask.js";

test("query workbench routes cursors to the same search and preserves exact published permit names", () => {
  const [url] = indexedQueryRequest("permits", { permit_types: ["Hood - C", "Water Heater"], scope: "city" }, "permit-cursor");
  const params = new URL(url, "https://example.test").searchParams;
  assert.deepEqual(params.getAll("permit_type"), ["Hood - C", "Water Heater"]);
  assert.equal(params.get("cursor"), "permit-cursor");
  const [path, request] = indexedQueryRequest("records", {
    source_id: "municipal-business-licenses", site_address: "1533 State St",
  }, "license-cursor");
  assert.equal(path, "/api/v1/search-indexed-records");
  assert.equal(JSON.parse(request.body).cursor, "license-cursor");
  assert.equal(indexedQueryTool("activity"), "search_indexed_permit_activity");
});

test("observed examples are limited to categorical fields and checked parcel-linked rows", async () => {
  assert.equal(searchCapabilities().indexed_source_fields["municipal-business-licenses"].event_date_field, "IssueDate");
  await assert.rejects(indexedQueryValues("parcels", "owner_name_1", {
    configured: () => true, query: () => assert.fail("Owner names should not be listed as observed examples"),
  }), { status: 400 });
  const values = await indexedQueryValues("municity", "PermStatus", {
    configured: () => true,
    query: async (statement, params) => {
      if (statement.includes("search_active_runs")) {
        assert.deepEqual(params, ["municity", "permit-window:90"]);
        return [{ run_id: 123, status: "partial" }];
      }
      assert.deepEqual(params, ["municity", 123, "PermStatus"]);
      assert.match(statement, /j\.join_status = 'exact'/);
      return [{ value: "Issued" }];
    },
  });
  assert.deepEqual(values.values, ["Issued"]);
});

test("license export keeps Government date meanings and protects spreadsheet fields", async () => {
  const report = await indexedLicenseExport({ configured: () => true, query: async (sql) => {
    assert.match(sql, /count\(DISTINCT \(j\.city_parcel_id, j\.city_objectid\)\) = 1/);
    assert.match(sql, /bool_and\(j\.join_status = 'exact'\)/);
    return [{
      source_id: "municipal-business-licenses", record_id: "11",
      fields: { BusinessName: '  =EXAMPLE("123")', LegalAddress: "3 Edwards Street", CreatedDate: "2026-11-20" },
    }, {
      source_id: "ct-liquor-permits", record_id: "row-12", date: "2026-11-10",
      fields: { dba: "Sample, Inc.", permit_address: "3 Edwards St", credential: "LIR-123" },
    }];
  } });
  assert.equal(report.items[0].issue_date, null);
  assert.equal(report.items[0].effective_date, null);
  assert.equal(report.items[1].issue_date, null);
  assert.equal(report.items[1].effective_date, "2026-11-10");
  const csv = licenseCsv(report.items);
  assert.ok(csv.includes('"\'  =EXAMPLE(""123"")"'));
  assert.ok(csv.includes('"Sample, Inc."'));
});

test("water heater replacement questions check the official permit role, dates and replacement wording", async () => {
  const answer = await askIndexedParcels({ question:
    "Show me Contractor contacts who did water heater replacements in the last 30 days" }, {
    now: new Date("2026-11-20T17:00:00Z"),
    catalog: async () => ({ groups: [{ name: "Plumbing", types: [{ name: "Water Heater" }] }] }),
    interpret: async () => assert.fail("The checked question does not need an AI interpretation"),
    searchPermitWork: async (args) => {
      assert.deepEqual(args, { scope: "city", permit_types: ["Water Heater"],
        permit_date_from: "2026-10-22", permit_date_to: "2026-11-20",
        contact_role: "Contractor", require_contact_role: true, scan_limit: 6,
        permit_description_terms: ["replace", "replacing", "change out", "change-out"] });
      return { items: [], next_cursor: "permit-contact-page", complete_for_query: false };
    },
  });
  assert.equal(answer.search_method, "contacts");
  assert.equal(answer.status, "paging");
  assert.equal(answer.interpretation.date_field, "PermitDate");
  const [url] = indexedQueryRequest("contacts", answer.criteria, answer.search_result.next_cursor);
  const params = new URL(url, "https://example.test").searchParams;
  assert.deepEqual(params.getAll("permit_description_term"), answer.criteria.permit_description_terms);
  assert.equal(params.get("cursor"), "permit-contact-page");
});
