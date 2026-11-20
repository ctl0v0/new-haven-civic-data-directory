import { getSearchCoverage } from '../search-index/coverage.js';
import { indexQuery } from '../search-index/db.js';
import { questionPermitCatalog } from '../search-index/ask.js';
import { queryParcelData } from '../search-index/parcel-query.js';
import { askParcelData } from '../search-index/parcel-question.js';
import { municipalSearch, municipalDate } from '../search-index/municity.js';
import { LAYERS } from '../parcel/config.js';
import { arcgis, fetchJson } from '../parcel/http.js';
const log = (stage, data) => console.log(JSON.stringify({ event: 'hood_and_mixed_use_audit', stage, data }));
const check = async (stage, fn) => {
  try { log(stage, await fn()); }
  catch (error) { log(stage, { error: error.name, code: error.code, status: error.upstreamStatus, detail: error.message }); }
};
const catalog = await questionPermitCatalog();
const types = catalog.groups.flatMap(g => g.types.filter(({ name }) => /hood/i.test(name)).map(({name})=>[g.name,name]));
log('hood_catalog', { partial: catalog.partial, types });
const keys = types.map(([, type]) => `permit-type:${type.toUpperCase()}`);
await Promise.all([
  check('hood_index_runs', async () => {
    const coverage = await getSearchCoverage();
    const historical = coverage.municipal_permit_types.filter((type) => /hood/i.test(type.permit_type));
    const active = await indexQuery(`SELECT a.scope_key, r.id AS run_id, r.expected_count, r.returned_count,
      r.linked_count, r.unlinked_count, r.ambiguous_count, r.metadata->'parcel_link_summary' AS link_gap_summary,
      (SELECT count(DISTINCT p.record_id)::int FROM search_records p WHERE p.run_id=r.id AND p.source_id='municity') AS stored_ids,
      (SELECT count(DISTINCT (j.city_parcel_id,j.city_objectid))::int FROM search_record_parcels j
        WHERE j.run_id=r.id AND j.source_id='municity' AND j.join_status='exact') AS linked_parcel_count
      FROM search_active_runs a JOIN search_source_runs r ON r.id=a.run_id
      WHERE a.source_id='municity' AND a.scope_key=ANY($1::text[])`,[keys]);
    return { historical, active };
  }),
  check('hood_indexed_workbench_page', async () => {
    const result = await queryParcelData({plan:{requirements:[{source_id:'municity',equals:{PermitType:'Hood - C'}}],
      include:[{source_id:'municity',fields:['PermitNo','PermitType','PermitDate','LegalAddress']}]}});
    return { status:result.status, shown:result.items?.length, has_next_page:Boolean(result.next_cursor),
      permit_rows:result.items?.reduce((total,item)=>total+(item.matching_sources.find(group=>group.source_id==='municity')?.records.length??0),0) };
  }),
  check('hood_plain_question', async () => {
    const result = await askParcelData({question:'Show me all hood related permits',plan_only:true});
    return { status:result.status, reason:result.reason, plan:result.plan };
  }),
  check('hood_current_official_type', async () => {
    const result = await municipalSearch('PermitType','Hood - C',500,
      (url, options) => fetchJson(url,{...options,timeout:12000}).catch((e) => { throw new Error(e.message); }));
    const rows = result.rows.filter((row)=> String(row.PermitType).trim().toUpperCase()==='HOOD - C');
    const date = rows.map((row)=>municipalDate(row.PermitDate)).filter(Boolean).sort();
    return { published_total:result.total, returned_rows:result.rows.length, matching_type_rows:rows.length,
      distinct_ids:new Set(rows.map(r=>String(r.Permit_ID))).size, earliest_published_date:date[0], latest_published_date:date.at(-1) };
  }),
  check('official_mixed_codes_in_city', async () => {
    const rows = await Promise.all(['107C','3030','303I','303R'].map(async(code)=>{
      try {
        const count=await arcgis(LAYERS.parcels,{where:`use_code='${code}'`,returnCountOnly:'true'});
        return {code,count:count.count};
      } catch(e) { return {code,error:e.message}; }
    }));
    return rows;
  }),
  check('official_mixed_code_columns', async () => {
    const catalog=await fetchJson('https://data.ct.gov/api/views/rny9-6ak2.json',{timeout:15000});
    return catalog.columns.filter((col)=>/use|class|town|location|muni|^pid$/i.test(col.fieldName))
      .map(({fieldName,name,dataTypeName})=>[fieldName,name,dataTypeName]);
  }),
]);
log('finished', true);
