import test from 'node:test';
import assert from 'node:assert/strict';
import {findChanges,reviewBody,syncReviewIssues,mergeBody} from '../scripts/review-source-changes.mjs';
const run='https://github.com/ctl0v0/new-haven-civic-data-directory/actions/runs/';
const prior={sources:{alders:{checked_at:'2026-10-06T10:00:00Z',run_url:run+'1',checks:[{id:'roster',title:'Roster',status:'passed',warnings:['The city HTML includes a representative row with no ward identifier.'],source_urls:[],findings:[{rowsWithoutWard:1}]}]}}};
function current(){return {sources:{alders:{checked_at:'2026-10-06T11:00:00Z',run_url:run+'2',checks:[{id:'roster',title:'Roster',status:'passed',warnings:[],source_urls:[],findings:[{rowsWithoutWard:0}]}]}}};}
test('routine timestamps and first findings baseline do not create issues',()=>{
 const same=structuredClone(prior);same.sources.alders.checked_at='2026-10-06T11:00:00Z';same.sources.alders.run_url=run+'2';
 assert.deepEqual(findChanges(prior,same),[]);
 const baseline=structuredClone(prior);delete baseline.sources.alders.checks[0].findings;
 assert.deepEqual(findChanges(baseline,same),[]);
 assert.deepEqual(findChanges({sources:{}},current()),[]);
});
test('coverage changes, removed warnings and failed status request review',()=>{
 const changes=findChanges(prior,current());assert.equal(changes.length,1);
 const body=reviewBody(changes[0],{title:'Alders'});
 assert.ok(body.includes('Confirm all 30 ward identifiers'));
 assert.ok(body.includes(run+'1'));assert.ok(body.includes(run+'2'));
 const failure=current();failure.sources.alders.checks[0].status='blocked';
 assert.equal(findChanges(prior,failure).length,1);
});
test('reuse and reopen one review issue while preserving user notes',async()=>{
 const changes=findChanges(prior,current());const calls=[];
 const existing={number:7,state:'closed',body:'<!-- source-review:alders -->\n<!-- source-review-fingerprint:'+'0'.repeat(64)+' -->\n<!-- source-review-generated:start -->\nold\n<!-- source-review-generated:end -->\nKeep my notes'};
 const request=async(method,path,body)=>{calls.push({method,path,body});return method==='GET'?[existing]:{html_url:'https://github.com/example/issue'};};
 await syncReviewIssues(changes,{alders:{title:'Board of Alders roster'}},request);
 assert.equal(calls.length,2);assert.equal(calls[1].method,'PATCH');assert.equal(calls[1].body.state,'open');
 assert.ok(calls[1].body.body.includes('Keep my notes'));
});
test('create once and skip a retry of the same change',async()=>{
 const change=findChanges(prior,current())[0];let posts=0;
 await syncReviewIssues([change],{alders:{title:'Alders'}},async(method)=>method==='GET'?[]:(posts++,{html_url:'https://github.com/example/issue'}));
 assert.equal(posts,1);
 const existing={number:7,body:reviewBody(change,{title:'Alders'})};
 await syncReviewIssues([change],{},async(method)=>{assert.equal(method,'GET');return [existing];});
});
