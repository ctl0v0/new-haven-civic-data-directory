import { guarded } from "../../parcel/api.js";
import { resolveParcel } from "../../parcel/service.js";
import { SourceError, readRequestText } from "../../parcel/http.js";

export default guarded(
  async (request) => {
    if (
      !(request.headers.get("content-type") ?? "").startsWith(
        "application/json",
      )
    )
      throw new SourceError("Expected JSON", 415);
    let body;
    try {
      body = JSON.parse(await readRequestText(request, 1000));
    } catch (error) {
      if (error instanceof SourceError) throw error;
      throw new SourceError("Invalid JSON", 400);
    }
    return resolveParcel(body?.query);
  },
  { methods: ["POST"] },
);
