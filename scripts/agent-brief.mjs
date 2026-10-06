import {READINESS_LABELS} from './readiness.mjs';
export function renderAgentBrief(entry) {
  const site='https://new-haven-civic-data-directory.vercel.app';
  return [
    'Help me build a tool using this New Haven data source.',
    'My project: [describe what you want to build].',
    '',
    'Source: '+entry.title,
    'What it contains: '+entry.description,
    'Access: '+entry.access,
    'Directory status: '+entry.status,
    'Build readiness: '+READINESS_LABELS[entry.build_readiness.level]+' — '+entry.build_readiness.summary,
    'Readiness assessed: '+entry.build_readiness.assessed_on+'; review due: '+entry.build_readiness.next_review_on,
    'Preparation: '+(entry.build_readiness.preparation.join(' ') || 'See the documented tested workflow.'),
    'Access last checked: '+entry.checked_on+' (not the data update date).',
    'Original source: '+entry.url,
    'Current source record: '+site+'/sources/'+entry.id+'.json',
    'Readable documentation: '+site+'/sources/'+entry.id+'.html',
    '',
    'Read the current source record for access steps, fields, evidence, limitations, costs and reuse terms before planning the integration. Separate verified access from untested methods and unknowns. Test a small request or sample before relying on it. Do not assume that a successful sample proves complete, current or reusable data. If you cannot open the links, ask me to paste the source record rather than inventing details.',
    '',
    'Start by explaining what this source can support for my project, what remains uncertain, and the smallest useful next step.'
  ].join('\n');
}
