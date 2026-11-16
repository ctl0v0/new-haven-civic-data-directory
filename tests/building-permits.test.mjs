import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyBuildingPermits} from '../scripts/verify-building-permits.mjs';
import {interpret} from '../scripts/validate-sources.mjs';
import {updateResults} from '../scripts/publish-source-checks.mjs';
import {findChanges} from '../scripts/review-source-changes.mjs';
import {renderSource} from '../scripts/render.mjs';

const parcel={Parcel_ID:13397,PrintKey:'241 0234 00200',LegalAddress:'155 TEMPLE ST',Owner:'PRIVATE OWNER'};
function fixture(){return {
 search:{success:'success',total:1,rows:[structuredClone(parcel)]},
 point:{rows:[structuredClone(parcel)]},
 children:{
  Permit:[{Permit_ID:101,PermitNo:'SYNTHETIC-PERMIT',PermitType:'Synthetic',PermStatus:'Issued',PermitDate:'2026-01-01',Description:'PRIVATE DESCRIPTION',Contacts:[{Email:'PRIVATE EMAIL'}]}],
  Application:[{Application_ID:102,ApplicationNumber:'SYNTHETIC-APPLICATION',PermitApplicationType:'Synthetic',PermitApplicationStatus:'Pending',ApplicationDate:'2026-01-02'}],
  License:[{License_ID:103,LicenseNumber:'SYNTHETIC-LICENSE',LicenseType:'Synthetic',Status:'Historical',Date:'2025-01-01',ExpirationDate:null}],
  Certificate:[{Certificate_ID:104,CertificateNumber:'SYNTHETIC-CERTIFICATE',CertificateType:'Synthetic',CertificateDate:'2026-01-03'}],
  Contact:[{Email:'PRIVATE CONTACT'}],Document:[{FilenameWeb:'PRIVATE DOCUMENT'}]
 }
};}
function fetcher(data,calls=[]){return async(input,init)=>{
 const url=new URL(input);calls.push({url,init});
 const body=url.pathname.endsWith('/GetM5Data')?data.search:url.pathname.endsWith('/Mobile/SelectParcel')?data.point:url.pathname.endsWith('/Parcel/13397/Children')?data.children:null;
 assert.notEqual(body,null,'Only the three documented read-only endpoints may be requested');
 return new Response(JSON.stringify(body));
};}
const outcome=observation=>interpret({status:observation.status==='passed'?0:1,stdout:JSON.stringify(observation)});
const run='https://github.com/ctl0v0/new-haven-civic-data-directory/actions/runs/123';
const revision='a'.repeat(40);
const registry=JSON.parse(await readFile(new URL('../validation/sources.json',import.meta.url),'utf8'));

test('permit checker verifies both parcel routes and all four groups without exposing records',async()=>{
 const calls=[];const result=await verifyBuildingPermits({fetcher:fetcher(fixture(),calls)});
 assert.equal(result.status,'passed');assert.equal(calls.length,3);
 assert.equal(calls[0].url.searchParams.get('value'),'241 0234 00200');
 assert.equal(calls[1].url.searchParams.get('customer'),'NewHavenCityCT');
 for(const {init}of calls){assert.equal(init.headers.SourceId,'2');assert.equal(init.headers.Accept,'application/json');assert(init.signal instanceof AbortSignal);assert(!init.headers.Authorization);}
 assert.deepEqual(result.recordGroups.map(group=>[group.kind,group.rowsReturned]),[['Permit',1],['Application',1],['License',1],['Certificate',1]]);
 assert.equal(result.repeatLookups[0].sameRecordAndSelectedValues,true);
 assert.deepEqual(result.metadata.missingRequestedFields,[]);
 assert.equal(outcome(result).status,'passed');
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SYNTHETIC-|155 TEMPLE ST|241 0234 00200.*Owner/);
});

test('point lookup accepts a direct parcel or one-row envelope and rejects ambiguous or different parcels',async()=>{
 const direct=fixture();direct.point=structuredClone(parcel);
 assert.equal((await verifyBuildingPermits({fetcher:fetcher(direct)})).status,'passed');
 for(const change of [data=>data.search.rows.push(structuredClone(parcel)),data=>data.search.total=2,data=>data.point.rows.push(structuredClone(parcel)),data=>data.point.total=2,data=>data.point.rows[0].Parcel_ID=999,data=>data.point.rows[0].PrintKey='DIFFERENT',data=>data.search.rows[0].LegalAddress='DIFFERENT']){
  const data=fixture();change(data);const result=await verifyBuildingPermits({fetcher:fetcher(data)});
  assert.equal(result.status,'failed');assert.equal(outcome(result).status,'changed');
 }
});

