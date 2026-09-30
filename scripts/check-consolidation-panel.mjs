#!/usr/bin/env node
/**
 * check-consolidation-panel.mjs - PRESS the Debt Payoff "Would a consolidation loan help?" panel
 * at 390x844, signed in as the walk account, and assert each press CHANGES what is on screen.
 *
 * WHY (ask fee53760, 2026-09-30): the calculator shipped with unit tests and no screen. A jsdom
 * green cannot tell a panel that renders from one a user can open and read.
 *
 * WHAT IT ASSERTS, in order, each against the state before it:
 *   1. Positive control: the panel header exists and its body is ABSENT (collapsed by default).
 *   2. Pressing the header shows the body and the "Enter the APR" prompt, and NO Interest block -
 *      the panel must never price an offer the user has not typed.
 *   3. Typing an APR of 12 replaces the prompt with SEPARATE "Interest" and "Utilization" blocks.
 *   4. Changing the APR to 40 CHANGES the interest sentence (a press that changes nothing fails).
 * The panel's inputs are local state and write nothing. The ONE write is the shared sign-in step:
 * it marks the walk account's first-run dialogs as seen (tour_flags), refusing any non-@forgenta.test email.
 *
 * WHAT IT DOES NOT COVER: whether the numbers are right (consolidation-view.test.ts owns that),
 * desktop widths, light mode, contrast.
 *
 * USAGE:  node scripts/check-consolidation-panel.mjs
 * EXITS:  0 pass . 1 a press did not do what it should . 2 could not test
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const VIEW = { width: 390, height: 844 };
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

const browser = await chromium.launch();
const done = async (code, msg) => { await browser.close(); if (code) fail(code, msg); console.log(msg); process.exit(0); };
const ctx = await browser.newContext({ viewport: VIEW });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => {
  localStorage.setItem('tre_cookie_consent', JSON.stringify({
    version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
  }));
  // Start closed, and past the one-time Assumptions tutorial, whatever a previous run left.
  localStorage.setItem('tre:debtpayoff:activeTab', JSON.stringify('cards'));
});
// /forecast is a redirect to this tab (src/App.tsx), so go to the tab itself.
await page.goto(`${BASE}/debt?tab=cards`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);

const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';
for (let i = 0; i < 6 && (await page.locator(OVERLAY).count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const still = page.locator(OVERLAY);
  if (await still.count()) { await still.first().dispatchEvent('click'); await page.waitForTimeout(600); }
}
if (await page.locator(OVERLAY).count()) await done(2, 'a modal overlay is still up; it would intercept the presses.');
const header = page.getByRole('button', { name: 'Would a consolidation loan help?' });
if (!(await header.count())) {
  await done(2, `no consolidation panel on ${page.url()} - does the walk account carry card debt?`);
}
const body = page.locator('#consolidation-panel-body');
if (await body.count()) await done(2, 'the panel is open before the press, so a pass would prove nothing.');

await header.first().click();
await page.waitForTimeout(400);
if (!(await body.isVisible())) await done(1, 'pressing the header did not show the panel body.');
if (!(await body.getByText('Enter the APR from your loan offer to compare.').count())) {
  await done(1, 'the empty-APR prompt is missing after opening.');
}
if (await body.getByText('Interest', { exact: true }).count()) {
  await done(1, 'an Interest block rendered before any APR was typed - the panel invented a rate.');
}

const apr = body.getByLabel('Loan APR (%)');
await apr.fill('12');
await page.waitForTimeout(400);
const interestCap = await body.getByText('Interest', { exact: true }).count();
const utilCap = await body.getByText('Utilization', { exact: true }).count();
if (interestCap !== 1 || utilCap !== 1) {
  await done(1, `after typing an APR: Interest blocks ${interestCap}, Utilization blocks ${utilCap} (want 1 and 1).`);
}
if (await body.getByText('Enter the APR from your loan offer to compare.').count()) {
  await done(1, 'the prompt is still showing after an APR was typed.');
}
const at12 = await body.innerText();

await apr.fill('40');
await page.waitForTimeout(400);
const at40 = await body.innerText();
if (at12 === at40) await done(1, 'changing the APR from 12 to 40 changed nothing on screen.');

const pick1 = (t) => t.split(String.fromCharCode(10)).find((l) => /^The loan (saves|costs) /.test(l)) || '';
console.log(`  12%: ${pick1(at12) || '(no verdict line)'}`);
console.log(`  40%: ${pick1(at40) || '(no verdict line)'}`);
await apr.fill('12');
await page.waitForTimeout(400);
await page.locator('section', { has: header }).screenshot({ path: 'test-results/consolidation-panel-390.png' });
await done(0, 'PASS: collapsed by default, opens on press, refuses to price without an APR, two separate blocks, and the APR moves the answer.');
