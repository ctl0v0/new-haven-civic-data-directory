import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const statuses=new Set(['passed','changed','blocked','unavailable','not-configured']);
const priority=['unavailable','blocked','changed','not-configured','passed'];
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
   (grouped[id]||=[]).push({id:check.id,title:definition.title||'Source validation',scope:definition.scope||'See the exact run for the tested scope.',status:check.status,checked_at:report.checked_at,run_url:runUrl,revision,source_urls,reason:typeof check.reason==='string'?check.reason.slice(0,500):null,warnings:(check.observations||[]).flatMap(x=>x.warnings||[]).filter(x=>typeof x==='string').map(x=>x.slice(0,500))});
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
 await writeFile('site/source-checks.json',JSON.stringify(result,null,2)+'\n');
 console.log('Published validation summaries only; source attributes and readiness assessments are unchanged.');
}
if(process.argv[1]===fileURLToPath(import.meta.url))await main();
