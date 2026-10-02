#!/usr/bin/env node
/**
 * check-goal-extras.mjs - Goals > Add Goal, the "Also count these accounts" editor (ask e1b0fffc), 390x844, signed in.
 *
 * savings_goals.also_linked_accounts (ask 4674b24a) could only be set by SQL. This presses the new editor with the
 * write ANSWERED IN THE BROWSER (route.fulfill, never sent), the same pattern as check:rewards-save.
 * ASSERTS: with no linked account the editor is ABSENT; picking a linked account shows it, offering every account
 * except the primary and any card or loan (a debt must never add to saved), and
 * pressing one chip sets aria-pressed; pressing Add Goal sends exactly ONE POST to savings_goals
 * whose also_linked_accounts is exactly [that chip's account] and whose linked_account is the primary.
 * DOES NOT COVER: editing an existing goal, a real server round trip, RLS, or the balance shown after save
 * (goal-linkage.test.ts owns the sum).
 * USAGE: node scripts/check-goal-extras.mjs    EXITS: 0 pass . 1 the editor or save is wrong . 2 could not test
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
const posts = [];
let aborted = 0;
await page.route(/\/rest\/v1\//, async route => {
  const req = route.request();
  if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue();
  if (req.method() === 'POST' && /\/rest\/v1\/savings_goals\b/.test(req.url())) {
    posts.push(req.postDataJSON());
    return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  }
  aborted += 1;
  return route.abort();
});
await page.goto(`${BASE}/dashboard?tab=goals`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay').count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}
const add = page.getByRole('button', { name: 'Add Goal' }).first();
try { await add.waitFor({ state: 'visible', timeout: 20000 }); }
catch { await done(2, 'CONTROL FAILED: no Add Goal button on the goals tab.'); }
await add.click();
const linked = page.locator('#field-linked_account');
try { await linked.waitFor({ state: 'visible', timeout: 5000 }); }
catch { await done(1, 'Add Goal did not open the goal form.'); }
const label = page.getByText('Also count these accounts', { exact: true });
if (await label.count()) await done(1, 'the editor shows with no linked account (extras need a primary).');
const values = await linked.locator('option').evaluateAll(os => os.map(o => o.value).filter(Boolean));
if (values.length < 2) await done(2, `CONTROL FAILED: the walk account has ${values.length} active account(s); need 2.`);
const primary = values[0];
await linked.selectOption(primary);
try { await label.waitFor({ state: 'visible', timeout: 3000 }); }
catch { await done(1, 'picking a linked account did not show "Also count these accounts".'); }
const section = label.locator('xpath=..');
const chips = section.getByRole('button');
const n = await chips.count();
const primaryText = await linked.locator(`option[value="${primary}"]`).innerText();
const chipTexts = await chips.allInnerTexts();
console.log(`chips ${n}: ${JSON.stringify(chipTexts)}; primary ${JSON.stringify(primaryText)}`);
// Every other account EXCEPT debts: a card or loan balance must never add to a goal's saved amount.
const allLabels = await linked.locator('option').evaluateAll(os => os.filter(o => o.value).map(o => o.textContent));
const DEBT = /\((credit card|mortgage|student loan|auto loan|other liability)\)$/;
const wantChips = allLabels.filter(l => l !== primaryText && !DEBT.test(l));
if (!allLabels.some(l => DEBT.test(l))) await done(2, 'CONTROL FAILED: the walk account has no debt account, so the debt filter is untested.');
if (JSON.stringify(chipTexts) !== JSON.stringify(wantChips)) {
  await done(1, `chips ${JSON.stringify(chipTexts)}, want every non-debt account but the primary ${JSON.stringify(wantChips)}.`);
}
if (chipTexts.includes(primaryText)) await done(1, 'the primary account is offered as an extra.');
const chip = chips.first();
if ((await chip.getAttribute('aria-pressed')) !== 'false') await done(1, 'a chip starts pressed on a new goal.');
await chip.click();
if ((await chip.getAttribute('aria-pressed')) !== 'true') await done(1, 'pressing a chip did not set aria-pressed.');
const chipText = chipTexts[0];
const extraId = await linked.locator('option').evaluateAll((os, t) => os.find(o => o.textContent === t)?.value, chipText);
await page.locator('#field-name').fill('Gate goal (never saved)');
if (await page.locator('#field-target_amount').count()) await page.locator('#field-target_amount').fill('1000');
await chip.scrollIntoViewIfNeeded();
await page.screenshot({ path: 'test-results/goal-extras-390.png' });
if (posts.length !== 0) await done(1, `the form sent ${posts.length} write(s) before Save.`);
await page.getByRole('button', { name: 'Add Goal' }).last().click();
for (let i = 0; i < 20 && posts.length === 0; i += 1) await page.waitForTimeout(250);
console.log(`posts ${posts.length}, other writes aborted ${aborted}`);
if (posts.length !== 1) await done(1, `Add Goal sent ${posts.length} POST(s) to savings_goals, want 1.`);
const body = Array.isArray(posts[0]) ? posts[0][0] : posts[0];
console.log(`linked_account ${body.linked_account}, also_linked_accounts ${JSON.stringify(body.also_linked_accounts)}`);
if (body.linked_account !== primary) await done(1, `linked_account sent ${body.linked_account}, want ${primary}.`);
if (JSON.stringify(body.also_linked_accounts) !== JSON.stringify([extraId])) {
  await done(1, `also_linked_accounts sent ${JSON.stringify(body.also_linked_accounts)}, want ${JSON.stringify([extraId])}.`);
}
await done(0, 'PASS: the extras editor is hidden without a primary, offers every other account, and Add Goal sent one POST with the pressed account in also_linked_accounts; answered in-browser, nothing reached the database.');
