import { readFile } from 'node:fs/promises';
import { askParcelData, interpretParcelQuestion } from '../search-index/parcel-question.js';
import { queryParcelData } from '../search-index/parcel-query.js';
import { questionPermitCatalog } from '../search-index/ask.js';
import { indexConfigured } from '../search-index/db.js';

const questions = JSON.parse(await readFile(new URL('../tests/fixtures/parcel-query-qa.json', import.meta.url)));
const now = new Date('2026-11-20T17:00:00Z');
const report = (value) => console.log(JSON.stringify({ event: 'parcel_query_qa', ...value }));
const failure = (error) => ({ name: error?.name, code: error?.code, status: error?.statusCode ?? error?.status });
let catalogPromise;
const catalog = () => catalogPromise ??= questionPermitCatalog();
const mode = process.argv.includes('--local') ? 'local' : 'preview';
const credentials = { index: indexConfigured(), gatewayKey: Boolean(process.env.AI_GATEWAY_API_KEY),
  oidc: Boolean(process.env.VERCEL_OIDC_TOKEN) };
report({ mode, date: '2026-11-20', credentials, questions: questions.length });
const listed = mode === 'preview' ? await catalog().catch((error) => {
  report({ catalogError: failure(error) });
  return null;
}) : null;
if (listed) report({ catalog: { groups: listed.groups.length, permitTypes: listed.distinct_type_names, partial: listed.partial,
  relevantGroups: listed.groups.filter(({ name }) => /plumb|electr|mechan|roof|build/i.test(name ?? '')).map(({ name, count, types }) => [name, count ?? types.length]) } });

const planView = ({ scope, requirements, include, parcel_use_category, contact_role,
  require_contact_role, permit_description_terms, radius_meters, sort }) => ({ scope,
  req: requirements, returns: include, use: parcel_use_category, role: contact_role,
  requireRole: require_contact_role || undefined, desc: permit_description_terms, radius: radius_meters,
  sort: sort === 'parcel_asc' ? undefined : sort });
const searchView = (result) => ({ status: result.status, reason: result.reason, shown: result.items?.length,
  more: Boolean(result.next_cursor), complete: result.complete_for_query,
  checks: [...(result.coverage?.source_checks ?? []), ...(result.coverage?.live_source_checks ?? [])]
    .map(({ source_id, status, date_covered }) => [source_id, status, date_covered]),
  projected: [...new Set(result.items?.flatMap(({ matching_sources }) => matching_sources
    .filter(({ records }) => records?.length).map(({ source_id }) => source_id)) ?? [])],
  ...(result.clarification ? { choice: result.clarification.id, choices: result.clarification.options.map(({ id }) => id) } : {}),
});
async function run(question, id, clarification) {
  let model = 'deterministic';
  let modelError;
  try {
    const review = await askParcelData({ question, plan_only: true, ...(clarification ? { clarification } : {}) }, {
      now, catalog: mode === 'preview' ? catalog : async () => ({ partial: true, groups: [] }),
      interpret: async (...args) => {
        model = 'gateway';
        if (mode === 'local') throw new Error('Live gateway is not configured for local testing');
        try { return await interpretParcelQuestion(...args); }
        catch (error) { modelError = failure(error); throw error; }
      },
    });
    let search;
    if (review.status === 'planned' && credentials.index && mode === 'preview') {
      try { search = searchView(await queryParcelData({ plan: review.plan }, { catalog })); }
      catch (error) { search = { error: failure(error) }; }
    }
    report({ id, choice: clarification?.choice, model, modelError, status: review.status, reason: review.reason,
      questionForUser: review.clarification?.question, plan: review.plan ? planView(review.plan) : undefined, search });
    if (review.clarification?.id === 'work_date' && !clarification && id === 15)
      await run(question, id, { id: 'work_date', choice: 'permit_date' });
  } catch (error) { report({ id, model, error: failure(error) }); }
}
const remaining = questions.map((question, index) => [question, index + 1]);
await Promise.all(Array.from({ length: 4 }, async () => {
  while (remaining.length) await run(...remaining.shift());
}));
report({ finished: true });
