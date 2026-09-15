#!/usr/bin/env node
/**
 * walk-row-link-undo.mjs - press BankActivity's PER-ROW link control in a real browser,
 * then press undo, and assert that each press CHANGED something.
 *
 * WHY THIS EXISTS
 * `linkOneWithUndo` (BankActivity.tsx:688) and the undo that reverses it shipped
 * verified in jsdom only. Ask 5d6dbada named exactly these two presses and sat blocked
 * for days, because the only accounts that could reach them were Tre's real ledger and
 * the reviewer account he alone can sign into. `walk-deck-undo.mjs` covers the
 * AUTO-APPLY undo; this covers the per-row link, which is a different control on a
 * different code path and was the half that ask actually named.
 *
 * THE GUARD is the same one, and for the same reason: this refuses to sign in as
 * anything that is not an `@forgenta.test` address - an IANA-reserved TLD that can
 * never be a real mailbox - so the credential it handles cannot reach anybody's money.
 * See `.claude/skills/dev-signin/SKILL.md`, "The one carve-out".
 *
 * WHAT IT ASSERTS, and why it is id-based
 *   1. Pressing "Link to a bill" and choosing a destination creates a NEW row in
 *      `applied_actions` - an id that was not in the snapshot taken moments earlier.
 *   2. Pressing undo marks THAT SPECIFIC id undone.
 * Counting live rows would prove neither: auto-apply writes its own rows on load, so a
 * count can stay flat across a press that worked and move across one that did not.
 * That is not hypothetical - the count-based version of the sibling check reported FAIL
 * on a press that had worked perfectly.
 *
 * WHAT IT DOES NOT COVER
 *   - The BATCH panel's undo (MerchantMemoryPanel) is a third control and is still
 *     jsdom-only.
 *   - It asserts database rows, not a rendered frame: a visual regression in the row or
 *     the undo banner would pass this.
 *   - It needs a charge the deck has NOT already decided. The fixture's unknown-merchant
 *     charge is that; once linked, re-arm before running again (message below says how).
 *
 * USAGE: node scripts/walk-row-link-undo.mjs [screenshot.png]
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };

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

/** Read applied_actions as the USER, through RLS - never with a privileged key. */
async function actions() {
  const r = await fetch(`${url}/rest/v1/applied_actions?select=id,kind,label,undone_at`, {
    headers: { apikey: anon, Authorization: `Bearer ${session.access_token}` },
  });
  if (!r.ok) fail(1, `reading applied_actions returned ${r.status}`);
  return await r.json();
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
const shot = process.argv[2] || 'walk-row-link-undo.png';

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

// The consent banner overlays the controls under test, so it goes first.
const reject = page.getByRole('button', { name: /reject non-essential/i });
if (await reject.count()) { await reject.first().click(); await page.waitForTimeout(1500); }
await page.waitForTimeout(3000);

const done = async (code, msg) => { await page.screenshot({ path: shot }); await browser.close(); fail(code, msg); };

if (page.url().includes('/auth') || page.url().includes('/onboarding')) {
  await done(1, `landed on ${page.url()} - the account is not past first run.`);
}

/**
 * LEAVE THE DECK FIRST, OR NOTHING BELOW IT IS CLICKABLE.
 * When charges are waiting, the Decision Deck mounts as a full-screen modal
 * (`role="dialog"`, `data-testid="decision-deck"`, `fixed inset-0 z-50`) and its
 * backdrop intercepts every pointer event. The per-row control IS in the DOM and IS
 * reported visible, so a naive click times out after 30s against an element the
 * harness insists is fine - measured, and it is the first thing this script hit.
 * "Browse all" is the deck's own documented way back to the list
 * (DecisionDeck.tsx:146), so the walk uses the same door a user does.
 */
const deck = page.locator('[data-testid="decision-deck"]');
if (await deck.count()) {
  const browse = page.getByRole('button', { name: /browse all/i });
  if (await browse.count() === 0) await done(1, 'the deck modal is open and offers no "Browse all" way back to the list.');
  await browse.first().click();
  await page.waitForTimeout(2500);
  if (await deck.count()) await done(1, 'pressed "Browse all" and the deck modal is still mounted.');
  console.log('left the deck modal via "Browse all"');
}

// The control under test. `Link to a bill` is BankActivity's per-row opener
// (BankActivity.tsx:1424); it becomes `Link another bill` once the row has a link.
const opener = page.getByRole('button', { name: /^Link (to a|another) bill$/ });
if (await opener.count() === 0) {
  await done(2, 'no per-row link control on screen - every charge is already decided, so there is nothing to link. '
    + 'RE-ARM with a privileged connection:\n'
    + "  delete from applied_actions where user_id = (select id from auth.users where email = 'deck-walk@forgenta.test');\n"
    + "  delete from synced_transaction_reviews where synced_transaction_id = (\n"
    + "    select t.id from synced_transactions t join auth.users u on u.id = t.user_id\n"
    + "     where u.email = 'deck-walk@forgenta.test' and t.merchant_name = 'Northside Hardware');");
}

const before = await actions();
const beforeIds = new Set(before.map((a) => a.id));
console.log(`BEFORE  applied_actions = ${before.length}`);

/**
 * THE DESTINATION IS DISCOVERED, NOT HARDCODED - AND IT IS A NATIVE <select>.
 * The options are the account's own recurring rules, so a label typed into this file
 * would be a fact about one fixture rather than about the control. The first version of
 * this check diffed BUTTON labels and reported "the picker did not open" while the
 * picker was open and populated: the options are `<option>` elements inside a native
 * `<select>`, which render with zero width and height and are not buttons. A zero from
 * a matcher aimed at the wrong element type and a zero from a control that never opened
 * are the same zero, so the count is checked against the SELECT's own option list.
 */
const selectsBefore = await page.locator('select').count();
await opener.first().click();
await page.waitForTimeout(2000);
if (await page.locator('select').count() <= selectsBefore) {
  await done(1, 'pressing the per-row link control opened no picker - no new <select> appeared.');
}
/**
 * The picker is identified by its own PROMPT option, never by position. The page
 * already carries six unrelated `<select>`s (period, account, category, source
 * filters), and the new one is inserted in DOM order rather than appended - so
 * `.last()` picked up the "All Sources" filter, found no destinations in it, and
 * reported that the picker offers none. A matcher aimed at the wrong element and a
 * control that is genuinely empty produce the same zero.
 */
const picker = page.locator('select').filter({ has: page.locator('option', { hasText: /which bill does this pay/i }) }).first();
if (await picker.count() === 0) {
  await done(1, 'a new <select> appeared but none of them is the bill picker.');
}
const options = (await picker.locator('option').allTextContents())
  .map((t) => t.replace(/\s+/g, ' ').trim())
  .filter((t) => /·/.test(t));
console.log(`picker opened with ${options.length} destination option(s)`);
if (options.length === 0) await done(1, 'the picker opened but offers no destinations.');

const chosen = options[0];
await picker.selectOption({ label: chosen });
await page.waitForTimeout(5000);

const afterLink = await actions();
const created = afterLink.filter((a) => !beforeIds.has(a.id));
console.log(`AFTER LINK  applied_actions = ${afterLink.length}, new = ${created.length}`);
if (created.length === 0) {
  await done(1, `linking to "${chosen.replace(/\s+/g, ' ').trim()}" wrote no applied_action. `
    + 'The control threw nothing and did nothing, which is exactly what this check exists to catch.');
}
const target = created[0];
console.log(`  created ${target.id} - ${target.kind} / ${target.label}`);
if (target.undone_at !== null) await done(1, 'the newly created action is already marked undone, which makes the undo assertion meaningless.');

const undo = page.getByRole('button', { name: /^undo$/i });
if (await undo.count() === 0) await done(1, 'the link wrote an action but no undo control rendered.');
await undo.first().click();
await page.waitForTimeout(5000);
await page.screenshot({ path: shot });
await browser.close();

const final = await actions();
const row = final.find((a) => a.id === target.id);
if (!row) fail(1, `the action ${target.id} disappeared entirely - undo must MARK it, not delete it.`);
if (row.undone_at === null) {
  fail(1, `undo did not reverse the link: ${target.id} still has undone_at null.`);
}
console.log(`PASS - per-row link created ${target.id} and undo marked it undone at ${row.undone_at}.`);
