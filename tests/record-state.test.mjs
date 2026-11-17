import test from "node:test";
import assert from "node:assert/strict";
import { displayGroup, displayGroupCounts, orderDisplayRecords } from "../parcel/record-state.js";

const asOf = new Date("2026-11-17T12:00:00Z");
const item = (id, category, status, eventDate = "2026-09-01", attributes = {}) => ({
  id, source_id: "municity", category, event_date: eventDate,
  attributes: { Status: status, ...attributes },
});

test("published status and license expiration separate recent, draft, older and past records", () => {
  assert.equal(displayGroup(item("1", "Permit", "Issued"), asOf).key, "reported");
  assert.equal(displayGroup(item("2", "Application", "Draft"), asOf).key, "early");
  assert.equal(displayGroup(item("3", "Application", "Pending Review"), asOf).key, "early");
  assert.equal(displayGroup(item("3b", "Application", "Not Issued"), asOf).key, "early");
  assert.equal(displayGroup(item("4", "Permit", "Issued", "2021-11-12"), asOf).key, "older");
  assert.equal(displayGroup(item("5", "Complaint", "Open", "2021-11-12"), asOf).key, "older");
  assert.equal(displayGroup(item("6", "Permit", "Void"), asOf).key, "past");
  assert.equal(displayGroup(item("7", "License", "Issued", "2026-09-01", {
    ExpirationDate: "2026-10-31T00:00:00Z",
  }), asOf).key, "past");
  assert.equal(displayGroup(item("7b", "License", "Issued", "2021-01-01", {
    ExpirationDate: "2027-10-31T00:00:00Z",
  }), asOf).key, "reported");
  assert.equal(displayGroup(item("8", "Document", null), asOf).key, "unclassified");
});

test("an occupant without an inactive flag is not labeled active", () => {
  const occupant = { id: "occupant:1", source_id: "municipal-occupants",
    attributes: { inactive: false }, event_date: "2026-10-01" };
  assert.equal(displayGroup(occupant, asOf).key, "unclassified");
  assert.equal(displayGroup({ ...occupant, attributes: { inactive: true } }, asOf).key, "past");
});

test("owner registry roles stay together and current source records precede drafts and voids before paging", () => {
  const rows = [
    item("void", "License", "Void"),
    { id: "agent", source_id: "business-agents", attributes: {} },
    item("draft", "Application", "Draft"),
    { id: "owner", source_id: "business-master", attributes: { registry_status: "Active" } },
    item("issued", "License", "Issued"),
    { id: "principal", source_id: "business-principals", attributes: {} },
  ];
  const ordered = orderDisplayRecords(rows, "business", asOf);
  assert.deepEqual(ordered.map((row) => row.id), ["owner", "principal", "agent", "issued", "draft", "void"]);
  assert.deepEqual(displayGroupCounts(ordered), {
    owner_registry: 3, reported: 1, early: 1, older: 0, past: 1, unclassified: 0,
  });
});

test("activity keeps City categories under the same status section", () => {
  const ordered = orderDisplayRecords([
    item("old-issue", "Permit", "Issued", "2021-03-01"),
    item("new-license", "License", "Active"),
    item("new-permit", "Permit", "Open"),
    item("new-draft", "Application", "Draft"),
  ], "activity", asOf);
  assert.deepEqual(ordered.map((row) => row.id), ["new-permit", "new-license", "new-draft", "old-issue"]);
  assert.equal(ordered[3].display_group.basis, "Published status; record date more than two years old");
});
