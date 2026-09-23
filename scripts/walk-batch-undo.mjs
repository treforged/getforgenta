#!/usr/bin/env node
/**
 * walk-batch-undo.mjs - press MerchantMemoryPanel's "Undo all" in a REAL browser and
 * assert the whole retroactive pass was reversed.
 *
 * WHY THIS EXISTS
 * This is the third and last of the three undo controls ask 5d6dbada left jsdom-only.
 * `walk-deck-undo.mjs` covers auto-apply, `walk-row-link-undo.mjs` covers BankActivity's
 * per-row link, and this covers the BATCH pass - which is the one that matters most,
 * because it writes over the whole backlog in one act and its own copy promises "undoes
 * in one press". That promise used to be held in component state, so a reload silently
 * made it false; it now lives in `public.applied_actions`, and this check is what proves
 * the durable version actually reverses.
 *
 * THE GUARD is the same as its siblings: it refuses any address that is not
 * `@forgenta.test`, an IANA-reserved TLD that can never be a real mailbox. See
 * `.claude/skills/dev-signin/SKILL.md`, "The one carve-out".
 *
 * WHAT IT ASSERTS
 *   1. A `merchant_retro_pass` action exists and is live - the panel auto-applies once
 *      per mount, so loading the page IS the apply half.
 *   2. Pressing "Undo all" marks THAT SPECIFIC id undone, and the charges the pass
 *      touched go back to having no recorded category.
 * The second half matters on its own: an undo that marks the record but leaves the
 * writes in place would satisfy a check that only read `applied_actions`, and would be
 * the worse defect, because the user would be told it was taken back.
 *
 * WHAT IT DOES NOT COVER
 *   - The ambiguous half of the split, which needs a confirm press first. This asserts
 *     the confident half, which is the one that applies with nobody watching.
 *   - Rendered appearance. It asserts rows, not a frame.
 *
 * USAGE: node scripts/walk-batch-undo.mjs [screenshot.png]
 */
import { readFileSync } from 'node:fs';
import { undoOfferWindowHours, isOffered } from './lib/undo-window.mjs';

const BASE = 'http://localhost:8080';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };
// The app offers an undo only inside its own window; an older un-undone row is a SPENT fixture, not a
// missing control. Read from the app's source - see scripts/lib/undo-window.mjs.
const OFFER_HOURS = undoOfferWindowHours();
if (OFFER_HOURS === null) fail(2, 'could not read UNDO_OFFER_WINDOW_HOURS from src/lib/applied-actions.ts - the extractor is broken, not the app.');

const env = readFileSync('.env.local', 'utf8');
let creds;
try {
  creds = readFileSync('.env.deck-walk.local', 'utf8');
} catch {
  fail(2, '.env.deck-walk.local is missing - create the walk account and run scripts/seed-walk-account.sql first.');
}

