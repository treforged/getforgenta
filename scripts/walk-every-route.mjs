#!/usr/bin/env node
/**
 * walk-every-route.mjs - open EVERY route this app registers, signed in, in a real
 * browser, and assert each one actually renders its page.
 *
 * WHY THIS EXISTS
 * "A screen that cannot be reached is the finding, and it is the one a green suite
 * hides best." Nothing in this repo had ever opened the signed-in routes as a set. The
 * unit suite mounts components directly, so a route that is registered wrong, lazy-
 * chunked wrong, or guarded wrong is invisible to all 4,590 of those tests: they never
 * ask the router for anything. Until 2026-09-14 no script COULD walk them either,
 * because every available surface refused a sign-in (see walk-deck-undo.mjs). The
 * `@forgenta.test` walk account removed that fork, so this is now measurable.
 *
 * THE ROUTE LIST IS DERIVED, NEVER HAND-NAMED.
 * It is parsed out of src/App.tsx at run time. A hand-written list is blind to exactly
 * the route nobody added to it - which is always the new one, because that is why it is
 * new. If the parse finds no routes the script exits 2 rather than reporting a clean
 * walk of nothing.
 *
 * WHAT IT ASSERTS, per route
 *   - it is not the 404 page                      (registered, and reachable)
 *   - it is not an ErrorBoundary fallback         (the chunk loaded and the page mounted)
 *   - it is not effectively blank                 (mounted, and rendered something)
 *   - a protected route did not bounce to /auth   (the guard lets a real user through)
 * A route declared as a <Navigate> redirect is asserted to LAND somewhere that passes
 * all four, rather than to render in place.
 *
 * THE POSITIVE CONTROL, and why it is shaped this way
 * A walk that reports "0 failures" and a walk whose detector cannot fire are the same
 * output. So the script first opens a path that is deliberately impossible and REQUIRES
 * the 404 detector to fire on it. That control does not share the subject's failure
 * mode: if every real route broke tomorrow, this control still passes, so it can never
 * re-label a real finding as a broken instrument.
 *
 * AND THE SECOND HALF, WHICH EXISTS BECAUSE THE FIRST HALF HAS A BLIND SPOT.
 * Deriving the list from the router is what makes it complete, and it is also what makes
 * it blind to a route being RENAMED: rename `/settings` to `/settings-x` and the walk
 * cheerfully walks `/settings-x`, which renders perfectly, while every link in the app
 * still points at `/settings` and every user hits the 404. Measured, not reasoned - that
 * mutation was run against this script and it passed. So the walk ALSO collects every
 * in-app `<a href="/...">` it meets on the pages it opens, and requires each target to
 * be a route the router declares. The router says what exists; the rendered links say
 * what the app promises. A rename breaks the agreement between them, and nothing else
 * here can see that.
 *
 * WHAT IT DOES NOT COVER, said plainly
 *   - It presses NOTHING. A control that renders and does nothing passes this.
 *   - Link targets are only collected from pages this walk actually opens, and only
 *     from real anchors. A destination reached solely by an onClick `navigate(...)` is
 *     invisible to it. The count of links checked is printed so that "0 broken" can be
 *     told apart from "0 examined".
 *   - It asserts text, not a rendered frame. A layout or contrast regression passes.
 *   - Routes taking a URL parameter, and the three external OAuth callbacks, are
 *     SKIPPED - and printed with their reason, never silently dropped.
 *   - It walks one account's data. A route that only renders for, say, a premium user
 *     is exercised in whatever state that account is in.
 *
 * USAGE:  node scripts/walk-every-route.mjs
 *         Needs the dev server on http://localhost:8080 and .env.deck-walk.local.
 * EXITS:  0 pass . 1 a route failed . 2 could not test (setup, or the control failed)
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };

// -- Route list, derived from the router itself --------------------------------
const app = readFileSync('src/App.tsx', 'utf8');
const declared = [];
const re = /<Route\s+path="([^"]+)"([\s\S]*?)(?=<Route\s|<\/Routes>)/g;
let m;
while ((m = re.exec(app)) !== null) {
  declared.push({ path: m[1], redirect: /<Navigate\s+to="([^"]+)"/.exec(m[2])?.[1] ?? null });
}
if (declared.length === 0) fail(2, 'parsed 0 routes out of src/App.tsx - the matcher is broken, not the app.');

const SKIP = new Map([
  ['*', 'catch-all, not a real path'],
  ['/oauth', 'external provider callback - errors by design without a provider redirect'],
  ['/akoya-oauth', 'external provider callback - errors by design without a provider redirect'],
  ['/auth-callback', 'external provider callback - errors by design without a provider redirect'],
  ['/__error-test', 'deliberate-crash route; rendering the error fallback is its whole job'],
]);
const walked = [];
const skipped = [];
for (const r of declared) {
  if (SKIP.has(r.path)) skipped.push({ ...r, why: SKIP.get(r.path) });
  else if (r.path.includes(':')) skipped.push({ ...r, why: 'takes a URL parameter; no fixture id to supply' });
  else walked.push(r);
}
console.log(`routes declared ${declared.length} . walking ${walked.length} . skipped ${skipped.length}`);
for (const s of skipped) console.log(`  SKIP  ${s.path.padEnd(22)} ${s.why}`);

// -- Sign in --------------------------------------------------------------------
const env = readFileSync('.env.local', 'utf8');
let creds;
try { creds = readFileSync('.env.deck-walk.local', 'utf8'); }
catch { fail(2, '.env.deck-walk.local is missing - see scripts/seed-walk-account.sql.'); }

const pick = (s, k) => (s.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const url = pick(env, 'VITE_SUPABASE_URL');
const anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
const email = pick(creds, 'REACH_TEST_EMAIL');
const password = pick(creds, 'REACH_TEST_PASSWORD');
if (!url || !anon) fail(2, 'VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing from .env.local.');
if (!email || !password) fail(2, '.env.deck-walk.local carries no email/password.');

// THE GUARD. `dev-signin` forbids scripting a credential to real money; `.test` is an
// IANA-reserved TLD that can never be a real mailbox, so this address cannot be one.
// Remove this check and that rule is back in force.
if (!/@forgenta\.test$/.test(email)) {
  fail(2, `refusing to script a sign-in for "${email}" - this script only ever handles @forgenta.test accounts.`);
}

const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}: ${JSON.stringify(session).slice(0, 200)}`);
console.log(`signed in as ${session.user.email}`);

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try {
  const ping = await fetch(BASE, { redirect: 'manual' });
  if (ping.status >= 500) fail(2, `${BASE} answered ${ping.status}.`);
} catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);

/**
 * Dismiss the cookie banner ON THE LANDING PAGE, not on /dashboard.
 * Best-effort, and deliberately so: the signed-in app can raise its own modal overlay
 * (the tour, a dialog) which intercepts pointer events, and a click that then times out
 * would abort the whole walk with a Playwright stack trace - a harness failure wearing
 * the costume of a finding. It is not load-bearing either way: the banner is a fixed
 * strip and every verdict below reads document.body.innerText, which sees through it.
 */
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
try {
  const reject = page.getByRole('button', { name: /reject non-essential/i });
  if (await reject.count()) { await reject.first().click({ timeout: 5000 }); await page.waitForTimeout(800); }
} catch { console.log('note: could not dismiss the cookie banner; continuing (it does not affect innerText).'); }

