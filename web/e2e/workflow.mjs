// End-to-end test of the analyst workflow through the real dashboard UI.
//
// Prerequisites (see web/e2e/run.sh): an isolated e2e database seeded by scripts/e2e_seed.py, the dashboard
// running against it with dev auth, and the research worker available to execute queued refresh runs.
//
//   BASE_URL=http://localhost:3100 SLUG=<test model slug> WORKER_CMD="…planb worker --until-empty" node web/e2e/workflow.mjs
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Playwright is resolved with require() so that a globally installed copy (NODE_PATH) works as well as a local one.
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const SLUG = process.env.SLUG;
const WORKER = process.env.WORKER_CMD;
const USERS = { admin: '00000000-0000-4000-8000-000000000001', researcher: '00000000-0000-4000-8000-000000000002', reviewer: '00000000-0000-4000-8000-000000000003' };
if (!SLUG || !WORKER) throw new Error('SLUG and WORKER_CMD are required');

const results = [];
let failures = 0;
function check(name, condition, detail = '') {
  results.push(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

const browser = await chromium.launch();
const TIMEOUT = 8000;
const errors = [];

async function as(role) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addCookies([{ name: 'planb_dev_user', value: USERS[role], url: BASE }]);
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  page.on('pageerror', (e) => errors.push(`${role}: ${String(e).slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) errors.push(`${role}: CSP ${m.text().slice(0, 200)}`); });
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`${role}: HTTP ${r.status()} ${r.url()}`); });
  return page;
}
const record = (tab) => `${BASE}/business/${SLUG}?tab=${tab}`;
const flash = async (page) => (await page.locator('.notice.good, .notice.bad').first().textContent().catch(() => '')) ?? '';
const rowWith = (page, text) => page.locator('tr', { hasText: text }).first();
const runWorker = () => execSync(WORKER, { stdio: 'pipe' }).toString();

try {
// ── 1. Every core screen renders for a researcher ───────────────────────────
const researcher = await as('researcher');
for (const path of ['/', '/catalogue', '/tasks', '/runs', '/sources', '/evidence', '/review', '/publication', '/quality', '/costs', '/audit',
                    '/suppliers', '/interviews', '/geography', '/regulatory']) {
  const res = await researcher.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  check(`renders ${path}`, res?.status() === 200, `HTTP ${res?.status()}`);
}
for (const tab of ['overview', 'costs', 'revenue', 'model', 'evidence', 'gaps', 'versions']) {
  const res = await researcher.goto(record(tab), { waitUntil: 'domcontentloaded' });
  check(`renders business record tab ${tab}`, res?.status() === 200);
}
await researcher.goto(record('overview'));
check('test data is unmistakably labelled', (await researcher.locator('.badge.demo').count()) > 0 && (await researcher.locator('.notice.demo').count()) === 1);

// ── 2. Scenario calculator runs the engine in the browser ───────────────────
await researcher.goto(record('model'), { waitUntil: 'networkidle' });
const whatIf = researcher.locator('table', { hasText: 'What-if' });
const before = await whatIf.locator('tr', { hasText: 'Steady-state revenue / month' }).locator('td').nth(2).textContent();
await researcher.locator('input[type=range]').nth(1).fill('-20'); // selling price −20 %
const after = await whatIf.locator('tr', { hasText: 'Steady-state revenue / month' }).locator('td').nth(2).textContent();
check('scenario calculator recomputes on input', before !== after, `${before} → ${after}`);
check('source reconciliation shown', (await researcher.locator('text=Reconciliation against the source document').count()) === 1);

// ── 3. Reviewer rejects one claim and corrects another ──────────────────────
const reviewer = await as('reviewer');
await reviewer.goto(record('evidence'));
let row = rowWith(reviewer, 'Synthetic packer');
await row.locator('input[name=note]').first().fill('E2E: wrong machine for this capacity');
await row.locator('button[value=reject]').click();
await reviewer.waitForURL(/ok=|error=/);
check('reviewer rejects a claim', (await flash(reviewer)).includes('rejected'), await flash(reviewer));

await reviewer.goto(record('evidence'));
row = reviewer.locator('tr', { has: reviewer.locator('b', { hasText: /^Rent$/ }) }).first();
await row.locator('summary', { hasText: 'correct' }).click();
await row.locator('details input[name=value]').fill('1.20');
await row.locator('details input[name=quote]').fill('selling & adm exp 1.20 1.20 1.20 1.20 1.20');
await row.locator('details input[name=note]').fill('E2E: rent line misread');
await row.locator('details button', { hasText: 'Save correction' }).click();
await reviewer.waitForURL(/ok=|error=/);
check('reviewer corrects a claim with a quote that exists on the page', (await flash(reviewer)).includes('accepted'), await flash(reviewer));

// a rejection without a reason is refused by the database, and the UI shows why
await reviewer.goto(record('evidence'));
row = rowWith(reviewer, 'Synthetic grinder');
await row.locator('button[value=reject]').click();
await reviewer.waitForURL(/ok=|error=/);
check('rejecting without a reason is refused', (await reviewer.locator('.notice.bad').count()) === 1, await flash(reviewer));

// ── 4. Researcher adds a conflicting observation; cannot verify evidence ────
await researcher.goto(record('costs'));
const form = researcher.locator('form', { hasText: 'Add observation' }).last();
await form.locator('select[name=cost_item_id]').selectOption({ label: /Synthetic grinder/ }).catch(async () => {
  const opt = await form.locator('select[name=cost_item_id] option', { hasText: 'Synthetic grinder' }).first().getAttribute('value');
  await form.locator('select[name=cost_item_id]').selectOption(opt);
});
await form.locator('input[name=value]').fill('320000');
await form.locator('input[name=observed_on]').fill('2026-06-01');
const src = await form.locator('select[name=source_id] option', { hasText: 'E2E second source' }).first().getAttribute('value');
await form.locator('select[name=source_id]').selectOption(src);
await form.locator('select[name=evidence_type]').selectOption('manufacturer_catalogue');
await form.locator('input[name=notes]').fill('E2E synthetic conflicting figure');
await form.locator('button', { hasText: 'Add observation' }).click();
await researcher.waitForURL(/ok=|error=/);
check('researcher records a second observation beside the first', (await flash(researcher)).includes('recorded'), await flash(researcher));

await researcher.goto(record('costs'));
const verifyOption = researcher.locator('select[name=status] option[value=verified]').first();
check('researcher is not offered "verified"', (await verifyOption.isDisabled()) === true);

// ── 5. Researcher records an assumption, queues a refresh; the worker runs it ─
await researcher.goto(record('revenue'));
row = rowWith(researcher, 'owner_monthly_compensation');
await row.locator('summary').click();
await row.locator('input[name=value]').fill('40000');
await row.locator('input[name=rationale]').fill('E2E: owner needs to replace a salary of Rs 40,000');
await row.locator('button', { hasText: 'Record as assumption' }).click();
await researcher.waitForURL(/ok=|error=/);
check('researcher records an explicit assumption', (await flash(researcher)).includes('Assumption recorded'), await flash(researcher));

// tie the rent line to the local rent rate × floor area (an explicit, recorded analyst decision)
await researcher.goto(record('costs'));
const rentMapping = researcher.locator('tr:has(b:text-is("Rent")) + tr');  // the mapping row directly under the Rent line
await rentMapping.locator('summary').click();
await rentMapping.locator('select[name=metric_key]').selectOption('commercial_rent_per_sqft_month');
await rentMapping.locator('input[name=multiplier]').fill('1200');
await rentMapping.locator('button', { hasText: 'Save' }).click();
await researcher.waitForURL(/ok=|error=/);
check('a local derivation without a stated basis is refused', (await researcher.locator('.notice.bad').count()) === 1, await flash(researcher));
await researcher.goto(record('costs'));
const rentMapping2 = researcher.locator('tr:has(b:text-is("Rent")) + tr');  // the mapping row directly under the Rent line
await rentMapping2.locator('summary').click();
await rentMapping2.locator('select[name=metric_key]').selectOption('commercial_rent_per_sqft_month');
await rentMapping2.locator('input[name=multiplier]').fill('1200');
await rentMapping2.locator('input[name=basis]').fill('E2E synthetic: 1,200 sq ft assumed for the fixture');
await rentMapping2.locator('button', { hasText: 'Save' }).click();
await researcher.waitForURL(/ok=|error=/);
check('researcher ties a cost to a local rate with its basis', (await flash(researcher)).includes('Local derivation recorded'), await flash(researcher));

await researcher.goto(record('overview'));
await researcher.locator('button', { hasText: 'Queue refresh run' }).click();
await researcher.waitForURL(/ok=|error=/);
check('refresh run queued from the dashboard', (await flash(researcher)).includes('queued'), await flash(researcher));
const workerOut = runWorker();
check('worker executed the queued run', /succeeded/.test(workerOut), workerOut.trim().slice(0, 120));

// ── 6. The conflict is visible, both observations kept, then resolved ───────
await researcher.goto(record('costs'));
const conflicts = researcher.locator('section.panel', { hasText: 'Conflicting observations' });
check('conflict between the two observations is flagged', (await conflicts.locator('tr', { hasText: 'Synthetic grinder' }).count()) === 1);
const body = await researcher.locator('body').textContent();
check('both observation values remain on record', body.includes('₹2,00,000') && body.includes('₹3,20,000'));
check('corrected rent flows into the model (₹10,000 / month)', (await researcher.locator('tr:has(b:text-is("Rent"))').first().textContent()).includes('₹10,000'));
check('rejected claim retired its observation', (await researcher.locator('tr.sub', { hasText: 'Synthetic packer' }).locator('.badge', { hasText: /rejected/i }).count()) >= 1);
await conflicts.locator('input[name=note]').fill('E2E: different capacity classes; accept the range');
await conflicts.locator('select[name=status]').selectOption('accepted_as_range');
await conflicts.locator('button', { hasText: 'Close' }).click();
await researcher.waitForURL(/ok=|error=/);
check('conflict closed with a recorded reason', (await flash(researcher)).includes('Conflict closed'), await flash(researcher));

await researcher.goto(record('model'));
const locPanel = researcher.locator('section.panel', { hasText: 'Location scenarios' });
const puneRow = await locPanel.locator('tr', { hasText: 'Pune (city)' }).textContent();
check('Pune gets its own scenario from the city-specific rent', /city.specific/i.test(puneRow) && puneRow.includes('₹96,000'), puneRow.slice(0, 160));
const nandedRow = await locPanel.locator('tr', { hasText: 'Nanded' }).textContent();
check('Nanded, with no local evidence, gets no scenario', /no local evidence/i.test(nandedRow));
check('assumption reached the engine input', (await researcher.locator('pre.pagetext').textContent()).includes('"monthlyCompensation": 40000'));

// ── 7. Versions: four-eyes, approval, and the publication gate ──────────────
await reviewer.goto(record('versions'));
let v1 = reviewer.locator('section.panel', { hasText: 'Version 1' });
await v1.locator('input[name=comments]').fill('E2E: claims were unreviewed at submission');
await v1.locator('button[value=request_changes]').click();
await reviewer.waitForURL(/ok=|error=/);
check('reviewer requests changes on the pipeline-submitted version', (await flash(reviewer)).includes('Decision recorded'), await flash(reviewer));

await researcher.goto(record('versions'));
await researcher.locator('input[name=change_summary]').fill('E2E: rent corrected, packer rejected, owner draw added');
await researcher.locator('button', { hasText: 'Submit version' }).click();
await researcher.waitForURL(/ok=|error=/);
check('researcher submits version 2', (await flash(researcher)).includes('submitted'), await flash(researcher));
await researcher.goto(record('versions'));
const v2r = researcher.locator('section.panel', { hasText: 'Version 2' });
check('submitter sees they cannot decide their own version', (await v2r.locator('button[value=approve]').isDisabled()) === true);
await v2r.locator('summary', { hasText: 'Changes since version 1' }).click();
const diff = await v2r.locator('details', { hasText: 'Changes since version 1' }).textContent();
check('version diff lists what changed', diff.includes('Rent') && diff.includes('Owner monthly compensation'), diff.slice(0, 80));

await reviewer.goto(record('versions'));
const v2 = reviewer.locator('section.panel', { hasText: 'Version 2' });
await v2.locator('button[value=approve]').click();
await reviewer.waitForURL(/ok=|error=/);
check('a different person approves version 2', (await flash(reviewer)).includes('Decision recorded'), await flash(reviewer));

const admin = await as('admin');
await admin.goto(record('versions'));
const v2a = admin.locator('section.panel', { hasText: 'Version 2' });
const blockers = await v2a.locator('.notice.warn').textContent();
check('approved test record still cannot be published, with reasons shown', blockers.includes('Cannot be published') && /test data|demo\/test rows/.test(blockers), blockers.slice(0, 140));
check('no publish button is offered while blockers exist', (await v2a.locator('button', { hasText: 'Publish this version' }).count()) === 0);
await admin.goto(BASE + '/audit');
check('audit history records the actions with their actors', (await admin.locator('body').textContent()).includes('Dev Reviewer'));

} catch (error) {
  check('workflow ran to completion', false, String(error).split('\n')[0]);
}
const probe = await as('researcher');
const cspHeader = (await (await probe.goto(BASE + '/'))?.headerValue('content-security-policy')) ?? '';
check('content security policy is served and nothing violated it', cspHeader.includes("frame-ancestors 'none'"), cspHeader.slice(0, 60));
check('no server errors, page exceptions or policy violations', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
