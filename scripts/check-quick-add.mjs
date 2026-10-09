#!/usr/bin/env node
/**
 * check-quick-add.mjs - QUICK ADD's tap count (ask 661548f5, Tre: "quick add like Fincend").
 *
 * Fincend saves a $36 groceries expense in 5 taps: `+`, Groceries, 3, 6, "Add $36". Before this,
 * Forgenta took 7 taps + 2 keystrokes and had no add door on Home
 * (docs/quick-add-comparison-2026-10-07.md). This walks the same entry FROM HOME on /demo (no
 * credentials) and COUNTS every press, then requires:
 *   - the door is on Home: the bottom bar's centre `+` at phone widths, Home's "Add" at WIDTH>=1024
 *     (the bar is lg:hidden there);
 *   - PRESSING it opens the "Quick add" dialog (a change, found by its own heading);
 *   - Groceries is a one-tap chip, 3 and 6 are keypad keys, the hero reads "-$36" and the save
 *     button says "Add $36" - all ON SCREEN without scrolling (the OS keyboard never opens);
 *   - pressing save reaches the save path: /demo is read only, and since 2026-10-09 (growth pass,
 *     Proposal B) the save asks for the signup ("That's the 5-tap add." + "Sign up free") instead of
 *     the generic refusal; PRESSING that ask must land on /auth. Its tap is not counted in the 5.;
 *   - <= 5 presses in all, the Fincend number;
 *   - at phone widths every bottom-bar label is still WHOLE beside the extra cell.
 * Red on the pre-change app (no `+`, Home's Add was a link to /transactions): exit 1.
 *
 * SIGNED_IN=1 (the PC: needs .env.local and .env.deck-walk.local, the walk account) runs the same presses
 * on the real signed-in app and requires the save to send EXACTLY ONE insert to /rest/v1/transactions
 * carrying type expense, amount 36, category Groceries, then the sheet to close. That insert is ANSWERED
 * IN THE BROWSER (route.fulfill, 201), never sent, so nothing reaches the database; every other write is
 * aborted and rpc passes, as check:narrow-overflow. The walk account is a FREE web account, so this arm
 * also proves quick add is free on web (Tre, 2026-10-09).
 * It does NOT cover the native app, where a free user's door goes to /premium (QuickAddContext.gate.test.tsx).
 *
 * ENV: SIGNED_IN=1, WIDTH (390), HEIGHT (844), BASE_URL (http://localhost:8080), PW_CHROMIUM (an executable path
 * when the bundled browser is not installed). Frames: test-results/quick-add/.
 * EXITS: 0 pass . 1 a finding . 2 could not test.
 */
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const WIDTH = Number(process.env.WIDTH || 390);
const HEIGHT = Number(process.env.HEIGHT || 844);
const DESKTOP = WIDTH >= 1024;
const MAX_TAPS = 5;
const OUT = 'test-results/quick-add';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };

