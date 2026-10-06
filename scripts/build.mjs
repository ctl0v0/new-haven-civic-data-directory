import {readFile, readdir, mkdir, writeFile, copyFile} from 'node:fs/promises';
import {render, renderSource} from './render.mjs';
const root = new URL('../', import.meta.url);
const repo = 'https://github.com/ctl0v0/new-haven-civic-data-directory';
const entries = [];
for (const file of (await readdir(new URL('sources/', root))).filter(f=>f.endsWith('.json')).sort()) {
  const entry = JSON.parse(await readFile(new URL('sources/'+file,root),'utf8'));
  for (const field of ['id','title','category','publisher','source_type','status','description','url','access','contact','cost','terms','update_frequency','checked_on','entry_maintainer']) {
    if (typeof entry[field] !== 'string' || !entry[field].trim()) throw new Error(file+': missing '+field);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id) || file !== entry.id+'.json') throw new Error(file+': invalid ID');
  if (!['Source located','Access tested','Needs investigation','In progress'].includes(entry.status)) throw new Error(file+': invalid status');
  if (!['official','official-vendor','community'].includes(entry.source_type)) throw new Error(file+': invalid source type');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.checked_on) || !Number.isFinite(Date.parse(entry.checked_on))) throw new Error(file+': invalid date');
  for (const field of ['formats','steps','limitations','next']) if (!Array.isArray(entry[field]) || entry[field].some(v=>typeof v!=='string')) throw new Error(file+': invalid '+field);
  if (!entry.steps.length || !Array.isArray(entry.fields) || entry.fields.some(v=>!Array.isArray(v)||v.length!==2||v.some(s=>typeof s!=='string'))) throw new Error(file+': invalid steps/fields');
  if (!Array.isArray(entry.evidence) || !entry.evidence.length) throw new Error(file+': evidence required');
  if (!Array.isArray(entry.step_links) || !entry.step_links.length) throw new Error(file+': How to access requires at least one direct link in step_links');
  if (entry.step_links !== undefined) {
    if (!Array.isArray(entry.step_links)) throw new Error(file+': invalid step links');
    for (const item of entry.step_links) {
      if (!Number.isInteger(item.step) || item.step < 0 || item.step >= entry.steps.length || typeof item.label !== 'string' || !item.label.trim() || !entry.steps[item.step].includes(item.label)) throw new Error(file+': invalid linked step or label');
    }
  }
  for (const item of [{url:entry.url},...entry.evidence,...(entry.related||[]),...(entry.step_links||[])]) if (new URL(item.url).protocol !== 'https:') throw new Error(file+': HTTPS links required');
  if (entry.evidence.some(v=>typeof v.note!=='string')) throw new Error(file+': evidence note required');
  entries.push(entry);
}
if (!entries.length || new Set(entries.map(e=>e.id)).size !== entries.length) throw new Error('Missing entries or duplicate IDs');
await mkdir(new URL('dist/',root),{recursive:true});
await writeFile(new URL('dist/index.html',root),render(entries,repo));
await mkdir(new URL('dist/sources/',root),{recursive:true});
for (const entry of entries) {
  await writeFile(new URL('dist/sources/'+entry.id+'.html',root),renderSource(entry,repo));
  await writeFile(new URL('dist/sources/'+entry.id+'.json',root),JSON.stringify(entry,null,2)+'\n');
}
await writeFile(new URL('dist/catalog.json',root),JSON.stringify(entries,null,2)+'\n');
for (const name of ['style.css','search.js','request.js','request.html','agent-brief.js']) await copyFile(new URL('site/'+name,root),new URL('dist/'+name,root));
console.log('Validated and built '+entries.length+' source entries.');
