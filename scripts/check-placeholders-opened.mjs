#!/usr/bin/env node
/**
 * check:placeholders:opened - the placeholders check:placeholders CANNOT reach, because they sit
 * behind a press (ask d694a896). Same measurement (scripts/lib/placeholder-fit.mjs), so the only
 * thing this adds is REACHING fields - never judging them differently.
 *
 * Each STOP presses its way to a container and must PROVE the container opened: the named field
 * has to be present and measured, or the stop exits 2. A stop that found nothing would otherwise
 * read as "nothing clipped".
 *
 *   signed out  /auth -> Start Free            ("Your name", "Re-enter your password")
 *   signed out  /auth -> Sign In -> Forgot?    (reset form)
 *   signed in   /settings -> Security          ("New email address", the three password fields)
 *   signed in   /vehicles?tab=builds -> New Build   (the build form)
 *   demo mode   /demo -> /vehicles?tab=builds -> Log Service   (maintenance form)
 *   demo mode   /demo -> /transactions -> Add Plan   (payment-plan form; the walk account is not premium)
 *   demo mode   /demo -> builds -> Suspension -> EDIT -> Transaction/Plan -> + New   (PhaseBlock item
 *               edit; local state only, Save is never pressed)
 *   signed in   /settings -> Security -> Delete account   ("DELETE") - REVEAL ONLY. The confirm
 *               field is measured and NOTHING is typed into it; the walk account must survive.
 *
 * 390x844. Exit 0 all fit, 1 a field clips, 2 a stop did not open (instrument).
 * Does NOT cover the password-update and MFA forms (they need a recovery link or a factor).
 */
import { readFileSync } from 'node:fs';
import { READ_PLACEHOLDER_FIT } from './lib/placeholder-fit.mjs';

const BASE = 'http://localhost:8080';
// An uncaught error is an INSTRUMENT fault, never a finding - exit 2, not node's default 1.
const firstLine = (e) => String(e?.message ?? e).split(/\r?\n/)[0];
process.on('uncaughtException', (e) => { console.error(`FAIL(2): the walk crashed: ${firstLine(e)}`); process.exit(2); });
process.on('unhandledRejection', (e) => { console.error(`FAIL(2): the walk crashed: ${firstLine(e)}`); process.exit(2); });
const fail = (code, msg) => { console.error(`FAIL(${code}): ${msg}`); process.exit(code); };
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
if (!session.access_token) fail(2, `sign-in returned ${res.status}.`);

let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'no @playwright/test'); }
const browser = await chromium.launch();
const done = async (code, msg) => { await browser.close(); fail(code, msg); };
const CONSENT = JSON.stringify({ version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false });

async function freshPage(signedIn) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s, c]) => {
    localStorage.setItem('tre_cookie_consent', c);
    if (s) localStorage.setItem(k, JSON.stringify(s));
  }, [`sb-${ref}-auth-token`, signedIn ? session : null, CONSENT]);
  return page;
}
const press = async (page, name, stop) => {
  const b = page.getByRole('button', { name, exact: true }).first();
  try { await b.waitFor({ timeout: 20000 }); await b.click(); }
  catch { await done(2, `${stop}: never found the "${name}" button to press`); }
  await page.waitForTimeout(700);
};

const results = [];
async function measure(page, stop, mustSee) {
  let fields = [];
  for (let i = 0; i < 8; i++) {
    fields = await page.evaluate(READ_PLACEHOLDER_FIT);
    if (mustSee.every((t) => fields.some((f) => f.text === t))) break;
    await page.waitForTimeout(600);
  }
  const missing = mustSee.filter((t) => !fields.some((f) => f.text === t));
  if (missing.length) await done(2, `${stop}: the container did not open - never measured ${missing.map((m) => JSON.stringify(m)).join(', ')}`);
  for (const f of fields) results.push({ ...f, stop });
  console.log(`${stop.padEnd(34)} ${fields.length} field(s) measured`);
}

