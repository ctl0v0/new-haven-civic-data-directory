import {
  checkPassphrase,
  issueCookie,
  sameOrigin,
  pilotConfigured,
} from "../parcel/auth.js";
import { readRequestText, SourceError } from "../parcel/http.js";

export default {
  fetch: async (request) => {
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405 });
    if (!sameOrigin(request))
      return new Response("Origin not allowed", { status: 403 });
    if (
      !(request.headers.get("content-type") ?? "").startsWith(
        "application/x-www-form-urlencoded",
      )
    )
      return new Response("Expected form data", { status: 415 });
    let raw;
    try {
      raw = await readRequestText(request, 2048);
    } catch (error) {
      return new Response("Request too large", {
        status: error instanceof SourceError ? error.status : 400,
      });
    }
    const form = new URLSearchParams(raw);
    if (!pilotConfigured())
      return new Response("Pilot access is not configured", { status: 503 });
    if (!checkPassphrase(form.get("passphrase")))
      return Response.redirect(
        new URL("/parcel?access=denied", request.url),
        303,
      );
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/parcel",
        "Set-Cookie": issueCookie(),
        "Cache-Control": "private, no-store",
      },
    });
  },
};
