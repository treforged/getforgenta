#!/usr/bin/env node
/**
 * measure-first-save.mjs - how many screens, presses and fields stand between a new user and
 * the FIRST number the app saves for them. Phone width (390x844), signed in, real dev server.
 *
 * WHY IT EXISTS. Measured 2026-09-29 (business_user_funnel): of 28 real users, 11 saved nothing
 * and all 9 of those who signed in left on their signup day. The wizard saved only on the finish
 * screen's "Continue free" (press 10 of 10), AFTER that screen had already said "Your profile is
 * set". Since 2026-09-29 it saves on "See your plan" (press 9), and this is the gate for that.
 *
 * WHAT IT DOES. Resets the @forgenta.test walk account to onboarding_completed=false and walks
 * /onboarding twice at 390x844, the SHORTEST honest path (a name, one paycheck, Continue or
 * decline on every screen). Every non-GET data-plane request is RECORDED and answered IN THE
 * BROWSER with an empty 204, so the app believes it saved and nothing reaches the database.
 *   ARM A  ends on "Continue free"   -> /dashboard. Dismisses the cookie banner, as a user would.
 *   ARM B  ends on "Explore Premium" -> /premium.   NEVER dismisses the banner, so every press
 *          must reach its control with the banner up (it covered Continue before 2026-09-29), and
 *          a control asserts the banner really was up.
 *   ARM C  answers "Me and a partner" and ends on "Set up partner sharing" -> /account, which must
 *          open on the partner section although Account was parked on Leaderboard (ask d53dbbe1).
 *          ARM A and B are its control: they must show NO partner card.
 *   ARM D  ARM A with the release-flag PATCH never answered (ask 769b6e40): "See your plan" must
 *          still reach the finish. A control asserts the PATCH really was held.
 *   ARM E  presses "Save what I have" on Expenses (ask 9d793687): the save is on that press, carries
 *          the income, and reaches the finish. ARM A asserts the link is on its Expenses screen too.
 * Each arm asserts the SCREEN: the first save is on "See your plan", "Your profile is set" is
 * shown only after it, the final button saves the wizard zero more times, and the URL lands.
 *
 * PROVEN RED 2026-09-29, each restored byte-exact by sha256: the pre-fix Onboarding.tsx (6 of 8
 * checks fail, first save "Continue free"); the fix without its `saved` guard (both no-double-save
 * checks fail, "Continue free" re-inserted 5 rows); the pre-fix ConsentBanner (ARM B cannot press
 * Continue - the banner intercepts it).
 *
 * ⚠️ PROBE ARTEFACT, NAMED: "Explore Premium" is a full page load, and the reloaded app finds the
 * profile row still false (the stubbed save never reached the database) while the device cache
 * says done, so it writes onboarding_completed_via="cache_restore". That write is printed and NOT
 * counted as a double save; with a real save the row reads true and it does not happen.
 *
 * EXIT CODES: 0 all checks pass, 1 a check failed or a walk could not finish, 2 it could not look
 * (env, sign-in, dev server, playwright, profile write matched nothing). The profile is restored
 * and read back on every path, including a failed walk.
 *
 * DOES NOT MEASURE: human time (machine time is printed but means nothing about a person), the
 * bank-link path (it presses Skip on the bank step), OAuth sign-up, or
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

// WIZARD TABLES are DERIVED from the wizard's own source, never typed here. Before 2026-09-30 any
// non-profile write counted as a wizard save, so the dashboard's leaderboard publisher - which fires
// on mount, after "Continue free" lands - failed this gate on timing alone (1 of 2 runs, same code).
const WIZARD_TABLES = [...new Set([...readFileSync('src/pages/Onboarding.tsx', 'utf8')
  .matchAll(/from\(['"]([a-z_]+)['"]\)/g)].map((m) => m[1]))].filter((t) => t !== 'profiles');
// Positive control: the wizard's data inserts must be found, or a zero below means a broken matcher.
if (!WIZARD_TABLES.includes('budget_items')) fail(2, `wizard table derivation found ${JSON.stringify(WIZARD_TABLES)}, expected budget_items among them.`);
const isWizardTable = (path) => WIZARD_TABLES.includes(path.split('?')[0]);

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

const safeJsonKeys = (t) => Object.keys(safeJson(t)).join('+');

// One walk of the wizard. `final` is the finish-screen control pressed at the end:
//   ARM A  "Continue free"   must land on /dashboard
//   ARM B  "Explore Premium" must land on /premium
// Every data-plane write is RECORDED and ANSWERED IN THE BROWSER with an empty 204, so the app
// believes it saved and NOTHING reaches the database. (Aborting instead made the save fail, and
// since 2026-09-29 a failed save keeps the user off the finish screen - correctly.)
// partner: answer "Me and a partner" on the welcome step (ask d53dbbe1). The finish screen must then
// show the partner card, and only then; ARM A is the control that it is absent for "Just me".
// hangFlag: never answer the release-flag PATCH (tour_flags), the write that hung a real walk on
// 2026-10-06 (ask 769b6e40). The wizard must still move on within its bound.
// saveEarly (ask 9d793687): on Expenses press "Save what I have" instead of walking to Goals. The save
// must land on THAT press, carry the income, and still reach the finish screen.
async function runArm(browser, arm, final, wantPath, keepFrames, leaveBanner = false, partner = false, hangFlag = false, saveEarly = false) {
  // leaveBanner: never dismiss the cookie banner, so every press must reach its control WITH the
  // banner up. Before 2026-09-29 the banner covered Continue at 390px and this arm could not finish.
  const st = { screens: 0, presses: 0, fields: 0, writes: [], log: [], savePress: null, cookie: leaveBanner };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route(`${url}/rest/v1/**`, (route) => {
    const req = route.request();
    // ARM D: the walk account already carries the release flag, so the wizard would skip the write.
    // Answer ITS read (select=tour_flags only) with an empty map so the write is really attempted.
    if (hangFlag && req.method() === 'GET' && /[?&]select=tour_flags(&|$)/.test(req.url())) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tour_flags: {} }) });
    }
    if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue();
    const path = new URL(req.url()).pathname.replace('/rest/v1/', '');
    const body = req.postData() || '';
    // The profile write carrying onboarding_completed=true IS the save; any insert into a data
    // table is part of it. Progress markers (onboarding_furthest_step) are not.
    const isSave = isWizardTable(path) || /"onboarding_completed":true/.test(body);
    // A WIZARD save is the one that must not happen twice: a data-table insert, or the profile write
    // tagged via "wizard". A "cache_restore" write is the app reconciling a device cache with the
    // profile row - and here the row still reads false because the stubbed save never reached the
    // database. It is an artefact of THIS PROBE on a full-page reload, printed rather than hidden.
    const isWizardSave = isWizardTable(path) || /"onboarding_completed_via":"wizard"/.test(body);
    const isCacheRestore = /"onboarding_completed_via":"cache_restore"/.test(body);
    st.writes.push({ method: req.method(), path, isSave, isWizardSave, isCacheRestore, fields: path.startsWith('profiles') ? safeJsonKeys(body) : '' });
    if (hangFlag && /"tour_flags"/.test(body)) { st.hung = (st.hung || 0) + 1; return undefined; }
    return route.fulfill({ status: 204, body: '' });
  });
  const page = await ctx.newPage();

  const shot = async (name) => {
    st.screens += 1;
    if (keepFrames) await page.screenshot({ path: join(OUT, `${partner ? 'partner-' : ''}${String(st.screens).padStart(2, '0')}-${name}.png`) });
    st.log.push(`screen ${st.screens}: ${name}`);
  };
  const press = async (role, re, name) => {
    // The cookie banner arrives a few seconds after load. A real user dismisses it, so it counts.
    if (!st.cookie) {
      const banner = page.getByRole('region', { name: 'Cookie consent' });
      if (await banner.isVisible().catch(() => false)) {
        st.cookie = true;
        await banner.getByRole('button', { name: /reject/i }).first().click();
        st.presses += 1;
        await page.waitForTimeout(500);
        st.log.push(`  press ${st.presses}: Reject (cookie banner)`);
      }
    }
    const el = page.getByRole(role, { name: re }).first();
    await el.waitFor({ state: 'visible', timeout: 10000 });
    const before = st.writes.length;
    await el.click();
    st.presses += 1;
    await page.waitForTimeout(1200);
    const mine = st.writes.slice(before);
    if (st.savePress === null && mine.some((w) => w.isSave)) st.savePress = name;
    st.log.push(`  press ${st.presses}: ${name}${mine.length ? '  -> ' + mine.map((w) => `${w.method} ${w.path}${w.fields ? ' {' + w.fields + '}' : ''}${w.isSave ? ' [SAVE]' : ''}`).join(', ') : ''}`);
    return mine;
  };
  const fill = async (label, value) => {
    await page.getByLabel(label, { exact: false }).first().fill(value);
    st.fields += 1;
    st.log.push(`  field ${st.fields}: ${label}`);
  };

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.includes('onboarding')) localStorage.removeItem(k); });
  // Park Account on another section, so landing on the partner field proves the link moved it.
  if (partner) await page.evaluate(() => localStorage.setItem('account-section', JSON.stringify('leaderboard')));
  await page.goto(`${BASE}/onboarding`, { waitUntil: 'domcontentloaded' });
  await page.getByText(/Welcome to Forgenta/i).first().waitFor({ timeout: 15000 });

  await shot('welcome');
  await fill('What should we call you?', 'Walk Tester');
  if (partner) await press('button', /^Me and a partner$/, 'Me and a partner');
  await press('button', /^Continue/, 'Continue');
  // Since 2026-10-06 (ask 2fb9bc69) a free account is asked to link a bank second, and sees the
  // premium pitch AFTER the save, one step before the finish.
  await shot('bank');
  await press('button', /Skip for now/, 'Skip for now');
  await page.getByText(/Income & Paycheck/i).first().waitFor({ timeout: 10000 });
  await shot('income');
  await fill('Gross per paycheck', '1875');
  await press('button', /^Continue/, 'Continue');
  const savePressName = saveEarly ? 'Save what I have' : 'See your plan';
  let bannerUp = false;
  let earlySave = [];
  if (saveEarly) {
    await shot('expenses');
    earlySave = await press('button', /Save what I have/, savePressName);
  } else {
    // Control for ARM E: the save-early link must be ON the normal walk's Expenses screen too,
    // or ARM E would be pressing something only it can see.
    for (const name of ['expenses', 'debts', 'savings']) {
      await shot(name);
      if (name === 'expenses') st.earlyLinkShown = await page.getByRole('button', { name: /Save what I have/ }).isVisible().catch(() => false);
      await press('button', /^Continue/, 'Continue');
    }
    await shot('goals');
    // Positive control for leaveBanner: the banner must really be up here, or this arm proves nothing.
    bannerUp = await page.getByRole('region', { name: 'Cookie consent' }).isVisible().catch(() => false);
    await press('button', /See your plan/, savePressName);
  }
  // The pitch's buttons only navigate; the press log shows they write nothing.
  await shot('premium-1');
  await press('button', /^No thanks$/, 'No thanks');

  // ASSERT THE SCREEN, NOT THE ROW: the finish screen must be on screen, and must be there only
  // AFTER the save - which the press log already orders.
  const finishShown = await page.getByText(/Your profile is set/i).first()
    .waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  const savedBeforeFinish = st.savePress !== null;
  const partnerCard = await page.getByTestId('finish-partner').isVisible().catch(() => false);
  // No bills entered: the finish must not print take-home as "Available after expenses".
  const noExpHint = await page.getByTestId('finish-no-expenses').isVisible().catch(() => false);
  const afterExpRow = await page.getByText(/Available after expenses/).first().isVisible().catch(() => false);
  await shot('finish');

  const finalWrites = await press(final.role, final.re, final.name);
  await page.waitForURL((u) => new URL(u).pathname === wantPath, { timeout: 8000 }).catch(() => {});
  const landed = new URL(page.url()).pathname;
  const inviteField = partner
    ? await page.getByText(/Have an invite code\?/).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false)
    : null;
  await shot('after');
  await ctx.close();

  const checks = [
    ...(leaveBanner ? [['cookie banner stayed up for the whole walk (control)', bannerUp, `visible=${bannerUp}`]] : []),
    [`first save is on "${savePressName}"`, st.savePress === savePressName, `was ${st.savePress ?? 'NONE'}`],
    ...(saveEarly ? [['the early save writes the income', earlySave.some((w) => w.path.startsWith('profiles') && /weekly_gross_income/.test(w.fields)),
      earlySave.map((w) => `${w.path} {${w.fields}}`).join('; ') || 'no writes']] : []),
    ...(saveEarly ? [['finish shows the add-bills hint, not "Available after expenses"', noExpHint && !afterExpRow, `hint=${noExpHint} afterRow=${afterExpRow}`]] : []),
    ...(!saveEarly && arm === 'ARM A' ? [['"Save what I have" shows on Expenses once income is in', st.earlyLinkShown === true, `visible=${st.earlyLinkShown}`]] : []),
    ['finish screen shown, and only after the save', finishShown && savedBeforeFinish, `shown=${finishShown} savedBefore=${savedBeforeFinish}`],
    [`"${final.name}" does not save the wizard again`, finalWrites.filter((w) => w.isWizardSave).length === 0,
      `${finalWrites.filter((w) => w.isWizardSave).length} wizard saves; ${finalWrites.filter((w) => w.isCacheRestore).length} cache_restore (probe artefact, see header)`],
    [`"${final.name}" lands on ${wantPath}`, landed === wantPath, `landed ${landed}`],
    [partner ? 'finish screen shows the partner card' : 'finish screen shows NO partner card for "Just me"',
      partnerCard === partner, `visible=${partnerCard}`],
    ...(hangFlag ? [['the release-flag PATCH really was left unanswered (control)', (st.hung || 0) >= 1, `hung=${st.hung || 0}`]] : []),
    ...(partner ? [['Account opened on the partner section ("Have an invite code?")', inviteField === true, `visible=${inviteField}`]] : []),
  ];
  return { arm, st, checks };
}

const t0 = Date.now();
const arms = [];
let browser;
let walkError = null;
try {
  await writeProfile({ onboarding_completed: false, onboarding_step: null, onboarding_furthest_step: null });
  browser = await chromium.launch();
  arms.push(await runArm(browser, 'ARM A', { role: 'button', re: /Continue free/, name: 'Continue free' }, '/dashboard', true));
  arms.push(await runArm(browser, 'ARM B', { role: 'link', re: /Explore Premium/, name: 'Explore Premium' }, '/premium', false, true));
  arms.push(await runArm(browser, 'ARM C', { role: 'button', re: /Set up partner sharing/, name: 'Set up partner sharing' }, '/account', true, false, true));
  arms.push(await runArm(browser, 'ARM D', { role: 'button', re: /Continue free/, name: 'Continue free' }, '/dashboard', false, false, false, true));
  arms.push(await runArm(browser, 'ARM E', { role: 'button', re: /Continue free/, name: 'Continue free' }, '/dashboard', true, false, false, false, true));
} catch (err) {
  // NOT fail() here: process.exit skips `finally`, and a red run then left the walk account at
  // onboarding_completed=false (measured 2026-09-29). Record it; exit after the restore.
  const lines = err.message.split('\n');
  walkError = lines.filter((l) => /intercepts|not stable|not enabled|outside/.test(l)).slice(-2).join(' | ') || lines[0];
} finally {
  if (browser) await browser.close();
  await writeProfile(original);
  const back = await readProfile();
  const ok = PROFILE_COLS.split(',').every((c) => back[c] === original[c]);
  console.log(`restore: ${ok ? 'OK' : 'MISMATCH ' + JSON.stringify(back)}`);
  if (!ok) fail(2, 'the walk account profile was NOT restored - fix it before trusting anything.');
}

if (walkError) {
  for (const a of arms) console.log(a.st.log.join('\n'));
  fail(1, `a walk did not finish: ${walkError}`);
}

let failed = 0;
for (const a of arms) {
  console.log(`\n== ${a.arm} ==`);
  console.log(a.st.log.join('\n'));
  console.log(`screens: ${a.st.screens}  presses: ${a.st.presses}  fields: ${a.st.fields}  (${a.st.presses + a.st.fields} actions)`);
  for (const [name, pass, detail] of a.checks) {
    if (!pass) failed += 1;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
  }
}
console.log(`\narms examined: ${arms.length}  checks failed: ${failed}`);
console.log(`machine time: ${((Date.now() - t0) / 1000).toFixed(1)} s (NOT a human time)   frames: ${OUT}`);
if (arms.length !== 5) fail(2, `${arms.length} of 5 arms ran - nothing complete was measured.`);
if (failed) fail(1, `${failed} check(s) failed.`);
console.log('OK - the save happens before the finish screen claims it, and neither finish button saves twice.');
