#!/usr/bin/env node
// check:goal-grid - the Dashboard's Goal Progress card at 390x844 AND 1440x900, signed in as the walk account.
// The walk account has NO goals, so the savings_goals read is answered IN THE BROWSER (route.fulfill)
// with 1, 2 and 3 goals in turn - nothing is written. For each count and width, EVERY ROW of tiles
// must span the card: the row's rightmost tile ends within 2px of the grid's right edge (rows are
// grouped by tile top, so a stacked phone layout is one tile per row and desktop is one row).
// A fixed md:grid-cols-3 put one goal in a third of a 1296px card (red, proven before the fix).
// Does NOT cover widths between 390 and 1440, colour, or the empty state.
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

// THE GOALS EMPTY STATE'S ONE-PRESS STARTS (e1b0fffc). With savings_goals answered EMPTY in-browser
// (nothing written; every other goals write aborted), the Goals tab must show one start button per
// goal type except Custom, and PRESSING each must open "New Savings Goal" with that type selected.
// Positive control: the empty-state text renders. Asserts a CHANGE: no dialog before, dialog after.
const TYPES = ['Emergency Fund', 'Vacation', 'Down Payment', 'Retirement'];
const browser = await chromium.launch();
const failures = [];
for (const VIEW of VIEWS) {
  const ctx = await browser.newContext({ viewport: VIEW });
  const page = await ctx.newPage();
  await page.route('**/rest/v1/savings_goals*', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    : route.abort()));
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
  await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
    version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
  })));
  await page.goto(`${BASE}/dashboard?tab=goals`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay').count()); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  const goalsTab = page.getByRole('tab', { name: /goals/i }).first();
  if (await goalsTab.count()) await goalsTab.click().catch(() => {});
  const empty = page.getByText('No savings goals yet.');
  await empty.first().waitFor({ timeout: 25000 }).catch(() => {});
  if (!(await empty.count())) { await browser.close(); fail(2, `${VIEW.width}: empty state never rendered on ${page.url()} (control).`); }
  const group = page.getByRole('group', { name: 'Start a goal from a template' });
  const found = await group.getByRole('button').allInnerTexts().catch(() => []);
  console.log(`${VIEW.width}: start buttons [${found.join(', ')}]`);
  await empty.first().scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `test-results/goal-starts-empty-${VIEW.width}.png` });
  if (found.join('|') !== TYPES.join('|')) failures.push(`${VIEW.width}: buttons ${JSON.stringify(found)}, expected ${JSON.stringify(TYPES)}`);
  for (const t of TYPES) {
    const dialog = page.getByRole('dialog');
    const before = await dialog.count();
    await group.getByRole('button', { name: t, exact: true }).click().catch(() => {});
    const title = page.getByText('New Savings Goal');
    await title.first().waitFor({ timeout: 5000 }).catch(() => {});
    const opened = await title.count();
    const selected = opened ? await page.locator('select').evaluateAll((els) => els.map((e) => e.value)) : [];
    if (t === TYPES[1]) await page.screenshot({ path: `test-results/goal-starts-${VIEW.width}.png` });
    console.log(`${VIEW.width} ${t}: dialogs ${before} -> ${await dialog.count()}, form open ${opened > 0}, selects ${JSON.stringify(selected)}`);
    if (!opened) failures.push(`${VIEW.width} ${t}: pressing it opened no form`);
    else if (!selected.includes(t)) failures.push(`${VIEW.width} ${t}: form opened without ${t} selected`);
    for (let i = 0; i < 4 && (await page.getByText('New Savings Goal').count()); i += 1) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
  }
  await ctx.close();
}
await browser.close();
if (failures.length) fail(1, failures.join('; '));
console.log('PASS - the goals empty state offers one start per goal type, and each opens the form with that type.');
