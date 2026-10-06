#!/usr/bin/env node
// check:avg-spend - Account > Analytics "Avg Monthly Spend" reads the BANK where the bank has rows (ask 0ac9c4b3).
// 1440x900, signed in as the walk account (no bank, empty ledger history). The full synced_transactions read is
// ANSWERED in-browser: last month and the month before each get $600 Dining + $400 Shopping + a $5,000
// TRANSFER_OUT; every write is aborted. Expected $400.00 = (1000 + 1000 + 0 + 0 + 0) / 5 - $2,400.00 would mean the
// transfers counted. NO_BANK=1 must read "-" (the old ledger path, unchanged for users with no bank). Red on the
// pre-fix card: it read the ledger only, so it shows the NO_BANK figure with bank rows present.
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


// Last month and the one before each get bank rows: $600 Dining + $400 Shopping, and a $5,000 TRANSFER_OUT
// that must not count. Expected avg over 5 months = (1000 + 1000 + ledger fallback for the other 3) / 5.
const now = new Date();
const mk = (k, day) => { const d = new Date(now.getFullYear(), now.getMonth() - k, day); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
let n = 0;
const syn = (date, amount, category) => ({ id: `00000000-0000-4000-8000-0000000007${String(n++).padStart(2, '0')}`, account_id: null, amount: String(amount), date, pending: false, name: 'Probe', merchant_name: 'Probe', category });
const STUB = process.env.NO_BANK ? [] : [1, 2].flatMap((k) => [syn(mk(k, 10), 600, 'FOOD_AND_DRINK'), syn(mk(k, 12), 400, 'GENERAL_MERCHANDISE'), syn(mk(k, 14), 5000, 'TRANSFER_OUT')]);
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
await page.goto(`${BASE}/account?section=analytics`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
for (let i = 0; i < 6 && (await page.locator('[role="dialog"]').count()); i += 1) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
await page.getByRole('tab', { name: /analytics/i }).first().click().catch(async () => { await page.getByText(/^analytics$/i).first().click().catch(() => {}); });
await page.waitForTimeout(4000);
const read = () => page.evaluate(() => { const el = [...document.querySelectorAll('[data-testid="advanced-analytics"] *')].find((e) => /^avg monthly spend$/i.test(e.textContent.trim())); const card = el?.closest('div.card-forged, [class*="metric"], div'); return el ? el.parentElement.parentElement.innerText.replace(/\s+/g, ' ') : null; });
let v = await read();
for (let i = 0; i < 6; i += 1) { await page.waitForTimeout(1500); const w = await read(); if (w === v) break; v = w; }
await page.locator('[data-testid="advanced-analytics"]').first().scrollIntoViewIfNeeded().catch(() => {});
await page.screenshot({ path: `test-results/avg-spend-${process.env.NO_BANK ? 'nobank' : 'bank'}.png` });
console.log('stub rows', STUB.length, '->', v);
const m = (v || '').match(/AVG MONTHLY SPEND (\S+)/i);
if (!v || !m) fail(2, 'CONTROL FAILED - the Avg Monthly Spend figure did not render.');
const want = process.env.NO_BANK ? '—' : '$400.00';
if (m[1] !== want) { await browser.close(); fail(1, `Avg Monthly Spend read ${m[1]}, expected ${want}`); }
await browser.close();
console.log(`PASS - Avg Monthly Spend ${process.env.NO_BANK ? 'keeps the ledger figure with no bank rows' : 'reads $400.00 from bank rows, transfers excluded'}.`);
