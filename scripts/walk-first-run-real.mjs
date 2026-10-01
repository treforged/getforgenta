#!/usr/bin/env node
/**
 * walk-first-run-real.mjs - the onboarding wizard with REAL writes, on a brand-new account.
 *
 * WHY IT EXISTS. check:first-save answers every write in the browser, so it proves the wizard
 * SENDS its save at the right press - never that the database ACCEPTS it, and never that the app
 * leaves the row alone afterwards. On 2026-09-13 a reset read back correctly and the app undid it
 * a second later; a check that finishes before the app does cannot see that. This one lets every
 * write through, then reads the profile from OUTSIDE the browser, twice, after the app has run.
 *
 * WHAT IT ASSERTS (phone, 390x844, signed in as a throwaway @forgenta.test user with no data):
 *   - the wizard renders for a fresh account (control: a fresh account must reach first run)
 *   - "See your plan" reaches "Your profile is set"
 *   - "Continue free" lands on /dashboard
 *   - the profile reads onboarding_furthest_step='finish' and onboarding_completed=true,
 *     both straight after the walk and again 10 s later (the app must not undo it)
 *   - the wizard's income really saved: weekly_gross_income > 0 on the row
 *
 * CREDENTIALS come from FIRST_RUN_EMAIL / FIRST_RUN_PASSWORD and are never stored. The account is
 * created in SQL for the run and DELETED after it (ask 813d6b21 pattern); this script never creates
 * or deletes users itself.
 *
 * EXITS: 0 all checks pass . 1 a check failed . 2 could not test (env, sign-in, server, not fresh)
 * DOES NOT COVER: OAuth sign-up, the bank-link path, desktop widths, or whether the screens are clear.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:8080';
const OUT = process.argv[2] || 'test-results/first-run-real';
const fail = (code, msg) => { console.error(`FAIL(${code}): ${msg}`); process.exit(code); };
const pick = (s, k) => (s.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();

let env;
try { env = readFileSync('.env.local', 'utf8'); } catch { fail(2, '.env.local is missing.'); }
const url = pick(env, 'VITE_SUPABASE_URL');
const anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
const email = process.env.FIRST_RUN_EMAIL;
const password = process.env.FIRST_RUN_PASSWORD;
if (!url || !anon || !email || !password) fail(2, 'missing Supabase URL/key or FIRST_RUN_EMAIL / FIRST_RUN_PASSWORD.');
if (!/@forgenta[.]test$/.test(email)) fail(2, `refusing to script a sign-in for "${email}".`);

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

const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}` };
const COLS = 'display_name,onboarding_completed,onboarding_completed_via,onboarding_furthest_step,weekly_gross_income';
async function readProfile() {
  const r = await fetch(`${url}/rest/v1/profiles?select=${COLS}&user_id=eq.${uid}`, { headers: rest });
  const rows = r.ok ? await r.json() : [];
  if (rows.length !== 1) fail(2, `profile read matched ${rows.length} rows (${r.status}), expected 1.`);
  return rows[0];
}

// Control: the account must really be fresh, or "it reached finish" proves nothing about first run.
const before = await readProfile();
console.log(`before: ${JSON.stringify(before)}`);
if (before.onboarding_completed || before.display_name) fail(2, 'account is not fresh (onboarding done or a display_name is set).');

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const writes = [];
page.on('response', (r) => {
  const q = r.request();
  if (q.url().startsWith(`${url}/rest/v1/`) && q.method() !== 'GET' && q.method() !== 'HEAD') {
    writes.push(`${q.method()} ${new URL(q.url()).pathname.replace('/rest/v1/', '')} ${r.status()}`);
  }
});
let n = 0;
const shot = (name) => page.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) });
const press = async (re) => {
  const banner = page.getByRole('region', { name: 'Cookie consent' });
  if (await banner.isVisible().catch(() => false)) await banner.getByRole('button', { name: /reject/i }).first().click();
  const el = page.getByRole('button', { name: re }).first();
  await el.waitFor({ state: 'visible', timeout: 10000 });
  await el.click();
  await page.waitForTimeout(1500);
};

const checks = [];
let landed = '';
let wizardShown = false;
let finishShown = false;
try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
  await page.goto(`${BASE}/onboarding`, { waitUntil: 'domcontentloaded' });
  wizardShown = await page.getByText(/Welcome to Forgenta/i).first()
    .waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  if (!wizardShown) { await shot('no-wizard'); throw new Error(`wizard never rendered; url ${page.url()}`); }
  await shot('welcome');
  await page.getByLabel('What should we call you?', { exact: false }).first().fill('First Run');
  await press(/^Continue/);
  await press(/^No thanks$/);
  await press(/stay on free/i);
  await page.getByText(/Income & Paycheck/i).first().waitFor({ timeout: 10000 });
  await page.getByLabel('Gross per paycheck', { exact: false }).first().fill('1500');
  await shot('income');
  await press(/^Continue/);
  for (const name of ['expenses', 'debts', 'savings']) { await shot(name); await press(/^Continue/); }
  await shot('goals');
  await press(/See your plan/);
  finishShown = await page.getByText(/Your profile is set/i).first()
    .waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  await shot('finish');
  await press(/Continue free/i);
  await page.waitForURL((u) => new URL(u).pathname === '/dashboard', { timeout: 10000 }).catch(() => {});
  landed = new URL(page.url()).pathname;
  await page.waitForTimeout(3000);
  await shot('dashboard');
} catch (err) {
  console.error(`walk stopped: ${err.message}`);
  await shot('stopped').catch(() => {});
}

// Read the row from OUTSIDE the browser while the app is still open on the dashboard, then again
// 10 s later: the thing that undoes a first-run write is the app, not the write.
const after1 = await readProfile();
await page.waitForTimeout(10000);
const after2 = await readProfile();
await browser.close();

for (const w of writes) console.log(`  write: ${w}`);
console.log(`after:     ${JSON.stringify(after1)}`);
console.log(`after+10s: ${JSON.stringify(after2)}`);
checks.push(
  ['wizard rendered for a fresh account (control)', wizardShown, `shown=${wizardShown}`],
  ['"See your plan" reached "Your profile is set"', finishShown, `shown=${finishShown}`],
  ['"Continue free" landed on /dashboard', landed === '/dashboard', `landed ${landed || 'nowhere'}`],
  ['no write was refused', writes.every((w) => !/ [45]\d\d$/.test(w)), `${writes.filter((w) => / [45]\d\d$/.test(w)).length} of ${writes.length} refused`],
  ["onboarding_furthest_step = 'finish' after the walk", after1.onboarding_furthest_step === 'finish', `${after1.onboarding_furthest_step}`],
  ['onboarding_completed = true after the walk', after1.onboarding_completed === true, `${after1.onboarding_completed} via ${after1.onboarding_completed_via}`],
  ['both still true 10 s later (the app did not undo them)', after2.onboarding_furthest_step === 'finish' && after2.onboarding_completed === true,
    `${after2.onboarding_furthest_step} / ${after2.onboarding_completed}`],
  ['the income saved (weekly_gross_income > 0)', Number(after2.weekly_gross_income) > 0, `${after2.weekly_gross_income}`],
);
let failed = 0;
for (const [name, ok, detail] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); if (!ok) failed++; }
console.log(`${checks.length - failed}/${checks.length} checks pass. Frames: ${OUT}`);
process.exit(failed ? 1 : 0);