test('missing groups, empty groups, missing schema, duplicate IDs and non-scalar fields require review',async()=>{
 for(const change of [data=>delete data.children.License,data=>data.children.Certificate=[],data=>delete data.children.Application[0].PermitApplicationType,data=>data.children.Permit.push(structuredClone(data.children.Permit[0])),data=>data.children.Permit[0].Permit_ID=null,data=>data.children.Permit[0].PermStatus={private:'PRIVATE'},data=>data.children.Permit=Array.from({length:501},(_,index)=>({...data.children.Permit[0],Permit_ID:index+1}))]){
  const data=fixture();change(data);const result=await verifyBuildingPermits({fetcher:fetcher(data)});
  assert.equal(result.status,'failed');assert.equal(outcome(result).status,'changed');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 }
});

test('blocked requests, upstream errors, malformed data and network failures stay distinct and sanitized',async()=>{
 for(const status of [401,403,429,500,503]){
  const result=await verifyBuildingPermits({fetcher:async()=>new Response('PRIVATE',{status})});
  assert.equal(result.httpStatus,status);assert.equal(outcome(result).status,[401,403,429].includes(status)?'blocked':'unavailable');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 }
 for(const body of ['<html>PRIVATE</html>','null','[]','{"error":"PRIVATE"}','{"success":"failure","message":"PRIVATE"}']){
  const result=await verifyBuildingPermits({fetcher:async()=>new Response(body)});
  assert.equal(outcome(result).status,'changed');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 }
 const result=await verifyBuildingPermits({fetcher:async()=>{throw Error('PRIVATE NETWORK DETAIL');}});
 assert.equal(outcome(result).status,'unavailable');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});

test('response byte limit rejects advertised or streamed oversize data',async()=>{
 for(const response of [new Response('small',{headers:{'content-length':'10000001'}}),new Response(new Uint8Array(10_000_001))]){
  const result=await verifyBuildingPermits({fetcher:async()=>response});
  assert.equal(outcome(result).status,'changed');assert.match(result.error,/size limit/);
 }
});

test('fingerprints ignore ordering and contact edits but detect changed statuses and additional records',async()=>{
 const data=fixture();data.children.Permit.push({...data.children.Permit[0],Permit_ID:105,PermitNo:'SYNTHETIC-SECOND'});
 const initial=await verifyBuildingPermits({fetcher:fetcher(data)});
 const reordered=structuredClone(data);reordered.children.Permit.reverse();reordered.children.Permit[0].Description='DIFFERENT PRIVATE DESCRIPTION';
 const repeat=await verifyBuildingPermits({fetcher:fetcher(reordered)});
 assert.equal(initial.recordFingerprint,repeat.recordFingerprint);
 reordered.children.Permit[0].PermStatus='Closed';
 const changed=await verifyBuildingPermits({fetcher:fetcher(reordered)});
 assert.notEqual(initial.recordFingerprint,changed.recordFingerprint);
 reordered.children.Permit.push({...reordered.children.Permit[0],Permit_ID:106});
 assert.notEqual(changed.recordFingerprint,(await verifyBuildingPermits({fetcher:fetcher(reordered)})).recordFingerprint);
});

test('permit checks publish source evidence, render a latest result and detect later source changes',async()=>{
 const data=fixture();const result=await verifyBuildingPermits({fetcher:fetcher(data)});
 const report={checked_at:'2026-11-16T12:00:00Z',checks:[{id:'building-permits',source_ids:['building-permits'],...outcome(result)}]};
 const published=updateResults({},report,run,revision,registry);
 const source=published.sources['building-permits'];
 assert.equal(source.status,'passed');assert.equal(source.checks[0].findings[0].recordGroups.length,4);
 assert(source.checks[0].source_urls.some(url=>url.startsWith('https://services5.municity5.com/')));
 assert.doesNotMatch(JSON.stringify(source),/PRIVATE|SYNTHETIC-/);
 const entry=JSON.parse(await readFile(new URL('../sources/building-permits.json',import.meta.url),'utf8'));
 const html=renderSource(entry,'https://github.com/ctl0v0/new-haven-civic-data-directory',source);
 assert(html.includes('Latest source check'));assert(html.includes('Passed with notes'));assert(html.includes(run));
 data.children.Permit[0].PermStatus='Closed';
 const changed=await verifyBuildingPermits({fetcher:fetcher(data)});
 const next=updateResults(published,{checked_at:'2026-11-16T13:00:00Z',checks:[{id:'building-permits',source_ids:['building-permits'],...outcome(changed)}]},run,revision,registry);
 assert.equal(findChanges(published,next)[0].id,'building-permits');
});

