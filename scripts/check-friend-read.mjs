#!/usr/bin/env node
/**
 * check-friend-read.mjs — prove a REAL signed-in user (role `authenticated`) can perform the
 * exact PostgREST select that `useFriendLink` performs, and that /account → Profile renders the
 * Friends card rather than its error state.
 *
 * ⚠️ WHY THIS EXISTS. On 2026-09-15 `invitee_username` was added to `friend_links` by a migration
 * that did not extend the column-scoped SELECT grant written in 20260826_friend_links.sql. The
 * hook's select list was extended to include it in `cc8aecb1`, and from that commit every
 * signed-in user's own read answered
 *     403 {"code":"42501","message":"permission denied for table friend_links"}
 * so /account → Profile read "Could not load your friends." for everybody. It shipped GREEN —
 * 4614 tests, tsc 0, lint 0 — because NO TEST IN THIS REPO PERFORMED A REAL POSTGREST SELECT.
 * Every SQL tool here runs as service_role, which bypasses column grants entirely and would have
 * reported the table clean over a card that was broken for every user.
 *
 * ⚠️ THE COLUMN LIST IS DERIVED FROM THE SOURCE, never hand-typed. A hand-named list is blind to
 * the next column somebody adds to the hook — which is exactly the defect being guarded against.
 *
 * ⚠️ STAGE 3 IS LOAD-BEARING, not decoration. A blanket `grant select on friend_links` would make
 * stage 2 pass while exposing `invite_code_hash`; and a 200 from a broken harness is
 * indistinguishable from a real pass unless the harness is shown, in the same run, to be able to
 * produce a denial.
 *
 * WHAT IT DOES NOT COVER: layout, contrast, the desktop width, any other table, and anything
 * about a user who HAS friend rows — the walk account has none, so this proves the read is
 * PERMITTED, not that rows render.
 *
 * USAGE:  node scripts/check-friend-read.mjs      (needs the dev server and .env.deck-walk.local)
 * EXITS:  0 pass . 1 a real failure . 2 could not test
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
const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}` };

// ── 1. DERIVE the column list the hook actually sends ──────────────────────
const hookSrc = readFileSync('src/hooks/useFriendLink.ts', 'utf8');
const m = hookSrc.match(/FRIEND_LINK_COLUMNS\s*=\s*\n?\s*'([^']+)'/);
if (!m) fail(2, 'could not read FRIEND_LINK_COLUMNS out of src/hooks/useFriendLink.ts.');
const columns = m[1].replace(/\s+/g, '');
const columnCount = columns.split(',').length;
console.log(`1. hook select list: ${columnCount} columns - ${columns}`);

// ── 2. THE SUBJECT: the hook's own read, as `authenticated` ────────────────
const subject = await fetch(`${url}/rest/v1/friend_links?select=${columns}`, { headers: rest });
const subjectBody = await subject.text();
console.log(`2. subject read as authenticated: HTTP ${subject.status}`);
if (!subject.ok) {
  fail(1, `the hook's own read returned ${subject.status}: ${subjectBody.slice(0, 300)}\n`
    + '      This is the read that renders the Friends card. It is broken for EVERY signed-in user.\n'
    + '      A column in the list above has no SELECT grant for `authenticated`.');
}

// ── 3. THE POSITIVE CONTROL: a column with no client path must still be denied
const control = await fetch(`${url}/rest/v1/friend_links?select=invite_code_hash`, { headers: rest });
const controlBody = await control.text();
console.log(`3. control (invite_code_hash): HTTP ${control.status}`);
if (control.ok) {
  fail(1, 'invite_code_hash is READABLE by `authenticated`. The column allowlist has been widened - '
    + 'a blanket grant makes stage 2 pass and exposes the invite secret.');
}
if (control.status !== 403 || !controlBody.includes('42501')) {
  fail(2, `the control returned ${control.status} (${controlBody.slice(0, 200)}) rather than a 403/42501, `
    + 'so this run cannot show it is able to detect a denial at all - stage 2 proves nothing.');
}

// ── 3b. Settle first run, or /account bounces to the wizard and has no section bar ──
const whatsNew = readFileSync('src/lib/whats-new.ts', 'utf8');
const releaseVersion = (whatsNew.match(/version:\s*'([^']+)'/) || [])[1];
if (!releaseVersion) fail(2, 'could not read the current release version out of src/lib/whats-new.ts.');
const jsonRest = { ...rest, 'Content-Type': 'application/json' };
const prof = await fetch(`${url}/rest/v1/profiles?select=tour_flags&user_id=eq.${session.user.id}`, { headers: jsonRest });
if (!prof.ok) fail(2, `reading the walk account's profile returned ${prof.status}.`);
const flags = (await prof.json())[0]?.tour_flags ?? {};
const patch = await fetch(`${url}/rest/v1/profiles?user_id=eq.${session.user.id}`, {
  method: 'PATCH',
  headers: { ...jsonRest, Prefer: 'return=representation' },
  body: JSON.stringify({
    founder_note_seen: true,
    tour_flags: { ...flags, new_user_done: true, premium_done: true, [`whats_new_${releaseVersion}`]: true },
  }),
});
const patched = await patch.json().catch(() => []);
if (!patch.ok || !Array.isArray(patched) || patched.length === 0) {
  fail(2, `settling the first-run dialogs matched no profile row (HTTP ${patch.status}).`);
}

// ── 4. THE SCREEN ──────────────────────────────────────────────────────────
let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const stop = async (code, msg) => { await browser.close(); fail(code, msg); };

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));
await page.evaluate(() => localStorage.removeItem('account-section'));
// ⚠️ DEMO MODE DISABLES THE VERY QUERY THIS GATE IS ABOUT (`enabled: !isDemo`), so a demo run
// shows "Loading..." forever and records zero reads - which is indistinguishable from a broken
// grant unless the demo flag is cleared and then asserted off below.
await page.evaluate(() => sessionStorage.removeItem('forged:demo_session'));

// Registered BEFORE the navigation, or the first read is missed and zero would read as "no reads".
const seen = [];
page.on('response', (r) => { if (r.url().includes('/rest/v1/friend_links')) seen.push(r.status()); });

await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });

const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';
for (let i = 0; i < 6 && (await page.locator(OVERLAY).count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const still = page.locator(OVERLAY);
  if (await still.count()) { await still.first().dispatchEvent('click'); await page.waitForTimeout(600); }
}
if (await page.locator(OVERLAY).count()) await stop(2, 'a modal overlay is still up; it would intercept the press below.');

// Wait for the bar itself. A skeleton renders no tabs, and "0 segments" and "not yet mounted"
// are the same reading from outside.
try {
  await page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length > 0, { timeout: 20000 });
} catch {
  await stop(2, `no section bar mounted within 20s; landed on ${page.url()}.`);
}

const tabs = page.getByRole('tab');
const labels = [];
let profile = null;
for (let i = 0; i < (await tabs.count()); i += 1) {
  const t = tabs.nth(i);
  const label = (await t.innerText()).trim().replace(/\s+/g, ' ');
  labels.push(label);
  if (/profile/i.test(label)) profile = t;
}
if (!profile) await stop(2, `no Profile segment among ${JSON.stringify(labels)} - nothing to press.`);
await profile.click();

// ⚠️ WAIT ON THE READ ITSELF, NOT ON TEXT AND NOT ON A CLOCK. The card's "Friends" heading is
// present while the query is still in flight, so waiting on text measures the LOADING state and
// records zero responses - which reads identically to a denied grant. Measured here on the first
// run of this gate.
const deadline = Date.now() + 25000;
while (seen.length === 0 && Date.now() < deadline) await page.waitForTimeout(250);
// Let the card settle out of "Loading..." once the response has landed.
await page.waitForTimeout(1500);

const body = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim());
await page.screenshot({ path: 'friend-read.png' });

if (/could not load your friends/i.test(body)) {
  await stop(1, `/account -> Profile is still showing "Could not load your friends." `
    + `friend_links responses seen: ${JSON.stringify(seen)}`);
}
// ⚠️ THE ABSENCE OF THE ERROR IS NOT A PASS: a card that does not render at all satisfies it.
if (!/friend/i.test(body)) {
  await stop(1, 'the error text is absent because the Friends card is absent. An absence is not a pass.');
}
const demo = await page.evaluate(() => sessionStorage.getItem('forged:demo_session') === 'true');
if (demo) {
  await stop(2, 'this run was in DEMO mode, where the friends query is deliberately disabled - it measured nothing.');
}
if (seen.length === 0) {
  await stop(2, 'the page made no friend_links read at all, so the screen half measured nothing.');
}
const bad = seen.filter((s) => s !== 200);
if (bad.length) await stop(1, `friend_links responses on the rendered page: ${JSON.stringify(seen)} - not all 200.`);

await browser.close();
console.log(`4. screen: Profile pressed, no error state, ${seen.length} friend_links response(s), all 200`);
console.log(`PASS: ${columnCount} granted columns, subject ${subject.status}, control ${control.status}, screen clean.`);
process.exit(0);
