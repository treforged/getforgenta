#!/usr/bin/env node
/**
 * reset-reviewer-account.mjs — put the store-reviewer account back into first-run
 * state, prove it landed, and refuse to look successful when it did not.
 *
 * Run it BEFORE every full walk of the site:
 *     node scripts/reset-reviewer-account.mjs
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────
 * An account that has already onboarded can never exercise first-run, and first-run
 * is the only experience most new users ever have. The app has carried a reviewer
 * reset since before the rebrand, but it fires only when a human signs in AND the
 * email matches a constant — and that constant was wrong from 2026-04-27 to
 * 2026-09-11 (see src/lib/reviewer-account.ts). This script is the copy that can be
 * run deliberately, and that says so out loud when it fails.
 *
 * ── THE THREE NON-NEGOTIABLES, AND HOW EACH IS ENFORCED ──────────────────────
 *
 * 1. REVIEWER ONLY — never a real user's row. Proved by QUERY, not by comment:
 *    the reviewer id is never taken from argv or from a config file. It is
 *    RESOLVED by selecting auth.users for exactly the address in
 *    src/lib/reviewer-account.ts, and the run aborts unless that select returns
 *    EXACTLY ONE row whose email matches that address byte for byte. Every write
 *    is then scoped `.eq('user_id', <that id>)`. There is no code path that can
 *    address any other row, because there is no other id in scope.
 *
 * 2. IT ASSERTS ITS OWN EFFECT. Every write uses `.select()` and the affected rows
 *    are counted. Afterwards the profile is READ BACK from the database and each
 *    first-run column is checked against the value it must hold. The read-back is
 *    a separate round trip on purpose: asserting the object you just sent proves
 *    only that you can remember what you typed.
 *
 * 3. IT EXITS NON-ZERO WHEN IT CHANGED NOTHING. With a resolved reviewer id a
 *    profile UPDATE matches exactly one row — Postgres counts a matched row even
 *    when the new values equal the old ones, so "already in first-run state" still
 *    reports 1. Zero matched rows therefore means the write was REFUSED or aimed
 *    at nothing, which is precisely the silent failure this script exists to catch.
 *
 *    Exit codes, and the difference matters:
 *      0  reset applied and verified by read-back
 *      1  it ran and the result is WRONG (no rows matched, or read-back disagrees)
 *      2  it COULD NOT LOOK (no credentials, reviewer address matches no user,
 *         more than one match, or the database could not be reached)
 *    "I looked and it is broken" and "I could not look" must never share a code.
 *
 * ── WHAT THIS SCRIPT DELIBERATELY DOES NOT DO ────────────────────────────────
 * It NEVER writes, prints or persists a credential; the service-role key is read
 * from the environment and used only to construct the client. It cannot clear the
 * browser-side first-run flags (localStorage `forged:onboarding_done_<id>`, the two
 * tour keys, and the sessionStorage founder-note / wizard keys) because those live
 * in the browser, not the database. Signing in as the reviewer clears them — that is
 * AuthContext's own reset, which now runs again — but a walk driven against an
 * already-open tab must reload after sign-in or the route gate will wave the
 * reviewer past /onboarding on a cached flag. That residue is named here rather
 * than implied away.
 */

import process from 'node:process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Read the reviewer address and the first-run column values out of the TypeScript
 * module that the app itself imports, rather than restating them here.
 *
 * A second copy of these values is exactly how the rebrand drift happened: two
 * places holding one fact, and nothing comparing them. Parsing the source keeps a
 * single definition without pulling a TS toolchain into a plain node script.
 */
