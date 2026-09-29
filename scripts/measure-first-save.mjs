#!/usr/bin/env node
/**
 * measure-first-save.mjs - how many screens, presses and fields stand between a new user and
 * the FIRST number the app saves for them. Phone width (390x844), signed in, real dev server.
 *
 * WHY IT EXISTS. Measured 2026-09-29 (business_user_funnel): of 28 real users, 11 saved nothing
 * and 9 of those 9 who signed in left on their signup day. The wizard holds every answer in
 * memory and writes only when the LAST screen's "Continue free" is pressed, so a user who leaves
 * on screen 5 of 9 has nothing saved. This script turns that reading of the code into a count.
 *
 * WHAT IT DOES. Resets the @forgenta.test walk account to onboarding_completed=false, opens
 * /onboarding in a fresh context, and walks the SHORTEST honest path: a name, one paycheck
 * amount, then Continue / decline on every screen. Every non-GET request the page makes to the
 * Supabase data plane is RECORDED and ABORTED, so the walk account's data is never changed and
 * the list of attempted writes shows exactly when the app first tries to save anything.
 *
 * ⚠️ THE WRITES ARE ABORTED, SO THE FINAL SAVE FAILS ON PURPOSE. The count stops at the press
 * that attempts it. A toast about a failed save after that press is this script, not the app.
 *
 * EXIT CODES: 0 measured, 1 the walk could not reach the save press (a screen changed shape),
 * 2 it could not look (env, sign-in, dev server, playwright, profile write matched nothing).
 *
 * DOES NOT MEASURE: human time (machine time is printed but means nothing about a person), the
 * bank-link path (the walk account is free, so it sees the premium screens), OAuth sign-up, or
 * whether the screens are clear. Frames are saved so a person can judge the last one.
 *
 * USAGE: node scripts/measure-first-save.mjs [outDir]
 */

import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:8080';
const OUT = process.argv[2] || 'test-results/first-save';

function fail(code, msg) {
  console.error(`FAIL(${code}): ${msg}`);
  process.exit(code);
}

