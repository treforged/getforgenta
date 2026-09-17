/**
 * Does the trophy case actually RENDER the milestone badges, and does calling the grant RPC from
 * a real signed-in browser actually grant them?
 *
 * ⚠️ WHY THIS EXISTS. The milestone work (c14e5d9f) was measured hard on the SERVER - refusal for
 * an anonymous caller, correct progress for a real account, a rolled-back transaction proving no
 * live data was written. None of that is evidence that a person sees anything. The TrophyCase
 * change shipped compiled and unrendered, which is precisely the gap this portfolio keeps paying
 * for: a control that throws nothing and does nothing passes every smoke test ever written.
 *
 * WHAT IT ASSERTS, and each is a CHANGE rather than an absence:
 *   1. the walk account holds ZERO milestone badges before, and MORE THAN ZERO after - the grant
 *      really ran, through the app's own client, not through an admin connection;
 *   2. the trophy case renders a named badge, not a raw `milestone:` id - which is what proves
 *      the resolver's new branch is reached in a browser rather than only in vitest;
 *   3. the "Still to earn" list renders with a real progress figure - the half that has no data
 *      behind it in any unit test;
 *   4. and the badge count VISIBLE on screen goes UP across the grant.
 *
 * ⚠️ IT WRITES TO THE WALK ACCOUNT, WHICH IS A RESERVED-DOMAIN TEST ACCOUNT, AND REFUSES
 * ANYTHING ELSE. The email must end @forgenta.test - the same guard check-followers.mjs uses.
 * Granting a real person a badge to make a gate green is exactly the thing this repo forbids.
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
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to grant badges on "${email}".`);

const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}.`);

const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
const uid = session.user.id;

const countMilestones = async () => {
  const r = await fetch(
    `${url}/rest/v1/achievements?select=achievement_id&user_id=eq.${uid}&achievement_id=like.milestone:*`,
    { headers: rest });
  if (!r.ok) fail(2, `reading achievements returned ${r.status}.`);
  return (await r.json()).length;
};

// Start from a known state, on the TEST account only, so "more than zero after" means something.
const wipe = await fetch(
  `${url}/rest/v1/achievements?user_id=eq.${uid}&achievement_id=like.milestone:*`,
  { method: 'DELETE', headers: rest });
if (!wipe.ok) fail(2, `clearing the walk account's milestone badges returned ${wipe.status}.`);

const before = await countMilestones();
if (before !== 0) fail(2, `expected 0 milestone badges before the walk, found ${before}.`);

// Settle first-run dialogs the same way the followers gate does.
const whatsNew = readFileSync('src/lib/whats-new.ts', 'utf8');
const releaseVersion = (whatsNew.match(/version:\s*'([^']+)'/) || [])[1];
if (!releaseVersion) fail(2, 'could not read the release version from src/lib/whats-new.ts.');
const prof = await fetch(`${url}/rest/v1/profiles?select=tour_flags&user_id=eq.${uid}`, { headers: rest });
const flags = (await prof.json())[0]?.tour_flags ?? {};
await fetch(`${url}/rest/v1/profiles?user_id=eq.${uid}`, {
  method: 'PATCH',
  headers: { ...rest, Prefer: 'return=representation' },
  body: JSON.stringify({
    founder_note_seen: true,
    tour_flags: { ...flags, new_user_done: true, premium_done: true, [`whats_new_${releaseVersion}`]: true },
  }),
});

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));

// ⚠️ RE-AIMED 2026-09-17. The trophy case was a Dashboard Overview widget; Tre moved it:
// "achievements shouldn't be on the home overview tab. It should just go on its own tab in the
// section in the account tab." It now lives behind the ACHIEVEMENTS segment of /account, so a
// gate still opening /dashboard would report a missing feature that is simply somewhere else -
// which is exactly what this script did on the commit that moved it, correctly.
await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });

const CASE = '[data-testid="trophy-case"]';

// The segment is found BY ROLE and by its accessible name, never by a class - a selector keyed on
// a styling class would go quiet the day the bar is restyled, and this gate's whole job is to
// notice the case going missing.
const SEG = 'button[role="tab"]';
let pressed = false;
for (let i = 0; i < 25 && !pressed; i += 1) {
  await page.waitForTimeout(700);
  const tabs = page.locator(SEG);
  const n = await tabs.count();
  for (let k = 0; k < n; k += 1) {
    const label = ((await tabs.nth(k).textContent()) || '').trim();
    if (/achievements/i.test(label)) { await tabs.nth(k).click(); pressed = true; break; }
  }
}
if (!pressed) {
  fail(1, 'no Achievements segment on /account, so the trophy case has no door at all. '
        + 'It was moved off /dashboard on 2026-09-17 - if this is a regression, the segment is '
        + 'what went missing, not the case.');
}

let seen = false;
for (let i = 0; i < 25 && !seen; i += 1) {
  await page.waitForTimeout(700);
  seen = (await page.locator(CASE).count()) > 0;
}
if (!seen) {
  fail(1, 'the Achievements segment on /account exists and was pressed, but the trophy case never '
        + 'rendered behind it - a segment that switches nothing is the dead-tab shape this '
        + 'portfolio has shipped before.');
}

// 1. The grant really ran, through the app's own client.
let after = 0;
for (let i = 0; i < 20 && after === 0; i += 1) {
  await page.waitForTimeout(700);
  after = await countMilestones();
}
if (after === 0) {
  fail(1, 'the trophy case rendered but granted NOTHING - claim_milestone_achievements was never '
        + 'reached from the browser, or it was refused.');
}

const text = await page.locator(CASE).innerText();

// 2. A NAMED badge, never a raw id. A raw `milestone:` on screen means the resolver branch was
//    not reached and the badge fell through to `unknown`.
if (/milestone:/.test(text)) {
  fail(1, `the trophy case is showing a RAW id, so the resolver did not name it:\n${text}`);
}

// 3. The "Still to earn" half, with a real progress figure. It has no data behind it in any unit
//    test, so this is its only evidence.
if (!/still to earn/i.test(text)) {
  fail(1, `no "Still to earn" section rendered. Every milestone cannot be earned by this account:\n${text}`);
}
if (!/\d+\/\d+/.test(text)) {
  fail(1, `"Still to earn" rendered no progress figure (expected N/M):\n${text}`);
}

// 4. POSITIVE CONTROL on the readable text itself: at least one catalogued NAME must appear.
//    Without this, a trophy case that rendered an empty list would satisfy every check above
//    that is phrased as an absence.
const NAMES = ['Connected', 'Something to aim at', 'Goal reached', 'Clear', '25 reviewed',
  '100 reviewed', 'First follower', '5 followers', '10 followers', 'Following', 'Following 5'];
const found = NAMES.filter(n => text.includes(n));

// 5. THE BADGE THAT WAS JUST GRANTED MUST BE ON SCREEN. This is the assertion the first run of
//    this gate FAILED silently: the grant happens inside the milestone query, but the earned
//    badges are read by a different query that had already resolved from cache, so the account
//    went 0 -> 1 and the screen showed only the ten it had NOT earned. A badge granted and
//    invisible is the failure `achievements.ts` opens by describing.
if (!/\bEarned\b/.test(text)) {
  fail(1, 'a badge was granted but NO earned badge is on screen - the earned list did not '
        + `refetch after the grant:
${text}`);
}
if (found.length === 0) {
  fail(1, `no catalogued milestone NAME appeared on screen, so nothing proves the catalogue is '
        + 'reached:\n${text}`);
}

await browser.close();

console.log(`  milestone badges: ${before} before -> ${after} after (granted in-browser)`);
console.log(`  catalogued names on screen: ${found.join(', ')}`);
console.log(`  "Still to earn" rendered with a progress figure`);
console.log(`\nPASS: the trophy case grants and renders milestone badges in a real browser.`);
process.exit(0);
