import { guarded } from "../../parcel/api.js";
import { listCityActivity } from "../../search-index/city-activity.js";

export default guarded((request) => {
  const input = Object.fromEntries(new URL(request.url).searchParams);
  if (input.limit !== undefined) input.limit = Number(input.limit);
  return listCityActivity(input);
});
