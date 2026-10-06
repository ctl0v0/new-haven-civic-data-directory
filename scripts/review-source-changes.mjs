import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const repository='ctl0v0/new-haven-civic-data-directory';
const stable=value=>JSON.stringify(value);
function comparable(check,includeFindings){
 const result={status:check.status,warnings:[...(check.warnings||[])].sort(),reason:check.reason||null,source_urls:[...(check.source_urls||[])].sort()};
 if(includeFindings)result.findings=check.findings;
 return result;
}
export function findChanges(previous,current){
 const changes=[];
 for(const [id,source] of Object.entries(current.sources||{})){
  const prior=previous.sources?.[id];
  if(!prior||Date.parse(source.checked_at)<=Date.parse(prior.checked_at))continue;
  const before=new Map((prior.checks||[]).map(check=>[check.id,check]));
  const after=new Map((source.checks||[]).map(check=>[check.id,check]));
  const changed=[];
  for(const checkId of new Set([...before.keys(),...after.keys()])){
   const old=before.get(checkId),next=after.get(checkId);
   const includeFindings=!!old?.findings&&!!next?.findings;
   if(!old||!next||stable(comparable(old,includeFindings))!==stable(comparable(next,includeFindings)))changed.push({id:checkId,before:old||null,after:next||null});
  }
  if(changed.length){
   const fingerprint=createHash('sha256').update(stable(changed.map(change=>({id:change.id,before:change.before?comparable(change.before,!!change.before.findings&&!!change.after?.findings):null,after:change.after?comparable(change.after,!!change.before?.findings&&!!change.after.findings):null})))).digest('hex');
   changes.push({id,previous:prior,current:source,changed,fingerprint});
  }
 }
 return changes;
}
const safe=value=>String(value).replaceAll('@','＠').replace(/[<>\r]/g,' ').slice(0,2000);
export function reviewBody(change,entry){
 const lines=[
 '<!-- source-review:'+change.id+' -->',
 '<!-- source-review-fingerprint:'+change.fingerprint+' -->',
 '<!-- source-review-generated:start -->',
 'The automated source check found a change. This is a request to review the documentation, not a confirmation that every limitation is resolved.',
 '',
 '[Previous check]('+change.previous.run_url+') · [Current check]('+change.current.run_url+')',
 '',
 '### Changed findings'
 ];
 for(const item of change.changed){
  lines.push('- **'+safe(item.after?.title||item.before?.title||'Source check')+'**: '+safe(item.before?.status||'not configured')+' → '+safe(item.after?.status||'removed')+'.');
  for(const note of item.before?.warnings||[])if(!item.after?.warnings?.includes(note))lines.push('  - No longer reported by this check: '+safe(note));
  for(const note of item.after?.warnings||[])if(!item.before?.warnings?.includes(note))lines.push('  - Newly reported by this check: '+safe(note));
  if(item.after?.reason&&item.after.reason!==item.before?.reason)lines.push('  - Current result: '+safe(item.after.reason));
  if(stable(item.before?.source_urls)!==stable(item.after?.source_urls))lines.push('  - Original-source links changed; check whether the selected document or query changed.');
  if(item.before?.findings&&item.after?.findings&&stable(item.before.findings)!==stable(item.after.findings))lines.push('  - Recorded coverage, schema, sample results or content fingerprint changed. Inspect the current run for details.');
 }
 lines.push('','### Proposed documentation review','- Reproduce the changed check and inspect the original source.','- Review the source record’s limitations, preparation notes, readiness summary and evidence.','- Prepare a pull request only for findings supported by the new evidence; retain unresolved questions.','- The page and agent brief regenerate from the source record after the pull request is merged.');
 if(change.id==='alders'&&change.changed.some(item=>item.before?.warnings?.some(note=>note.includes('no ward identifier'))&&!item.after?.warnings?.some(note=>note.includes('no ward identifier'))&&item.after?.status==='passed'))lines.push('- The missing-ward warning is no longer reported. Confirm all 30 ward identifiers before proposing removal of that limitation; current officeholding and reuse permissions remain separate questions.');
 lines.push('','[Review source record](https://github.com/'+repository+'/blob/main/sources/'+change.id+'.json)','', '<!-- source-review-generated:end -->');
 return lines.join('\n');
}
export function mergeBody(existing,generated){
 const start='<!-- source-review-generated:start -->',end='<!-- source-review-generated:end -->';
 const a=existing.indexOf(start),b=existing.indexOf(end);
 if(a>=0&&b>=a){
  const priorFingerprint=/<!-- source-review-fingerprint:[a-f0-9]+ -->/;
  const updated=existing.slice(0,a)+generated.slice(generated.indexOf(start),generated.indexOf(end)+end.length)+existing.slice(b+end.length);
  const fingerprint=generated.match(priorFingerprint)?.[0]||'';
  return updated.replace(priorFingerprint,()=>fingerprint);
 }
 return generated+(existing.trim()?'\n\n### Existing notes\n'+existing:'');
}
export async function syncReviewIssues(changes,entries,request){
 if(!changes.length)return [];
 const issues=[];
 for(let page=1;page<=10;page++){
  const batch=await request('GET','/issues?state=all&per_page=100&page='+page);
  issues.push(...batch.filter(item=>!item.pull_request));
  if(batch.length<100)break;
  if(page===10)throw Error('Could not safely finish existing review-issue lookup');
 }
 const results=[];
 for(const change of changes){
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(change.id))throw Error('Invalid source ID');
  const marker='<!-- source-review:'+change.id+' -->';
  const existing=issues.find(issue=>(issue.body||'').includes(marker));
  if(existing?.body?.includes('<!-- source-review-fingerprint:'+change.fingerprint+' -->')){results.push({id:change.id,action:'already-recorded'});continue;}
  const entry=entries[change.id];
  const generated=reviewBody(change,entry);
  const title='[Source review] '+safe(entry?.title||change.id);
  const result=existing?await request('PATCH','/issues/'+existing.number,{state:'open',title,body:mergeBody(existing.body||'',generated)}):await request('POST','/issues',{title,body:generated});
  results.push({id:change.id,action:existing?'updated':'created',url:result.html_url});
 }
 return results;
}
async function main(){
 const previous=JSON.parse(await readFile('verification/previous-source-checks.json','utf8'));
 const current=JSON.parse(await readFile('site/source-checks.json','utf8'));
 const changes=findChanges(previous,current);
 if(!changes.length){console.log('No material source-check changes; no review issues needed.');return;}
 const token=process.env.GITHUB_TOKEN;
 if(!token)throw Error('Missing GitHub issue credential');
 const request=async(method,path,body)=>{
  const response=await fetch('https://api.github.com/repos/'+repository+path,{method,headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('GitHub review-issue request failed: HTTP '+response.status);
  return response.json();
 };
 const entries={};
 for(const change of changes)entries[change.id]=JSON.parse(await readFile('sources/'+change.id+'.json','utf8'));
 const results=await syncReviewIssues(changes,entries,request);
 console.log(JSON.stringify({reviewIssues:results}));
}
if(process.argv[1]===fileURLToPath(import.meta.url))await main();