const pick = (s, k) => (s.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const url = pick(env, 'VITE_SUPABASE_URL');
const anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
const email = pick(creds, 'REACH_TEST_EMAIL');
const password = pick(creds, 'REACH_TEST_PASSWORD');
if (!url || !anon) fail(2, 'VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing from .env.local.');
if (!email || !password) fail(2, '.env.deck-walk.local carries no email/password.');
if (!/@forgenta\.test$/.test(email)) {
  fail(2, `refusing to script a sign-in for "${email}" - this script only ever handles @forgenta.test accounts.`);
}

const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(1, `sign-in returned ${res.status} with no token.`);
console.log(`signed in as ${session.user.email}`);

const auth = { apikey: anon, Authorization: `Bearer ${session.access_token}` };

/** Read applied_actions as the USER, through RLS - never with a privileged key. */
async function actions() {
  const r = await fetch(`${url}/rest/v1/applied_actions?select=id,kind,label,steps,undone_at,created_at`, { headers: auth });
  if (!r.ok) fail(1, `reading applied_actions returned ${r.status}`);
  return await r.json();
}
/** How many charges currently carry a recorded category, as the user sees it. */
async function categorised() {
  const r = await fetch(`${url}/rest/v1/synced_transaction_reviews?select=id,category_override`, { headers: auth });
  if (!r.ok) fail(1, `reading synced_transaction_reviews returned ${r.status}`);
  return (await r.json()).filter((v) => v.category_override).length;
}

let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  fail(2, 'Could not load @playwright/test - run npm i.');
}
try {
  const ping = await fetch(BASE, { redirect: 'manual' });
  if (ping.status >= 500) fail(2, `${BASE} answered ${ping.status}.`);
} catch (err) {
  fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
const page = await ctx.newPage();
const shot = process.argv[2] || 'walk-batch-undo.png';
const done = async (code, msg) => { await page.screenshot({ path: shot }); await browser.close(); fail(code, msg); };

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

const reject = page.getByRole('button', { name: /reject non-essential/i });
if (await reject.count()) { await reject.first().click(); await page.waitForTimeout(1500); }
await page.waitForTimeout(3000);

// The deck mounts as a full-screen modal whose backdrop intercepts every pointer event,
// so the panel beneath it is unclickable until we leave by its own door.
const deck = page.locator('[data-testid="decision-deck"]');
if (await deck.count()) {
  const browse = page.getByRole('button', { name: /browse all/i });
  if (await browse.count() === 0) await done(1, 'the deck modal is open and offers no "Browse all" way back.');
  await browse.first().click();
  await page.waitForTimeout(2500);
  console.log('left the deck modal via "Browse all"');
}
await page.waitForTimeout(3000);

const afterApply = await actions();
const pass = afterApply.find((a) => a.kind === 'merchant_retro_pass' && isOffered(a, OFFER_HOURS));
if (!pass) {
  await done(2, `no merchant_retro_pass inside the app's ${OFFER_HOURS}h undo window exists after the page settled (an older un-undone pass is not offered, by design),` + ' so the batch never applied and there is nothing to undo. '
    + 'The panel needs charges with NO recorded category from a merchant the account has already labelled. '
    + 'Re-arm with a privileged connection by deleting this account\'s applied_actions and the category_override reviews the last pass wrote.');
}
const steps = Array.isArray(pass.steps) ? pass.steps.length : 0;
const catsBefore = await categorised();
console.log(`BEFORE  pass ${pass.id} - ${pass.label}, ${steps} step(s); categorised reviews = ${catsBefore}`);
if (steps === 0) await done(1, 'the retro pass recorded zero steps, so undoing it could not change anything - the check would pass vacuously.');

const undoAll = page.getByRole('button', { name: /^undo all$/i });
if (await undoAll.count() === 0) await done(1, 'a live merchant_retro_pass exists but no "Undo all" control rendered - the panel promises a reversal it does not offer.');
await undoAll.first().click();
await page.waitForTimeout(6000);
await page.screenshot({ path: shot });
await browser.close();

const final = await actions();
const row = final.find((a) => a.id === pass.id);
if (!row) fail(1, `the pass ${pass.id} disappeared entirely - undo must MARK it, not delete it.`);
if (row.undone_at === null) fail(1, `"Undo all" did not mark the pass undone: ${pass.id} still has undone_at null.`);

const catsAfter = await categorised();
console.log(`AFTER   pass marked undone at ${row.undone_at}; categorised reviews = ${catsAfter}`);
if (catsAfter >= catsBefore) {
  fail(1, `the record says undone but the WRITES are still in place: ${catsBefore} categorised before, ${catsAfter} after. `
    + 'Marking the trail without reversing the writes is worse than not undoing at all, because the user is told it was taken back.');
}
console.log(`PASS - "Undo all" reversed the pass: ${pass.id} marked undone and ${catsBefore - catsAfter} charge(s) went back to having no category.`);
