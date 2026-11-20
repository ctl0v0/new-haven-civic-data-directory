import { getSearchCoverage } from '../search-index/coverage.js';
import { indexQuery } from '../search-index/db.js';
import { questionPermitCatalog } from '../search-index/ask.js';
import { municipalSearch, municipalDate } from '../search-index/municity.js';
import { fetchJson } from '../parcel/http.js';
const log = (stage, data) => console.log(JSON.stringify({ event: 'hood_inventory_check', stage, data }));
const catalog = await questionPermitCatalog();
const types = catalog.groups.flatMap(g => g.types.filter(({ name }) => /\bhood\b/i.test(name)).map(({ name }) => name));
const runs = (await getSearchCoverage()).municipal_permit_types.filter(({ permit_type }) => types.includes(permit_type));
const officialIds = new Set();
const dates = [];
for (const type of types) {
  try {
    const result = await municipalSearch('PermitType',type,500,
      (url,options)=>fetchJson(url,{...options,timeout:12000}).catch(e=>{throw new Error(e.message)}));
    const rows = result.rows.filter(row=>String(row.PermitType ?? '').trim().toUpperCase()===type.toUpperCase());
    const ids = new Set(rows.map(row=>String(row.Permit_ID ?? '').trim()).filter(id=>/^\d+$/.test(id)));
    const publishedDates = rows.map(row=>municipalDate(row.PermitDate)).filter(Boolean).sort();
    const index = runs.find(run=>run.permit_type===type);
    const subset = await indexQuery(`SELECT record_id FROM search_records WHERE source_id='municity' AND run_id=$1`,[index?.run_id]);
    const included = new Set(subset.map(row=>row.record_id));
    for (const id of ids) officialIds.add(id);
    dates.push(...publishedDates);
    log('type', { type, official_total:result.total, returned_rows:result.rows.length, official_ids:ids.size,
      from:publishedDates[0], to:publishedDates.at(-1), index_run_id:index?.run_id, indexed_ids:included.size,
      live_ids_in_index:[...ids].filter(id=>included.has(id)).length,
      live_ids_not_in_index:[...ids].filter(id=>!included.has(id)).length,
      unlinked_at_refresh:index?.unlinked_count, ambiguous_at_refresh:index?.ambiguous_count });
  } catch(error) { log('type', { type, error:error.message }); }
}
const indexed = await indexQuery(`SELECT count(DISTINCT r.record_id)::int AS ids,
  count(DISTINCT (j.city_parcel_id,j.city_objectid))::int AS parcels,
  min(r.event_date) AS first_date, max(r.event_date) AS last_date
FROM search_records r JOIN search_record_parcels j USING(run_id,source_id,record_id)
WHERE r.source_id='municity' AND r.run_id=ANY($1::bigint[]) AND j.join_status='exact'`,[runs.map(run=>run.run_id).filter(Boolean)]);
dates.sort();
log('combined', { types, distinct_official_ids:officialIds.size, earliest_published:dates[0], most_recent_published:dates.at(-1), indexed:indexed[0] });
log('finished', true);
