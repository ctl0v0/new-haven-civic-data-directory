import { readFile } from "node:fs/promises";
import { indexQuery } from "../search-index/db.js";

if (!process.env.SEARCH_DATABASE_WRITE_URL)
  throw new Error("SEARCH_DATABASE_WRITE_URL is required for search-index migration");
const schema = await readFile(new URL("../search-index/schema.sql", import.meta.url), "utf8");
const statements = schema.replace(/^\s*--.*$/gm, "")
  .split(/;\s*(?:\n|$)/).map((part) => part.trim()).filter(Boolean);
for (const statement of statements)
  await indexQuery(statement, [], { write: true });
console.log("Search index schema is ready.");