const pick = (s, k) => (s.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();

let env, creds;
try { env = readFileSync('.env.local', 'utf8'); } catch { fail(2, '.env.local is missing.'); }
try { creds = readFileSync('.env.deck-walk.local', 'utf8'); } catch { fail(2, '.env.deck-walk.local is missing.'); }

const url = pick(env, 'VITE_SUPABASE_URL');
const anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
const email = pick(creds, 'REACH_TEST_EMAIL');
const password = pick(creds, 'REACH_TEST_PASSWORD');
if (!url || !anon || !email || !password) fail(2, 'missing Supabase URL/key or walk credentials.');
if (!/@forgenta[.]test$/.test(email)) fail(2, 'refusing: this script only signs in @forgenta.test accounts.');

const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}.`);
const uid = session.user.id;

try {
  const ping = await fetch(BASE, { redirect: 'manual' });
  if (ping.status >= 500) fail(2, `${BASE} answered ${ping.status}.`);
} catch (err) { fail(2, `${BASE} is not serving (${err.message}).`); }

let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'could not load @playwright/test.'); }

const restHeaders = {
  apikey: anon, Authorization: `Bearer ${session.access_token}`,
  'Content-Type': 'application/json', Prefer: 'return=representation',
};
const safeJson = (t) => { try { const v = JSON.parse(t); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const PROFILE_COLS = 'display_name,onboarding_completed,onboarding_step,onboarding_furthest_step';
async function readProfile() {
  const r = await fetch(`${url}/rest/v1/profiles?select=${PROFILE_COLS}&user_id=eq.${uid}`, { headers: restHeaders });
  const rows = r.ok ? await r.json() : [];
  if (rows.length !== 1) fail(2, `profile read matched ${rows.length} rows, expected 1.`);
  return rows[0];
}
async function writeProfile(patch) {
  const r = await fetch(`${url}/rest/v1/profiles?user_id=eq.${uid}`, {
    method: 'PATCH', headers: restHeaders, body: JSON.stringify(patch),
  });
  const rows = r.ok ? await r.json() : [];
  if (!rows.length) fail(2, `profile write matched no row (${r.status}).`);
}

const original = await readProfile();
mkdirSync(OUT, { recursive: true });

let screens = 0, presses = 0, fields = 0;
const writes = [];          // every data-plane write the page attempted, in order
const log = [];
let savePressAt = null;     // press number that first produced a write to a data table
let browser;

async function shot(page, name) {
  screens += 1;
  await page.screenshot({ path: join(OUT, `${String(screens).padStart(2, '0')}-${name}.png`) });
  log.push(`screen ${screens}: ${name}`);
}

let cookieDismissed = false;
async function press(page, re, name) {
  // The cookie banner arrives a few seconds after load and covers the lower third of a phone
  // screen, including Continue from the expenses screen on (measured 2026-09-29). A real user has
  // to dismiss it too, so that press is counted. "Reject" sets no analytics cookie.
  if (!cookieDismissed) {
    const banner = page.getByRole('region', { name: 'Cookie consent' });
    if (await banner.isVisible().catch(() => false)) {
      cookieDismissed = true;
      await banner.getByRole('button', { name: /reject/i }).first().click();
      presses += 1;
      await page.waitForTimeout(500);
      log.push(`  press ${presses}: Reject (cookie banner, covers Continue at 390px)`);
    }
  }
  const btn = page.getByRole('button', { name: re }).first();
  await btn.waitFor({ state: 'visible', timeout: 10000 });
  const before = writes.length;
  await btn.click();
  presses += 1;
  await page.waitForTimeout(900);
  const newWrites = writes.slice(before).filter((w) => w.isSave);
  if (savePressAt === null && newWrites.length) savePressAt = presses;
  log.push(`  press ${presses}: ${name}${writes.length > before ? `  -> writes: ${writes.slice(before).map((w) => `${w.method} ${w.path}${w.fields ? ' {' + w.fields + '}' : ''}${w.isSave ? ' [SAVE]' : ''}`).join(', ')}` : ''}`);
}

async function fill(page, label, value) {
  await page.getByLabel(label, { exact: false }).first().fill(value);
  fields += 1;
  log.push(`  field ${fields}: ${label}`);
}

const t0 = Date.now();
try {
  await writeProfile({ onboarding_completed: false, onboarding_step: null, onboarding_furthest_step: null });
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route(`${url}/rest/v1/**`, (route) => {
    const req = route.request();
    if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue();
    // A POST to /rpc/ can be a read; it is recorded either way and continued only if it is one.
    const path = new URL(req.url()).pathname.replace('/rest/v1/', '');
    const body = req.postData() || '';
    // The wizard's save writes the profile FIRST and throws if that fails, so with writes aborted
    // the data inserts behind it never fire. The profile write that carries
    // onboarding_completed=true IS the save, and it is marked so.
    const isSave = !path.startsWith('profiles') || /"onboarding_completed":true/.test(body);
    writes.push({ method: req.method(), path, isSave, fields: path.startsWith('profiles') ? Object.keys(safeJson(body)).join('+') : '' });
    return route.abort();
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.includes('onboarding')) localStorage.removeItem(k); });
  await page.goto(`${BASE}/onboarding`, { waitUntil: 'domcontentloaded' });
  await page.getByText(/Welcome to Forgenta/i).first().waitFor({ timeout: 15000 });

  await shot(page, 'welcome');
  await fill(page, 'What should we call you?', 'Walk Tester');
  await press(page, /^Continue/, 'Continue');

  await shot(page, 'premium-1');
  await press(page, /^No thanks$/, 'No thanks');
  await shot(page, 'premium-2');
  await press(page, /stay on free/i, "I'll stay on free");

  await page.getByText(/Income & Paycheck/i).first().waitFor({ timeout: 10000 });
  await shot(page, 'income');
  await fill(page, 'Gross per paycheck', '1875');
  await press(page, /^Continue/, 'Continue');

  for (const name of ['expenses', 'debts', 'savings']) {
    await shot(page, name);
    await press(page, /^Continue/, 'Continue');
  }
  await shot(page, 'goals');
  await press(page, /See your plan/, 'See your plan');

  await shot(page, 'finish');
  await press(page, /Continue free/, 'Continue free');
  await shot(page, 'after-save');
  await ctx.close();
} catch (err) {
  console.log(log.join('\n'));
  const lines = err.message.split('\n');
  const why = lines.filter((l) => /intercepts|not stable|not enabled|outside/.test(l)).slice(-2).join(' | ');
  fail(1, `the walk did not reach the save press: ${why || lines[0]}`);
} finally {
  if (browser) await browser.close();
  await writeProfile(original);
  const back = await readProfile();
  const ok = PROFILE_COLS.split(',').every((c) => back[c] === original[c]);
  console.log(`restore: ${ok ? 'OK' : 'MISMATCH ' + JSON.stringify(back)}`);
  if (!ok) fail(2, 'the walk account profile was NOT restored - fix it before trusting anything.');
}

console.log(log.join('\n'));
console.log('');
console.log(`screens shown before the save press: ${screens - 1}`);
console.log(`presses: ${presses}   fields filled: ${fields}   (${presses + fields} actions)`);
console.log(`first SAVE attempt on press: ${savePressAt ?? 'NONE'} of ${presses}`);
console.log(`non-save writes (progress markers): ${writes.filter((w) => !w.isSave).length}`);
console.log(`all attempted writes (aborted): ${writes.length}`);
console.log(`machine time: ${((Date.now() - t0) / 1000).toFixed(1)} s (NOT a human time)`);
console.log(`frames: ${OUT}`);
if (savePressAt === null) fail(1, 'no press ever attempted a data write - the save moved or the walk is blind.');