function loadReviewerContract() {
  const src = readFileSync(new URL('../src/lib/reviewer-account.ts', import.meta.url), 'utf8');

  const emailMatch = src.match(/export const REVIEWER_EMAIL\s*=\s*'([^']+)'/);
  if (!emailMatch) {
    fail(2, 'Could not read REVIEWER_EMAIL from src/lib/reviewer-account.ts.');
  }

  const blockMatch = src.match(/export const REVIEWER_FIRST_RUN_PROFILE\s*=\s*\{([\s\S]*?)\}/);
  if (!blockMatch) {
    fail(2, 'Could not read REVIEWER_FIRST_RUN_PROFILE from src/lib/reviewer-account.ts.');
  }

  // Strip comments first: the block carries a long JSDoc whose prose contains colons
  // and words, and parsing that as data is how a comment becomes a column.
  const body = blockMatch[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  const firstRun = {};
  for (const [, key, value] of body.matchAll(/(\w+)\s*:\s*(true|false|null)/g)) {
    firstRun[key] = value === 'null' ? null : value === 'true';
  }
  if (Object.keys(firstRun).length === 0) {
    fail(2, 'REVIEWER_FIRST_RUN_PROFILE parsed to zero columns — refusing to "reset" nothing.');
  }

  /**
   * ⚠️ COUNT WHAT WAS DROPPED. This parser understands `true`, `false` and `null`
   * and nothing else, so a future field like `onboarding_step: 0` would be skipped
   * IN SILENCE and the reset would quietly stop covering it — the same shape as the
   * rebrand drift this file exists to prevent, one level down.
   *
   * `display_name: null` was added to the contract on 2026-09-13 and the original
   * `(true|false)` pattern would have dropped it exactly this way.
   */
  const declaredKeys = [...body.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]);
  const dropped = declaredKeys.filter((k) => !(k in firstRun));
  if (dropped.length > 0) {
    fail(
      2,
      `REVIEWER_FIRST_RUN_PROFILE declares ${declaredKeys.length} columns and this script ` +
        `could only parse ${Object.keys(firstRun).length}.\n` +
        `        Unparsed: ${dropped.join(', ')}\n` +
        '        Refusing to run a reset that silently skips part of its own contract.\n' +
        '        Teach the parser the new value shape in loadReviewerContract().',
    );
  }

  return { email: emailMatch[1], firstRun };
}

function fail(code, message) {
  console.error(`\n  FAIL  ${message}\n`);
  process.exit(code);
}

