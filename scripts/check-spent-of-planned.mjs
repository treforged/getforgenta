#!/usr/bin/env node
// check:spent-of-planned - Budget Simple shows "Spent so far ... of $X planned" (ask e1b0fffc (c)) at 390x844 and 1440x900, signed
// in as the walk account. The profile READ is rewritten to view_mode=simple (nothing written), the month's
// synced_transactions read is ANSWERED in-browser with known rows, and the ledger read with [] - every write is
// aborted. Expected: Dining $12.34; Shopping $30.00 (a $50 charge less a $20 refund); a $500 TRANSFER_OUT and a
// $900 LOAN_PAYMENTS row are NOT spending, so the headline reads $42.34. Positive control: the card mounts.
// VIEW_MODE=advanced must NOT render the card. Does NOT cover matched-rule categories, user overrides, transfer
// pairing (unit tests own those: src/lib/__tests__/budget-spent.test.ts), or colour.
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

const MODE = process.env.VIEW_MODE || 'simple';
const now = new Date();
const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const syn = (i, amount, category) => ({ id: `00000000-0000-4000-8000-00000000050${i}`, account_id: '00000000-0000-4000-8000-0000000005aa',
  amount: String(amount), date: d, pending: false, name: `Probe ${i}`, merchant_name: `Probe ${i}`, category });
const SYNCED = [syn(1, 12.34, 'FOOD_AND_DRINK'), syn(2, 50, 'GENERAL_MERCHANDISE'), syn(3, -20, 'GENERAL_MERCHANDISE'),
  syn(4, 500, 'TRANSFER_OUT'), syn(5, 900, 'LOAN_PAYMENTS')];

const browser = await chromium.launch();
const failures = [];
for (const VIEW of VIEWS) {
  const tag = `${VIEW.width} ${MODE}`;
  const ctx = await browser.newContext({ viewport: VIEW });
  const page = await ctx.newPage();
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const u = req.url();
    if (req.method() === 'GET' || req.method() === 'HEAD') {
      if (/\/rest\/v1\/synced_transactions\b/.test(u) && !/select=count|head/.test(u)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SYNCED) });
      }
      if (/\/rest\/v1\/transactions\b/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      if (/\/rest\/v1\/profiles\b/.test(u)) {
        const resp = await route.fetch();
        let txt = await resp.text();
        try { const j = JSON.parse(txt); const set = (o) => ({ ...o, view_mode: MODE }); txt = JSON.stringify(Array.isArray(j) ? j.map(set) : set(j)); } catch { /* pass */ }
        if (process.env.DEBUG) console.log('profiles', u.slice(-90), txt.slice(0, 120));
        return route.fulfill({ response: resp, body: txt });
      }
      return route.continue();
    }
    if (req.method() === 'POST' && /\/rest\/v1\/rpc\//.test(u)) return route.continue();
    return route.abort();
  });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
  await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
    version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
  })));
  await page.goto(`${BASE}/budget`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay, [role="dialog"]').count()); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  // Control that the Budget panel itself mounted, in either mode.
  await page.getByText(/budget allocation/i).first().waitFor({ timeout: 20000 }).catch(() => {});
  const read = () => page.evaluate(() => {
    const card = document.querySelector('[data-testid="spent-of-planned"]');
    return {
      budget: /budget allocation/i.test(document.body.innerText),
      card: !!card,
      text: card ? card.innerText.replace(/\s+/g, ' ') : '',
      rows: card ? [...card.querySelectorAll('[data-testid="spent-row"]')].map((r) => r.innerText.replace(/\s+/g, ' ')) : [],
    };
  });
  let prev = await read(); let cur = prev;
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(1500);
    cur = await read();
    if (cur.card === prev.card && cur.text === prev.text) break;
    prev = cur;
  }
  await page.locator('[data-testid="spent-of-planned"]').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `test-results/spent-of-planned-${VIEW.width}-${MODE}.png`, fullPage: false });
  console.log(`${tag}: budget ${cur.budget}, card ${cur.card}
  ${cur.text.slice(0, 160)}
  rows: ${JSON.stringify(cur.rows)}`);
  if (!cur.budget) { await browser.close(); fail(2, `${tag}: CONTROL FAILED - the Budget panel did not render on ${page.url()}.`); }
  if (MODE !== 'simple') { if (cur.card) failures.push(`${tag}: the card renders in ${MODE}`); await ctx.close(); continue; }
  if (!cur.card) { failures.push(`${tag}: no Spent so far card`); await ctx.close(); continue; }
  if (!/Spent so far/i.test(cur.text) || !/\$42\.34 of \$[\d,]+\.\d\d planned/.test(cur.text)) failures.push(`${tag}: headline is not "$42.34 of $X planned": ${cur.text.slice(0, 120)}`);
  const row = (c) => cur.rows.find((r) => r.startsWith(c)) || '';
  if (!/\$12\.34/.test(row('Dining'))) failures.push(`${tag}: Dining row ${JSON.stringify(row('Dining'))}, expected $12.34`);
  if (!/\$30\.00/.test(row('Shopping'))) failures.push(`${tag}: Shopping row ${JSON.stringify(row('Shopping'))}, expected $30.00`);
  if (/\$500\.00|\$900\.00|\$1,4/.test(cur.text)) failures.push(`${tag}: a transfer or loan payment was counted as spending`);
  await ctx.close();
}
await browser.close();
if (failures.length) fail(1, failures.join('; '));
console.log(`PASS - ${MODE}: ${MODE === 'simple' ? 'Spent so far reads $42.34 with Dining and Shopping rows' : 'no Spent so far card'}.`);
