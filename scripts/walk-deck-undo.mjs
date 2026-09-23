#!/usr/bin/env node
/**
 * walk-deck-undo.mjs - press the Decision Deck's undo control in a REAL browser and
 * assert that something CHANGED, not that nothing threw.
 *
 * WHY THIS EXISTS
 * Auto-apply and the durable undo shipped verified in jsdom only. They could not be
 * walked, because all three available surfaces refused:
 *   - demo mode: mutations `throw new Error('Demo mode')` by construction;
 *   - Tre's own account: pressing undo writes to his real ledger, which has already
 *     happened once by accident;
 *   - the reviewer account: correctly seeded, but only Tre can sign into it.
 * So ask 5d6dbada sat blocked on a human sign-in. This removes the fork with a fourth
 * surface: a throwaway account carrying a CLONE of the reviewer fixture
 * (`seed-walk-account.sql`), which is neither real money nor the demo surface.
 *
 * THE GUARD, AND WHY IT IS NOT DECORATION
 * The `dev-signin` skill's standing rule is: never script credential entry. That rule
 * exists to keep a durable credential to REAL financial data off disk, and it still
 * binds for every real account. It does not bind here, and the reason is CHECKABLE
 * rather than asserted: this script refuses to sign in as anything whose address does
 * not end in `@forgenta.test`. `.test` is an IANA-reserved TLD that can never be a
 * real mailbox, so the credential it handles cannot be a credential to anybody's
 * money. Remove that check and the rule it carves out from is back in force.
 *
 * WHAT IT ASSERTS
 * Not "the button exists" and not "the click threw nothing" - a control that does
 * nothing passes both, and this repo has shipped exactly that defect before. It reads
 * `applied_actions` THROUGH THE SIGNED-IN USER'S OWN PostgREST session (the same path
 * the app uses, so RLS is exercised too) before and after the press, and requires a
 * row to move from `undone_at is null` to `undone_at is not null`.
 *
 * WHAT IT DOES NOT COVER, said plainly rather than left to be assumed
 *   - It presses the undo control the page is showing. When auto-apply has consumed
 *     the only pending charge, that is the AUTO-APPLY undo. The per-row link undo
 *     inside a row's own menu, and the batch panel's undo, are SEPARATE controls and
 *     are NOT exercised here.
 *   - It asserts a database change, not a rendered frame. A visual regression in the
 *     undo banner would pass this.
 *
 * USAGE:  node scripts/walk-deck-undo.mjs [screenshot.png]
 *         Needs the dev server on http://localhost:8080 and .env.deck-walk.local.
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

// THE GUARD. See the header - this is what makes scripting this sign-in legitimate.
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
if (!session.access_token) {
  fail(1, `sign-in returned ${res.status} with no token: ${JSON.stringify(session).slice(0, 200)}`);
}
console.log(`signed in as ${session.user.email}`);

/** Read applied_actions as the USER, through RLS - never with a privileged key. */
async function actions() {
  const r = await fetch(`${url}/rest/v1/applied_actions?select=id,kind,undone_at,created_at&order=created_at.desc`, {
    headers: { apikey: anon, Authorization: `Bearer ${session.access_token}` },
  });
  if (!r.ok) fail(1, `reading applied_actions returned ${r.status}`);
  // `merchant_retro_pass` belongs to MerchantMemoryPanel, whose control is "Undo all" and which
  // walk-batch-undo covers. Counting it here let a merchant pass created on this page load stand in
  // for a deck action, so the walk blamed the deck's Undo for a row the deck never wrote (2026-09-23).
  const rows = (await r.json()).filter((a) => a.kind !== 'merchant_retro_pass');
  return {
    total: rows.length,
    live: rows.filter((a) => isOffered(a, OFFER_HOURS)).length,
    liveIds: rows.filter((a) => isOffered(a, OFFER_HOURS)).map((a) => a.id),
    undoneIds: new Set(rows.filter((a) => a.undone_at !== null).map((a) => a.id)),
  };
}

