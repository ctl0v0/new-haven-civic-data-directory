export const READINESS_LABELS = {
  'workflow-tested':'Workflow tested',
  'sample-tested':'Structured sample tested',
  'preparation-needed':'Preparation needed',
  'not-assessed':'Not yet assessed'
};
export function reviewDue(readiness, now=new Date()) {
  return now.toISOString().slice(0,10) >= readiness.next_review_on;
}
export function validateReadiness(entry, file=entry.id) {
  const r=entry.build_readiness;
  if(!r || !Object.hasOwn(READINESS_LABELS,r.level))throw Error(file+': build readiness required');
  for(const key of ['summary','review_owner'])if(typeof r[key]!=='string'||!r[key].trim())throw Error(file+': readiness '+key+' required');
  for(const key of ['assessed_on','next_review_on']){
    if(typeof r[key]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r[key])||!Number.isFinite(Date.parse(r[key]))||new Date(r[key]).toISOString().slice(0,10)!==r[key])throw Error(file+': invalid readiness '+key);
  }
  if(r.next_review_on<=r.assessed_on)throw Error(file+': readiness review date must follow assessment');
  if(!Array.isArray(r.preparation)||r.preparation.some(v=>typeof v!=='string'||!v.trim()))throw Error(file+': readiness preparation must be text');
  if(r.level!=='workflow-tested'&&!r.preparation.length)throw Error(file+': document remaining preparation');
  if(!Array.isArray(r.evidence)||!r.evidence.length)throw Error(file+': readiness evidence required');
  const recorded=new Set(entry.evidence.map(x=>x.url));
  for(const url of r.evidence)if(!recorded.has(url))throw Error(file+': readiness evidence must refer to source evidence');
}
