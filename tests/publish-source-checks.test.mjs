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

test('each finding retains scope, provenance and official links without exposing attributes',()=>{
 const report={checked_at:'2026-10-06T20:00:00Z',checks:[{id:'finance',source_ids:['finance'],status:'passed',observations:[{url:'https://www.newhavenct.gov/reports',sample:{url:'https://www.newhavenct.gov/report.pdf',records:[{owner:'excluded'}]}}]}]};
 const result=updateResults({sources:{}},report,url,sha,[{id:'finance',title:'PDF sample',scope:'One table row',source_urls:['https://example.com/untrusted']}]);
 const finding=result.sources.finance.checks[0];
 assert.equal(finding.title,'PDF sample');
 assert.equal(finding.scope,'One table row');
 assert.equal(finding.run_url,url);
 assert.equal(finding.revision,sha);
 assert.deepEqual(finding.source_urls,['https://www.newhavenct.gov/reports','https://www.newhavenct.gov/report.pdf']);
 assert.equal(JSON.stringify(finding).includes('owner'),false);
});