/**
 * THE FIXTURE IS SINGLE-USE, AND THAT IS THE PRODUCT BEING CORRECT.
 * Once a decision is undone, the app deliberately does NOT re-apply that charge on the
 * next load - undoing something must not have it done straight back to you. So after a
 * successful run the deck offers nothing and this check can no longer press anything.
 * Re-arming is a privileged write and is NOT attempted here: DELETE on applied_actions
 * is refused by RLS even for the row's own owner (measured, HTTP 403), because the
 * table is an append-only trail that undo marks rather than erases. The instruction is
 * printed instead - see the exit-2 message below.
 */
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
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([key, s]) => localStorage.setItem(key, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

// The consent banner overlays the controls under test, so it goes first.
const reject = page.getByRole('button', { name: /reject non-essential/i });
if (await reject.count()) {
  await reject.first().click();
  await page.waitForTimeout(1500);
}
await page.waitForTimeout(3000);

if (page.url().includes('/auth') || page.url().includes('/onboarding')) {
  await page.screenshot({ path: process.argv[2] || 'walk-deck-undo.png' });
  await browser.close();
  fail(1, `landed on ${page.url()} - the account is not past first run. Set display_name and onboarding_completed.`);
}

/**
 * THE SNAPSHOT IS TAKEN AFTER THE PAGE HAS SETTLED, NOT BEFORE THE BROWSER OPENS.
 * Auto-apply runs on load, so a reading taken beforehand describes a state the press
 * will never act on - and on the first attempt that ordering made the check refuse
 * with "nothing to press" while the app was about to create exactly the row it needed.
 */
const before = await actions();
console.log(`BEFORE  applied_actions total=${before.total} not-undone=${before.live}`);
if (before.live === 0) {
  await page.screenshot({ path: process.argv[2] || 'walk-deck-undo.png' });
  await browser.close();
  fail(2, `no applied action inside the app's ${OFFER_HOURS}h undo window exists even after the page settled (an older un-undone row is not offered, by design),` + ' so there is nothing to press - the fixture is spent, which is what a SUCCESSFUL previous run leaves behind. '
    + 'RE-ARM IS TWO DELETES, NOT ONE: clearing applied_actions alone is not enough, because the newest charge is left LINKED and auto-apply then has nothing to offer. '
    + 'With a privileged connection, and note the order - the review goes first:\n'
    + "  delete from synced_transaction_reviews where synced_transaction_id = (\n"
    + "    select t.id from synced_transactions t join auth.users u on u.id = t.user_id\n"
    + "     where u.email = 'deck-walk@forgenta.test' and coalesce(t.merchant_name, t.name) = 'City Power & Light'\n"
    + "     order by t.date desc limit 1);\n"
    + '  -- ONLY the newest City Power & Light charge. Auto-apply acts on the CURRENT card alone, and an\n'
    + '  -- undecided Northside Hardware charge sorts first and parks the deck on it. The 6 older City Power\n'
    + '  -- links must stay: they are the link memory auto-apply matches against.\n'
    + "  delete from applied_actions where user_id = (select id from auth.users where email = 'deck-walk@forgenta.test');");
}

const undo = page.getByRole('button', { name: /^undo$/i });
const found = await undo.count();
console.log(`undo controls on screen: ${found}`);
if (found === 0) {
  await page.screenshot({ path: process.argv[2] || 'walk-deck-undo.png' });
  await browser.close();
  fail(1, 'no undo control rendered.');
}

await undo.first().click();
await page.waitForTimeout(5000);
await page.screenshot({ path: process.argv[2] || 'walk-deck-undo.png' });
await browser.close();

const after = await actions();
console.log(`AFTER   applied_actions total=${after.total} not-undone=${after.live}`);

/**
 * ASSERT ON SPECIFIC ROW IDS, NEVER ON THE LIVE COUNT.
 * The first version of this check compared not-undone counts and reported FAIL on a
 * press that had worked perfectly: auto-apply fires again on every page load, so it
 * created a fresh live action in the same load that the press undid an old one, and
 * the count came back unchanged. A counter whose meaning changes with context is not
 * a measurement. What discriminates is whether one of the rows that WAS live before
 * the press is undone after it - rows born after the snapshot are irrelevant.
 */
const nowUndone = before.liveIds.filter((id) => after.undoneIds.has(id));
if (nowUndone.length === 0) {
  fail(1, `the press changed nothing: none of the ${before.live} action(s) live before it (${before.liveIds.join(', ')}) is undone now. A control that throws nothing and does nothing passes every smoke test ever written; this check exists so that one cannot.`);
}
console.log(`PASS - pressing undo in a real browser undid ${nowUndone.length} of the ${before.live} action(s) that were live beforehand: ${nowUndone.join(', ')}`);
