import { checkedQueryAddress } from "./address-evidence.js";
import { getGroup } from "./adapters.js";
import { GROUPS, LAYERS } from "./config.js";
import { parcelFeatureToGeoJSON } from "./geometry.js";
import { parcelMapContext } from "./map-context.js";
import { parcelPhoto } from "./photo.js";
import { loadParcel } from "./resolve.js";
import { parcelAddresses } from "./service.js";

export async function parcelReport(id, { objectid = null, query_address = null } = {}) {
  const searchedAddress = checkedQueryAddress(query_address);
  const feature = await loadParcel(id, objectid);
  const a = feature.attributes;
  const parcel = {
    parcel_id: a.parcel_id, objectid: a.objectid, address: a.property_address,
    mblu: a.mblu, account_number: a.account_number,
    source_url: `${LAYERS.parcels}/${a.objectid}`,
  };
  const [groups, photo, addresses, context] = await Promise.all([
    Promise.all(GROUPS.map(({ id: group }) => getGroup(group, feature))),
    parcelPhoto(a.parcel_id, a.objectid),
    parcelAddresses(a.parcel_id, a.objectid),
    parcelMapContext(a.parcel_id, a.objectid).catch(() => null),
  ]);
  let geometry;
  try { geometry = parcelFeatureToGeoJSON(feature); }
  catch { geometry = null; }
  return { parcel, searchedAddress, groups, photo, addresses, geometry, context, generated_at: new Date().toISOString() };
}
