import { authorized, pilotConfigured, pilotPreviewEnabled } from "../parcel/auth.js";
import { parcelReport } from "../parcel/report.js";
import { apiError } from "../parcel/service.js";
import { renderParcelReport, renderReportMessage } from "../site/render-parcel-report.js";

const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://server.arcgisonline.com https://gis.vgsi.com https://www.municitymedia.com; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};

const message = (status, heading, detail) =>
  new Response(renderReportMessage(heading, detail), { status, headers });

export default {
  fetch: async (request) => {
    if (!pilotPreviewEnabled()) return message(404, "Report unavailable", "Property reports are available in the private Preview.");
    if (request.method !== "GET") return message(405, "Method not allowed", "Open the report from the parcel records.");
    if (!authorized(request)) return message(pilotConfigured() ? 401 : 503, "Parcel pilot access required",
      "Open the parcel pilot and sign in to view this report.");
    const params = new URL(request.url).searchParams;
    try {
      const data = await parcelReport(params.get("parcel_id"), {
        objectid: params.get("objectid"), query_address: params.get("query_address"),
      });
      return new Response(renderParcelReport(data), { headers });
    } catch (error) {
      const { status, error: detail } = apiError(error);
      return message(status, "Could not generate the property report", detail);
    }
  },
};