function line(ok, label, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const { email: reviewerEmail, firstRun } = loadReviewerContract();

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    fail(
      2,
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in the environment.\n' +
        '        This script never stores a credential and never reads one from disk.\n' +
        '        Exit 2 means "could not look", NOT "nothing needed doing".',
    );
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  console.log(`\nReviewer reset — ${reviewerEmail}`);
  console.log(`Repo: ${REPO_ROOT}\n`);

  // ── 1. Resolve the reviewer BY EMAIL. This is the reviewer-only proof. ──────
  const { data: userPage, error: listErr } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) {
    fail(2, `Could not read auth.users: ${listErr.message}`);
  }
  const matches = (userPage?.users ?? []).filter(
    (u) => (u.email ?? '').toLowerCase() === reviewerEmail.toLowerCase(),
  );

  if (matches.length === 0) {
    fail(
      2,
      `No auth user has the address ${reviewerEmail}.\n` +
        '        This is the failure the 2026-04-27 rebrand drift produced silently for 136 days:\n' +
        '        a reviewer constant that matches no row resets nothing and raises nothing.\n' +
        '        Fix src/lib/reviewer-account.ts, or the account, before walking the site.',
    );
  }
  if (matches.length > 1) {
    fail(2, `${matches.length} auth users share ${reviewerEmail} — refusing to guess which one.`);
  }

  const reviewer = matches[0];
  // Belt and braces: the id used for every write below came from this row and this
  // row alone, and the address on it is re-checked here rather than assumed.
  if ((reviewer.email ?? '').toLowerCase() !== reviewerEmail.toLowerCase()) {
    fail(2, 'Resolved user does not carry the reviewer address — aborting before any write.');
  }
  line(true, 'reviewer resolved', `exactly 1 auth user, id ${reviewer.id}`);

  // ── 2. Write, and COUNT what the write matched. ─────────────────────────────
  const { data: updated, error: updateErr } = await db
    .from('profiles')
    .update(firstRun)
    .eq('user_id', reviewer.id)
    .select('user_id');

  if (updateErr) {
    fail(1, `The profile update was refused: ${updateErr.message}`);
  }
  const matched = updated?.length ?? 0;
  if (matched === 0) {
    fail(
      1,
      'The profile update matched ZERO rows.\n' +
        '        With a resolved reviewer id this always matches exactly one row, so zero means\n' +
        '        the write was refused or aimed at nothing. The account is NOT in first-run state.',
    );
  }
  if (matched > 1) {
    fail(1, `The profile update matched ${matched} rows — it must only ever match the reviewer.`);
  }
  line(true, 'profile update matched', `${matched} row (the reviewer only)`);

  // ── 3. READ BACK. A separate round trip, because echoing your own payload ───
  //      proves only that you can remember what you typed.
  const { data: readBack, error: readErr } = await db
    .from('profiles')
    .select(['user_id', ...Object.keys(firstRun)].join(', '))
    .eq('user_id', reviewer.id)
    .single();

  if (readErr || !readBack) {
    fail(1, `Could not read the profile back to verify it: ${readErr?.message ?? 'no row'}`);
  }

  let allGood = true;
  for (const [column, want] of Object.entries(firstRun)) {
    const got = readBack[column];
    const ok = got === want;
    if (!ok) allGood = false;
    line(ok, `first-run column ${column}`, `want ${want}, read back ${JSON.stringify(got)}`);
  }

  if (!allGood) {
    fail(1, 'Read-back disagrees with what was written — the account is NOT in first-run state.');
  }

  line(true, 'database read-back', 'every first-run column holds its reset value');

  // ── 4. ASSERT THE SCREEN, NOT THE ROW. ─────────────────────────────────────
  if (process.argv.includes('--no-browser')) {
    console.log(
      '\n  --no-browser: the ROW was reset and read back, and NOTHING checked that the\n' +
        '  wizard is reachable. That is the exact gap that made this script report success\n' +
        '  while first run was unwalkable. Re-run without the flag before trusting a walk.\n',
    );
    process.exit(0);
  }
  await assertFirstRunScreen({ db, reviewer, baseUrl: process.env.APP_URL ?? 'http://localhost:8080' });

  console.log(
    '\n  The reviewer account is in first-run state AND the wizard was seen to render.\n' +
      '\n  ⚠️ WALK /onboarding FIRST, BEFORE /dashboard. Loading the dashboard mounts\n' +
      '  OnboardingChecklist, which computes allDone from the account\'s real data — the\n' +
      '  reviewer already has accounts, so it calls markOnboardingComplete from a\n' +
      '  useEffect with NO user interaction and re-completes onboarding in under a second.\n' +
      '  That is a property of the app, not a bug in this reset, and it is why the reset\n' +
      '  cannot be verified by reading the row back later.\n',
  );
  process.exit(0);
}

/**
 * Open the app as the reviewer and REQUIRE the onboarding wizard to render.
 *
 * ⚠️ WHY THIS EXISTS, AND IT IS THE WHOLE POINT OF THE 2026-09-13 REWRITE.
 * Every check above this one reads the DATABASE, and the database was never the
 * thing in doubt. The reset wrote its columns correctly for months and the wizard
 * was still unreachable, because `Onboarding.tsx:237` bounced any user carrying a
 * `display_name`. **A read-back cannot see that**: it runs before the app does, so
 * it verifies the write and not the outcome. A reset is verified by opening the app
 * and seeing first run.
 *
 * ⚠️ ON THE CREDENTIAL, because this script's header promises never to store one.
 * It still doesn't. The session is minted by the SERVICE ROLE for the reviewer TEST
 * account through `generateLink` — no password is typed, read, or stored, the link
 * is never printed, and the browser context is in-memory and destroyed on exit.
 * Nothing is written to disk and no `storageState` is saved. This is only ever
 * pointed at the reviewer id resolved above, which is the same id every write used.
 *
 * ⚠️ WHAT WAS AND WAS NOT EXERCISED WHEN THIS WAS WRITTEN (2026-09-13). Say it here
 * rather than let a reader assume a green.
 *   PROVEN RED: the two assertions below were run against an UNAUTHENTICATED context
 *   as a negative control. The app redirected to `/auth`, `onWizard` and `hasWelcome`
 *   both came back false, and the check failed — so it cannot mistake a login wall
 *   for first run, and the Playwright plumbing runs.
 *   NOT PROVEN GREEN: the magic-link path has never been executed. No
 *   `SUPABASE_SERVICE_ROLE_KEY` exists on the machine this was written on, so the
 *   happy path could not be reached. **The first person to run this with the key in
 *   the environment is testing this function, not just the account** — if the link
 *   hop or the 4s settle is wrong, it will fail here rather than at the assertion.
 */
