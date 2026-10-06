import {readFile,readdir} from 'node:fs/promises';
import {validateReadiness,reviewDue} from './readiness.mjs';
const root=new URL('../sources/',import.meta.url);
let due=0;
for(const name of (await readdir(root)).filter(x=>x.endsWith('.json'))){
 const entry=JSON.parse(await readFile(new URL(name,root),'utf8'));
 validateReadiness(entry,name);
 if(reviewDue(entry.build_readiness)){
  due++;
  console.error('::error file=sources/'+name+'::Build-readiness review due. Confirm access/evidence and update the assessment; do not advance dates without a check. Review owner: '+entry.build_readiness.review_owner);
 }
}
console.log(due+' build-readiness reviews due. This check does not reverify city data.');
if(due)process.exitCode=1;
