#!/usr/bin/env node
/**
 * check-save-timeouts.mjs - a save that NEVER ANSWERS must end in a message, not a spinner.
 * Phone width (390x844), signed in as the @forgenta.test walk account, real dev server.
 *
 * WHY IT EXISTS. supabase-js has no timeout. On 2026-10-06 a real first-run walk froze on "See your
 * plan" for good: the write had landed, its response never came back (ask 769b6e40). Sam then asked
 * for every awaited write on the first-run path to be bounded (ask 61c40702). check:first-save ARM D
 * covers the release flag; this covers the rest. Every write is answered IN THE BROWSER (204) or held
 * open on purpose - nothing reaches the database except the walk account's restore.
 *
 *   HOLD-SAVE   the profile save on "See your plan" is held: the user must get the timeout message,
 *               stay on Goals (the finish screen never claims a save), and get the button back.
 *   HOLD-INSERT Rent is entered and the budget_items insert is held: the save must still finish,
 *               and say it could not CONFIRM monthly expenses (it may have landed, so never "failed").
 *   HOLD-SKIP   "Skip setup" with its profile write held: the user must get "We couldn't save that"
 *               and stay on /onboarding.
 * Each arm has a control that the write really was held, or its pass would prove nothing.
 *   RELOAD      (ask b3f0bbcc) reload on Expenses: the wizard must reopen ON Expenses with the income
 *               kept. It used to keep the answers and reopen on Welcome.
 *
 * PROVEN RED 2026-10-06 against the unbounded writes (boundedWrite returning the raw query).
 * Takes ~1 min: each hold waits out SAVE_WAIT_MS (15 s).
 * DOES NOT COVER: the sign-in path's trusted-device read (needs an MFA account; unit-level only),
 * the auth calls themselves, or a response that arrives slowly but inside the bound.
 * EXIT CODES: 0 pass, 1 a check failed, 2 could not look. The profile is restored on every path.
 */

import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:8080';
const OUT = 'test-results/save-timeouts';
const TIMEOUT_TEXT = /Saving is taking too long/i;

function fail(code, msg) { console.error(`FAIL(${code}): ${msg}`); process.exit(code); }
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
  method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
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

const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const COLS = 'display_name,onboarding_completed,onboarding_step,onboarding_furthest_step';
async function readProfile() {
  const r = await fetch(`${url}/rest/v1/profiles?select=${COLS}&user_id=eq.${uid}`, { headers: rest });
  const rows = r.ok ? await r.json() : [];
  if (rows.length !== 1) fail(2, `profile read matched ${rows.length} rows, expected 1.`);
  return rows[0];
}
async function writeProfile(patch) {
  const r = await fetch(`${url}/rest/v1/profiles?user_id=eq.${uid}`, { method: 'PATCH', headers: rest, body: JSON.stringify(patch) });
  const rows = r.ok ? await r.json() : [];
  if (!rows.length) fail(2, `profile write matched no row (${r.status}).`);
}

// One arm. `hold(path, body)` says which write to leave unanswered.
async function runArm(browser, name, hold, drive) {
  const st = { held: 0 };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route(`${url}/rest/v1/**`, (route) => {
    const req = route.request();
    if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue();
    const path = new URL(req.url()).pathname.replace('/rest/v1/', '');
    if (hold(path, req.postData() || '')) { st.held += 1; return undefined; }
    return route.fulfill({ status: 204, body: '' });
  });
  const page = await ctx.newPage();
  const press = async (re) => {
    const banner = page.getByRole('region', { name: 'Cookie consent' });
    if (await banner.isVisible().catch(() => false)) await banner.getByRole('button', { name: /reject/i }).first().click();
    const el = page.getByRole('button', { name: re }).first();
    await el.waitFor({ state: 'visible', timeout: 10000 });
    await el.click();
    await page.waitForTimeout(800);
  };
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.includes('onboarding')) localStorage.removeItem(k); });
  await page.goto(`${BASE}/onboarding`, { waitUntil: 'domcontentloaded' });
  await page.getByText(/Welcome to Forgenta/i).first().waitFor({ timeout: 15000 });
  const checks = await drive(page, press, st);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  await ctx.close();
  const control = st.noHold ? [] : [[`the write really was held (control)`, st.held >= 1, `held=${st.held}`]];
  return { name, checks: [...control, ...checks] };
}

// Welcome -> Goals, optionally typing Rent on the expenses step.
async function walkToGoals(page, press, rent) {
  await page.getByLabel('What should we call you?', { exact: false }).first().fill('Walk Tester');
  await press(/^Continue/);
  await press(/Skip for now/);
  await page.getByText(/Income & Paycheck/i).first().waitFor({ timeout: 10000 });
  await page.getByLabel('Gross per paycheck', { exact: false }).first().fill('1875');
  await press(/^Continue/);
  if (rent) await page.getByLabel('Rent / Mortgage', { exact: false }).first().fill('1200');
  for (let i = 0; i < 3; i++) await press(/^Continue/);
}
const seen = (page, re, ms) => page.getByText(re).first().waitFor({ timeout: ms }).then(() => true).catch(() => false);

