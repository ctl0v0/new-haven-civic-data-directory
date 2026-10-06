const today=new Date().toISOString().slice(0,10);
for(const item of document.querySelectorAll('[data-review-on]')){
  const due=today>=item.dataset.reviewOn;
  item.hidden=!due;
}
