#!/usr/bin/env node
/**
 * check-panel-rows.mjs - every segmented panel bar renders as ONE ROW on a phone.
 *
 * WHY THIS EXISTS
 * Tre, 2026-09-16, with a screenshot of Settings: *"format the pill in the settings tab
 * cleaner."* The `seg-track` was `flex-wrap`, so a set of segments wider than the viewport
 * broke onto a second line and the remainder read as a stray button floating beneath the pill
 * rather than as part of it. A pill is one row; when it does not fit, it scrolls.
 *
 * MEASURED AT 390px BEFORE THE FIX - four of nine routes were wrapping:
 *     /settings  4 segs, needs 435px in 363px -> 2 rows   (the one he photographed)
 *     /debt      5 segs, needs 730px in 363px -> 3 rows
 *     /account   3 segs, needs 364px in 363px -> 2 rows   (over by ONE pixel)
 *     /accounts  2 segs, needs 286px in 222px -> 2 rows
 *
 * ⚠️ WHY THIS GATES THE PILL AND NOT THE STACKED PAGE HEADERS, which he reported in the same
 * breath ("some other tabs also have this issue. big blank spaces"). A wrapped pill is
 * objectively wrong everywhere - it is one control broken across two lines. A stacked header is
 * a JUDGEMENT: on Settings, Garage and Accounts the second row held one small Guide button and
 * an empty top-right, so it was waste; on Dashboard the second row holds two real action buttons
 * and Tre himself asked for it to be centred there on 2026-08-19, and on Forecast the Guide is
 * already on the title row. A gate that failed those two would be wrong on ordinary work, and a
 * gate that is wrong on ordinary work is the one somebody switches off on the day it matters.
 * So the headers were fixed by measurement and left ungated, deliberately, and this says so
 * rather than letting a future reader assume the whole class is covered.
 *
 * WHAT IT ASSERTS, per route, at 390x844, signed in:
 *   1. Every `.seg-track` puts all its segments on ONE row (one distinct `top` among children).
 *   2. The active segment is WITHIN its track's visible box - because `flex-nowrap` without
 *      `PanelBar`'s scroll-into-view would hide the selected segment offscreen on Debt, with
 *      `scrollbar-width: none` leaving no hint anything is there. That would be WORSE than the
 *      wrap it replaced: a wrapped segment is at least visible.
 *
 * POSITIVE CONTROL: at least one track with MORE segments than fit must be found, or this is
 * measuring only the easy cases. Debt needs 730px in 363px and is the intended witness. If no
 * overflowing track is seen at all, the run exits 2 rather than passing - a suite that only ever
 * meets tracks that would fit anyway proves nothing about nowrap.
 *
 * WHAT IT DOES NOT COVER
 *   Colour, spacing, the look of the pill, desktop widths, whether the right segment is
 *   selected, and page headers (see above).
 *
 * USAGE:  node scripts/check-panel-rows.mjs
 * EXITS:  0 pass . 1 a pill wraps or hides its selection . 2 could not test
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };

const ROUTES = ['/dashboard', '/transactions', '/debt', '/vehicles', '/account', '/settings', '/accounts', '/forecast', '/goals'];

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
if (!patch.ok) fail(2, `settling the first-run dialogs returned HTTP ${patch.status}.`);

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));

const failures = [];
let tracksSeen = 0;
let overflowingSeen = 0;

for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const tracks = await page.evaluate(() => [...document.querySelectorAll('.seg-track')].map((t) => {
    const tr = t.getBoundingClientRect();
    const kids = [...t.children];
    const boxes = kids.map((k) => k.getBoundingClientRect());
    const active = t.querySelector('[aria-selected="true"], .seg-item-active');
    const ar = active ? active.getBoundingClientRect() : null;
    return {
      segs: kids.length,
      rows: new Set(boxes.map((b) => Math.round(b.top))).size,
      trackW: Math.round(tr.width),
      // ⚠️ `trackW` IS THE TRACK'S OWN FITTED BOX, NOT THE ROOM IT HAS. `seg-track` is
      // `width: fit-content` + `max-w-full`, so on a pill that FITS the box simply equals its
      // content and `trackW - needed` is a constant of the `needed` formula - it read exactly
      // 7px of "slack" on two different pills whose content differed by 46px. It only becomes a
      // real measurement when `max-w-full` CLAMPS it, which is the overflow case. So the space
      // the pill is competing for is the PARENT's content box, and that is what a fit test has
      // to use. Measured, not reasoned: shortening a label moved `needed` 286->240 and `trackW`
      // 293->247, leaving the difference unchanged.
      // ⚠️ AND THE PARENT'S FULL WIDTH IS NOT IT EITHER. On the Accounts pill the parent is a
      // flex row the pill SHARES with the "+ Add Account" button, so the parent reads the full
      // 363px while the pill is competing for what the button leaves. The room is the parent's
      // box minus every SIBLING that draws one, minus the gaps. That is the number that moved
      // when the button went icon-only, and it is the only one of the three that did.
      availW: (() => {
        const p = t.parentElement;
        if (!p) return null;
        const cs = getComputedStyle(p);
        const pw = p.getBoundingClientRect().width;
        // ⚠️ ONLY SUBTRACT SIBLINGS WHEN THEY ACTUALLY SHARE THE ROW. In a plain block parent the
        // "siblings" are the page's other sections stacked BELOW the pill, and subtracting them
        // produced -363px of room on five routes. Measured, and it is the reason this guard
        // exists rather than a tidier-looking formula.
        if (cs.display !== 'flex' || cs.flexDirection.startsWith('column')) return Math.round(pw);
        const gap = parseFloat(cs.columnGap) || 0;
        let taken = 0;
        let drawn = 0;
        for (const sib of p.children) {
          if (sib === t) { drawn += 1; continue; }
          const w = sib.getBoundingClientRect().width;
          if (w > 0) { taken += w; drawn += 1; }
        }
        return Math.round(pw - taken - gap * Math.max(0, drawn - 1));
      })(),
      needed: Math.round(boxes.reduce((a, b) => a + b.width, 0) + 4 * kids.length),
      labels: kids.map((k) => (k.innerText || '').replace(/\s+/g, ' ').trim()).join(' | '),
      hasActive: !!active,
      activeVisible: ar ? (ar.left >= tr.left - 1 && ar.right <= tr.right + 1) : null,
      activeLabel: active ? (active.innerText || '').replace(/\s+/g, ' ').trim() : null,
    };
  }));
  for (const t of tracks) {
    tracksSeen += 1;
    if (t.needed > t.trackW) overflowingSeen += 1;
    console.log(`${route.padEnd(13)} ${t.segs} segs, ${t.rows} row(s), needs ${t.needed}px, box ${t.trackW}px, row offers ${t.availW}px  [${t.labels}]`);
    if (t.rows > 1) {
      failures.push(`${route}: the pill wraps onto ${t.rows} rows (${t.segs} segments needing ${t.needed}px in ${t.trackW}px). A pill is one row - when it does not fit it must SCROLL. Segments: ${t.labels}`);
    }
    // ⚠️ A SMALL PILL MUST *FIT*, NOT SCROLL - Tre, 2026-09-16, with a screenshot of the
    // Accounts tab: *"that pill is kind of truncated and it should all show at once without
    // scrolling."* Scrolling is the RIGHT answer for Debt's five segments and the WRONG one for
    // a two-segment pill, so this does not undo the nowrap work above - it draws the line.
    // Scoped to <= 2 segments on purpose: /account has THREE needing 364px in 363px, over by one
    // pixel, which is the same family but a different surface and a different label decision. It
    // is recorded in handoff.md rather than swept in here, because a gate that also demands a
    // label change nobody has agreed to is a gate somebody switches off.
    if (t.segs <= 2 && t.needed > t.trackW) {
      failures.push(`${route}: a ${t.segs}-segment pill SCROLLS - it needs ${t.needed}px and has ${t.trackW}px, so part of it is cut off. A pill this small must show all of itself at once; take the width back from whatever shares its row. Segments: ${t.labels}`);
    } else if (t.segs <= 2 && t.availW !== null && t.availW - t.needed < 20) {
      // Not a failure: it fits today. But the count badge is DATA - the walk account carries 5
      // accounts where Tre carries 16, and a second digit is about 6px - so a pass with a few
      // pixels in hand is a pass that fails on his phone. Printed rather than thrown, because
      // where to draw that line is a judgement and a gate that is wrong on ordinary work is the
      // one somebody switches off. Measured against the PARENT's width for the reason above.
      console.log(`${' '.repeat(13)} TIGHT: ${t.availW - t.needed}px of room in its row - a two-digit count badge would eat most of that.`);
    }
    if (t.hasActive && t.activeVisible === false) {
      failures.push(`${route}: the SELECTED segment ${JSON.stringify(t.activeLabel)} is scrolled outside its own track, and there is no scrollbar to hint it exists. PanelBar's scroll-into-view is what makes flex-nowrap safe; without it this is worse than the wrap it replaced.`);
    }
  }
}
await browser.close();

console.log(`\nexamined ${tracksSeen} panel bar(s) across ${ROUTES.length} routes; ${overflowingSeen} of them need more width than they have`);
if (tracksSeen === 0) fail(2, 'found ZERO panel bars across every route - the selector is not matching, so "no wrapping" would mean nothing.');
if (overflowingSeen === 0) {
  fail(2, 'every panel bar found FITS its track, so nothing here exercised the overflow path. This check is about what happens when segments do NOT fit (Debt needs 730px in 363px) - with no such case seen, a pass proves nothing about flex-nowrap.');
}
if (failures.length) {
  console.error('');
  for (const f of failures) console.error(`  ${f}`);
  fail(1, `${failures.length} panel bar problem(s).`);
}
console.log(`PASS - all ${tracksSeen} panel bars render as ONE row at 390px, including ${overflowingSeen} that overflow and scroll, and every selected segment is visible within its track.`);
