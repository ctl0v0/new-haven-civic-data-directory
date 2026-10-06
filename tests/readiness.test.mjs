import test from 'node:test';import assert from 'node:assert/strict';
import {validateReadiness,reviewDue} from '../scripts/readiness.mjs';
const entry={id:'demo',evidence:[{url:'https://example.org'}],build_readiness:{level:'sample-tested',summary:'One structured sample returned.',preparation:['Verify pagination.'],assessed_on:'2026-10-06',next_review_on:'2027-01-04',review_owner:'Unassigned',evidence:['https://example.org']}};
test('assessment requires explicit evidence, remaining work and valid dates',()=>{
 assert.doesNotThrow(()=>validateReadiness(entry));
 for(const change of [{evidence:[]},{evidence:['https://unrecorded.example']},{preparation:[]},{assessed_on:'2026-02-30'},{next_review_on:'2026-10-05'},{level:'great'}]){
  assert.throws(()=>validateReadiness({...entry,build_readiness:{...entry.build_readiness,...change}}));
 }
});
test('due date expires assessment without promoting or rewriting its judgment',()=>{
 assert.equal(reviewDue(entry.build_readiness,new Date('2027-01-03')),false);
 assert.equal(reviewDue(entry.build_readiness,new Date('2027-01-04')),true);
 assert.equal(entry.build_readiness.level,'sample-tested');
});
