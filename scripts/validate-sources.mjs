import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const commands={
 'alders-html':['python3',['scripts/verify-alders.py']],
 'city-property-apis':[process.execPath,['scripts/verify-property-api.mjs']],
 'known-property-lookup':[process.execPath,['scripts/verify-property-lookup.mjs']],
 'known-gis-workflow':[process.execPath,['scripts/verify-gis-workflow.mjs']],
 'ward-boundaries':[process.execPath,['scripts/verify-ward-boundaries.mjs']],
 'finance-documents':['python3',['scripts/verify-finance.py']]
};
export function interpret(result){
 const observations=(result.stdout||'').split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}}).filter(Boolean);
 if(result.error)return {status:'unavailable',reason:'Validator could not finish.',observations};
 const missing=observations.some(x=>x.metadata?.missingRequestedFields?.length);
 if(missing)return {status:'changed',reason:'Expected schema fields are missing.',observations};
 if(observations.some(x=>x.status==='failed')){
  const failed=observations.find(x=>x.status==='failed');
  const reason=failed.reason||failed.error||'Check failed';
  const blocked=[401,403,429].includes(failed.httpStatus)||/HTTP (401|403|429)/.test(reason);
  const changed=/table|schema|field|features|ward|row|format|representative/i.test(reason);
  return {status:blocked?'blocked':changed?'changed':'unavailable',reason,observations};
 }
 if(result.status!==0||!observations.length||observations.some(x=>x.status!=='passed')){
  return {status:'changed',reason:'Expected validation output was not confirmed.',observations};
 }
 return {status:'passed',observations};
}
export async function main(){
 const registry=JSON.parse(await readFile(new URL('../validation/sources.json',import.meta.url),'utf8'));
 const selected=process.argv[2]||'all';
 if(!['all','alders','property','finance','wards'].includes(selected))throw Error('Unknown source selection');
 const report={checked_at:new Date().toISOString(),scope:'Small read-only source checks; not a freshness, accuracy or rights certification',checks:[]};
 for(const check of registry){
  if(selected!=='all'&&check.group!==selected)continue;
  if(!check.validator){report.checks.push({id:check.id,source_ids:check.source_ids,status:'not-configured',reason:check.reason});continue;}
  const command=commands[check.validator];
  if(!command)throw Error('Unknown validator type');
  const result=spawnSync(command[0],command[1],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',timeout:180000,maxBuffer:1000000});
  const outcome=interpret(result);
  report.checks.push({id:check.id,source_ids:check.source_ids,...outcome});
  if(['finance-documents','ward-boundaries'].includes(check.id)) for(const observation of outcome.observations) console.log(JSON.stringify({documentOrBoundaryCheck:observation}));
  console.log(JSON.stringify({check:check.id,status:outcome.status,reason:outcome.reason||null,warnings:outcome.observations.flatMap(x=>x.warnings||[])}));
 }
 await mkdir('verification',{recursive:true});
 await writeFile('verification/source-validation-report.json',JSON.stringify(report,null,2)+'\n');
 if(report.checks.some(x=>['blocked','changed','unavailable'].includes(x.status)))process.exitCode=1;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await main();
