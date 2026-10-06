#!/usr/bin/env node
// check:loan-chart - Debt > Auto Loans draws the payoff graph ONCE (ask 336b096c, Tre 2026-10-05: "users dont
// need to see there car payoff graph twice"). At 390x844 and 1440x900, signed in as the walk account. The walk
// account has NO car loan, so the car_funds read is answered IN THE BROWSER with two loan-phase rows; every other
// write is aborted - nothing is written. Positive control: both stub vehicle names render (the loan cards
// mounted). Then exactly ONE chart (.recharts-surface wider than 100px) may be on the page. Red on the pre-fix
// LoanCard (one chart per loan): 1 + 2 = 3. Does NOT cover the mortgage/student/other tabs (grep-verified:
// they render only LiabilityTrajectoryChart), colour, or the chart's contents.
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const VIEWS = [{ width: 390, height: 844 }, { width: 1440, height: 900 }];
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };

const env = readFileSync('.env.local', 'utf8');
let creds;
try { creds = readFileSync('.env.deck-walk.local', 'utf8'); }
catch { fail(2, '.env.deck-walk.local is missing - see scripts/seed-walk-account.sql.'); }
const pick = (s, k) => (s.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const url = pick(env, 'VITE_SUPABASE_URL');
const anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
const email = pick(creds, 'REACH_TEST_EMAIL');
const password = pick(creds, 'REACH_TEST_PASSWORD');
if (!url || !anon || !email || !password) fail(2, 'missing supabase url/key or walk credentials.');
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to script a sign-in for "${email}".`);

const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}: ${JSON.stringify(session).slice(0, 200)}`);

// Settle the first-run dialogs on the WALK account only, exactly as check:account does.
const whatsNew = readFileSync('src/lib/whats-new.ts', 'utf8');
const releaseVersion = (whatsNew.match(/version:\s*'([^']+)'/) || [])[1];
if (!releaseVersion) fail(2, 'could not read the current release version out of src/lib/whats-new.ts.');
const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
const prof = await fetch(`${url}/rest/v1/profiles?select=tour_flags&user_id=eq.${session.user.id}`, { headers: rest });
if (!prof.ok) fail(2, `reading the walk account's profile returned ${prof.status}.`);
const flags = (await prof.json())[0]?.tour_flags ?? {};
const patch = await fetch(`${url}/rest/v1/profiles?user_id=eq.${session.user.id}`, {
  method: 'PATCH',
  headers: { ...rest, Prefer: 'return=representation' },
  body: JSON.stringify({
    founder_note_seen: true,
    tour_flags: { ...flags, new_user_done: true, premium_done: true, [`whats_new_${releaseVersion}`]: true },
  }),
});
const patched = await patch.json().catch(() => []);
if (!patch.ok || !Array.isArray(patched) || patched.length === 0) {
  fail(2, `settling the first-run dialogs matched no profile row (HTTP ${patch.status}).`);
}

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const start = new Date(today.getFullYear() - 1, today.getMonth(), 1);
const loan = (i, name) => ({
  id: `00000000-0000-4000-8000-0000000000c${i}`, user_id: session.user.id, vehicle_name: name,
  target_price: 30000, tax_fees: 0, down_payment_goal: 0, current_saved: 0, saved_source: 'fixed', saved_percent: 0,
  monthly_insurance: 0, expected_apr: 6.5, loan_term_months: 60, phase: 'loan', loan_amount: 25000 + i * 1000,
  loan_start_date: iso(start), payment_start_date: iso(start), interest_start_date: iso(start), insurance_start_date: null,
  actual_monthly_payment: 500, linked_account: null, linked_rule_id: null, loan_payment_account: null,
  linked_loan_account_id: null, planned_purchase_date: null, gift_contribution: 0, lump_sum_payments: [],
  sort_order: i, auto_extra_enabled: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
});
const NAMES = ['Probe Civic', 'Probe Tacoma'];
const rows = NAMES.map((n, i) => loan(i + 1, n));
const browser = await chromium.launch();
const failures = [];
for (const VIEW of VIEWS) {
  const tag = `${VIEW.width}`;
  const ctx = await browser.newContext({ viewport: VIEW });
  const page = await ctx.newPage();
  await page.route('**/rest/v1/**', (route) => {
    const req = route.request();
    if (req.method() === 'GET' || req.method() === 'HEAD') {
      if (/\/rest\/v1\/car_funds\b/.test(req.url())) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
      }
      return route.continue();
    }
    if (req.method() === 'POST' && /\/rest\/v1\/rpc\//.test(req.url())) return route.continue();
    return route.abort();
  });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
  await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
    version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
  })));
  await page.goto(`${BASE}/debt?tab=auto`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay, [role="dialog"]').count()); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  await page.getByText(NAMES[1]).first().waitFor({ timeout: 20000 }).catch(() => {});
  // Read until two consecutive reads agree, so an unmounted chart cannot read as a clean 1.
  const read = () => page.evaluate((names) => ({
    charts: [...document.querySelectorAll('svg.recharts-surface')]
      .filter((s) => s.getBoundingClientRect().width > 100).length,
    names: names.filter((n) => document.body.innerText.includes(n)).length,
  }), NAMES);
  let prev = await read(); let cur = prev;
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(1500);
    cur = await read();
    if (cur.charts === prev.charts && cur.names === prev.names) break;
    prev = cur;
  }
  await page.screenshot({ path: `test-results/loan-chart-${VIEW.width}.png`, fullPage: true });
  console.log(`${tag}: vehicles shown ${cur.names}/${NAMES.length}, charts ${cur.charts}`);
  if (cur.names !== NAMES.length) { await browser.close(); fail(2, `${tag}: CONTROL FAILED - loan cards did not render (${cur.names}/${NAMES.length}) on ${page.url()}.`); }
  if (cur.charts !== 1) failures.push(`${tag}: ${cur.charts} payoff charts on the Auto Loans tab, expected 1`);
  await ctx.close();
}
await browser.close();
if (failures.length) fail(1, failures.join('; '));
console.log('PASS - Auto Loans draws one payoff chart with two loans, at 390 and 1440.');
