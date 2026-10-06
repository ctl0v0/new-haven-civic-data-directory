(() => {
  const search = document.querySelector('#search');
  const category = document.querySelector('#category');
  const rows = [...document.querySelectorAll('[data-source]')];
  const normalize = value => value.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  function filter() {
    const query = normalize(search.value.trim());
    let count = 0;
    rows.forEach(row => {
      const match = (!query || normalize(row.dataset.search).includes(query)) &&
        (!category.value || row.dataset.category === category.value);
      row.hidden = !match;
      if (match) count++;
    });
    document.querySelector('#count').textContent = count + ' of ' + rows.length + ' sources';
    document.querySelector('#empty').hidden = count !== 0;
  }
  search.addEventListener('input', filter);
  category.addEventListener('change', filter);
  document.querySelector('#filters').hidden = false;
})();
