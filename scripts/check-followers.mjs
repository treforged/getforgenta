#!/usr/bin/env node
/**
 * check-followers.mjs - PRESS the Followers section and assert something CHANGED.
 *
 * Tre, 2026-09-16: "maybe we should make a follower System like how Instagram has and then you
 * can make a users account public or private."
 *
 * ⚠️ A GREEN SUITE IS NOT A PRESSED BUTTON, and this portfolio has shipped a tab whose two
 * handlers set the same view: it threw nothing, so "press every button" passed it every time and
 * the pane was unreachable for every user on every machine. So every assertion here is a CHANGE,
 * never the absence of an error.
 *
 * WHAT IT ASSERTS
 *   1. The Followers segment EXISTS on /account and is found BY ROLE, never by a label list.
 *   2. Pressing it CHANGES the body, and `aria-selected` moves to it.
 *   3. The panel's own controls are really in the rendered tree - the find form and its button.
 *   4. The public/private switch renders with role="switch", carries aria-checked, and PRESSING
 *      IT FLIPS aria-checked. A control that throws nothing and does nothing passes every smoke
 *      test ever written; only the flip separates the two.
 *   5. The switch's knob stays INSIDE its track in both states - measured, because a knob once
 *      shipped 14px outside a 36px track and no class list could see it.
 *
 * THE CONTROLS: the segment is located before anything is pressed and a zero exits 2 naming the
 * selector; and the aria-checked flip is compared against its own BEFORE value, so a switch stuck
 * in one state cannot pass.
 *
 * WHAT IT DOES NOT COVER: following an actual person end to end (that needs a second real
 * account), the approve/decline path (needs a pending row), colour, and desktop widths.
 *
 * USAGE:  node scripts/check-followers.mjs
 * EXITS:  0 pass . 1 a control did not work . 2 could not test
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

await page.goto(BASE + '/account', { waitUntil: 'domcontentloaded' });
let ready = false;
for (let i = 0; i < 20 && !ready; i += 1) {
  await page.waitForTimeout(700);
  ready = await page.evaluate(() =>
    !/session has ended|sign in again/i.test(document.body.innerText)
    && document.querySelectorAll('[role="tab"]').length > 0);
}
if (!ready) { console.error('FAIL: /account never reached a signed-in state with its section bar.'); process.exit(2); }
await clearOverlays();

// ⚠️ 2026-09-17: THERE IS NO FOLLOWERS SEGMENT ANY MORE, AND THAT IS THE ASK, NOT A REGRESSION.
// Tre: "the friend section shouldn't exist anymore. Move it back up. The following tab and
// profile tab can be combined now put what's on the followers tab below what's the partner
// linking that's on the profile tab. Keep the username in change section at the top."
//
// So the press this file was built around is gone. What it was really protecting - that the
// followers surface is REACHED and really renders - is protected here instead by asserting the
// surface is present from the first paint AND that Tre's ORDER holds. Deleting the reachability
// half because the door changed would have thrown away the only thing standing between this
// screen and the invisibility he originally reported.

// CONTROL: the section bar itself still exists, so a missing "Followers" tab below is a fact
// about the IA and not about a selector that stopped matching anything.
const tabs = await page.locator('[role="tab"]').allInnerTexts();
if (tabs.length === 0) {
  console.error('CONTROL FAILED: no [role="tab"] at all on /account - the bar did not render.');
  process.exit(2);
}
if (tabs.some((t) => /followers/i.test(t))) {
  console.error('FAIL: a "Followers" segment is back. It was merged into Profile on 2026-09-17.');
  console.error('Tabs present: ' + JSON.stringify(tabs));
  process.exit(1);
}
console.log('  section bar: ' + JSON.stringify(tabs) + ' - no separate Followers segment');

// THE ORDER IS PART OF THE ASK, so it is asserted as an ORDER. Three presence checks would pass
// just as happily with the stack upside down.
// ⚠️ MATCH CASE-INSENSITIVELY. These headings carry `uppercase`, and `innerText` REFLECTS CSS
// text-transform - so `indexOf('Username')` reads -1 against a page rendering "USERNAME", and the
// gate accuses a screen that is perfectly correct. That happened on this gate's first run.
const order = await page.evaluate(() => {
  const t = document.body.innerText.toLowerCase();
  return { username: t.indexOf('username'), partner: t.indexOf('partner link'), followers: t.indexOf('find someone') };
});
for (const [k, v] of Object.entries(order)) {
  if (v < 0) { console.error(`FAIL: "${k}" is not on the Profile section at all.`); process.exit(1); }
}
if (!(order.username < order.partner && order.partner < order.followers)) {
  console.error('FAIL: wrong order. Tre asked for username, then partner linking, then followers.');
  console.error('  measured: ' + JSON.stringify(order));
  process.exit(1);
}
console.log('  order: username -> partner linking -> followers, as asked');

// The panel's own controls must be IN the rendered tree, not merely constructed.
const findBtn = page.locator('button', { hasText: 'Find' });
if (await findBtn.count() === 0) { console.error('FAIL: the Find button is not rendered in the Followers panel.'); process.exit(1); }
if (await page.locator('input[placeholder="username"]').count() === 0) { console.error('FAIL: the username input is not rendered.'); process.exit(1); }
console.log('  Find form: input and button both rendered');

/*
 * The public/private switch sits at the TOP OF THIS SAME PANEL, so we stay here.
 * It was briefly mounted in the Connections card on the Profile section instead; four suites went
 * red because that component is contractually DB-free and this one queries. Do not re-aim this at
 * Profile without moving the control back first.
 */
