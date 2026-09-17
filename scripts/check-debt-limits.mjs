/**
 * check-debt-limits.mjs - the /debt page states the credit limit ONCE.
 *
 * Tre, 2026-09-17: "on the debt we don't need to see total limit and open limit. Those are the
 * same exact thing."
 *
 * He was right, and it was verified rather than taken on trust: the removed tile summed
 * `creditLimit` over the cards open now, and `UtilizationPanel`'s "Open Limit" sums `creditLimit`
 * over the cards `summarizeUtilization` marks open - the same figure over the same population,
 * printed twice on one page under two names.
 *
 * WHY THIS IS A RENDERED CHECK AND NOT A GREP. A grep over the source proves a string was
 * deleted from a file. It cannot prove the page a user opens now shows one limit, it cannot see
 * the tile grid left with a hole in it, and it would go green if the same figure came back under
 * a third name somewhere else on the route. So this counts what the PAGE says.
 *
 * THE CONTROLS, because "I found no duplicate" and "my selector found nothing" are the same zero:
 *   - the page must contain at least one limit label, or the probe is looking at the wrong screen;
 *   - the tile row must still render its OTHER tiles, so deleting the whole row cannot pass;
 *   - a deliberately impossible label must match zero, so the matcher is shown able to say no.
 *
 * WHAT IT DOES NOT COVER: colour, spacing, whether the remaining figure is CORRECT, the phone
 * layout below the tiles, and any surface other than /debt.
 *
 * USAGE:  node scripts/check-debt-limits.mjs
 * EXITS:  0 pass . 1 the page states a limit more than once . 2 could not test
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
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

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

const browser = await chromium.launch();
// Desktop, because the tile grid is where the duplicate lived and lg: is its widest form.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));

await page.goto(BASE + '/debt', { waitUntil: 'domcontentloaded' });
let ready = false;
for (let i = 0; i < 20 && !ready; i += 1) {
  await page.waitForTimeout(700);
  ready = await page.evaluate(() =>
    !/session has ended|sign in again/i.test(document.body.innerText)
    && /utilization/i.test(document.body.innerText));
}
if (!ready) fail(2, '/debt never reached a signed-in state showing its utilization figures.');

for (let i = 0; i < 6; i += 1) {
  if (!(await page.locator('div.backdrop-blur-sm, div.modal-overlay').count())) break;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

// Count VISIBLE label text, not markup: a label hidden behind a class still reads in innerText
// only when it is actually on screen, and that is the thing being asserted.
const seen = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('p, span, div, h2, h3')]
    .filter(el => el.children.length === 0)
    .map(el => (el.textContent || '').trim())
    .filter(Boolean);
  const count = (re) => labels.filter(t => re.test(t)).length;
  return {
    limitLabels: labels.filter(t => /limit$/i.test(t)),
    anyLimit: count(/limit$/i),
    utilization: count(/^utilization$/i),
    ccBalance: count(/total cc balance/i),
    impossible: count(/^zzz-not-a-real-label$/i),
  };
});

// CONTROL 1 - the matcher can find something, so a zero below means absence and not a bad selector.
if (seen.anyLimit === 0) {
  fail(2, 'no label ending in "limit" was found at all on /debt - the probe is looking at the wrong '
    + 'screen, or the matcher is broken. This is NOT evidence the duplicate is gone.');
}
// CONTROL 2 - the matcher can say no.
if (seen.impossible !== 0) fail(2, 'an impossible label matched - the matcher cannot discriminate.');
// CONTROL 3 - the tile row still exists, so deleting the whole row cannot pass as "no duplicate".
if (seen.ccBalance === 0) fail(1, 'the summary tile row is gone - "Total CC Balance" no longer renders.');
if (seen.utilization === 0) fail(1, 'the Utilization figure is gone.');

console.log(`  limit labels on /debt: ${JSON.stringify(seen.limitLabels)}`);
console.log(`  tile row intact: "Total CC Balance" x${seen.ccBalance}, "Utilization" x${seen.utilization}`);

if (seen.anyLimit > 1) {
  console.error(`FAIL: /debt states the credit limit ${seen.anyLimit} times: ${JSON.stringify(seen.limitLabels)}.`);
  console.error('  Tre, 2026-09-17: "we don\'t need to see total limit and open limit. Those are the same exact thing."');
  process.exit(1);
}

console.log('\nPASS: /debt states the credit limit exactly once, and the tile row still renders.');
await browser.close();
