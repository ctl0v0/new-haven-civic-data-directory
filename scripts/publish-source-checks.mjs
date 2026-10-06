import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const statuses=new Set(['passed','changed','blocked','unavailable','not-configured']);
const priority=['unavailable','blocked','changed','not-configured','passed'];

export function summarizeFindings(observations){
 return (observations||[]).map(item=>{
  const result={};
  for(const key of ['rowsExtracted','uniqueWards','missingNumberedWards','rowsWithoutWard','headings','exportedFields','dataFingerprint','recordFingerprint'])if(Object.hasOwn(item,key))result[key]=item[key];
  if(item.metadata)result.schema={missingFields:item.metadata.missingRequestedFields||[],fields:(item.metadata.requestedFields||[]).map(f=>({name:f.name,type:f.type})).sort((a,b)=>a.name.localeCompare(b.name))};
  if(item.query)result.sample={rowsReturned:item.query.rowsReturned,returnedFields:[...(item.query.returnedFields||[])].sort()};
  for(const key of ['address','parcel','zoning','identifiers'])if(item[key])result[key]=Object.fromEntries(Object.entries(item[key]).filter(([name])=>['rowsReturned','distinctLocations','normalizedAddressesMatchInput','validLongitudeLatitudePolygons','matchesIndependentAddressLookup','requiredFieldsPresent','parcelPresent','accountPresent'].includes(name)));
  if(item.repeatLookups)result.repeatLookups=item.repeatLookups.map(({field,rowsReturned,sameRecordAndSelectedValues})=>({field,rowsReturned,sameRecordAndSelectedValues}));
  if(item.sample)result.document={label:item.sample.label,url:item.sample.url,sha256:item.sample.source_sha256,pages:item.sample.pages,pagesInspected:item.sample.pages_inspected,textPages:item.sample.pages_with_substantial_text,revenueRowPage:item.sample.checked_revenue_sample?.pdf_page,revenueRowChecks:item.sample.checked_revenue_sample?.checks};
  return result;
 });
}

export function updateResults(previous,report,runUrl,revision,registry=[]){
 if(!/^https:\/\/github\.com\/ctl0v0\/new-haven-civic-data-directory\/actions\/runs\/\d+$/.test(runUrl))throw Error('Invalid validation run link');
 if(!/^[a-f0-9]{40}$/.test(revision)||!Number.isFinite(Date.parse(report.checked_at)))throw Error('Invalid validation provenance');
 const output={sources:{...(previous.sources||{})}};
 const grouped={};
 const definitions=new Map(registry.map(item=>[item.id,item]));
 for(const check of report.checks||[]){
  if(!statuses.has(check.status))throw Error('Invalid source-check status');
  for(const id of check.source_ids||[]){
   if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))throw Error('Invalid source ID');
   const definition=definitions.get(check.id)||{};
   const urls=[...(definition.source_urls||[]),...(check.observations||[]).flatMap(item=>[item.url,item.sample?.url,item.addressQuery?.url,item.address?.url,item.parcel?.url,item.zoning?.url])];
   const source_urls=[...new Set(urls.filter(url=>{
    if(typeof url!=='string')return false;
    try{const parsed=new URL(url);return parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&(parsed.hostname==='newhavenct.gov'||parsed.hostname.endsWith('.newhavenct.gov')||parsed.hostname==='newhaven-ct.legistar.com'||parsed.hostname==='gis.vgsi.com');}catch{return false;}
   }))];
   (grouped[id]||=[]).push({id:check.id,title:definition.title||'Source validation',scope:definition.scope||'See the exact run for the tested scope.',status:check.status,checked_at:report.checked_at,run_url:runUrl,revision,source_urls,findings:summarizeFindings(check.observations),reason:typeof check.reason==='string'?check.reason.slice(0,500):null,warnings:(check.observations||[]).flatMap(x=>x.warnings||[]).filter(x=>typeof x==='string').map(x=>x.slice(0,500))});
  }
 }
 for(const [id,checks] of Object.entries(grouped)){
  if(output.sources[id]&&Date.parse(output.sources[id].checked_at)>Date.parse(report.checked_at))continue;
  output.sources[id]={checked_at:report.checked_at,run_url:runUrl,revision,status:priority.find(status=>checks.some(check=>check.status===status)),checks};
 }
 return output;
}
async function main(){
 const report=JSON.parse(await readFile('verification/source-validation-report.json','utf8'));
 let previous={sources:{}};
 try{previous=JSON.parse(await readFile('site/source-checks.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const runUrl='https://github.com/ctl0v0/new-haven-civic-data-directory/actions/runs/'+process.env.GITHUB_RUN_ID;
 const registry=JSON.parse(await readFile('validation/sources.json','utf8'));
 const result=updateResults(previous,report,runUrl,process.env.GITHUB_SHA,registry);
 await writeFile('verification/previous-source-checks.json',JSON.stringify(previous,null,2)+'\n');
 await writeFile('site/source-checks.json',JSON.stringify(result,null,2)+'\n');
 console.log('Published validation summaries only; source attributes and readiness assessments are unchanged.');
}
if(process.argv[1]===fileURLToPath(import.meta.url))await main();