mkdirSync(OUT, { recursive: true });
const original = await readProfile();
const arms = [];
let browser;
let walkError = null;
try {
  await writeProfile({ onboarding_completed: false, onboarding_step: null, onboarding_furthest_step: null });
  browser = await chromium.launch();

  arms.push(await runArm(browser, 'HOLD-SAVE',
    (path, body) => path.startsWith('profiles') && /"onboarding_completed":true/.test(body),
    async (page, press) => {
      await walkToGoals(page, press, false);
      await press(/See your plan/);
      const msg = await seen(page, TIMEOUT_TEXT, 25000);
      const finish = await page.getByText(/Your profile is set/i).first().isVisible().catch(() => false);
      const usable = await page.getByRole('button', { name: /See your plan/ }).first().isEnabled().catch(() => false);
      return [
        ['the timeout message is shown', msg, `shown=${msg}`],
        ['the finish screen does NOT claim the save', !finish, `finish=${finish}`],
        ['"See your plan" is usable again for a retry', usable, `enabled=${usable}`],
      ];
    }));

  arms.push(await runArm(browser, 'HOLD-INSERT',
    (path) => path.startsWith('budget_items'),
    async (page, press) => {
      await walkToGoals(page, press, true);
      await press(/See your plan/);
      const warn = await seen(page, /couldn't confirm: monthly expenses/i, 25000);
      const moved = await seen(page, /Get more done with Forgenta Premium|Your profile is set/i, 5000);
      return [
        ['the save finishes and says it could not CONFIRM monthly expenses', warn, `shown=${warn}`],
        ['the user moves on past Goals', moved, `moved=${moved}`],
      ];
    }));

  arms.push(await runArm(browser, 'HOLD-SKIP',
    (path, body) => path.startsWith('profiles') && /"onboarding_completed_via":"skipped"/.test(body),
    async (page) => {
      await page.getByRole('button', { name: /Skip setup/i }).first().click();
      const msg = await seen(page, /We couldn't save that/i, 25000);
      const stayed = new URL(page.url()).pathname === '/onboarding';
      return [
        ['"We couldn\'t save that" is shown', msg, `shown=${msg}`],
        ['the user stays on /onboarding', stayed, `path=${new URL(page.url()).pathname}`],
      ];
    }));

  // RELOAD (ask b3f0bbcc): not a held write - a reload on Expenses must reopen ON Expenses with the
  // income still there. The wizard used to keep the answers and reopen on Welcome. No write is held,
  // so this arm's control is that the walk really reached Expenses before the reload.
  arms.push(await runArm(browser, 'RELOAD', () => false, async (page, press, st) => {
    st.noHold = true;
    await page.getByLabel('What should we call you?', { exact: false }).first().fill('Walk Tester');
    await press(/^Continue/);
    await press(/Skip for now/);
    await page.getByText(/Income & Paycheck/i).first().waitFor({ timeout: 10000 });
    await page.getByLabel('Gross per paycheck', { exact: false }).first().fill('1875');
    await press(/^Continue/);
    const reachedExpenses = await seen(page, /Monthly Expenses/, 8000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const onExpenses = await seen(page, /Monthly Expenses/, 15000);
    const onWelcome = await page.getByText(/Welcome to Forgenta/i).first().isVisible().catch(() => false);
    // Back from Expenses is Income. On a wrong reopen there is no Back to press, so read nothing.
    if (onExpenses && !onWelcome) await press(/^Back/);
    const income = onExpenses && !onWelcome
      ? await page.getByLabel('Gross per paycheck', { exact: false }).first().inputValue().catch(() => '')
      : '(not reached)';
    return [
      ['reached Expenses before the reload (control)', reachedExpenses, `reached=${reachedExpenses}`],
      ['the reload reopens on Expenses, not Welcome', onExpenses && !onWelcome, `expenses=${onExpenses} welcome=${onWelcome}`],
      ['the income typed before the reload is still there', income === '1875', `income="${income}"`],
    ];
  }));
} catch (err) {
  walkError = err.message.split('\n')[0];
} finally {
  if (browser) await browser.close();
  await writeProfile(original);
  const back = await readProfile();
  console.log(`restore: ${back.onboarding_completed === original.onboarding_completed ? 'OK' : 'MISMATCH'}`);
}
if (walkError) fail(1, `an arm did not finish: ${walkError}`);

let failed = 0;
for (const a of arms) {
  console.log(`\n== ${a.name} ==`);
  for (const [label, ok, detail] of a.checks) {
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${detail})`);
  }
}
console.log(`\narms examined: ${arms.length}  checks failed: ${failed}   frames: ${OUT}`);
if (arms.length !== 4) fail(2, `${arms.length} of 4 arms ran.`);
if (failed) fail(1, `${failed} check(s) failed.`);
console.log('OK - every held write ended in a message, never a spinner.');