async function assertFirstRunScreen({ db, reviewer, baseUrl }) {
  let chromium;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    fail(2, 'Could not load @playwright/test — cannot look at the screen. `npm i` first.');
  }

  // The dev server has to be up. A connection refused here is "could not look".
  try {
    const ping = await fetch(baseUrl, { redirect: 'manual' });
    if (ping.status >= 500) fail(2, `${baseUrl} answered ${ping.status} — cannot look at the screen.`);
  } catch (err) {
    fail(2, `${baseUrl} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`);
  }

  const { data: link, error: linkErr } = await db.auth.admin.generateLink({
    type: 'magiclink',
    email: reviewer.email,
    options: { redirectTo: `${baseUrl}/dashboard` },
  });
  if (linkErr || !link?.properties?.action_link) {
    fail(2, `Could not mint a reviewer session: ${linkErr?.message ?? 'no action_link'}`);
  }

  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    fail(2, `Could not launch a browser (${err.message}). Run: npx playwright install chromium`);
  }

  try {
    const context = await browser.newContext();           // in-memory; never persisted
    const page = await context.newPage();

    await page.goto(link.properties.action_link, { waitUntil: 'domcontentloaded' });
    // The magic-link hop lands on /dashboard. Give the app time to establish the
    // session before asking it for a gated route.
    await page.waitForTimeout(4000);

    await page.goto(`${baseUrl}/onboarding`, { waitUntil: 'domcontentloaded' });
    // ⚠️ The route gate renders NOTHING while the profile read is in flight and races
    // a 10s timeout, so a short wait here photographs a blank page and calls it a
    // failure. Measured 2026-09-13: up to ~16s to first paint on this instance.
    await page.waitForTimeout(18000);

    const url = page.url();
    const body = (await page.locator('body').innerText().catch(() => '')) ?? '';

    // Assert what a FIRST-RUN USER SEES, not merely that nothing threw. A page that
    // renders an empty shell throws nothing and is exactly the failure being caught.
    const onWizard = /\/onboarding/.test(url);
    const hasWelcome = /Welcome to Forgenta|Let's set up your financial profile/i.test(body);

    line(onWizard, 'the app stayed on /onboarding', onWizard ? url : `redirected to ${url}`);
    line(hasWelcome, 'the wizard rendered its first step', hasWelcome ? 'Welcome step visible' : `body was ${body.length} chars`);

    if (!onWizard || !hasWelcome) {
      fail(
        1,
        'THE ROW SAYS FIRST-RUN AND THE SCREEN DOES NOT.\n' +
          '        This is the failure the database read-back cannot see, and the reason this\n' +
          '        check exists. Most likely a profile field the app reads as "already onboarded"\n' +
          '        is still set — `display_name` did exactly this until 2026-09-13\n' +
          '        (Onboarding.tsx:237). Add it to REVIEWER_FIRST_RUN_PROFILE.',
      );
    }
  } finally {
    // Always tear the context down, even on a failed assertion: a browser left running
    // holds a live reviewer session, which is the one thing this must not leave behind.
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  fail(2, `Unexpected failure before the result could be established: ${err?.message ?? err}`);
});
