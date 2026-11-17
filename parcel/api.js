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
        return respond(json(await handler(request)));
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
  };
}
