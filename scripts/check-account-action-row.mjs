#!/usr/bin/env node
/**
 * check-account-action-row.mjs - the account card's three action buttons must share a line with a
 * SHORT meta line, and must still drop below a LONG one. 390x844, signed in, real browser.
 *
 * WHY IT EXISTS
 * Tre asked twice for the blank space on the Accounts tab to be closed - 2026-09-16 ("there's a
 * lot of empty space on the sides of some of these boxes") and again 2026-09-17 after installing
 * iOS 937 ("she forgot the spacing issues I mentioned specifically at least on the accounts
 * section"). Both earlier fixes were real, were pushed, and ARE in the build he was holding
 * (89604ad4 and c4ec0b69 are ancestors of 55a17bca by git merge-base). The complaint survived them
 * because every gate on this screen was a jsdom TEXT assertion, and jsdom reports zero for every
 * size in this repo. 44062af7's own evidence says so: "jsdom has no geometry, so this asserts TEXT
 * not layout; how many lines are saved at 390px needs a Playwright rendered frame." That stated
 * limit was never closed, and a stated limit is a to-do rather than an absolution.
 *
 * THE DEFECT IT PINS
 * The meta <p> carried `basis-[11rem]`. Flex decides whether to break a line from each item's
 * flex-basis, NOT from the text the item holds - so 176px of basis plus the action buttons
 * exceeded the row on every account, and the buttons took a line of their own whatever the meta
 * said. Measured at 390x844 before the fix: "Chase Checking / Checking" stood 149px tall with a
 * whole line spent on three icons.
 *
 * ⚠️ IT IS A PAIR, AND THE SECOND HALF IS LOAD-BEARING. "The buttons are on the meta's line" is
 * satisfied perfectly by never wrapping at all - which would crush a long meta line back into the
 * "Brok era..." defect the fixed basis was added to cure. So this asserts BOTH: short meta shares
 * the line, long meta still pushes the buttons below. Either alone passes over a real regression.
 *
 * POSITIVE CONTROLS, because a zero from a broken selector and a clean screen are one zero:
 *   - at least one SHORT-meta card and at least one LONG-meta card were found, or exit 2;
 *   - cards are found by SHAPE (a card carrying a figure and two <p>s), never by any class the
 *     fixed version carries and the broken one does not.
 *
 * DOES NOT COVER: colour, the note line below the card, the Linked banks segment, desktop widths,
 * vertical rhythm between cards, or whether the meta strings are the right strings.
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
catch (err) { fail(2, `${BASE} is not serving (${err.message}).`); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));
await page.goto(`${BASE}/dashboard?tab=accounts`, { waitUntil: 'domcontentloaded' });
// Wait for the thing being measured, never a fixed settle - "no cards" and "not mounted yet" are
// the same reading, and a fixed 8s found the segments on one run and missed them on the next.
await page.locator('div.card-forged span.font-display').first()
  .waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});

const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';
for (let i = 0; i < 6 && (await page.locator(OVERLAY).count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const still = page.locator(OVERLAY);
  if (await still.count()) { await still.first().dispatchEvent('click'); await page.waitForTimeout(600); }
}
if (await page.locator(OVERLAY).count()) { await browser.close(); fail(2, 'a modal overlay is still up.'); }

const cards = await page.evaluate(() => {
  // BY SHAPE. A card is one that renders a figure and at least two <p>s - true of the card both
  // before and after the fix, so this still finds it on the day the defect is real. Selecting on
  // anything only the fixed version carries would make a red run print CONTROL FAILED, which is
  // the one diagnosis nobody chases.
  const els = [...document.querySelectorAll('div.card-forged')].filter(c =>
    c.querySelectorAll('p').length >= 2 && c.querySelector('span.font-display'));
  return els.map(c => {
    const meta = [...c.querySelectorAll('p')].find(p => p.className.includes('text-muted-foreground'));
    // The action block is the flex box holding the icon buttons, found by its buttons rather than
    // by its classes.
    const block = [...c.querySelectorAll('div')].find(d =>
      d.querySelectorAll(':scope > button').length >= 2 && !d.querySelector('p'));
    if (!meta || !block) return null;
    const r = document.createRange();
    r.selectNodeContents(meta);
    const ink = r.getBoundingClientRect();
    const mb = meta.getBoundingClientRect();
    const bb = block.getBoundingClientRect();
    return {
      name: (c.querySelector('p')?.textContent || '').trim(),
      metaText: (meta.textContent || '').trim(),
      inkW: Math.round(ink.width),
      // Positive when the buttons sit BELOW the meta line, ~0 when they share it.
      dropPx: Math.round(bb.top - mb.top),
      cardH: Math.round(c.getBoundingClientRect().height),
    };
  }).filter(Boolean);
});

await browser.close();

if (cards.length === 0) {
  fail(2, 'examined ZERO account cards - the probe never reached the list, so nothing below was '
    + 'measured. A clean run and a blind one must not look alike.');
}

// ⚠️ CLASSIFY BY CHARACTER COUNT, NEVER BY RENDERED INK WIDTH. The first version of this gate
// split short from long on ink width, and that is a property the defect itself changes: with a
// never-wrap mutation the long meta lines are CRUSHED to about half their width, so no card
// passed the "long" filter and the gate exited 2 - "the instrument is blind" - over a real
// regression. An exit-1 defect gets fixed; an exit-2 tooling fault gets re-run, then ignored.
// Character count is a property of the CONTENT, so it reads the same in the broken and the fixed
// state and can still sort the cards on the day the defect is real.
// Measured on this walk account: 8-20 characters render 54-146px, 38-61 characters render
// 207-237px. The band between is deliberately unasserted rather than guessed at - a gate that is
// wrong on ordinary work is one somebody switches off on the day it matters.
const SHORT_CHARS = 18;
const LONG_CHARS = 38;
const SAME_LINE = 6;

const shorts = cards.filter(c => c.metaText.length <= SHORT_CHARS);
const longs = cards.filter(c => c.metaText.length >= LONG_CHARS);

console.log(`examined ${cards.length} account card(s) at 390x844`);
for (const c of cards) {
  console.log(`  "${c.name}" ink=${c.inkW} drop=${c.dropPx}px card=${c.cardH}px :: ${c.metaText.slice(0, 54)}`);
}

if (shorts.length === 0) {
  fail(2, `no card has a meta line at or under ${SHORT_CHARS} characters, so the behaviour under test never `
    + 'rendered. This is the instrument being blind, not the app being right.');
}
if (longs.length === 0) {
  fail(2, `no card has a meta line at or over ${LONG_CHARS} characters, so the half that protects long text was `
    + 'never exercised. Without it this gate is satisfied by a layout that never wraps at all.');
}

const stacked = shorts.filter(c => c.dropPx > SAME_LINE);
if (stacked.length) {
  fail(1, `${stacked.length} card(s) with a SHORT meta line still push the action buttons onto a `
    + `line of their own: ${stacked.map(c => `"${c.name}" (ink ${c.inkW}px, drop ${c.dropPx}px)`).join(', ')}. `
    + 'That line is almost entirely blank and it is the empty space Tre reported twice. The usual '
    + 'cause is a FIXED flex-basis on the meta <p>: flex breaks the line from the basis, not from '
    + 'the text, so the wrap fires however short the text is.');
}

const crushed = longs.filter(c => c.dropPx <= SAME_LINE);
if (crushed.length) {
  fail(1, `${crushed.length} card(s) with a LONG meta line now keep the action buttons on the same `
    + `line: ${crushed.map(c => `"${c.name}" (ink ${c.inkW}px)`).join(', ')}. That is the regression `
    + 'the wrap exists to prevent - it crushes the meta text into a few characters per line, which '
    + 'Tre reported with a screenshot ("Brok era...").');
}

console.log(`PASS: ${shorts.length} short-meta card(s) share the action line, `
  + `${longs.length} long-meta card(s) still drop it below.`);
