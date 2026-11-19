import { neon } from "@neondatabase/serverless";

const readers = new Map();
function connection(write = false) {
  const url = write
    ? process.env.SEARCH_DATABASE_WRITE_URL
    : process.env.SEARCH_DATABASE_URL;
  if (!url) return null;
  if (!readers.has(url)) readers.set(url, neon(url));
  return readers.get(url);
}

export function indexConfigured(write = false) {
  return Boolean(connection(write));
}

export async function indexQuery(statement, values = [], { write = false } = {}) {
  const sql = connection(write);
  if (!sql) throw new Error(write
    ? "Search index writer is not configured"
    : "Search index reader is not configured");
  return sql.query(statement, values);
}
