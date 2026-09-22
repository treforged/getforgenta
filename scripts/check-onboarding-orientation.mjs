#!/usr/bin/env node
/**
 * check-onboarding-orientation.mjs - WALK FIRST RUN TO THE END, IN A REAL BROWSER, AND ASSERT
 * THE ORIENTATION IS ON SCREEN.
 *
 * `onboarding-orientation.gate.test.ts` reads SOURCE. It proves the copy exists and that every
 * destination it names is one the app really has, and it states its own limit in writing: a
 * block inside a branch that never renders would satisfy it. This is that limit, closed.
 *
 * ── WHY THE DATABASE IS NOT THE INSTRUMENT, AND THIS IS MEASURED HERE ────────────────────────
 * This repo has a reviewer reset that read its own write back CLEAN while the running app undid
 * it within a second - the verifier finished before the system under test started. So a row
 * saying `onboarding_completed = false` is a fact about a table. Whether a person sees the
 * wizard is a fact about the product, and only the product can be asked. Every assertion below
 * is about RENDERED TEXT.
 *
 * ── WHAT IT PROVES ───────────────────────────────────────────────────────────────────────────
 *   1. first run is REACHABLE at all - the wizard's own copy is on screen, not /dashboard
 *   2. the walk REACHES THE FINISH STEP by pressing the app's own controls, step by step
 *   3. the orientation block is ON SCREEN there, and NAMES EVERY DESTINATION - both lists
 *      DERIVED, from `primary-nav.ts` and from Account's own section bar, never typed here
 *   4. as a by-product it COUNTS the placeholders it met, which `check:placeholders` cannot
 *      reach: that gate walks routes and sees only fields rendered without interaction, so the
 *      onboarding steps are invisible to it (ask d694a896)
 *
 * ── WHAT IT DOES NOT PROVE, stated rather than implied ───────────────────────────────────────
 * That the wording is good, that anyone reads it, or that the destinations are REACHABLE once
 * named - a name existing and a tap arriving somewhere are different claims, and `check:nav`
 * owns the second. It does not measure layout, colour or whether the block fits its box. It
 * walks ONE viewport. And it asserts the ENGLISH copy; a translated build is not covered.
 *
 * ── EXIT CODES, and the difference is the point ──────────────────────────────────────────────
 *   0  the walk reached finish and every destination was named
 *   1  it ran, looked, and the orientation is WRONG or MISSING - a finding in the app
 *   2  it COULD NOT LOOK - env missing, sign-in refused, dev server down, playwright missing,
 *      a profile write that matched no row, or the walk never reached finish. Zero steps
 *      examined can never exit 0, because a walk that measured nothing must not read as clean.
 *
 * USAGE:  node scripts/check-onboarding-orientation.mjs
 *         Needs the dev server on http://localhost:8080 and .env.deck-walk.local.
 */

import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const MAX_STEPS = 20;           // the flow has 9; this is a runaway guard, not an expectation

function fail(code, msg) {
  console.error(`FAIL(${code}): ${msg}`);
  process.exit(code);
}

/**
 * ⚠️ `fail()` CALLS `process.exit`, WHICH JUMPS STRAIGHT OUT OF A `finally`. Using it inside
 * the walk left the reviewer account stranded mid-onboarding on this script's first run -
 * display_name null, onboarding_completed false - so the next run would have measured a state
 * this script created and had no way to tell it from a real defect. A harness that abandons
 * its subject is the saboteur version of the one this repo already records.
 *
 * Anything inside the try/finally therefore THROWS. The finally restores, and the code is
 * carried on the error so the exit status still discriminates 1 (a finding) from 2 (could not
 * look).
 */
class WalkError extends Error {
  constructor(code, msg) { super(msg); this.code = code; }
}
const abort = (code, msg) => { throw new WalkError(code, msg); };

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

// THE GUARD. `dev-signin` forbids scripting a credential to real money; `.test` is an
// IANA-reserved TLD that can never be a real mailbox, so this address cannot belong to a
// person. Remove this check and that rule is back in force.
if (!new RegExp('@forgenta[.]test$').test(email)) {
  fail(2, `refusing to script a sign-in for "${email}" - this script only ever handles @forgenta.test accounts.`);
}

// ── THE EXPECTED DESTINATIONS, DERIVED. A list typed here would enforce nothing: rename a tab
// and this walk would go on passing while the copy went stale, which is the precise defect
// class this whole slice exists to stop.
const NAV_LABELS = [...readFileSync('src/lib/primary-nav.ts', 'utf8')
  .matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1]);
const ACCOUNT_SECTIONS = [...readFileSync('src/pages/Account.tsx', 'utf8')
  .matchAll(/aria-label="([^"]+)"\s*\n\s*title="[^"]*"/g)].map((m) => m[1]);

