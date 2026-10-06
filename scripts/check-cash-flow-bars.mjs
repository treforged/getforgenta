#!/usr/bin/env node
// check:cash-flow-bars - Forecast's Cash Flow Overview reads past months from the BANK, income and expenses
// together (ask 01979820). 1440x900, signed in as the walk account; the full synced_transactions read is ANSWERED
// in-browser, every write aborted. Last month must read Income $2,000.00 (a loan disbursement is not income),
// Expenses $1,000.00 (a transfer out is not spending), Net $1,000.00 - found by HOVERING that month and reading the
// tooltip. NO_BANK=1 must not read those figures. Does NOT cover the current month (projection) or phone widths.
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const VIEWS = [{ width: 1440, height: 900 }];
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



// Last month: a -$2,000 INCOME paycheck, -$5,000 LOAN_DISBURSEMENTS (not income), $600 Dining + $400 Shopping,
// and a $5,000 TRANSFER_OUT (not spending). Expected tooltip for last month: Income $2,000.00, Expenses $1,000.00,
// Net $1,000.00. NO_BANK=1: the walk account's ledger month (no bank) must NOT read those figures.
const now = new Date();
const mk = (k, day) => { const d = new Date(now.getFullYear(), now.getMonth() - k, day); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
let n = 0;
const syn = (date, amount, category) => ({ id: `00000000-0000-4000-8000-0000000008${String(n++).padStart(2, '0')}`, account_id: null, amount: String(amount), date, pending: false, name: 'Probe', merchant_name: 'Probe', category });
const STUB = process.env.NO_BANK ? [] : [syn(mk(1, 3), -2000, 'INCOME'), syn(mk(1, 4), -5000, 'LOAN_DISBURSEMENTS'), syn(mk(1, 10), 600, 'FOOD_AND_DRINK'), syn(mk(1, 12), 400, 'GENERAL_MERCHANDISE'), syn(mk(1, 14), 5000, 'TRANSFER_OUT')];
const lastLabel = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleString('en', { month: 'short' });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWS[0] });
const page = await ctx.newPage();
await page.route('**/rest/v1/**', async (route) => {
  const req = route.request(); const u = req.url();
  if (req.method() === 'GET' || req.method() === 'HEAD') {
    if (/\/rest\/v1\/synced_transactions\b/.test(u)) {
      const all = !/date=gte/.test(u);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `0-${STUB.length}/${STUB.length}` }, body: JSON.stringify(all ? STUB : []) });
    }
    return route.continue();
  }
  if (req.method() === 'POST' && /\/rest\/v1\/rpc\//.test(u)) return route.continue();
  return route.abort();
});
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({ version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false })));
await page.goto(`${BASE}/transactions?tab=forecast`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
for (let i = 0; i < 6 && (await page.locator('[role="dialog"]').count()); i += 1) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
const card = page.locator('[data-testid="cash-flow-overview"]').first();
await card.waitFor({ timeout: 20000 }).catch(() => {});
if (!(await card.count())) { await browser.close(); fail(2, `CONTROL FAILED - Cash Flow Overview did not render on ${page.url()}.`); }
await card.scrollIntoViewIfNeeded();
await page.waitForTimeout(2500);
// Hover the X tick of last month, straight up into the plot, and read the tooltip.
const tick = card.locator('.recharts-cartesian-axis-tick-value', { hasText: lastLabel }).last();
if (!(await tick.count())) { await browser.close(); fail(2, `CONTROL FAILED - no "${lastLabel}" tick on the chart.`); }
const tb = await tick.boundingBox();
const plot = await card.locator('svg.recharts-surface').first().boundingBox();
let tip = '';
for (const dx of [0, 8, -8, 16]) {
  await page.mouse.move(tb.x + tb.width / 2 + dx, plot.y + plot.height / 2);
  await page.waitForTimeout(600);
  tip = ((await card.locator('.recharts-tooltip-wrapper').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
  if (tip.includes(lastLabel)) break;
}
await page.screenshot({ path: `test-results/cash-flow-bars-${process.env.NO_BANK ? 'nobank' : 'bank'}.png` });
await browser.close();
console.log(`tooltip: ${tip}`);
if (!tip.includes(lastLabel)) fail(2, `CONTROL FAILED - no tooltip for ${lastLabel}.`);
const want = /Income \$2,000\.00 Expenses \$1,000\.00 Net Cash Flow \$1,000\.00/;
if (process.env.NO_BANK) { if (want.test(tip)) fail(1, 'with no bank rows the bars still read the stub figures'); }
else if (!want.test(tip)) fail(1, `expected Income $2,000.00 / Expenses $1,000.00 / Net $1,000.00 for ${lastLabel}`);
console.log(`PASS - cash-flow bars ${process.env.NO_BANK ? 'keep the ledger month without bank rows' : 'read income and expenses from the bank'}.`);
