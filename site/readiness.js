const today=new Date().toISOString().slice(0,10);
for(const item of document.querySelectorAll('[data-review-on]')){
  const due=today>=item.dataset.reviewOn;
  item.hidden=!due;
}

for(const button of document.querySelectorAll('[data-readiness-dialog]')){
 const dialog=document.getElementById(button.dataset.readinessDialog);
 if(!dialog||typeof dialog.showModal!=='function')continue;
 button.hidden=false;
 button.parentElement.querySelector('[data-readiness-fallback]')?.setAttribute('hidden','');
 button.addEventListener('click',()=>dialog.showModal());
}
