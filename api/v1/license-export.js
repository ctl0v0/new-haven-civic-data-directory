import { guarded } from "../../parcel/api.js";
import { SourceError } from "../../parcel/http.js";
import { indexedLicenseExport, licenseCsv } from "../../search-index/license-export.js";

export default guarded(async (request) => {
  const format = new URL(request.url).searchParams.get("format") ?? "csv";
  if (!["csv", "json"].includes(format)) throw new SourceError("Choose csv or json.", 400);
  const result = await indexedLicenseExport();
  if (format === "json") return result;
  return new Response(licenseCsv(result.items), { headers: {
    "Content-Type": "text/csv; charset=utf-8", "X-Content-Type-Options": "nosniff",
    "Content-Disposition": 'attachment; filename="new-haven-parcel-licenses.csv"',
    "Cache-Control": "private, no-store",
  } });
});