// A derivation that yields nothing would make every assertion below vacuous - "named all 0 of
// them" is not a pass. This is the control on the instrument, and it runs before the browser.
if (NAV_LABELS.length !== 5) fail(2, `derived ${NAV_LABELS.length} nav labels, expected 5 - the extractor is broken, not the app.`);
if (ACCOUNT_SECTIONS.length !== 5) fail(2, `derived ${ACCOUNT_SECTIONS.length} Account sections, expected 5 - the extractor is broken, not the app.`);
console.log(`derived destinations: nav ${JSON.stringify(NAV_LABELS)}`);
console.log(`                     account ${JSON.stringify(ACCOUNT_SECTIONS)}`);

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
} catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: npm run dev`); }

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }

// ── Profile reads and writes, under the USER'S OWN token (RLS permits its own row) ───────────
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

// A write that matches NOTHING is the silent failure. PostgREST counts a matched row even when
// the value is unchanged, so an empty array means the write was refused or aimed at nothing -
// never "it was already correct".
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

const hasMarker = (text, m) => text.toLowerCase().includes(m.toLowerCase());

let browser;
let exitCode = 0;
try {
  // Put the account into first-run state. `display_name` must be cleared too: `Onboarding.tsx`
  // bounces anyone carrying one, so clearing only `onboarding_completed` lands on /dashboard
  // and the walk would report first run as unreachable.
  await writeProfile({ onboarding_completed: false, display_name: null });

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
  // The app ALSO remembers "onboarding done" per device. Left in place, that cache
  // short-circuits first run and the walk would measure the cache rather than the product.
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.includes('onboarding')) localStorage.removeItem(k);
  });

  await page.goto(`${BASE}/onboarding`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // ⚠️ THE COOKIE CONSENT BANNER IS FIXED TO THE BOTTOM AND INTERCEPTS POINTER EVENTS, so
  // every Continue press timed out against a control that was "visible, enabled and stable".
  // Playwright reported the interception plainly, which is the only reason this took one run
  // to find rather than being read as a broken button. It is dismissed rather than hidden:
  // hiding it with CSS would leave it eating clicks in a way no frame would show.
  const consent = page.getByRole('region', { name: /cookie consent/i });
  if (await consent.count()) {
    const accept = consent.getByRole('button', { name: /accept all|reject/i }).first();
    if (await accept.count()) {
      await accept.click();
      await page.waitForTimeout(600);
      console.log('dismissed the cookie consent banner (it intercepts pointer events)');
    }
  }

  const landed = new URL(page.url()).pathname;
  const firstText = (await page.evaluate(() => document.body.innerText || '')).trim();
  // Matched case-insensitively on purpose: `innerText` reports the RENDERED case and this repo
  // has already had a CSS-uppercased label read as a missing marker - an instrument fault
  // wearing the costume of a finding.
  if (landed !== '/onboarding' || !hasMarker(firstText, 'Welcome to Forgenta')) {
    abort(2, `first run is not reachable - landed on ${landed} with ${firstText.length} chars of text. `
      + 'Nothing about the orientation can be measured from here.');
  }
  console.log('first run reached: the wizard is on screen at /onboarding');

  // ── Drive the flow by pressing the app's OWN controls, step by step ────────────────────────
  let steps = 0;
  let placeholdersSeen = new Set();
  let reachedFinish = false;
  const visited = [];

  while (steps < MAX_STEPS) {
    steps += 1;
    const text = (await page.evaluate(() => document.body.innerText || '')).trim();
    // The step's OWN heading, not the first line of the page. Every screen begins with the
    // brand mark, so the first line labelled all nine steps "FORGENTA" and the trace said
    // nothing about where the walk had been - a log that cannot be read is not a log.
    const heading = await page.evaluate(() => {
      const h = document.querySelector('main h2') || document.querySelector('h2');
      return ((h && h.innerText) || '').trim();
    });
    visited.push(heading.slice(0, 30) || '(no heading)');

    for (const p of await page.evaluate(() =>
      [...document.querySelectorAll('input[placeholder]')].map((el) => el.getAttribute('placeholder')))) {
      if (p) placeholdersSeen.add(p);
    }

    if (hasMarker(text, 'Your profile is set')) { reachedFinish = true; break; }

    // The name field is the one genuinely required input; everything else may stay empty.
    const nameField = page.locator('input[placeholder="Your name"], input#display-name').first();
    if (await nameField.count() && !(await nameField.inputValue())) {
      await nameField.fill('Walk Account');
    }

    // Press whatever moves forward on THIS step. The bank and premium steps carry their own
    // controls rather than the shared Continue, which is why this is a list and not one name.
    // ⚠️ PREFER THE CONTROL THAT ADVANCES, AND NEVER MATCH "Skip setup".
    // The welcome step renders BOTH "Skip setup ->" and "Continue", and "Skip setup" comes
    // first in the DOM - so a single permissive regex with .first() pressed Skip and left the
    // wizard for /dashboard on step 1. The walk then reported "no forward control" from the
    // DASHBOARD, which reads like a broken app rather than a harness that took the wrong door.
    // Advance vocabulary first; the decline/dismiss words are a fallback for the bank and
    // premium steps, which carry their own controls instead of the shared Continue.
    const ADVANCE = /^(continue|see your plan|next)$/i;
    // ⚠️ THIS VOCABULARY IS HAND-NAMED, WHICH THIS REPO NORMALLY REFUSES - so note WHY it is
    // safe here: it cannot go quietly wrong. A label this list does not know produces no
    // forward control, and the walk then ABORTS at exit 2 printing every control it could see.
    // A hand-named list is only dangerous when a miss reads as a pass, and a miss here reads as
    // "could not look". The premium step is two-stage, which is why it contributes two.
    const FALLBACK = /(no thanks|i'?ll stay on free|not now|maybe later|decline|continue free|do this later|skip for now)/i;
    let forward = page.getByRole('button', { name: ADVANCE }).first();
    if (!(await forward.count())) forward = page.getByRole('button', { name: FALLBACK }).first();
    if (!(await forward.count())) {
      // PRINT WHAT WAS ACTUALLY THERE. A gate that reports only a verdict sends the reader to
      // the app when the INSTRUMENT is at fault; one that prints its own input makes the
      // difference visible without any cleverness.
      const controls = await page.evaluate(() =>
        [...document.querySelectorAll('button, a[href]')]
          .map((el) => (el.innerText || el.getAttribute('aria-label') || '').trim())
          .filter(Boolean));
      abort(2, `step ${steps} offers no control matching the forward vocabulary. The walk cannot `
        + `advance, so it has measured nothing about the finish step.\n`
        + `  screen began: ${JSON.stringify(visited.at(-1))}\n`
        + `  controls present: ${JSON.stringify(controls)}`);
    }
    await forward.click();
    await page.waitForTimeout(1200);
  }

  console.log(`walked ${steps} step(s): ${visited.join(' | ')}`);
  console.log(`placeholders met en route (invisible to check:placeholders): ${placeholdersSeen.size}`);
  for (const p of placeholdersSeen) console.log(`  - ${JSON.stringify(p)}`);

  if (!reachedFinish) {
    abort(2, `the walk never reached the finish step in ${MAX_STEPS} presses. It has examined no `
      + 'orientation, and a walk that measured nothing must not read as clean.');
  }

  // ── THE ASSERTION. Rendered text, on the finish step, at a phone width ─────────────────────
  const finishText = (await page.evaluate(() => document.body.innerText || '')).trim();
  const missingNav = NAV_LABELS.filter((l) => !hasMarker(finishText, l));
  const missingSections = ACCOUNT_SECTIONS.filter((s) => !hasMarker(finishText, s));
  const hasHeading = hasMarker(finishText, 'Where things are');

  console.log(`\nfinish step: ${finishText.length} chars on screen`);
  console.log(`  orientation heading present : ${hasHeading}`);
  console.log(`  nav destinations named      : ${NAV_LABELS.length - missingNav.length}/${NAV_LABELS.length}`);
  console.log(`  Account sections named      : ${ACCOUNT_SECTIONS.length - missingSections.length}/${ACCOUNT_SECTIONS.length}`);

  if (!hasHeading || missingNav.length || missingSections.length) {
    console.error('\nFAIL: the orientation is missing or incomplete ON SCREEN.');
    if (!hasHeading) console.error('  the "Where things are" block did not render at all');
    if (missingNav.length) console.error(`  nav destinations not named: ${missingNav.join(', ')}`);
    if (missingSections.length) console.error(`  Account sections not named: ${missingSections.join(', ')}`);
    console.error('A source gate cannot see this: the copy can exist and still not render.');
    exitCode = 1;
  } else {
    console.log('\nPASS: first run reaches the finish step and names every destination the app has.');
  }
} catch (err) {
  // A WalkError carries its own code so 1 (a finding in the app) stays distinguishable from
  // 2 (the walk could not look). Anything else is an unexpected crash, which is a 2: it
  // examined nothing, and a crash must never read as a clean run.
  if (err instanceof WalkError) {
    console.error(`FAIL(${err.code}): ${err.message}`);
    exitCode = err.code;
  } else {
    console.error(`FAIL(2): the walk crashed - ${err && err.stack ? err.stack : err}`);
    exitCode = 2;
  }
} finally {
  if (browser) await browser.close();
  // Put the account back the way it was found, whatever happened above. A walk that leaves the
  // reviewer account mid-onboarding poisons the next run, and the next run would have no way to
  // tell that state from a real defect.
  await writeProfile({
    onboarding_completed: original.onboarding_completed,
    display_name: original.display_name,
  });
  const restored = await readProfile();
  console.log(`restored: display_name=${JSON.stringify(restored.display_name)} onboarding_completed=${restored.onboarding_completed}`);
}

process.exit(exitCode);
