(() => {
  const search=document.querySelector('#search'),category=document.querySelector('#category');
  const rows=[...document.querySelectorAll('[data-source]')], entries=[...document.querySelectorAll('[data-entry]')];
  const normalize=value=>value.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
  function filter(){
    const query=normalize(search.value.trim()); let count=0;
    rows.forEach(row=>{
      const article=entries.find(e=>e.dataset.entry===row.dataset.source);
      const match=(!query||normalize(row.textContent+' '+article.textContent).includes(query))&&(!category.value||row.children[1].textContent===category.value);
      row.hidden=!match; article.hidden=!match; if(match)count++;
    });
    document.querySelector('#count').textContent=count+' of '+rows.length+' sources';
    document.querySelector('#empty').hidden=count!==0;
  }
  search.addEventListener('input',filter); category.addEventListener('change',filter);
  function revealAnchor(){
    const target=document.getElementById(location.hash.slice(1));
    if(target?.matches('[data-entry]')){search.value='';category.value='';filter();target.scrollIntoView();}
  }
  window.addEventListener('hashchange',revealAnchor);
  document.querySelector('#filters').hidden=false; revealAnchor();
})();
