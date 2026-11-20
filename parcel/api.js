import { bearerIdentity, requirePilot, sameOrigin } from "./auth.js";
import { apiError } from "./service.js";
import { json } from "./http.js";

export function guarded(handler, { methods = ["GET"] } = {}) {
  return {
    fetch: async (request) => {
      const respond = (response) => {
        console.info(JSON.stringify({
          event: "parcel_api_request",
          path: new URL(request.url).pathname,
          status: response.status,
          client: bearerIdentity(request) ?? "browser-or-unknown",
        }));
        return response;
      };
      const deny = requirePilot(request);
      if (deny) return respond(deny);
      if (!sameOrigin(request))
        return respond(json({ error: "Origin is not allowed" }, 403));
      if (!methods.includes(request.method))
        return respond(json({ error: "Method not allowed" }, 405));
      try {
        const result = await handler(request);
        return respond(result instanceof Response ? result : json(result));
      } catch (error) {
        const e = apiError(error);
        return respond(json({ error: e.error }, e.status));
      }
    },
  };
}

export function params(request) {
  const url = new URL(request.url);
  return {
    id: url.searchParams.get("parcel_id"),
    objectid: url.searchParams.get("objectid"),
    group: url.searchParams.get("group"),
    cursor: url.searchParams.get("cursor"),
    limit: url.searchParams.get("limit"),
    query_address: url.searchParams.get("query_address"),
    category: url.searchParams.getAll("category"),
    record_type: url.searchParams.getAll("record_type"),
    source_id: url.searchParams.getAll("source_id"),
    display_group: url.searchParams.getAll("display_group"),
    source_status: url.searchParams.getAll("source_status"),
    event_date_from: url.searchParams.get("event_date_from"),
    event_date_to: url.searchParams.get("event_date_to"),
    address_match: url.searchParams.get("address_match"),
  };
}
