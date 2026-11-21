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

test("owner names, State LLC roles and assessor sales stay in the ownership group", () => {
  const rows = [
    { id: "agent", source_id: "business-agents", attributes: {} },
    { id: "owner", source_id: "business-master", attributes: { registry_status: "Active" } },
    { id: "principal", source_id: "business-principals", attributes: {} },
    { id: "city", source_id: "parcel-owner", attributes: { owner_name_1: "OWNER LLC" } },
    { id: "assessor", source_id: "assessor-owner", attributes: { owner_name: "OWNER LLC" } },
    { id: "sale", source_id: "assessor-sales", event_date: "2021-01-01", attributes: { owner: "OWNER LLC" } },
  ];
  const ordered = orderDisplayRecords(rows, "ownership", asOf);
  assert.deepEqual(ordered.map((row) => row.id), ["city", "assessor", "owner", "principal", "agent", "sale"]);
  assert.equal(displayGroupCounts(ordered).owner_names, 2);
  assert.equal(displayGroupCounts(ordered).owner_registry, 3);
  assert.equal(displayGroupCounts(ordered).owner_history, 1);
  assert.equal(displayGroup({ id: "city-sale", source_id: "parcel-sale", attributes: { price: 0 } }, asOf).key, "owner_history");
});

test("business licensing and registration dates determine order while preserving published status", () => {
  const rows = [
    { id: "void", source_id: "municipal-business-licenses", event_date: "2021-01-01", attributes: { status: "Void" } },
    { id: "issued", source_id: "municipal-business-licenses", event_date: "2026-09-01", attributes: { status: "Issued", expiration_date: "2027-01-01" } },
    { id: "registration", source_id: "ct-business-registrations", event_date: "2026-10-01", attributes: { status: "Dissolved" } },
    { id: "undated", source_id: "ct-business-registrations", event_date: null, attributes: { status: "Active" } },
    { id: "occupant", source_id: "municipal-occupants", event_date: "2026-09-01", attributes: { inactive: false } },
  ];
  const ordered = orderDisplayRecords(rows, "business", asOf);
  assert.deepEqual(ordered.map((row) => row.id), ["registration", "issued", "void", "undated", "occupant"]);
  assert.deepEqual(ordered.map((row) => row.display_group.key), ["past", "reported", "past", "reported", "unclassified"]);
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
