#!/usr/bin/env node
/**
 * check-rewards-save.mjs - Debt > "Which Card?" rewards editor, SAVE PRESSED, at 390x844, signed in.
 *
 * The rewards editor's Save was exercised by no gate (check:card-advisor presses no Save, so it writes
 * nothing). This presses it with the write ANSWERED IN THE BROWSER (route.fulfill, never sent to the
 * database, same pattern as walk:press's stub phase) and asserts what the app TRIED to write.
 * ASSERTS: picking Apple Card + Apple Pay and pressing "Use these rates" fills 2%; typing Gas 3 overrides; that
 * alone sends no write (control); pressing "Save rates" sends exactly one PATCH to
 * accounts whose body carries card_rewards = { base_pct: 2, categories: { gas: 3 } } - the catalog rate and
 * the typed override - and the editor closes. Every other non-GET request is aborted and counted, so nothing reaches
 * the walk account.
 * DOES NOT COVER: the welcome-offer fields, a real server round trip, RLS, or the ranking after save.
 * USAGE: node scripts/check-rewards-save.mjs    EXITS: 0 pass . 1 the save is wrong . 2 could not test
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
});
const patches = [];
let aborted = 0;
await page.route(/\/rest\/v1\//, async route => {
  const req = route.request();
  if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue();
  if (req.method() === 'PATCH' && /\/rest\/v1\/accounts\b/.test(req.url())) {
    patches.push({ url: req.url(), body: req.postDataJSON() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  }
  aborted += 1;
  return route.abort();
});
await page.goto(`${BASE}/debt?tab=use`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay').count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}
const panel = page.getByTestId('card-advisor');
try { await panel.waitFor({ state: 'visible', timeout: 20000 }); }
catch { await done(2, 'CONTROL FAILED: the Which Card? panel did not mount.'); }
const open = panel.getByRole('button', { name: /rewards & welcome offer/i }).first();
if (!(await open.count())) await done(2, 'CONTROL FAILED: no card row with a rewards editor.');
await open.click();
const save = panel.getByRole('button', { name: 'Save rates' });
try { await save.waitFor({ state: 'visible', timeout: 5000 }); }
catch { await done(1, 'pressing "rewards & welcome offer" did not open the editor.'); }
// The public-card catalog fills the fields: Apple Card with Apple Pay on is 2% everywhere (ask f9b0da16).
await panel.getByLabel('Fill from a public card').selectOption('apple-card');
const everything = panel.getByLabel('Everything else');
const baseBefore = await everything.inputValue();
await panel.getByRole('switch', { name: 'Do you pay with Apple Pay?' }).click();
await panel.getByRole('button', { name: 'Use these rates' }).click();
await page.waitForTimeout(300);
const baseAfter = await everything.inputValue();
console.log(`catalog fill: "Everything else" ${JSON.stringify(baseBefore)} -> ${JSON.stringify(baseAfter)}`);
if (baseAfter !== '2') await done(1, `"Use these rates" did not fill 2% (field reads ${JSON.stringify(baseAfter)}).`);
// ...and any field stays the user's to override.
await panel.getByLabel('Gas').fill('3');
await page.waitForTimeout(400);
await panel.getByTestId('catalog-picker').scrollIntoViewIfNeeded();
await page.screenshot({ path: 'test-results/rewards-catalog-390.png' });
// Entry boxes in a row line up (form-control-theming rule): the first row is Everything else, Groceries, Gas.
const tops = await Promise.all(['Everything else', 'Groceries', 'Gas'].map(l => panel.getByLabel(l).evaluate(e => e.getBoundingClientRect().top)));
const spread = Math.max(...tops) - Math.min(...tops);
console.log(`rate boxes row 1 tops ${tops.map(t => t.toFixed(1)).join(', ')} (spread ${spread.toFixed(1)}px)`);
if (spread > 0.5) await done(1, `the rate boxes do not line up (spread ${spread.toFixed(1)}px).`);
if (patches.length !== 0) await done(1, `typing alone sent ${patches.length} write(s).`);
await save.click();
for (let i = 0; i < 20 && patches.length === 0; i += 1) await page.waitForTimeout(250);
console.log(`patches ${patches.length}, other writes aborted ${aborted}`);
if (patches.length !== 1) await done(1, `Save sent ${patches.length} PATCH(es) to accounts, want 1.`);
const body = patches[0].body ?? {};
console.log(`body: ${JSON.stringify(body)}`);
const want = { base_pct: 2, categories: { gas: 3 } };
if (JSON.stringify(body.card_rewards) !== JSON.stringify(want)) {
  await done(1, `card_rewards sent ${JSON.stringify(body.card_rewards)}, want ${JSON.stringify(want)}.`);
}
await page.waitForTimeout(400);
if (await save.isVisible()) await done(1, 'the editor stayed open after Save.');
await done(0, 'PASS: Save sent one PATCH carrying card_rewards {base_pct 2 from the Apple Card catalog entry, gas 3 typed over it}; answered in-browser, nothing reached the database.');
