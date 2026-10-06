import test from 'node:test';
import assert from 'node:assert/strict';
import {updateResults} from '../scripts/publish-source-checks.mjs';
const url='https://github.com/ctl0v0/new-haven-civic-data-directory/actions/runs/123';
const sha='a'.repeat(40);
test('publish only summaries and include failed checks',()=>{
 const report={checked_at:'2026-10-06T20:00:00Z',checks:[{id:'sample',source_ids:['assessor'],status:'passed',observations:[{records:[{owner:'excluded'}],warnings:['Known limit']}]},{id:'workflow',source_ids:['assessor'],status:'changed'}]};
 const result=updateResults({sources:{}},report,url,sha);
 assert.equal(result.sources.assessor.status,'changed');
 assert.equal(result.sources.assessor.run_url,url);
 assert.equal(JSON.stringify(result).includes('owner'),false);
 assert.deepEqual(result.sources.assessor.checks[0].warnings,['Known limit']);
});
test('a scoped run preserves other sources and newer results',()=>{
 const prior={sources:{alders:{checked_at:'2026-10-07T00:00:00Z'},finance:{checked_at:'2026-10-01T00:00:00Z'}}};
 const result=updateResults(prior,{checked_at:'2026-10-06T20:00:00Z',checks:[{id:'roster',source_ids:['alders'],status:'passed'}]},url,sha);
 assert.deepEqual(result,prior);
});
test('reject unsupported links and states',()=>{
 assert.throws(()=>updateResults({},{checked_at:'2026-10-06',checks:[]},'https://example.com',sha));
 assert.throws(()=>updateResults({},{checked_at:'2026-10-06',checks:[{source_ids:['alders'],status:'unknown'}]},url,sha));
});