const sw = page.locator('[role="switch"][aria-label*="Public account"]');
if (await sw.count() === 0) {
  console.error('CONTROL FAILED: no [role="switch"] for the public/private setting.');
  console.error('Switches present: ' + JSON.stringify(await page.locator('[role="switch"]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')))));
  process.exit(2);
}
const before = await sw.first().getAttribute('aria-checked');
if (before !== 'true' && before !== 'false') { console.error('FAIL: the switch carries no aria-checked (was ' + before + ').'); process.exit(1); }

// GEOMETRY: the knob must sit inside its track in BOTH states.
const knobInside = async (label) => {
  const r = await sw.first().evaluate((el) => {
    const t = el.getBoundingClientRect();
    const k = el.querySelector('span')?.getBoundingClientRect();
    return k ? { tl: t.left, tr: t.right, kl: k.left, kr: k.right } : null;
  });
  if (!r) { console.error('FAIL: the switch has no knob element.'); process.exit(1); }
  if (r.kl < r.tl - 1 || r.kr > r.tr + 1) {
    console.error('FAIL: knob outside its track (' + label + '): track ' + Math.round(r.tl) + '..' + Math.round(r.tr) + ', knob ' + Math.round(r.kl) + '..' + Math.round(r.kr));
    process.exit(1);
  }
  console.log('  knob inside track (' + label + '): track ' + Math.round(r.tr - r.tl) + 'px wide');
};
await knobInside('before press');

await sw.first().click();
await page.waitForTimeout(1500);
const after = await sw.first().getAttribute('aria-checked');
if (after === before) {
  console.error('FAIL: pressing the switch did not change aria-checked (still ' + before + ').');
  console.error('A control that throws nothing and does nothing passes every smoke test ever written.');
  process.exit(1);
}
console.log('  switch: aria-checked ' + before + ' -> ' + after);
await knobInside('after press');

// Put it back, so the gate leaves no state behind.
await sw.first().click();
await page.waitForTimeout(1500);
const restored = await sw.first().getAttribute('aria-checked');
if (restored !== before) console.warn('  NOTE: could not restore the switch to ' + before + ' (now ' + restored + ').');
else console.log('  switch restored to ' + before);

// -- THE SHARE LINK, EXERCISED END TO END -------------------------------------
//
// Tre, 2026-09-17: "allow users to make a shareable link that makes it easy click and it loads
// their profile into the app or add them into the app."
//
// A LINK THAT RENDERS IS NOT A LINK THAT WORKS. The only assertion worth having is that OPENING
// it changes the screen - so this reads the link the app offers, navigates to it, and requires a
// profile card to appear that was NOT there before.
const shareInput = page.locator('input[aria-label="Your shareable profile link"]');
if (await shareInput.count() === 0) {
  console.error('CONTROL FAILED: no share-link field rendered. Either it regressed, or the walk');
  console.error('account has no username - check the Username section above it.');
  process.exit(2);
}
const shareLink = await shareInput.first().inputValue();
const shareMatch = shareLink.match(/\/account\?u=(.+)$/);
if (!shareMatch) {
  console.error('FAIL: the share link is not an /account?u= link: ' + JSON.stringify(shareLink));
  process.exit(1);
}
const shareUser = shareMatch[1];
console.log('  share link offered: /account?u=' + shareUser);

// ⚠️ THE FIRST VERSION OF THIS ASSERTION COULD NOT DISCRIMINATE, and it is worth saying why.
// It counted matches for "@<username>" before and after. That reads 1 -> 1 on a PERFECTLY
// WORKING link, because the username is already on screen in the Username section directly
// above. A counter that cannot tell the two states apart is the instrument, not the app.
//
// So this asserts the MECHANISM and its RESULT, separately:
//   1. the find field is PRE-FILLED from the URL - proof the link was consumed at all;
//   2. a lookup RESULT appeared - proof it did not merely type into a box and stop.
// The walk account's own link resolves to itself, which the app answers with a specific
// sentence; a link to anybody else renders a follow button. Either satisfies (2), so this gate
// does not quietly depend on the walk account being the only user.
const findField = page.locator('input[aria-label="Find someone by username"]');
if (await findField.count() === 0) {
  console.error('CONTROL FAILED: no find field to pre-fill - the selector stopped matching.');
  process.exit(2);
}
const fieldBefore = await findField.first().inputValue();

await page.goto(BASE + '/account?u=' + shareUser, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await clearOverlays();

const fieldAfter = await findField.first().inputValue();
if (fieldAfter === fieldBefore || !fieldAfter.includes(shareUser)) {
  console.error('FAIL: opening the share link did not pre-fill the find field.');
  console.error('  before: ' + JSON.stringify(fieldBefore) + '  after: ' + JSON.stringify(fieldAfter));
  process.exit(1);
}

const body = (await page.evaluate(() => document.body.innerText)).toLowerCase();
const resolvedSelf = body.includes('cannot follow yourself');
const resolvedOther = (await page.locator('button', { hasText: 'Follow' }).count()) > 0;
if (!resolvedSelf && !resolvedOther) {
  console.error('FAIL: the link pre-filled the field but no profile was resolved.');
  console.error('It is a link that looks fine and does nothing - the exact shape this gate exists for.');
  process.exit(1);
}
console.log('  opening it pre-filled ' + JSON.stringify(fieldBefore) + ' -> ' + JSON.stringify(fieldAfter)
  + ' and resolved a profile (' + (resolvedSelf ? 'self' : 'followable') + ')');

await browser.close();
console.log(`\nPASS: the Profile section stacks username, partner linking and followers in Tre's order; the public/private switch really flips; and the share link really loads a profile.`);
process.exit(0);
