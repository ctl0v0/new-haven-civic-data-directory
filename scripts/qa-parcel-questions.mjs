import { readFile } from 'node:fs/promises';
import { askParcelData, interpretParcelQuestion } from '../search-index/parcel-question.js';
import { queryParcelData } from '../search-index/parcel-query.js';
import { questionPermitCatalog } from '../search-index/ask.js';
import { indexConfigured } from '../search-index/db.js';

const questions = JSON.parse(await readFile(new URL('../tests/fixtures/parcel-query-qa.json', import.meta.url)));
const now = new Date('2026-11-20T17:00:00Z');
const report = (value) => console.log(JSON.stringify({ event: 'parcel_query_diagnostic', ...value }));
const failure = (error) => ({ name: error?.name, code: error?.code, status: error?.statusCode ?? error?.status, reason: error?.reason,
  cause: error?.lastError?.name ?? error?.cause?.name, causeStatus: error?.lastError?.statusCode ?? error?.cause?.statusCode });
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
  let interpretation;
  const started = Date.now();
  try {
    const review = await askParcelData({ question, plan_only: true, ...(clarification ? { clarification } : {}) }, {
      now, catalog: mode === 'preview' ? catalog : async () => ({ partial: true, groups: [] }),
      interpret: async (...args) => {
        model = 'gateway';
        if (mode === 'local') throw new Error('Live gateway is not configured for local testing');
        try { interpretation = await interpretParcelQuestion(...args); return interpretation; }
        catch (error) { modelError = failure(error); throw error; }
      },
    });
    let search;
    if (review.status === 'planned' && credentials.index && mode === 'preview') {
      try { search = searchView(await queryParcelData({ plan: review.plan }, { catalog })); }
      catch (error) { search = { error: failure(error) }; }
    }
    report({ id, choice: clarification?.choice, model, modelError, elapsed_ms: Date.now() - started,
      raw: review.status === 'planned' ? undefined : interpretation, status: review.status, reason: review.reason,
      questionForUser: review.clarification?.question, plan: review.plan ? planView(review.plan) : undefined, search });
    if (review.clarification?.id === 'work_date' && !clarification && id === 15)
      await run(question, id, { id: 'work_date', choice: 'permit_date' });
  } catch (error) { report({ id, model, error: failure(error) }); }
}
const retryIds = new Set([2, 7, 12, 22, 26, 35, 37, 41]);
const remaining = questions.flatMap((question, index) => retryIds.has(index + 1) ? [[question, index + 1]] : []);
const permit = (fields, date, permit_group) => ({ source_id: 'municity', ...(fields ? { equals: fields } : {}),
  ...(date ? { date } : {}), ...(permit_group ? { permit_group } : {}) });
const city = { kind: 'city' };
const inNeighborhood = (name) => ({ kind: 'neighborhood', name });
const address = (address) => ({ kind: 'address', address });
const recent = { field: 'PermitDate', from: '2026-10-22', to: '2026-11-20' };
const controls = [
  [2, 'East Rock plumbing, 30 days', { scope: inNeighborhood('East Rock'), requirements: [permit(null, recent, 'Plumbing')] }],
  [9, 'Known address, full municipal parcel records', { scope: address('486 Orange St'), include: [{ source_id: 'municity' }] }],
  [12, 'Electrical group and business-space use', { scope: city, requirements: [permit(null, recent, 'Electrical')], parcel_use_category: 'business_space' }],
  [17, 'Hood - C application date', { scope: city, requirements: [{ source_id: 'municity-permit-activity',
    equals: { activity_kind: 'application', permit_type: 'Hood - C' }, date: { ...recent, field: 'ApplicationDate' } }] }],
  [20, 'East Rock business-license issue date', { scope: inNeighborhood('East Rock'), requirements: [{ source_id: 'municipal-business-licenses',
    date: { ...recent, field: 'IssueDate' } }] }],
  [24, 'Exact-address municipal license history', { scope: address('20 Eld St'), include: [{ source_id: 'municipal-business-licenses' }] }],
  [26, 'State liquor roster by parcel', { scope: city, requirements: [{ source_id: 'ct-liquor-permits' }],
    include: [{ source_id: 'ct-liquor-permits', fields: ['dba', 'permit_address', 'status'] }] }],
  [29, 'Strictly commercial Hood - C in the last calendar month', { scope: city,
    requirements: [permit({ PermitType: 'Hood - C' }, { ...recent, from: '2026-10-01', to: '2026-10-31' })],
    parcel_use_category: 'commercial_only' }],
  [30, 'Known permit number with its verified type', { scope: city,
    requirements: [permit({ PermitType: 'Hood - C', PermitNo: 'M-23-00357' })],
    include: [{ source_id: 'permit-applications' }, { source_id: 'permit-reviews' }, { source_id: 'permit-inspections' }] }],
  [35, 'Exact Plumbing Permit type', { scope: city, requirements: [permit({ PermitType: 'Plumbing Permit' }, recent)] }],
  [38, 'Electrical group for last calendar month', { scope: city,
    requirements: [permit(null, { ...recent, from: '2026-10-01', to: '2026-10-31' }, 'Electrical')] }],
  [41, 'Roofing - C with no parcel use filter', { scope: city, requirements: [permit({ PermitType: 'Roofing - C' })] }],
];
async function runControls() {
  if (!credentials.index || mode !== 'preview') return;
  const queue = [...controls];
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const [id, control, plan] = queue.shift();
      try {
        const result = await queryParcelData({ plan: { ...plan, limit: 5 } }, { catalog });
        report({ id, control, search: searchView(result), coverageDetail: result.coverage?.source_checks?.map((check) => ({
          source: check.source_id, status: check.status, fresh: check.fresh, unlinked: check.unlinked_count,
          dateCovered: check.date_covered, withoutIssueDate: check.inventory?.named_licenses_without_issue_date,
        })), knownPermit: id === 30 ? result.items?.some(({ matching_sources }) => matching_sources.some(({ records }) =>
          records?.some(({ fields }) => fields.PermitNo === 'M-23-00357'))) : undefined });
      } catch (error) { report({ id, control, error: failure(error) }); }
    }
  }));
}
await Promise.all([runControls(), ...Array.from({ length: 2 }, async () => {
  while (remaining.length) await run(...remaining.shift());
})]);
report({ finished: true });
