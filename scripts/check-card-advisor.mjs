#!/usr/bin/env node
/**
 * check-card-advisor.mjs - Debt > "Which Card?" (ask 1f3217bb), PRESSED, at 390x844, signed in.
 *
 * ASSERTS: the deep link /debt?tab=use opens the panel (its testid mounts AND the "Which Card?" tab
 * reads aria-selected) - positive control; the answer line reads "Enter an amount" before typing; after
 * typing 300 it CHANGES to a sentence starting "Use <card>" (or the honest no-room line); pressing a
 * category CHANGES aria-pressed. It presses no Save, so it writes nothing.
 * DOES NOT COVER: desktop widths, whether the ranking is right (card-for-purchase.test.ts owns the
 * numbers), or the rewards editor's save.
 * USAGE: node scripts/check-card-advisor.mjs    EXITS: 0 pass . 1 a press changed nothing . 2 could not test
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
  // A dismissal earlier this month would hide the notice; this browser context is fresh, but say so.
  localStorage.removeItem('account-update-reminder-dismissed');
});
await page.goto(`${BASE}/debt?tab=use`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay').count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}
const panel = page.getByTestId('card-advisor');
try { await panel.waitFor({ state: 'visible', timeout: 20000 }); }
catch { await done(1, `the deep link did not open the panel (url ${page.url()}).`); }
const tab = page.getByRole('tab', { name: /which card/i }).first();
if ((await tab.getAttribute('aria-selected')) !== 'true') await done(1, 'the panel mounted but the Which Card? tab is not selected.');
const answer = page.getByTestId('card-advisor-answer');
const before = (await answer.textContent())?.trim() ?? '';
console.log(`before: "${before}"`);
if (!/enter an amount/i.test(before)) await done(2, `CONTROL FAILED: expected the empty prompt before typing, read "${before}".`);
await page.getByLabel('Purchase amount').fill('300');
await page.waitForTimeout(500);
const after = (await answer.textContent())?.trim() ?? '';
console.log(`after 300: "${after}"`);
// "No room" is only an honest answer when the card list agrees; otherwise it must name a card.
const rows = await panel.getByRole('button', { name: /rewards & welcome offer/i }).count();
const noRoom = await panel.getByText(/^Not enough (room|cash)$/).count();
const expectNoRoom = rows > 0 && noRoom === rows;
console.log(`cards ${rows}, without room ${noRoom}`);
if (rows === 0) await done(2, 'CONTROL FAILED: the panel lists no cards.');
if (after === before) await done(1, 'typing an amount changed nothing.');
if (expectNoRoom ? !/^None of your open cards/.test(after) : !/^Use \S/.test(after)) {
  await done(1, `the answer does not match the card list (expected ${expectNoRoom ? 'no room' : 'a card named'}).`);
}
const gas = page.getByRole('group', { name: 'Purchase category' }).getByRole('button', { name: 'Gas' });
const pressedBefore = await gas.getAttribute('aria-pressed');
await gas.click();
await page.waitForTimeout(300);
const pressedAfter = await gas.getAttribute('aria-pressed');
if (pressedBefore === pressedAfter || pressedAfter !== 'true') await done(1, `pressing Gas did not select it (${pressedBefore} -> ${pressedAfter}).`);
await page.screenshot({ path: 'test-results/card-advisor-390.png', fullPage: false });
await done(0, `PASS: deep link opened Which Card?, 300 -> "${after.slice(0, 90)}", Gas selected. Frame test-results/card-advisor-390.png`);
