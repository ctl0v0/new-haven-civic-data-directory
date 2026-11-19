import { guarded } from "../../parcel/api.js";
import { getDataContext } from "../../parcel/data-context.js";

export default guarded((request) => {
  const p = new URL(request.url).searchParams;
  return getDataContext({ term: p.get("term"), source_id: p.get("source_id"), field: p.get("field") });
});
