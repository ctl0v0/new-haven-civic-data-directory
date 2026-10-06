import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAgentBrief} from '../scripts/agent-brief.mjs';
import {renderSource} from '../scripts/render.mjs';
import {readFile} from 'node:fs/promises';
const entry=JSON.parse(await readFile(new URL('../sources/assessor.json',import.meta.url),'utf8'));
test('brief links to current source facts without inventing integration capability',()=>{
 const brief=renderAgentBrief(entry);
 assert(brief.includes('/sources/assessor.json'));assert(brief.includes(entry.checked_on));assert(brief.includes(entry.url));
 assert(brief.includes('untested methods and unknowns'));assert(brief.includes('ask me to paste'));
 assert(!brief.includes('Civic Fit'));assert(!brief.includes('Civic Data Commons'));
});
test('brief regeneration reflects changed source and safely escapes text in HTML',()=>{
 const changed={...entry,title:'Changed </textarea><script>bad</script>',checked_on:'2026-10-07'};
 assert(renderAgentBrief(changed).includes('2026-10-07'));
 const html=renderSource(changed,'https://github.com/example/directory');
 assert(html.includes('Changed &lt;/textarea&gt;&lt;script&gt;bad&lt;/script&gt;'));
 assert(!html.includes('Changed </textarea><script>'));
 assert(html.includes('data-copy-brief="agent-brief"'));
});
