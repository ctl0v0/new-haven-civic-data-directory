import { guarded } from "../../parcel/api.js";
import { getIndexedRecord } from "../../search-index/record.js";

export default guarded((request) => {
  const params = new URL(request.url).searchParams;
  const geometry = params.get("include_geometry");
  return getIndexedRecord({
    source_id: params.get("source_id"), record_id: params.get("record_id"),
    permit_type: params.get("permit_type"),
    permit_group: params.get("permit_group"),
    include_geometry: geometry == null ? undefined
      : geometry === "true" ? true : geometry === "false" ? false : geometry,
  });
});