{ const p = await freshPage(false);
  await p.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
  await press(p, 'Start Free', 'auth sign-up');
  await measure(p, 'auth sign-up', ['Your name', 'Re-enter your password']);
  await p.context().close(); }

{ const p = await freshPage(false);
  await p.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
  await press(p, 'Sign In', 'auth reset');
  await press(p, 'Forgot password?', 'auth reset');
  const n = await p.evaluate(READ_PLACEHOLDER_FIT);
  for (const f of n) results.push({ ...f, stop: 'auth reset' });
  console.log(`${'auth reset'.padEnd(34)} ${n.length} field(s) measured`);
  await p.context().close(); }

{ const p = await freshPage(true);
  await p.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  await press(p, 'Security', 'settings security');
  await measure(p, 'settings security', ['New email address', 'Current password', 'New password (6+ characters)', 'Confirm new password']);
  // REVEAL ONLY. The press moves the delete flow to its confirm step, which shows the field.
  // Nothing is typed, so the destructive button stays disabled and the account is untouched.
  await press(p, 'Delete account', 'settings delete-confirm');
  await measure(p, 'settings delete-confirm', ['DELETE']);
  const typed = await p.evaluate(() => [...document.querySelectorAll('input[placeholder="DELETE"]')].map((i) => i.value));
  if (typed.some((v) => v !== '')) await done(2, 'SAFETY: the DELETE field is not empty - stop and check the walk account');
  await p.context().close(); }

