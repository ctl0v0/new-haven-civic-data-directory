import { indexQuery } from "../search-index/db.js";
import { getSearchCoverage } from "../search-index/coverage.js";
import { auditMunicipalPermitLinks } from "../search-index/linkage-audit.js";

const writer = process.env.SEARCH_DATABASE_WRITE_URL;
const password = process.env.SEARCH_DATABASE_READER_PASSWORD;
const role = process.env.SEARCH_DATABASE_READER_ROLE ?? "search_index_reader";
if (!writer || !password || !/^[a-z][a-z0-9_]*$/.test(role))
  throw new Error("Index writer URL, reader password and valid reader role are required");

const reader = new URL(writer);
reader.username = role;
reader.password = password;
process.env.SEARCH_DATABASE_URL = reader.toString();
const [identity] = await indexQuery(`SELECT current_user AS role,
  has_table_privilege(current_user, 'search_records', 'SELECT') AS can_read,
  has_table_privilege(current_user, 'search_records', 'INSERT') AS can_insert`);
if (identity?.role !== role || !identity.can_read || identity.can_insert)
  throw new Error("Read-only index role verification failed");

const coverage = await getSearchCoverage();
if (coverage.index_status !== "connected")
  throw new Error("Indexed source coverage is unavailable");
const types = coverage.municipal_permit_types.filter((type) => type.indexed)
  .sort((a, b) => Number(b.unlinked_count) - Number(a.unlinked_count));
const selected = types.slice(0, 10);
for (const name of ["Hood - C", "Heating Permit", "Air Conditioning Permit"])
  if (!selected.some((type) => type.permit_type === name)) {
    const type = types.find((item) => item.permit_type === name);
    if (type) selected.push(type);
  }
const audited = [];
for (const type of selected) {
  const result = await auditMunicipalPermitLinks({ permit_type: type.permit_type,
    sample_limit: 2 });
  if (!result.counts || result.coverage.index_status !== "connected")
    throw new Error(`Permit linkage audit failed for ${type.permit_type}`);
  audited.push({ permit_type: type.permit_type,
    active_run_id: result.coverage.active_run_id,
    ...result.counts,
    sample_record_ids: result.samples.map((row) => ({
      record_id: row.record_id, reason: row.reason,
      legal_address_published: Boolean(row.legal_address),
    })) });
}
console.log(JSON.stringify({ event: "municipal_linkage_audit",
  reader_role_verified: true,
  indexed_type_count: types.length,
  indexed_record_count: types.reduce((sum, type) =>
    sum + Number(type.returned_count ?? 0), 0),
  unlinked_record_count: types.reduce((sum, type) =>
    sum + Number(type.unlinked_count ?? 0), 0),
  most_unlinked_types: audited }));
