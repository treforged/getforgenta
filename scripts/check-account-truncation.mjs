#!/usr/bin/env node
/**
 * check-account-truncation.mjs - an account's NAME and META line must never be truncated on a
 * phone, at ordinary text size or at the larger sizes the accessibility slider sets.
 *
 * WHY THIS EXISTS: Tre reported this THREE TIMES (2026-09-02, 2026-09-16, and 2026-09-17 with
 * three screenshots at three text sizes): *"longer text truncates no matter the size though so
 * we need a solution."* Both earlier fixes added `line-clamp-2 break-words`, which only decides
 * what to do once the column is ALREADY too narrow - so the name still arrived as "Robinho
 * od...", broken mid-word as well as cut off.
 *
 * NO EXISTING GATE COULD SEE IT. jsdom reports every box as 0x0, so the 4,740-test suite is
 * structurally incapable of measuring a clamp. Every class involved is individually correct;
 * the defect is the ARITHMETIC of them together, which only a real browser has.
 *
 * WHAT IT MEASURES: for every account name and meta line, scrollHeight > clientHeight (a
 * line-clamp cutting text off) or scrollWidth > clientWidth (an ellipsis). Measured, never
 * read off a class list.
 *
 * THE CONTROLS: the selector matches the BROKEN and the FIXED markup alike, so it cannot
 * report its own blindness as a pass; a run matching zero names exits 2 naming the selector;
 * and a run examining zero elements exits 2, because "0 truncated" and "0 looked at" must not
 * read the same.
 *
 * WHAT IT DOES NOT COVER: colour, spacing, contrast, any route but /accounts, desktop widths,
 * text sizes above 150%, and whether the name is the RIGHT name.
 *
 * USAGE:  node scripts/check-account-truncation.mjs  (needs the dev server + .env.deck-walk.local)
 * EXITS:  0 pass . 1 truncated text found . 2 could not test
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));

const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';
async function clearOverlays() {
  for (let i = 0; i < 6; i += 1) {
    if (!(await page.locator(OVERLAY).count())) return true;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const still = page.locator(OVERLAY);
    if (await still.count()) { await still.first().dispatchEvent('click'); await page.waitForTimeout(600); }
  }
  return !(await page.locator(OVERLAY).count());
}

/**
 * SELECTED ON `font-semibold`, WHICH IS TRUE OF THE BROKEN AND THE FIXED STATE ALIKE.
 * Selecting on the absence of `line-clamp-2` would find NOTHING on the day the defect is real,
 * print "CONTROL FAILED" and exit 2 - and an exit-2 tooling fault gets re-run then ignored,
 * where an exit-1 finding gets fixed. This repo has shipped that mistake twice.
 */
const NAME_SEL = '.card-forged p.font-semibold';
const META_SEL = '.card-forged p.text-muted-foreground';

/** Truncation is MEASURED, never inferred from a class: a clamped box overflows its own height. */
const MEASURE = (sel) => {
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (!el.textContent.trim()) continue;
    out.push({
      text: el.textContent.trim().slice(0, 40),
      clippedVertically: el.scrollHeight - el.clientHeight > 1,
      clippedHorizontally: el.scrollWidth - el.clientWidth > 1,
      width: Math.round(r.width),
    });
  }
  return out;
};

let examined = 0;
const findings = [];

for (const scale of [100, 150]) {
  await page.goto(BASE + '/accounts', { waitUntil: 'domcontentloaded' });
  /**
   * WAIT FOR AUTH TO HYDRATE, NOT FOR A STOPWATCH. Going straight in caught the app before
   * `AuthContext` had read the token back, so the page rendered its signed-out state and the
   * selector correctly matched nothing - which the control then reported as an instrument
   * failure. That was the harness being too quick, not the app being broken.
   */
  let ready = false;
  for (let i = 0; i < 20 && !ready; i += 1) {
    await page.waitForTimeout(700);
    ready = await page.evaluate(() =>
      !/session has ended|sign in again/i.test(document.body.innerText)
      && document.querySelectorAll('.card-forged p').length > 0);
  }
  if (!ready) {
    console.error('FAIL: /accounts never reached a signed-in state with rendered rows.');
    console.error('Body was: ' + (await page.evaluate(() => document.body.innerText.slice(0, 200))));
    process.exit(2);
  }
  await clearOverlays();
  await page.evaluate((s) => { document.documentElement.style.fontSize = s + '%'; }, scale);
  await page.waitForTimeout(900);

  const names = await page.evaluate(MEASURE, NAME_SEL);
  const metas = await page.evaluate(MEASURE, META_SEL);
  examined += names.length + metas.length;

  // POSITIVE CONTROL: a zero here is a fact about the SELECTOR, not about the app.
  if (names.length === 0) {
    console.error('CONTROL FAILED: no account names matched "' + NAME_SEL + '" at ' + scale + '%.');
    console.error('The instrument cannot see the thing it measures; this is not a pass.');
    process.exit(2);
  }

  for (const n of [...names, ...metas]) {
    if (n.clippedVertically || n.clippedHorizontally) {
      findings.push(scale + '%  "' + n.text + '"  w=' + n.width + 'px  '
        + (n.clippedVertically ? 'CLIPPED-VERTICALLY ' : '')
        + (n.clippedHorizontally ? 'CLIPPED-HORIZONTALLY' : ''));
    }
  }
  console.log('  ' + scale + '%: ' + names.length + ' names, ' + metas.length + ' meta lines examined');
}

await browser.close();

if (examined === 0) {
  console.error('FAIL: examined 0 elements - "0 truncated" and "0 looked at" must not read the same.');
  process.exit(2);
}

if (findings.length) {
  console.error('\nFAIL: ' + findings.length + ' text element(s) truncated on a 390px phone:');
  for (const f of findings) console.error('  ' + f);
  console.error('\nA name is how a user tells two accounts apart. Tre has two called "Robinhood individual".');
  process.exit(1);
}
console.log('\nPASS: ' + examined + ' account name/meta elements examined at 100% and 150%, none truncated.');
process.exit(0);