// -- The verdict for one page ---------------------------------------------------
const NOT_FOUND = 'Page not found';
const BOUNDARY = [/couldn.t load\./, /Something went wrong loading this page\./];

/** Every in-app link target met anywhere in the walk, checked against the router below. */
const seenLinks = new Set();
/** `/builds/share/:token` has to match `/builds/share/abc`, so params become a wildcard. */
const routeMatchers = declared
  .filter((r) => r.path !== '*')
  .map((r) => new RegExp('^' + r.path.replace(/:[^/]+/g, '[^/]+').replace(/\//g, '\\/') + '$'));

async function verdict(path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const landed = new URL(page.url()).pathname + new URL(page.url()).search;
  const text = (await page.evaluate(() => document.body.innerText || '')).trim();
  for (const h of await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="/"]')).map((a) => a.getAttribute('href')))) {
    if (h) seenLinks.add(h.split('?')[0].split('#')[0].replace(/(.)\/$/, '$1'));
  }
  if (text.includes(NOT_FOUND)) return { landed, state: 'NOTFOUND', text };
  for (const b of BOUNDARY) if (b.test(text)) return { landed, state: 'ERROR', text };
  if (text.length < 40) return { landed, state: 'BLANK', text };
  if (new URL(page.url()).pathname.startsWith('/auth')) return { landed, state: 'AUTH', text };
  return { landed, state: 'OK', text };
}

// -- POSITIVE CONTROL: the 404 detector must be able to fire --------------------
const control = await verdict('/__walk-control-no-such-route');
if (control.state !== 'NOTFOUND') {
  await browser.close();
  fail(2, `CONTROL FAILED: an impossible path reported "${control.state}", not NOTFOUND, so this walk cannot tell a missing route from a present one. The instrument is broken; nothing below would have meant anything.`);
}
console.log('control OK - an impossible path is detected as NOTFOUND\n');

// -- The walk -------------------------------------------------------------------
const bad = [];
for (const r of walked) {
  const v = await verdict(r.path);
  const moved = v.landed !== r.path;
  const note = r.redirect ? `redirect -> ${v.landed}` : moved ? `moved -> ${v.landed}` : '';
  const ok = v.state === 'OK';
  console.log(`  ${ok ? 'ok  ' : v.state.padEnd(4)} ${r.path.padEnd(22)} ${note}`);
  if (!ok) bad.push({ ...r, ...v });
}

await browser.close();

// -- The link/router agreement --------------------------------------------------
const brokenLinks = [...seenLinks].filter((h) => !routeMatchers.some((m) => m.test(h)));
console.log(`\nin-app link targets seen ${seenLinks.size} . undeclared ${brokenLinks.length}`);
if (seenLinks.size === 0) {
  fail(2, 'collected 0 in-app link targets across the whole walk - "no broken links" would be a statement about an empty set, not about the app.');
}

console.log(`examined ${walked.length} routes . ${walked.length - bad.length} rendered . ${bad.length} did not`);
if (walked.length === 0) fail(2, 'examined 0 routes - nothing was compared.');
if (brokenLinks.length) {
  for (const h of brokenLinks) console.error(`  DEAD LINK  ${h} - rendered in the app, declared by no route`);
}
if (bad.length || brokenLinks.length) {
  for (const b of bad) {
    console.error(`  ${b.state}  ${b.path}${b.redirect ? ` (declared redirect to ${b.redirect})` : ''} landed on ${b.landed}`);
    console.error(`        first 160 chars: ${JSON.stringify(b.text.slice(0, 160))}`);
  }
  fail(1, `${bad.length} of ${walked.length} routes did not render their page, and ${brokenLinks.length} of ${seenLinks.size} in-app link targets point at no route.`);
}
console.log(`PASS - all ${walked.length} walked routes rendered signed in, and all ${seenLinks.size} in-app link targets resolve to a declared route.`);
