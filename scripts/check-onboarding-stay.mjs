#!/usr/bin/env node
/**
 * check-onboarding-stay.mjs - prove IN A REAL BROWSER that the onboarding bounce removed on
 * 2026-09-15 (d779ea9d) actually changed the behaviour a user meets.
 *
 * WHAT IT PROVES, as a DISCRIMINATING PAIR run in one execution:
 *   ARM A  display_name non-empty AND onboarding_completed = false  ->  STAYS on the wizard
 *   ARM B  the same account with onboarding_completed = true        ->  LEAVES to /dashboard
 * Arm A alone is not evidence. A wizard that never navigates at all, a blank page and a crashed
 * page all "stay put", so Arm A also requires the wizard's own copy to be on screen, and Arm B is
 * what proves a finished account is still let out rather than trapped in setup.
 *
 * WHY THE DATABASE IS NOT THE INSTRUMENT.
 * This repo already records a reviewer reset that read its own write back clean while the running
 * app undid it within a second - the verifier finished before the system under test started. A row
 * saying onboarding_completed = false is a fact about a table. Whether the user sees the wizard is
 * a fact about the product, and only the product can be asked.
 *
 * PROVEN RED, AND ONE ARM COULD NOT BE - measured 2026-09-15, both mutations run against the
 * real dev server and restored byte-exact (sha256 checked).
 *   ARM A goes RED on the REAL shipped defect. Reinstating the pre-fix rule
 *     (`onboarding_completed === true || !!display_name`) plus the `display_name` select made this
 *     account land on /dashboard with 0 of 2 wizard markers. That is the mutation taken from this
 *     repo's own history, not an invented one, so the gate demonstrably catches what really happened.
 *   ARM B CANNOT BE DRIVEN RED BY MUTATING THE RULE, and that is a fact about the app, not a
 *     weakness to paper over. With the rule mutated to return false for everybody, ARM B still
 *     passed: `ProtectedRoute` mounts `useOnboardingStatus`, which writes the device cache
 *     (`forged:onboarding_done_<uid>`) as soon as the profile reads completed, and `Onboarding`'s
 *     FIRST branch leaves on that cache before the rule is ever consulted. So a completed account
 *     leaves by TWO independent mechanisms. ARM B asserts the user-visible outcome; it is NOT
 *     evidence about `shouldLeaveOnboarding`. Only ARM A is.
 *
 * WHAT IT DOES NOT COVER, said plainly:
 *   - It presses NOTHING. A wizard whose buttons all throw passes this.
 *   - It asserts TEXT, not a rendered frame. A layout, contrast or encoding regression passes.
 *   - It walks ONE account, the reserved-TLD walk account. It says nothing about OAuth sign-up.
 *   - It restores the profile it changed, and verifies the restore, but it cannot restore the
 *     browser-side caches it cleared - those live in a throwaway context and are discarded.
 *
 * EXIT CODES, and the difference matters:
 *   0  both arms examined and both passed
 *   1  it ran and an arm FAILED
 *   2  it COULD NOT LOOK - missing env, sign-in refused, dev server down, playwright missing,
 *      or a profile write that matched no row. Zero arms examined can never exit 0.
 *
 * USAGE:  node scripts/check-onboarding-stay.mjs
 *         Needs the dev server on http://localhost:8080 and .env.deck-walk.local.
 */

import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';

function fail(code, msg) {
  console.error(`FAIL(${code}): ${msg}`);
  process.exit(code);
}

const pick = (s, k) => (s.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();

let env, creds;
try { env = readFileSync('.env.local', 'utf8'); }
catch { fail(2, '.env.local is missing.'); }
try { creds = readFileSync('.env.deck-walk.local', 'utf8'); }
catch { fail(2, '.env.deck-walk.local is missing - see scripts/seed-walk-account.sql.'); }

const url = pick(env, 'VITE_SUPABASE_URL');
const anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
const email = pick(creds, 'REACH_TEST_EMAIL');
const password = pick(creds, 'REACH_TEST_PASSWORD');
if (!url || !anon) fail(2, 'VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing from .env.local.');
if (!email || !password) fail(2, '.env.deck-walk.local carries no email/password.');

// THE GUARD. `dev-signin` forbids scripting a credential to real money; `.test` is an IANA-reserved
// TLD that can never be a real mailbox, so this address cannot belong to a person. Remove this
// check and that rule is back in force.
if (!new RegExp('@forgenta[.]test$').test(email)) {
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
const uid = session.user.id;
console.log(`signed in as ${session.user.email}`);

try {
  const ping = await fetch(BASE, { redirect: 'manual' });
  if (ping.status >= 500) fail(2, `${BASE} answered ${ping.status}.`);
} catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }

// -- Profile reads and writes, under the USER'S OWN token (RLS permits its own row) -------------
const restHeaders = {
  apikey: anon,
  Authorization: `Bearer ${session.access_token}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function readProfile() {
  const r = await fetch(
    `${url}/rest/v1/profiles?select=display_name,onboarding_completed&user_id=eq.${uid}`,
    { headers: restHeaders },
  );
  if (!r.ok) fail(2, `profile read returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length !== 1) {
    fail(2, `profile read matched ${Array.isArray(rows) ? rows.length : '?'} rows, expected exactly 1.`);
  }
  return rows[0];
}

