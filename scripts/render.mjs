const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const link = (url, label, className='') => `<a${className ? ` class="${escapeHTML(className)}"` : ''} href="${escapeHTML(url)}">${escapeHTML(label)}</a>`;
const renderStep = (entry, value, index) => {
  let text = escapeHTML(value);
  for (const item of entry.step_links || []) {
    if (item.step === index) text = text.replace(escapeHTML(item.label), link(item.url, item.label));
  }
  return '<li>' + text + '</li>';
};
const list = values => `<ul>${values.map(value => `<li>${escapeHTML(value)}</li>`).join('')}</ul>`;
const searchText = entry => [entry.title,entry.description,entry.category,entry.publisher,entry.access,entry.contact,entry.formats.join(' '),entry.fields.flat().join(' '),entry.steps.join(' '),entry.limitations.join(' '),entry.next.join(' ')].join(' ');
function page({title, repo, prefix='', content, search=false, source=false}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title><meta name="description" content="Find New Haven civic data, access instructions, contacts and known gaps."><link rel="stylesheet" href="${prefix}style.css"></head><body class="${source ? 'source-page' : 'directory-page'}">
<a class="skip" href="#main">Skip to content</a>
<header><div class="masthead"><a class="site-brand" href="${prefix}index.html">Civic data directory</a><nav class="site-nav" aria-label="Primary"><div class="nav-links"><a href="${prefix}index.html"${source ? '' : ' aria-current="page"'}>Browse sources</a>${link(repo+'/issues','Requests')}${link(repo+'/blob/main/ROADMAP.md','Roadmap')}</div>${link(prefix+'request.html','Request data','button-link')}</nav></div><p class="eyebrow">A community resource</p>${source ? `<h1>${escapeHTML(title)}</h1>` : '<h1>New Haven Civic Data Directory</h1><p>Find city data. Understand how to use it. Help fill the gaps.</p>'}</header>
<main id="main">${content}</main><footer><p>Independent community directory. Source publishers maintain their original data; entry maintainers document access. Confirm dates, costs and terms before relying on a source.</p><p>${link(repo,'Repository')} · ${link(repo+'/blob/main/research/peer-cities.md','Peer-city research')} · ${link(prefix+'catalog.json','Download directory JSON')}</p></footer>
${search ? '<script src="search.js" defer></script>' : ''}</body></html>`;
}
export function render(entries, repo) {
  const content = `<section aria-labelledby="directory-heading" id="directory"><h2 id="directory-heading">Browse sources</h2><p>These entries point to original sources. Each records the access checked and questions still open. “Access tested” may mean a page or metadata was inspected; open a source for its exact scope.</p>
<div id="filters" hidden><label>Search sources <input id="search" type="search" placeholder="Try parcels, budgets or agendas"></label><label>Category <select id="category"><option value="">All categories</option>${[...new Set(entries.map(entry=>entry.category))].sort().map(category=>`<option>${escapeHTML(category)}</option>`).join('')}</select></label></div>
<p id="count" role="status" aria-live="polite">${entries.length} sources</p><div class="table-wrap" tabindex="0" role="region" aria-label="Data sources table"><table class="directory-table"><caption class="sr-only">New Haven civic data sources and access status</caption><thead><tr><th scope="col">Source</th><th scope="col">Category</th><th scope="col">Data owner / publisher</th><th scope="col">Access</th><th scope="col">Cost</th><th scope="col">Status</th><th scope="col">Checked</th></tr></thead><tbody>
${entries.map(entry=>`<tr data-source="${escapeHTML(entry.id)}" data-category="${escapeHTML(entry.category)}" data-search="${escapeHTML(searchText(entry))}"><th scope="row">${link('sources/'+entry.id+'.html',entry.title)}</th><td>${escapeHTML(entry.category)}</td><td>${escapeHTML(entry.listing?.publisher || entry.publisher)}</td><td>${escapeHTML(entry.listing?.access || entry.access)}</td><td>${escapeHTML(entry.listing?.cost || entry.cost)}</td><td><span class="badge">${escapeHTML(entry.status)}</span></td><td><time datetime="${escapeHTML(entry.checked_on)}">${escapeHTML(entry.checked_on)}</time></td></tr>`).join('')}
</tbody></table></div><p id="empty" hidden>No sources match. Clear your search or choose another category.</p></section>`;
  return page({title:'New Haven Civic Data Directory',repo,content,search:true});
}
export function renderSource(entry, repo) {
  const definition = (label,value) => `<dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd>`;
  const content = `<article><p class="eyebrow">${escapeHTML(entry.category)} · ${escapeHTML(entry.status)}</p><p>${escapeHTML(entry.description)}</p><p>${link(entry.url,'Open source')} · ${link(repo+'/blob/main/sources/'+entry.id+'.json','View entry in GitHub')}</p>
<dl>${definition('Publisher / host',entry.publisher)}${definition('Source type',entry.source_type)}${definition('Contact',entry.contact)}${definition('Formats',entry.formats.join(', ')||'Not confirmed')}${definition('Cost',entry.cost)}${definition('Reuse terms',entry.terms)}${definition('Update frequency',entry.update_frequency)}${definition('Entry maintainer',entry.entry_maintainer)}${definition('Last checked',entry.checked_on+'; see evidence for scope')}</dl>
<h2>How to access</h2><ol>${entry.steps.map((value,index)=>renderStep(entry,value,index)).join('')}</ol><h2>Key fields</h2>
${entry.fields.length ? `<table><thead><tr><th scope="col">Field</th><th scope="col">Meaning</th></tr></thead><tbody>${entry.fields.map(field=>`<tr><th scope="row">${escapeHTML(field[0])}</th><td>${escapeHTML(field[1])}</td></tr>`).join('')}</tbody></table>` : '<p>Field schema not yet verified.</p>'}
<h2>Known limitations</h2>${list(entry.limitations)}<h2>Next investigation</h2>${list(entry.next)}
${entry.related ? `<h2>Related sources</h2><ul>${entry.related.map(value=>`<li>${link(value.url,value.label)}</li>`).join('')}</ul>` : ''}
<h2>Check evidence</h2><ul>${entry.evidence.map(value=>`<li>${link(value.url,value.note)}</li>`).join('')}</ul><p>${link(repo+'/issues/new?template=source-correction.yml','Report a correction')} · ${link('../index.html','Back to directory')}</p></article>`;
  return page({title:entry.title,repo,prefix:'../',content,source:true});
}
