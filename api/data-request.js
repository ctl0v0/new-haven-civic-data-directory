const REPO = 'ctl0v0/new-haven-civic-data-directory';
const ORIGIN = 'https://new-haven-civic-data-directory.vercel.app';
const LIMIT = 16000;
const limits = {title:120,need:3000,use:2000,coverage:300,checked:1500,examples:1500,access:500};
const json = (status, data) => new Response(JSON.stringify(data), {status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const text = value => value.replace(/@/g, '@\u200b').replace(/[<>]/g, '').replace(/\r/g, '');
export function createHandler({env=process.env,fetcher=fetch}={}) {
  const enabled = () => env.VERCEL_ENV === 'production' && Boolean(env.GITHUB_ISSUES_TOKEN && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
  return async request => {
    if (request.method === 'GET') return json(200,{enabled:enabled(),siteKey:enabled()?env.TURNSTILE_SITE_KEY:null});
    if (request.method !== 'POST') return json(405,{error:'Use the request form to submit data requests.'});
    if (!enabled()) return json(503,{error:'Website submissions are not available yet. Please use the GitHub request link.'});
    if (request.headers.get('origin') !== ORIGIN) return json(403,{error:'Submit requests from the directory website.'});
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) return json(415,{error:'Invalid submission format.'});
    if (Number(request.headers.get('content-length') || 0) > LIMIT) return json(413,{error:'Your request is too long.'});
    let body;
    try {
      const reader=request.body?.getReader(); if(!reader)return json(400,{error:'Please complete the form.'});
      const chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>LIMIT){await reader.cancel();return json(413,{error:'Your request is too long.'});}chunks.push(value);}
      const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
      body=JSON.parse(new TextDecoder().decode(all));
    } catch { return json(400,{error:'Invalid submission. Please check your entries.'}); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400,{error:'Please complete the form.'});
    if (typeof body.website !== 'string' || body.website) return json(400,{error:'Unable to accept this submission.'});
    if (body.publicNotice !== true) return json(400,{error:'Confirm that your request will be published publicly.'});
    const values={};
    for(const [key,max] of Object.entries(limits)){
      if(body[key] !== undefined && typeof body[key] !== 'string')return json(400,{error:'Invalid form field.'});
      values[key]=(body[key] || '').trim();
      if(values[key].length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(values[key]))return json(400,{error:'Please shorten or correct your '+key+' field.'});
    }
    if (!values.title || !values.need || !values.use) return json(400,{error:'Please enter a title, the data you need, and your intended use.'});
    if(typeof body.turnstileToken !== 'string' || !body.turnstileToken || body.turnstileToken.length>2048)return json(400,{error:'Complete the bot check, then submit again.'});
    try {
      const verification=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:body.turnstileToken}),signal:AbortSignal.timeout(10000)});
      if(!verification.ok)return json(503,{error:'The bot check is temporarily unavailable. Your request was not sent.'});
      const result=await verification.json();
      if(!result.success || result.hostname !== new URL(ORIGIN).hostname || result.action !== 'data-request')return json(400,{error:'The bot check expired or failed. Please try it again.'});
    } catch {return json(503,{error:'The bot check is temporarily unavailable. Your request was not sent.'});}
    const sections=[['Data needed','need'],['Intended use','use'],['Geography and time span','coverage'],['Sources already checked','checked'],['Examples from other cities','examples'],['Preferred access','access']];
    const issueBody='Submitted through the public directory website. Community investigation; not an official city records request.\n\n'+sections.map(([label,key])=>'## '+label+'\n\n'+text(values[key] || 'Not provided')).join('\n\n');
    try {
      const response=await fetcher('https://api.github.com/repos/'+REPO+'/issues',{method:'POST',headers:{'Authorization':'Bearer '+env.GITHUB_ISSUES_TOKEN,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:JSON.stringify({title:'[Data request]: '+text(values.title).replace(/\n/g,' '),body:issueBody}),signal:AbortSignal.timeout(10000)});
      if(response.status!==201)return json(502,{error:'GitHub did not confirm creation. Check existing requests before retrying.',uncertain:true});
      const issue=await response.json();
      if(!Number.isInteger(issue.number)||!issue.html_url?.startsWith('https://github.com/'+REPO+'/issues/'))throw Error('Invalid issue response');
      return json(201,{url:issue.html_url});
    } catch {return json(502,{error:'We could not confirm whether GitHub received your request. Check existing requests before retrying.',uncertain:true});}
  };
}
export default {fetch: request => createHandler()(request)};
