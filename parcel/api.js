import { requirePilot, sameOrigin } from "./auth.js";
import { apiError } from "./service.js";
import { json } from "./http.js";

export function guarded(handler, { methods = ["GET"] } = {}) {
  return {
    fetch: async (request) => {
      const deny = requirePilot(request);
      if (deny) return deny;
      if (!sameOrigin(request))
        return json({ error: "Origin is not allowed" }, 403);
      if (!methods.includes(request.method))
        return json({ error: "Method not allowed" }, 405);
      try {
        return json(await handler(request));
      } catch (error) {
        const e = apiError(error);
        return json({ error: e.error }, e.status);
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
  };
}
