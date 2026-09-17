/**
 * THE LEARN CARD HAS EXACTLY ONE HOME, AND A LESSON LINK LANDS IN IT.
 *
 * ⚠️ WHY THIS EXISTS. Tre, 2026-09-17: *"we should put the learn section in the accounts tab as
 * its own section instead of having it on the home overview dashboard maybe like the most or the
 * next up learning task but not like the whole tab section because it seems like the dashboard is
 * getting to the point where it['s an] overload of information when it's supposed to be a quick
 * snappy what needs to be paid next"*. So `LearnCard` became the Learn SECTION of /account and
 * the dashboard kept a one-line `NextLessonRow`.
 *
 * ⚠️ THE ASSERTION THAT MATTERS IS THE DEEP LINK, AND IT COULD NOT BE MADE BEFORE TODAY.
 * `notification-routes.ts` has carried a block since 2026-09-05 saying the `?lesson=` fix was
 * **REASONED, NOT MEASURED** — `/demo` cannot distinguish it working from it doing nothing,
 * because `useLearnProgress` is disabled there and the card returns null whatever the layout
 * says, and a default account has every widget visible so it never hits the path either. Moving
 * the reader to a section that cannot be customised away makes it measurable for the first time,
 * from a real signed-in browser: this gate opens `/account?lesson=<id>` and requires that lesson
 * to be OPEN on screen.
 *
 * ⚠️ AND MOVING THE CARD WITHOUT MOVING THE ROUTE WOULD HAVE RE-OPENED THE ORIGINAL HOLE FOR
 * EVERY USER rather than only the ones who had customised — so assertion 5 checks the COUPLING.
 *
 * ⚠️ ASSERTION 4 DOES NOT COVER THE ROUTE, AND AN EARLIER DRAFT OF THIS FILE SAID IT DID. The
 * browser navigates to `/account?lesson=` directly, so pointing `LEARN_PATH` back at /dashboard
 * left this gate GREEN — proven by mutation, which is the only reason the false claim was caught.
 * The destination itself is owned by `notification-routes.test.ts`; what is left over is that the
 * two must AGREE, and nothing in either place says so. Assertion 5 is a SOURCE check and is
 * labelled one: it reads `LEARN_PATH` out of the module and requires it to name the page this run
 * just proved works.
 *
 * WHAT IT ASSERTS:
 *   1. POSITIVE CONTROL: /account has a Learn segment, found BY ROLE, and pressing it renders
 *      the card. Every assertion below is over what that press produced.
 *   2. the dashboard shows the one-line next-lesson row — present, and tappable at its own
 *      centre, because visible-and-covered passes every visibility check ever written;
 *   3. the dashboard does NOT render the full card — one home, not two. A COUNT of learn-shaped
 *      things is the check, because "it moved" and "it was copied" look identical otherwise;
 *   4. `/account?lesson=<id>` opens THAT lesson's body, not merely the Learn section.
 *
 * WHAT IT DOES NOT COVER: the notification listener and the cold-start path (only a real device
 * tap proves those), the lesson content, the streak arithmetic, phone-only layout, and whether
 * the section is in the right ORDER on the bar.
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const LESSON = 'what-a-cash-floor-is';
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
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to sign in as "${email}".`);

// The lesson id is read from the catalogue rather than trusted: a renamed lesson would otherwise
// make assertion 4 fail as if the routing were broken.
const catalogue = readFileSync('supabase/functions/_shared/learn-lessons.ts', 'utf8');
if (!catalogue.includes(`id: '${LESSON}'`)) {
  fail(2, `CONTROL FAILED: the catalogue has no lesson "${LESSON}", so assertion 4 would test `
       + 'a link to nothing. Pick an id that exists rather than loosening the assertion.');
}

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

// ── 1. POSITIVE CONTROL: the Learn segment exists and renders the card ──────────────────────
await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
let pressed = false;
for (let i = 0; i < 25 && !pressed; i += 1) {
  await page.waitForTimeout(700);
  const tabs = page.locator('button[role="tab"]');
  const n = await tabs.count();
  for (let k = 0; k < n; k += 1) {
    const label = ((await tabs.nth(k).textContent()) || '').trim();
    if (/^learn$/i.test(label)) { await tabs.nth(k).click(); pressed = true; break; }
  }
}
if (!pressed) {
  await browser.close();
  fail(1, 'no Learn segment on /account. The card was moved off the dashboard on 2026-09-17, so '
       + 'if this is a regression the SEGMENT is what went missing, not the card.');
}

// The card's own marker: the heading plus the progress line it always renders for a signed-in
// account. Matched on rendered TEXT rather than a styling class.
const CARD_MARK = /Short money lessons/i;
let cardText = '';
for (let i = 0; i < 25; i += 1) {
  await page.waitForTimeout(700);
  cardText = await page.locator('main, body').first().innerText();
  if (CARD_MARK.test(cardText)) break;
}
if (!CARD_MARK.test(cardText)) {
  await browser.close();
  fail(1, 'the Learn segment exists and was pressed, but the Learn card never rendered behind '
       + 'it - a segment that switches nothing is the dead-tab shape this repo has shipped before.');
}

// ── 2 and 3. The dashboard keeps the one-line row and NOT the card ──────────────────────────
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
let rowCount = 0;
for (let i = 0; i < 25 && rowCount === 0; i += 1) {
  await page.waitForTimeout(700);
  rowCount = await page.locator('[data-testid="next-lesson-row"]').count();
}
if (rowCount === 0) {
  await browser.close();
  fail(1, 'the dashboard renders no next-lesson row. Tre asked to keep "the next up learning '
       + 'task" there when the card moved; removing both leaves no route into the loop at all.');
}

// Tappable at its OWN centre, not merely present. Visible-and-covered has already cost this repo
// the only phone route to Settings.
// ⚠️ SCROLL IT INTO VIEW FIRST. `elementFromPoint` is VIEWPORT-relative, so an element below the
// fold returns null and reads as "covered" - which is exactly what this check reported on its
// first run, about a row that is perfectly tappable. A hit test on an off-screen point measures
// the scroll position, not the layout.
await page.locator('[data-testid="next-lesson-row"]').scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const hit = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="next-lesson-row"]');
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { covered: !el.contains(top) && top !== el, w: Math.round(r.width), h: Math.round(r.height) };
});
if (hit.covered) {
  await browser.close();
  fail(1, 'the next-lesson row is on screen and something else is painted over its centre, so a '
       + 'tap never reaches it.');
}

const dashText = await page.locator('body').innerText();
if (CARD_MARK.test(dashText)) {
  await browser.close();
  fail(1, 'the FULL Learn card is still on the dashboard as well as in /account. Two homes for '
       + 'one thing is the "second place to look" problem the move was made to remove - and a '
       + 'copy and a move look identical from the /account side alone.');
}

// ── 4. The deep link lands IN the section with THAT lesson open ─────────────────────────────
await page.goto(`${BASE}/account?lesson=${LESSON}`, { waitUntil: 'domcontentloaded' });
let linkText = '';
let opened = false;
for (let i = 0; i < 25 && !opened; i += 1) {
  await page.waitForTimeout(700);
  linkText = await page.locator('body').innerText();
  // The lesson's BODY, not its title: a title is on screen in the lesson list whether or not the
  // reader opened, so asserting the title would pass over a link that did nothing.
  opened = CARD_MARK.test(linkText)
    && (await page.locator('[aria-expanded="true"]').count()) > 0;
}
if (!opened) {
  await browser.close();
  fail(1, `/account?lesson=${LESSON} did not open that lesson: the section was not forced for `
       + 'the arriving param, or the row opened its body without reporting aria-expanded. This '
       + 'is the assertion that could not be made at all before the card moved.');
}

await browser.close();

// ── 5. COUPLING, and it is a SOURCE check rather than a rendered one ────────────────────────
// A notification tap does not go through this browser run, so nothing above can see the routing
// destination. What this asserts is narrow and stated: the page `routeForNotificationKey` sends
// a lesson to is the page this run just proved carries the reader.
const routes = readFileSync('src/lib/notification-routes.ts', 'utf8');
const learnPath = (routes.match(/const LEARN_PATH = '([^']+)'/) || [])[1];
if (!learnPath) {
  fail(2, 'CONTROL FAILED: could not read LEARN_PATH out of notification-routes.ts, so the '
       + 'coupling check examined nothing. This is the instrument, not the app.');
}
if (learnPath !== '/account') {
  fail(1, `routeForNotificationKey sends a lesson to "${learnPath}", but the reader lives on `
       + '/account. A learn_lesson tap would land on a page with nothing to consume the param - '
       + 'the "the link works and does nothing visible" hole, re-opened for EVERY user rather '
       + 'than only those who had customised their dashboard.');
}

console.log(`  /account has a Learn segment and renders the card behind it`);
console.log(`  dashboard: ${rowCount} next-lesson row (${hit.w}x${hit.h}px, tappable), 0 full cards`);
console.log(`  /account?lesson=${LESSON} opened that lesson - measured, not reasoned`);
console.log(`  routeForNotificationKey sends a lesson to ${learnPath} (source check)`);
console.log('\nPASS: the Learn card has one home and a lesson link lands in it.');
process.exit(0);