{ const p = await freshPage(true);
  await p.goto(`${BASE}/vehicles?tab=builds`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  // "New Build" and, on an account with no builds yet, "Create Your First Build" open the same modal.
  const newBuild = p.getByRole('button', { name: /^(New Build|Create Your First Build)$/ }).first();
  try { await newBuild.waitFor({ timeout: 20000 }); await newBuild.click(); }
  catch { await done(2, 'garage build-form: never found "New Build" to press'); }
  await p.waitForTimeout(700);
  await measure(p, 'garage build-form', ['e.g. 2004 C5 Corvette', '2004', 'Chevy', 'Corvette']);
  if (process.env.SHOT_BUILD_FORM) await p.screenshot({ path: process.env.SHOT_BUILD_FORM });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  await p.context().close(); }

{ const p = await freshPage(false);
  // THROUGH DEMO MODE: "Add Plan" renders only for a premium or demo account, and the walk account
  // is not premium (measured - the button was absent). /demo needs no credentials and writes nothing.
  await p.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  await p.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  // The exact <button>: a looser name match also hits the whole section header (role=button).
  const addPlan = p.locator('button').filter({ hasText: /^\s*Add Plan\s*$/ }).first();
  try { await addPlan.waitFor({ timeout: 8000 }); } catch { /* reported below */ }
  if (await addPlan.count()) {
    // A DOM click, not a pointer click: in demo mode the bank half paints over this header (CSS
    // order), so a pointer click is intercepted. This stop measures the FORM, not the button's
    // hit area - check:rail and the page walks own whether controls are pressable.
    await addPlan.evaluate((el) => el.click());
    await p.waitForTimeout(700);
    await measure(p, 'transactions payment-plan', ['e.g. AirPods Pro, MacBook Pro', 'e.g. PayPal Pay in 4', 'e.g. 4 or 12']);
  } else {
    console.log(`${'transactions payment-plan'.padEnd(34)} NOT MEASURED - no "Add Plan" button even in demo mode`);
  }
  await p.context().close(); }

{ const p = await freshPage(false);
  // THROUGH DEMO MODE: "Log Service" exists only once an account has a build, the walk account has
  // none, and this walk never creates data. The demo account is seeded with one.
  await p.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  await p.goto(`${BASE}/vehicles?tab=builds`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  const logService = p.locator('button').filter({ hasText: /Log Service/i }).first();
  try { await logService.waitFor({ timeout: 15000 }); } catch { await done(2, 'garage maintenance-form: no "Log Service" button even in demo mode'); }
  await logService.evaluate((el) => el.click());
  await p.waitForTimeout(700);
  await measure(p, 'garage maintenance-form (demo)', ['e.g. Oil Change', 'e.g. Discount Tire, DIY']);
  await p.context().close(); }

{ const p = await freshPage(false);
  // THROUGH DEMO MODE, and PURE UI: EDIT and the Financing mode buttons only change local state in
  // PhaseBlock; nothing is saved unless Save is pressed, and this stop never presses it.
  await p.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  await p.goto(`${BASE}/vehicles?tab=builds`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  const clickText = async (re, what) => {
    const b = p.locator('button').filter({ hasText: re }).first();
    try { await b.waitFor({ timeout: 15000 }); } catch { await done(2, `build item-edit: no "${what}" button`); }
    await b.evaluate((el) => el.click());
    await p.waitForTimeout(700);
  };
  // Phases render COLLAPSED; the demo's "Suspension" phase holds items, so open it first.
  const phaseHead = p.getByText(/^Suspension$/i).first();
  try { await phaseHead.waitFor({ timeout: 15000 }); } catch { await done(2, 'build item-edit: no "Suspension" phase in the demo build'); }
  await phaseHead.click();
  await p.waitForTimeout(700);
  await clickText(/^\s*EDIT\s*$/, 'EDIT');
  await measure(p, 'build item-edit (demo)', ['https://...']);
  await clickText(/^\s*Transaction\s*$/, 'Transaction');
  await clickText(/＋ New/, '+ New (transaction)');
  await measure(p, 'build item-edit new tx (demo)', ['e.g. From Summit Racing']);
  await clickText(/^\s*Plan\s*$/, 'Plan');
  await clickText(/＋ New/, '+ New (plan)');
  await measure(p, 'build item-edit new plan (demo)', ['e.g. Exhaust system']);
  await p.context().close(); }

{ const p = await freshPage(false);
  // THROUGH DEMO MODE, and PURE UI: "Add stop" only appends to the form's local state. The goal is
  // never saved - this stop never presses "Add Goal" inside the modal, and Escape discards it.
  await p.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  await p.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  const clickBtn = async (re, what) => {
    const b = p.locator('button').filter({ hasText: re }).first();
    try { await b.waitFor({ timeout: 15000 }); } catch { await done(2, `goal stops: no "${what}" button`); }
    await b.evaluate((el) => el.click());
    await p.waitForTimeout(700);
  };
  await clickBtn(/^\s*Goals\s*$/, 'Goals');
  await clickBtn(/^\s*Add Goal\s*$/, 'Add Goal');
  await clickBtn(/^\s*Add stop\s*$/, 'Add stop');
  // Was 'Stop 1 name (optional)', clipped 69px at 390 (text 191, room 122). Now 'Name'.
  await measure(p, 'goal stops (demo)', ['Name']);
  await p.keyboard.press('Escape');
  await p.context().close(); }

await browser.close();
const seen = new Map();
for (const f of results) { const w = seen.get(f.text); if (!w || f.overflowPx > w.overflowPx) seen.set(f.text, f); }
const all = [...seen.values()].sort((a, b) => b.overflowPx - a.overflowPx);
console.log(`\nexamined ${all.length} distinct placeholder(s) behind a press.`);
console.log('placeholder                                   stop                        text avail  over');
for (const f of all) {
  console.log(`${f.text.slice(0, 44).padEnd(46)}${f.stop.padEnd(26)} ${String(f.textPx).padStart(5)} ${String(f.availPx).padStart(5)} ${String(f.overflowPx).padStart(5)}${f.overflowPx > 0 ? '  <-- CLIPPED' : ''}`);
}
const clipped = all.filter((f) => f.overflowPx > 0);
if (clipped.length) { console.error(`\nFAIL: ${clipped.length} placeholder(s) are cut off at 390px.`); process.exit(1); }
console.log('\nPASS: every placeholder behind these presses fits its field at 390px.');
