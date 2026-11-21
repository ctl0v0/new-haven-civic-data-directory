import {validateReadiness} from './readiness.mjs';
import {readFile, readdir, mkdir, writeFile, copyFile} from 'node:fs/promises';
import {render, renderSource} from './render.mjs';
import {SOURCES as parcelSources} from '../parcel/config.js';
const root = new URL('../', import.meta.url);
const repo = 'https://github.com/ctl0v0/new-haven-civic-data-directory';
const entries = [];
const sourceChecks = JSON.parse(await readFile(new URL('site/source-checks.json',root),'utf8'));
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
  validateReadiness(entry,file);
  entries.push(entry);
}
if (!entries.length || new Set(entries.map(e=>e.id)).size !== entries.length) throw new Error('Missing entries or duplicate IDs');
await mkdir(new URL('dist/',root),{recursive:true});
await writeFile(new URL('dist/index.html',root),render(entries,repo));
await mkdir(new URL('dist/sources/',root),{recursive:true});
for (const entry of entries) {
  await writeFile(new URL('dist/sources/'+entry.id+'.html',root),renderSource(entry,repo,sourceChecks.sources[entry.id]));
  await writeFile(new URL('dist/sources/'+entry.id+'.json',root),JSON.stringify(entry,null,2)+'\n');
}
await writeFile(new URL('dist/catalog.json',root),JSON.stringify(entries,null,2)+'\n');
for (const source of parcelSources) if (source.directoryId && !entries.some(entry=>entry.id===source.directoryId)) throw new Error('Unknown parcel directory source '+source.directoryId);
await writeFile(new URL('dist/parcel-source-catalog.json',root),JSON.stringify(parcelSources,null,2)+'\n');
for (const name of ['style.css','search.js','request.js','request.html','agent-brief.js','readiness.js','build-readiness.html','source-checks.json','parcel.css','parcel.js','city-activity.js','vacancy-layer.js','vacancy-session.js','query-explorer.js','permit-applications.js','storefront-opportunity.js','commercial-renter.js','parcel-report.css','parcel-report.js','parcel-record-text.js','parcel-map-sources.js']) await copyFile(new URL('site/'+name,root),new URL('dist/'+name,root));
await mkdir(new URL('dist/plat/fonts/', root), { recursive: true });
for (const name of ['plat-tokens.css', 'plat-fonts.css', 'plat-base.css', 'plat-map.css', 'plat.css', 'status.js'])
  await copyFile(new URL('site/plat/' + name, root), new URL('dist/plat/' + name, root));
for (const name of await readdir(new URL('site/plat/fonts/', root)))
  await copyFile(new URL('site/plat/fonts/' + name, root), new URL('dist/plat/fonts/' + name, root));
await mkdir(new URL('dist/leaflet/images/',root),{recursive:true});
for (const name of ['leaflet.css','leaflet.js']) await copyFile(new URL('node_modules/leaflet/dist/'+name,root),new URL('dist/leaflet/'+name,root));
for (const name of (await readdir(new URL('node_modules/leaflet/dist/images/',root))).filter(name=>name.endsWith('.png'))) await copyFile(new URL('node_modules/leaflet/dist/images/'+name,root),new URL('dist/leaflet/images/'+name,root));
console.log('Validated and built '+entries.length+' source entries.');
if (process.env.VERCEL_ENV === 'preview' &&
    process.env.VERCEL_GIT_COMMIT_REF === 'codex/parcel-pilot')
  await import('./smoke-preview-question.mjs');
