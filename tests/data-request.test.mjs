import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../api/data-request.js';
const env={VERCEL_ENV:'production',GITHUB_ISSUES_TOKEN:'test-github-secret',TURNSTILE_SITE_KEY:'public-site-key',TURNSTILE_SECRET_KEY:'test-bot-secret'};
const origin='https://new-haven-civic-data-directory.vercel.app';
const input={title:'Building permit history',need:'Permit dates and status',use:'Understand development',website:'',publicNotice:true,turnstileToken:'test-challenge'};
const request=(body=input,headers={})=>new Request(origin+'/api/data-request',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...headers},body:JSON.stringify(body)});
function setup({configuration=env,bot={},githubStatus=201,throws=false}={}){
 const calls=[];
 const handler=createHandler({env:configuration,fetcher:async(url,options)=>{
  calls.push({url,options});
  if(url.includes('siteverify'))return Response.json({success:true,hostname:new URL(origin).hostname,action:'data-request',...bot});
  if(throws)throw Error('network timeout');
  return Response.json({number:7,html_url:'https://github.com/ctl0v0/new-haven-civic-data-directory/issues/7'},{status:githubStatus});
 }});
 return {handler,calls};
}
test('public configuration exposes only readiness and site key',async()=>{
 const {handler}=setup();const r=await handler(new Request(origin+'/api/data-request'));const value=await r.json();
 assert.deepEqual(value,{enabled:true,siteKey:'public-site-key'});assert(!JSON.stringify(value).includes(env.GITHUB_ISSUES_TOKEN));
});
test('missing credentials and preview deployments cannot create issues',async()=>{
 for(const configuration of [{...env,GITHUB_ISSUES_TOKEN:''},{...env,VERCEL_ENV:'preview'}]){
  const {handler,calls}=setup({configuration});assert.equal((await handler(request())).status,503);assert.equal(calls.length,0);
  assert.equal((await (await handler(new Request(origin+'/api/data-request'))).json()).enabled,false);
 }
});
test('cross-origin and wrong content type rejected before external calls',async()=>{
 for(const headers of [{Origin:'https://other.example'},{'Content-Type':'text/plain'}]){
  const {handler,calls}=setup();assert((await handler(request(input,headers))).status>=400);assert.equal(calls.length,0);
 }
});
test('required fields, public consent, spam trap and challenge are enforced',async()=>{
 for(const changes of [{title:''},{need:''},{use:''},{publicNotice:false},{website:'spam'},{turnstileToken:''},{need:{bad:true}},{title:'x'.repeat(121)}]){
  const {handler,calls}=setup();assert.equal((await handler(request({...input,...changes}))).status,400);assert.equal(calls.length,0);
 }
});
test('oversized stream rejected without trusting content length',async()=>{
 const {handler,calls}=setup();assert.equal((await handler(request({...input,need:'x'.repeat(17000)}))).status,413);assert.equal(calls.length,0);
});
test('invalid JSON rejected',async()=>{
 const {handler,calls}=setup();const r=await handler(new Request(origin+'/api/data-request',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{bad'}));assert.equal(r.status,400);assert.equal(calls.length,0);
});
test('failed challenge, wrong hostname and wrong action never reach GitHub',async()=>{
 for(const bot of [{success:false},{hostname:'other.example'},{action:'wrong-action'}]){
  const {handler,calls}=setup({bot});assert.equal((await handler(request())).status,400);assert.equal(calls.length,1);
 }
});
test('successful request uses fixed repository and returns confirmed issue link',async()=>{
 const {handler,calls}=setup();const r=await handler(request({...input,repo:'other/repo',labels:['unsafe'],assignees:['someone']}));
 assert.equal(r.status,201);assert.equal((await r.json()).url,'https://github.com/ctl0v0/new-haven-civic-data-directory/issues/7');
 assert.equal(calls.length,2);assert.equal(calls[1].url,'https://api.github.com/repos/ctl0v0/new-haven-civic-data-directory/issues');
 assert.equal(calls[1].options.headers.Authorization,'Bearer test-github-secret');
 const body=JSON.parse(calls[1].options.body);assert.deepEqual(Object.keys(body).sort(),['body','title']);assert(body.body.includes('Permit dates and status'));
});
test('user mentions neutralized and secret never included in issue body',async()=>{
 const {handler,calls}=setup();await handler(request({...input,need:'Ask @someone <script> now'}));const body=JSON.parse(calls[1].options.body);
 assert(!body.body.includes('@someone'));assert(!body.body.includes('<script>'));assert(!body.body.includes(env.GITHUB_ISSUES_TOKEN));
});
test('GitHub refusal and timeout report uncertainty, never retry writes',async()=>{
 for(const options of [{githubStatus:403},{throws:true}]){
  const {handler,calls}=setup(options);const r=await handler(request());assert.equal(r.status,502);assert.equal((await r.json()).uncertain,true);assert.equal(calls.length,2);
 }
});
test('unsupported methods rejected',async()=>{
 const {handler,calls}=setup();assert.equal((await handler(new Request(origin+'/api/data-request',{method:'DELETE'}))).status,405);assert.equal(calls.length,0);
});
