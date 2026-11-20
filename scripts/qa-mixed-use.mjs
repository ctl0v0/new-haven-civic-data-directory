import { LAYERS } from '../parcel/config.js';
import { arcgis, fetchJson } from '../parcel/http.js';
import { recordedParcelUse } from '../parcel/data-context.js';
const log = (stage, data) => console.log(JSON.stringify({ event: 'mixed_use_audit', stage, data }));
const codeNames = ['107C','3030','303I','303R'];
const normalize = (value) => String(value ?? '').trim().toUpperCase();
try {
  const catalog = await fetchJson('https://data.ct.gov/api/views/rny9-6ak2.json', { timeout: 20000 });
  const columns = catalog.columns.map(({ fieldName, name }) => ({ fieldName, name }));
  const relevant = columns.filter(({ fieldName }) => /land_use|municip|town|parcel_id|local_use|property.*id|\bpid\b/i.test(fieldName));
  log('state_columns', relevant);
  const has = (name) => columns.some(({ fieldName }) => fieldName === name);
  const first = (...fields) => fields.find(has);
  const town = first('town','town_name','municipality','municipality_name');
  const code = first('land_use_code','land_use','local_use','use_code');
  const label = first('land_use_description','land_use_desc','use_description');
  const pid = first('parcel_id','pid','property_id','local_parcel_id');
  if (town && code && label && pid) {
    const endpoint = new URL('https://data.ct.gov/resource/rny9-6ak2.json');
    endpoint.searchParams.set('$select', [town,code,label,pid].join(','));
    endpoint.searchParams.set('$where', `upper(${town}) = 'NEW HAVEN' AND upper(${label}) LIKE '%MIX%'`);
    endpoint.searchParams.set('$limit','1000');
    const rows = await fetchJson(endpoint, { timeout: 20000 });
    const labels = new Map();
    for (const row of rows) {
      const key = normalize(row[code]);
      if (!labels.has(key)) labels.set(key, { code: key, byLabel: new Set(), ids: new Set() });
      labels.get(key).byLabel.add(row[label]);
      labels.get(key).ids.add(normalize(row[pid]));
    }
    log('state_counts', { count: rows.length, keys: { town, code, label, pid } });
    for (const [key, { byLabel, ids }] of labels) {
      if (!/^[A-Z0-9]{1,12}$/.test(key)) continue;
      if (!codeNames.includes(key)) codeNames.push(key);
      const city = await arcgis(LAYERS.parcels, { where: `use_code='${key}'`, outFields: 'parcel_id,objectid,property_address,use_code,units_commercial,units_residential', resultRecordCount: '1000' });
      const matches = (city.features ?? []).map(x => x.attributes).filter(x => ids.has(normalize(x.parcel_id)));
      log('city_state_match', { code: key, labels: [...byLabel], cityRows: city.features?.length,
        matchedSamePid: matches.length, sample: matches.slice(0,2).map(({ parcel_id, objectid, property_address }) => ({ parcel_id, objectid, property_address })) });
    }
  }
} catch (e) { log('state_error', { name: e.name, status: e.upstreamStatus, message: e.message }); }
for (const key of codeNames) {
  try {
    const where = `use_code='${key}'`;
    const [count, withUnits, sample] = await Promise.all([
      arcgis(LAYERS.parcels, { where, returnCountOnly:'true' }),
      arcgis(LAYERS.parcels, { where:`${where} AND units_commercial > 0 AND units_residential > 0`, returnCountOnly:'true' }),
      arcgis(LAYERS.parcels, { where, outFields:'parcel_id,objectid,property_address,use_code', resultRecordCount:'2' }),
    ]);
    log('city_counts', { key, cityRows: count.count, bothPublishedUnitCounts: withUnits.count,
      sample: sample.features?.map(x => x.attributes), category: recordedParcelUse(key).category });
  } catch (e) { log('city_error', { key, name: e.name, status: e.upstreamStatus, message:e.message }); }
}
log('finished', true);
