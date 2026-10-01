#!/usr/bin/env node
/**
 * check-update-reminder.mjs - the start-of-month "accounts need updating by hand" notice, PRESSED.
 *
 * WHY: Tre, 2026-10-01 (asks 7852f2f7, 3c888cff): notices on the homepage "need to be clickable to take
 * them to the page that would solve whatever is on it", and cards with a future start date must not be
 * listed. A jsdom press proves the Link's href; only a real browser proves the Dashboard then SHOWS the
 * Accounts panel, because the panel switch is the Dashboard reading ?tab= and stripping it.
 *
 * ASSERTS (390x844, signed in): the notice renders (positive control); the Accounts tab is NOT selected
 * before the press; after pressing the notice body the Accounts tab IS selected. Prints the names listed.
 * Exits 2 outside the 1st-7th of the month, when the notice is designed not to render.
 * DOES NOT COVER: desktop widths, which names are listed (the unit test owns that), other notices.
 * USAGE: node scripts/check-update-reminder.mjs    EXITS: 0 pass . 1 the press did not switch . 2 could not test
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
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay').count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

const day = new Date().getDate();
if (day > 7) await done(2, `it is day ${day}: the notice only shows on the 1st-7th, so there is nothing to press.`);
const notice = page.getByText(/needs? updating by hand/i).first();
try { await notice.waitFor({ state: 'visible', timeout: 25000 }); }
catch { await done(2, 'CONTROL FAILED: the notice never rendered (walk account has no unlinked account, or it was dismissed this month).'); }
const accountsTab = page.getByRole('tab', { name: /^accounts$/i }).first();
if (await accountsTab.count() === 0) await done(2, 'could not find the Accounts tab by role.');
const selected = async () => (await accountsTab.getAttribute('aria-selected')) === 'true';
const listed = await page.locator('a[href*="panel=balances"] strong').first().textContent().catch(() => '(none)');
console.log(`notice lists: ${listed}`);
if (await selected()) {
  await page.getByRole('tab', { name: /^overview$/i }).first().click();
  await page.waitForTimeout(500);
}
if (await selected()) await done(2, 'could not put the Dashboard on Overview before the press.');
await notice.click();
await page.waitForTimeout(1500);
if (!(await selected())) await done(1, `pressing the notice left the Accounts tab unselected (url ${page.url()}).`);
await done(0, `PASS: pressing the notice switched the Dashboard to Accounts (url ${page.url()}).`);
