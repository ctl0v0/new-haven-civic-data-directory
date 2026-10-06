const form=document.querySelector('#request-form');
const status=document.querySelector('#request-status');
const fields=document.querySelector('#request-fields');
const submit=document.querySelector('#submit-request');
let widget=null,token='',busy=false;
function message(value){status.textContent=value;status.focus();}
function retryBot(){token='';if(widget!==null&&window.turnstile)window.turnstile.reset(widget);}
async function start(){
 try{
  const response=await fetch('/api/data-request',{cache:'no-store'});
  if(!response.ok)throw Error();
  const config=await response.json();
  if(!config.enabled||!config.siteKey){message('Website submissions are not available yet. You can still request data through the GitHub link below.');return;}
  await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.onload=resolve;s.onerror=reject;document.head.append(s);});
  widget=window.turnstile.render('#bot-check',{sitekey:config.siteKey,action:'data-request',callback:value=>{token=value;},'expired-callback':()=>{token='';},'error-callback':()=>{token='';message('The bot check could not load. Try refreshing or use the GitHub request link.');}});
  fields.disabled=false;status.textContent='';
 }catch{message('The request form could not load. Refresh or use the GitHub request link below.');}
}
form.addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;
 if(!form.reportValidity())return;
 if(!token){message('Please complete the bot check before submitting.');return;}
 const body=Object.fromEntries(new FormData(form));body.publicNotice=body.publicNotice==='on';body.turnstileToken=token;
 busy=true;submit.disabled=true;form.setAttribute('aria-busy','true');message('Submitting your request…');
 let confirmed=false,uncertain=false;
 try{
  const response=await fetch('/api/data-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok){uncertain=Boolean(result.uncertain);message(result.error||'Submission failed. Your entries have been kept.');return;}
  if(!/^https:\/\/github\.com\/ctl0v0\/new-haven-civic-data-directory\/issues\/\d+$/.test(result.url))throw Error();
  confirmed=true;form.hidden=true;status.textContent='Your request was published. ';
  const link=document.createElement('a');link.href=result.url;link.textContent='View your request on GitHub';status.append(link);status.focus();
 }catch{uncertain=true;message('We could not confirm whether your request was received. Check existing requests below before trying again.');}
 finally{busy=false;form.removeAttribute('aria-busy');submit.disabled=false;if(!confirmed)retryBot();if(uncertain)document.querySelector('#existing-requests').focus();}
});
start();