let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'Could not load @playwright/test.'); }
try { await fetch(BASE, { redirect: 'manual' }); } catch (err) { fail(2, `${BASE} is not serving (${err.message}).`); }
const SIGNED_IN = process.env.SIGNED_IN === '1';
let session = null; let ref = null;
if (SIGNED_IN) {
  const { readFileSync } = await import('node:fs');
  const pick = (t, k) => (t.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
  let env; let creds;
  try { env = readFileSync('.env.local', 'utf8'); creds = readFileSync('.env.deck-walk.local', 'utf8'); }
  catch { fail(2, '.env.local or .env.deck-walk.local is missing.'); }
  const url = pick(env, 'VITE_SUPABASE_URL'); const anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
  const email = pick(creds, 'REACH_TEST_EMAIL'); const password = pick(creds, 'REACH_TEST_PASSWORD');
  if (!url || !anon || !email || !password) fail(2, 'missing supabase url/key or walk credentials.');
  if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to script a sign-in for "${email}".`);
  ref = new URL(url).hostname.split('.')[0];
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  session = await res.json().catch(() => ({}));
  if (!session.access_token) fail(2, `sign-in returned ${res.status}.`);
}
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const done = async (code, msg) => { await browser.close(); (code ? console.error : console.log)(msg); process.exit(code); };
mkdirSync(OUT, { recursive: true });

const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 });
// Signed in: the transactions insert is ANSWERED here and recorded; every other write is aborted.
const inserts = [];
if (SIGNED_IN) await ctx.route(/supabase\.co\/(rest|functions|storage)\//, (route) => {
  const req = route.request(); const m = req.method();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.continue();
  if (/\/rest\/v1\/rpc\//.test(req.url())) return route.continue();
  if (m === 'POST' && /\/rest\/v1\/transactions(\?|$)/.test(req.url())) {
    let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch { /* recorded as null */ }
    inserts.push(body);
    const row = { ...(Array.isArray(body) ? body[0] : body), id: '00000000-0000-4000-8000-00000000a0a0', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(row) });
  }
  return route.abort();
});
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false })));
if (SIGNED_IN) {
  await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [`sb-${ref}-auth-token`, session]);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
} else await page.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });

// CONTROL: Home has rendered. Without it, a missing door is indistinguishable from an unmounted page.
const home = page.getByRole('heading', { name: 'Command Center' });
let ready = false;
for (let i = 0; i < 30 && !ready; i += 1) {
  await page.waitForTimeout(1000);
  for (let j = 0; j < 4 && (await page.locator('div.modal-overlay [role=dialog]').count()); j += 1) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }
  ready = (await home.count()) > 0 && (await page.locator('.skeleton-shimmer').count()) === 0;
}
if (!ready) await done(2, `CONTROL FAILED: ${SIGNED_IN ? 'the walk account' : '/demo'} never showed a settled Home at ${WIDTH}px.`);
if (!page.url().includes('/dashboard')) await done(2, `CONTROL FAILED: landed on ${page.url()}, not Home.`);

let taps = 0;
const press = async (locator, what) => {
  if (!(await locator.count())) await done(1, `FINDING: no ${what} to press (after ${taps} presses).`);
  await locator.first().click();
  taps += 1;
  console.log(`press ${taps}: ${what}`);
};
// Inside the viewport AND inside the sheet's own scroll box: a button the sheet clips is not on screen.
const onScreen = async (locator) => locator.first().evaluate((el, h) => {
  const r = el.getBoundingClientRect();
  const box = el.closest('[role=dialog]').getBoundingClientRect();
  return r.width > 0 && r.top >= Math.max(0, box.top) && r.bottom <= Math.min(h, box.bottom) + 0.5;
}, HEIGHT);

// Phone: every bar label must be whole beside the `+` cell (the bar sizes cells to their words).
if (!DESKTOP) {
  const cut = await page.evaluate(() => [...document.querySelectorAll('nav a span[data-text-scale-exempt]')]
    .filter(s => s.scrollWidth > s.clientWidth + 0.5).map(s => s.textContent));
  const labels = await page.locator('nav a span[data-text-scale-exempt]').count();
  if (labels < 5) await done(2, `CONTROL FAILED: found ${labels} bottom-bar labels, expected 5.`);
  if (cut.length) await done(1, `FINDING: bottom-bar label(s) cut beside the + at ${WIDTH}px: ${cut.join(', ')}.`);
}

const door = DESKTOP ? page.getByTestId('home-quick-add') : page.getByTestId('nav-quick-add');
await press(door, DESKTOP ? "Home's Add button" : "the bottom bar's +");
const sheet = page.getByRole('dialog', { name: 'Quick add' });
// 15 s, not 5: the sheet is a LAZY chunk, and a dev server compiles it on its first request. The first
// 390 run after a vite restart (2026-10-09) missed a 5 s window and passed twice straight after.
try { await sheet.waitFor({ timeout: 15000 }); } catch { await done(1, `FINDING: pressing the door opened no "Quick add" dialog within 15 s (url ${page.url()}).`); }

const groceries = sheet.getByRole('group', { name: 'Category' }).getByRole('button', { name: /Groceries/ });
if (!(await groceries.count())) await done(1, 'FINDING: Groceries is not a one-tap chip.');
if ((await groceries.first().getAttribute('aria-pressed')) === 'true') console.log('Groceries already selected (last used): no press needed.');
else await press(groceries, 'the Groceries chip');
if ((await groceries.first().getAttribute('aria-pressed')) !== 'true') await done(1, 'FINDING: the Groceries chip did not select.');

const keypad = sheet.getByRole('group', { name: 'Amount keypad' });
await press(keypad.getByRole('button', { name: '3', exact: true }), 'keypad 3');
await press(keypad.getByRole('button', { name: '6', exact: true }), 'keypad 6');
const hero = (await sheet.getByTestId('quick-add-amount').innerText()).trim();
if (hero !== '-$36') await done(1, `FINDING: the amount reads "${hero}", expected "-$36".`);

const save = sheet.getByRole('button', { name: 'Add $36' });
if (!(await save.count())) await done(1, 'FINDING: no save button saying "Add $36".');
for (const [what, loc] of [['the amount', sheet.getByTestId('quick-add-amount')], ['the Groceries chip', groceries], ['keypad 3', keypad.getByRole('button', { name: '3', exact: true })], ['the save button', save]]) {
  if (!(await onScreen(loc))) await done(1, `FINDING: ${what} is not on screen at ${WIDTH}x${HEIGHT} without scrolling.`);
}
await sheet.screenshot({ path: `${OUT}/sheet-${WIDTH}.png` });
await press(save, 'Add $36');

if (SIGNED_IN) {
  try { await sheet.waitFor({ state: 'detached', timeout: 8000 }); } catch { await done(1, `FINDING: the sheet did not close after a saved insert (${inserts.length} insert(s) seen).`); }
  if (inserts.length !== 1) await done(1, `FINDING: ${inserts.length} inserts to transactions, expected exactly 1.`);
  const row = Array.isArray(inserts[0]) ? inserts[0][0] : inserts[0];
  console.log(`insert: ${JSON.stringify(row)}`);
  if (!row || row.type !== 'expense' || Number(row.amount) !== 36 || row.category !== 'Groceries') {
    await done(1, `FINDING: the insert is not a $36 Groceries expense: ${JSON.stringify(row)}.`);
  }
} else {
  const ask = page.getByText(/That's the 5-tap add/);
  try { await ask.first().waitFor({ timeout: 5000 }); } catch { await done(1, 'FINDING: pressing "Add $36" did not reach the save path (no signup ask on /demo).'); }
  if (!(await sheet.count())) await done(1, 'FINDING: the sheet closed on a refused write; what was typed is lost.');
  await page.screenshot({ path: `${OUT}/demo-ask-${WIDTH}.png` });
  // The ask must LEAD somewhere: pressing it lands on /auth (it also records demo_signup_tap).
  const signUp = page.getByRole('button', { name: 'Sign up free' });
  // ON SCREEN without scrolling, like every other control here: the first version sat in the save
  // button's slot and was cut off by the sheet's edge at 320x568.
  if (!(await signUp.count()) || !(await onScreen(signUp))) await done(1, `FINDING: "Sign up free" is not fully on screen inside the sheet at ${WIDTH}x${HEIGHT}.`);
  try { await signUp.first().click({ timeout: 5000 }); } catch { await done(1, 'FINDING: the demo signup ask has no pressable "Sign up free".'); }
  try { await page.waitForURL(/\/auth/, { timeout: 8000 }); } catch { await done(1, `FINDING: "Sign up free" did not land on /auth (url ${page.url()}).`); }
}

if (taps > MAX_TAPS) await done(1, `FINDING: ${taps} presses from Home to save, more than Fincend's ${MAX_TAPS}.`);
await done(0, `PASS${SIGNED_IN ? ' (signed in, insert answered in-browser)' : ''}: ${taps} presses from Home to "Add $36" at ${WIDTH}x${HEIGHT} (Fincend: ${MAX_TAPS}; before: 7 + 2 keystrokes). Frame: ${OUT}/sheet-${WIDTH}.png`);