// A write that matches NOTHING is the silent failure this whole file exists to refuse. PostgREST
// counts a matched row even when the value is unchanged, so an empty array means the write was
// refused or aimed at nothing - never "it was already correct".
async function writeProfile(patch) {
  const r = await fetch(`${url}/rest/v1/profiles?user_id=eq.${uid}`, {
    method: 'PATCH', headers: restHeaders, body: JSON.stringify(patch),
  });
  if (!r.ok) fail(2, `profile write returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    fail(2, `profile write matched NO row (${JSON.stringify(patch)}) - it did nothing and must not read as success.`);
  }
}

const original = await readProfile();
console.log(`original: display_name=${JSON.stringify(original.display_name)} onboarding_completed=${original.onboarding_completed}`);

// -- One arm: open the wizard in a FRESH context and read where it lands ------------------------
async function openWizard(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  // localStorage needs an origin, so land on the app before writing to it.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
  // The app ALSO remembers "onboarding done" per device (`forged:onboarding_done_<uid>`), and that
  // cache short-circuits the rule under test. Left in place, a pass would prove the cache works and
  // say nothing about the profile rule.
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.includes('onboarding')) localStorage.removeItem(k);
  });
  await page.goto(`${BASE}/onboarding`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const landed = new URL(page.url()).pathname;
  const text = (await page.evaluate(() => document.body.innerText || '')).trim();
  await ctx.close();
  return { landed, text };
}

// Matched CASE-INSENSITIVELY on purpose. `innerText` reports the RENDERED case, and the field
// label is uppercased by CSS - the source says "What should we call you?" and the page says
// "WHAT SHOULD WE CALL YOU?". A case-sensitive match read that as a missing marker on the first
// run, which is a defect in the instrument wearing the costume of a finding.
const WIZARD_MARKERS = ['Welcome to Forgenta', 'What should we call you?'];
const hasMarker = (text, m) => text.toLowerCase().includes(m.toLowerCase());

let examined = 0;
const results = [];
let browser;
try {
  browser = await chromium.launch();

  // ARM A - the case the change actually altered.
  await writeProfile({ display_name: 'Walk Tester', onboarding_completed: false });
  const a = await openWizard(browser);
  const aMarkers = WIZARD_MARKERS.filter((m) => hasMarker(a.text, m));
  const aPass = a.landed === '/onboarding' && aMarkers.length === WIZARD_MARKERS.length;
  examined += 1;
  results.push({
    arm: 'ARM A', want: 'stays on /onboarding with the wizard on screen',
    pass: aPass, landed: a.landed, text: a.text,
    extra: `markers found ${aMarkers.length}/${WIZARD_MARKERS.length}`,
  });

  // ARM B - the paired case, and the reason Arm A means anything.
  await writeProfile({ onboarding_completed: true });
  const b = await openWizard(browser);
  const bPass = b.landed === '/dashboard';
  examined += 1;
  results.push({
    arm: 'ARM B', want: 'leaves to /dashboard',
    pass: bPass, landed: b.landed, text: b.text, extra: '',
  });
} finally {
  if (browser) await browser.close();
  await writeProfile({ display_name: original.display_name, onboarding_completed: original.onboarding_completed });
  const back = await readProfile();
  const restored = back.display_name === original.display_name
    && back.onboarding_completed === original.onboarding_completed;
  console.log(`restore: display_name=${JSON.stringify(back.display_name)} onboarding_completed=${back.onboarding_completed} -> ${restored ? 'OK' : 'MISMATCH'}`);
  if (!restored) fail(2, 'the profile was NOT restored to the values this run found - fix it by hand before trusting anything else here.');
}

console.log('');
for (const r of results) {
  console.log(`${r.arm} ${r.pass ? 'PASS' : 'FAIL'}  want: ${r.want}  landed: ${r.landed}  ${r.extra}`);
  if (!r.pass) console.log(`       page text (first 300): ${JSON.stringify(r.text.slice(0, 300))}`);
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\narms examined: ${examined}  passed: ${examined - failed}  failed: ${failed}`);
if (examined === 0) fail(2, 'ZERO arms were examined - nothing was measured, so this is not a pass.');
if (failed > 0) fail(1, `${failed} arm(s) failed.`);
console.log('OK - the wizard stays for an unfinished account and leaves for a finished one.');
