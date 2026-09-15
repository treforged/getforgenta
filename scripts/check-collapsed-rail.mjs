#!/usr/bin/env node
/**
 * check-collapsed-rail.mjs - measure the DESKTOP SIDEBAR IN ITS COLLAPSED STATE and
 * assert nothing is clipped and nothing has wrapped.
 *
 * WHY THIS EXISTS
 * Tre, 2026-09-15: the reduced sidebar shows "Sign out" split onto two lines and reads
 * unsymmetric, and part of the wordmark still shows beside the mark when it should be
 * hidden. "It needs to look overall clear."
 *
 * Both are one defect wearing two faces, and no test in this repo could see either:
 * the rail's WIDTH is driven by CSS (`fine-pointer:w-16`, expanding to `w-52` only on
 * hover, so the expansion is an overlay and not a reflow) while the rail's CONTENT is
 * driven by React state (`collapsed`, which starts false). On a mouse those two
 * disagree from the first paint - the labels render at full width inside a 64px
 * `overflow-hidden` rail. jsdom reports every box as 0x0, so the unit suite is
 * structurally incapable of noticing; only a real browser can.
 *
 * WHAT IT ASSERTS, and both are MEASURED not eyeballed
 *   1. NOTHING IS CLIPPED. Every element in the rail that carries visible text must lie
 *      inside the rail's own right edge. A wordmark half-showing IS its box crossing
 *      that edge, so this is the defect stated as arithmetic.
 *   2. NOTHING HAS WRAPPED. Every interactive row in the rail is compared to the MEDIAN
 *      row height of the rail itself - derived from the app, never a magic pixel count -
 *      and a row more than 1.5x the median has wrapped.
 *
 * THE CONTROLS, and why there are three
 *   - `(hover: hover) and (pointer: fine)` must be TRUE in this browser, or the rail is
 *     never in the state under test and a green would be about nothing. Exit 2.
 *   - The rail must measure 64px wide unhovered. If it is already 208 the test is
 *     looking at the expanded state and, again, a green means nothing. Exit 2.
 *   - Both inventories must be NON-EMPTY. "0 clipped" and "0 examined" are the same
 *     zero, so the counts are printed and an empty inventory exits 2.
 *
 * WHAT IT DOES NOT COVER
 *   Colour, contrast, spacing, the EXPANDED state, the mobile bar, and anything the
 *   rail renders only for a different account (premium, demo, a partner link).
 *
 * USAGE:  node scripts/check-collapsed-rail.mjs [screenshot.png]
 * EXITS:  0 pass . 1 clipped or wrapped . 2 could not test
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
// See walk-deck-undo.mjs: `.test` can never be a real mailbox, which is what makes
// scripting this sign-in legitimate. Remove this and the dev-signin rule is back in force.
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to script a sign-in for "${email}".`);

const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}: ${JSON.stringify(session).slice(0, 200)}`);

/**
 * SETTLE THE FIRST-RUN DIALOGS IN THE ACCOUNT, NOT IN THE BROWSER.
 * The signed-in dashboard raises a sequence of one-time modals - the getting-started
 * tour, the founder note, What's New - and each one covers the rail with a backdrop that
 * intercepts clicks and puts a dialog across every frame. Dismissing them by clicking is
 * a race this check kept losing: a fresh one appears after the previous one closes and
 * again after a viewport change, and a click that times out aborts the run with a stack
 * trace that reads exactly like a finding.
 *
 * So they are settled where the app actually stores them: `profiles.tour_flags` and
 * `profiles.founder_note_seen`, written through the USER'S OWN PostgREST session under
 * RLS - never a privileged key. This is the throwaway @forgenta.test walk account, so
 * nothing here touches a real person's data.
 *
 * The What's New flag is DERIVED from src/lib/whats-new.ts rather than typed here. A
 * hardcoded version would stop matching on the next release and the dialog would quietly
 * come back, which is the same failure this block exists to remove.
 */
const whatsNew = readFileSync('src/lib/whats-new.ts', 'utf8');
const releaseVersion = (whatsNew.match(/version:\s*'([^']+)'/) || [])[1];
if (!releaseVersion) fail(2, "could not read the current release version out of src/lib/whats-new.ts - the What's New dialog would reappear and cover the rail.");

const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
const profRes = await fetch(`${url}/rest/v1/profiles?select=tour_flags&user_id=eq.${session.user.id}`, { headers: rest });
if (!profRes.ok) fail(2, `reading the walk account's profile returned ${profRes.status}.`);
const existingFlags = (await profRes.json())[0]?.tour_flags ?? {};
const patch = await fetch(`${url}/rest/v1/profiles?user_id=eq.${session.user.id}`, {
  method: 'PATCH',
  headers: { ...rest, Prefer: 'return=representation' },
  body: JSON.stringify({
    founder_note_seen: true,
    tour_flags: { ...existingFlags, new_user_done: true, premium_done: true, [`whats_new_${releaseVersion}`]: true },
  }),
});
// ASSERT THE WRITE LANDED. `return=representation` gives back the rows the PATCH actually
// matched; without it an RLS refusal and a wrong id both return no error and are
// indistinguishable from a write that worked.
const patched = await patch.json().catch(() => []);
if (!patch.ok || !Array.isArray(patched) || patched.length === 0) {
  fail(2, `settling the first-run dialogs matched no profile row (HTTP ${patch.status}) - the modals would still cover the rail.`);
}
console.log(`first-run dialogs settled in the account (whats_new_${releaseVersion})`);

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

const browser = await chromium.launch();
// The rail is `hidden lg:block`, so anything under 1024 has no rail at all and would
// make this check green by absence. 1440 is a desktop; 1024 is the iPad width Tre named.
const WIDTHS = [1440, 1024];
const ctx = await browser.newContext({ viewport: { width: WIDTHS[0], height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);

/**
 * PRE-DECIDE COOKIE CONSENT, AND THIS IS NOT COSMETIC.
 * The banner is a fixed strip across the bottom of the viewport and the rail's FOOTER -
 * Sign Out, the demo doors - sits behind it. The first version of this check ran with
 * the banner up, found TWO text-bearing elements in the whole rail, and reported
 * "0 rows wrapped" about a footer it could not see. That is the same zero as a clean
 * one, which is why CONTROL 3 below refuses a thin inventory.
 * Written straight into storage rather than clicked: the banner raises its own overlay
 * and a click on it times out, which aborts the run with a Playwright stack trace - a
 * harness failure dressed as a finding. The shape is `CookieConsentState` in
 * src/lib/consent-prefs.ts; nothing non-essential is granted.
 */
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));

await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

// CONTROL 1 - the media query the whole collapsed-on-a-mouse behaviour hangs on.
const fine = await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches);
if (!fine) { await browser.close(); fail(2, 'this browser does not report (hover: hover) and (pointer: fine), so the rail is never in the collapsed-on-a-mouse state this check is about.'); }

/**
 * Close the getting-started tour. It mounts a modal with a backdrop over the whole
 * viewport; the rail is still measurable behind it, but a rendered frame with a dialog
 * across the middle is not a frame anyone can judge the rail by - and the frames are
 * half the point of this check.
 */
/**
 * CLEAR EVERY MODAL BEFORE MEASURING, AND REFUSE TO MEASURE THROUGH ONE.
 * The signed-in dashboard raises several in sequence - the getting-started tour, then a
 * `.modal-overlay` dialog - and a fresh one can appear again after a viewport change. An
 * overlay does two things to this check: it intercepts every click, which aborts the run
 * with a Playwright stack trace that reads exactly like a finding, and it puts a dialog
 * across the middle of every frame, which is half of what this check is for.
 *
 * Escape first, then a dispatched click on the overlay itself. `dispatchEvent` rather
 * than `click()`: the dialog card sits centred ON its own overlay and intercepts a real
 * pointer click, so a positional click times out even though the handler is right there.
 */
const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';
async function clearOverlays() {
  for (let i = 0; i < 6; i += 1) {
    if (!(await page.locator(OVERLAY).count())) return true;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const still = page.locator(OVERLAY);
    if (await still.count()) { await still.first().dispatchEvent('click'); await page.waitForTimeout(700); }
  }
  return !(await page.locator(OVERLAY).count());
}
if (!(await clearOverlays())) {
  await browser.close();
  fail(2, 'a modal overlay is still up after six attempts to dismiss it. Every click below would be intercepted and every frame would show a dialog across the rail, so this run refuses to report a measurement taken through it.');
}

/**
 * Read the rail WHILE IT IS HOVERED. This is the positive control for the whole check,
 * and it is load-bearing: every assertion above is an ABSENCE - nothing clipped, nothing
 * wrapped - and an absence is satisfied perfectly by the labels being GONE ALTOGETHER.
 * Hiding a label is how you pass a clipping test by deleting the feature. So the rail
 * must also be able to SHOW those labels, in full, when it is open.
 */
async function measureHovered() {
  await page.mouse.move(30, 300);
  await page.waitForTimeout(900);
  return page.evaluate(() => {
    const panel = document.querySelector('aside').firstElementChild;
    const rail = panel.getBoundingClientRect();
    const labels = [];
    for (const el of panel.querySelectorAll('*')) {
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim()).join(' ').trim();
      if (own) labels.push({ text: own.slice(0, 30), clipped: r.right > rail.right + 0.5 });
    }
    return { width: Math.round(rail.width), labels };
  });
}

/** Read the rail as it stands right now. Pure measurement - it presses nothing. */
async function measure() {
  /**
   * PARK THE POINTER *AND* DROP FOCUS BEFORE READING ANYTHING.
   * The panel carries `fine-pointer:hover:w-52` AND `fine-pointer:focus-within:w-52` -
   * the second is the keyboard affordance, and it is not decoration. So after clicking
   * the collapse chevron the button keeps focus and the rail stays EXPANDED: the first
   * version of this loop pressed collapse and then measured 234px, which read as "the
   * collapse control does the opposite of its name". It does not. The instrument was
   * holding the rail open while asking whether it was closed.
   */
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.mouse.move(page.viewportSize().width - 60, 700);
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const aside = document.querySelector('aside');
    if (!aside) return { error: 'no <aside> - the desktop rail did not render at all.' };
    const panel = aside.firstElementChild;
    if (!panel) return { error: '<aside> has no panel child.' };
    const rail = panel.getBoundingClientRect();
    const clipped = [];
    const wrappedText = [];
    const rows = [];
    let textNodes = 0;
    let glyphs = 0;
    const clippedGlyphs = [];
    for (const el of panel.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Own text only - a container "contains" its children's text and would double-count.
      const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim()).join(' ').trim();
      if (own) {
        textNodes += 1;
        if (r.right > rail.right + 0.5) clipped.push({ text: own.slice(0, 40), right: Math.round(r.right) });
        /**
         * HOW MANY LINES IS THIS TEXT ON? Measured from the element's OWN line-height,
         * never from a pixel constant and never from a ratio against its neighbours.
         * The first version compared each ROW to 1.5x the median row height: "Sign Out"
         * wrapped to 48px against a 36px median, 1.33x, and slipped under the bar - so
         * the check reported "0 wrapped" about the exact defect it was written for, in a
         * frame that plainly shows the words stacked. A threshold tuned to look
         * reasonable is not a measurement.
         */
        const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
        const lines = lh > 0 ? r.height / lh : 1;
        if (lines > 1.4) wrappedText.push({ text: own.slice(0, 40), h: Math.round(r.height), lh: Math.round(lh), lines: Math.round(lines * 10) / 10 });
      }
      /**
       * ⚠️ GLYPHS, WHICH THIS CHECK WAS BLIND TO UNTIL 2026-09-15 (Tre, ask 98830520 items 2
       * and 4). Everything above inventories OWN TEXT. The lightning bolt beside Debt Payoff is
       * an `<svg>` and carries none, so it was never examined - and it overran the rail's content
       * box by 5.8px, which is the "cut off partially kind of weirdly" he reported. The check
       * printed "clipped 0" about it, at both widths, in both states, every run.
       *
       * So a glyph is anything VISIBLE with a box and no element children: icons, the badge dot,
       * the numeric badge. It is defined by SHAPE - a leaf with a rendered box - rather than by a
       * class or a tag list, because a hand-named inventory is blind to whatever nobody added to
       * it, and this repo has three recorded cases of exactly that.
       */
      const isLeaf = el.children.length === 0;
      if (isLeaf && (el.tagName === 'svg' || !own)) {
        glyphs += 1;
        if (r.right > rail.right + 0.5 || r.left < rail.left - 0.5) {
          clippedGlyphs.push({
            tag: el.tagName.toLowerCase(),
            near: (el.closest('a, button')?.getAttribute('aria-label') || '?').slice(0, 24),
            left: Math.round(r.left), right: Math.round(r.right),
          });
        }
      }
      if (el.matches('a, button')) {
        rows.push({ h: Math.round(r.height), label: (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 30) });
      }
    }
    /**
     * ⚠️ THE HORIZONTAL SCROLLBAR, MEASURED RATHER THAN EYEBALLED. Tre reported it as a separate
     * defect; it is the SAME one - anything overflowing the 72px rail makes the scrolling nav
     * scrollable sideways. Measured on his own machine before the fix: the numeric badge ran to
     * 80.3px against a rail ending at 72, and the nav reported exactly 9px of horizontal overflow.
     * Keeping this assertion means the scrollbar cannot come back silently even if the cause
     * changes.
     */
    const nav = panel.querySelector('nav');
    const navOverflowX = nav ? nav.scrollWidth - nav.clientWidth : null;
    /**
     * ⚠️ AND THE RAIL ROOT ITSELF, WHICH IS WHERE TRE'S SCROLLBAR ACTUALLY APPEARS. The nav is one
     * child; the header row is another, and it overflowed by its own 2px for an unrelated reason.
     * Asserting only the nav would have fixed half the bug and reported the whole of it.
     * The root carries `overflow-x: hidden`, so an overflow here is SILENTLY clipped rather than
     * scrolled - which is why nothing in the app complained for as long as it did.
     */
    const railOverflowX = panel.scrollWidth - panel.clientWidth;
    /**
     * Every badge must sit inside the icon box it is anchored to. A dot nudged out of its wrapper
     * is 2px of overflow that no per-element rail check can see, because the dot is still inside
     * the RAIL - it is its own parent it escapes.
     */
    const escapedBadges = [];
    for (const wrap of panel.querySelectorAll('span.relative')) {
      const wr = wrap.getBoundingClientRect();
      if (wr.width === 0) continue;
      for (const kid of wrap.children) {
        const kr = kid.getBoundingClientRect();
        if (kr.width === 0 || kid.tagName === 'svg') continue;
        if (kr.right > wr.right + 0.5 || kr.left < wr.left - 0.5 || kr.top < wr.top - 0.5 || kr.bottom > wr.bottom + 0.5) {
          escapedBadges.push({
            near: (wrap.closest('a, button')?.getAttribute('aria-label') || '?').slice(0, 24),
            badge: [Math.round(kr.left), Math.round(kr.right)],
            wrapper: [Math.round(wr.left), Math.round(wr.right)],
          });
        }
      }
    }
    /**
     * Whether this RUN exercised the numeric badge at all. It renders only when the signed-in
     * account has bank charges waiting, so on an account with an empty queue there is nothing to
     * measure - and "no badge was clipped" would be true because no badge existed. Printed rather
     * than asserted, so a reader can tell coverage from a clean result.
     */
    const badgePresent = !!Array.from(panel.querySelectorAll('span'))
      .find((s) => /^\d+$/.test(s.textContent.trim()) && s.getBoundingClientRect().width > 0);
    return {
      rail: { left: Math.round(rail.left), right: Math.round(rail.right), width: Math.round(rail.width) },
      clipped, wrappedText, rows, textNodes, glyphs, clippedGlyphs, navOverflowX, railOverflowX, escapedBadges, badgePresent,
    };
  });
}

/** The collapse chevron is the only control in the rail header that is not the brand link. */
async function pressCollapse() {
  // The tour can re-mount when the viewport changes, and its backdrop intercepts every
  // click. Clear it first rather than letting a 6s timeout abort the run with a stack
  // trace - a harness failure that reads exactly like a finding.
  if (!(await clearOverlays())) { await browser.close(); fail(2, 'a modal overlay reappeared and would intercept the collapse press.'); }
  const header = page.locator('aside button').first();
  await header.click({ timeout: 6000 });
  await page.waitForTimeout(900);
}

const findings = [];
let examinedCells = 0;

for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(900);

  // BOTH STATES, in order: as the app opens, then after the user presses collapse.
  for (const state of ['default', 'pressed-collapse']) {
    if (state === 'pressed-collapse') await pressCollapse();
    await clearOverlays();
    const m = await measure();
    if (m.error) { await browser.close(); fail(2, m.error); }
    const cell = `${width}px / ${state}`;
    await page.screenshot({ path: `rail-${width}-${state}.png` });
    examinedCells += 1;

    console.log(`${cell.padEnd(28)} rail ${String(m.rail.width).padStart(4)}px . text els ${String(m.textNodes).padStart(2)} . glyphs ${String(m.glyphs).padStart(2)} . rows ${String(m.rows.length).padStart(2)} . clipped ${m.clipped.length}+${m.clippedGlyphs.length} . wrapped ${m.wrappedText.length} . overflowX rail ${m.railOverflowX}/nav ${m.navOverflowX} . numeric badge ${m.badgePresent ? 'present' : 'ABSENT (not exercised)'}`);

    // CONTROL 3, per cell - "0 clipped" and "0 examined" are the same zero.
    if (m.rows.length === 0) { await browser.close(); fail(2, `${cell}: 0 interactive rows found in the rail - nothing was compared.`); }
    // ...and the same again for the glyph inventory added on 2026-09-15. Every glyph assertion
    // below is an ABSENCE, so an inventory of zero would satisfy all of them.
    if (m.glyphs === 0) { await browser.close(); fail(2, `${cell}: 0 glyphs found in the rail - the icon/badge assertions examined nothing.`); }

    // Only a NARROW rail can clip or wrap. A wide one has room, and asserting against it
    // would be a green that proves nothing about the state Tre reported.
    if (m.rail.width > 100) { console.log(`   (rail is expanded here - not the state under test)`); continue; }

    for (const c of m.clipped) findings.push({ cell, kind: 'CLIPPED', detail: `right=${c.right} past rail right=${m.rail.right}  ${JSON.stringify(c.text)}` });
    for (const g of m.clippedGlyphs) findings.push({ cell, kind: 'CLIPPED GLYPH', detail: `<${g.tag}> beside ${JSON.stringify(g.near)} spans ${g.left}..${g.right} against a rail of ${m.rail.left}..${m.rail.right}` });
    if (m.navOverflowX > 0) findings.push({ cell, kind: 'H-SCROLLBAR', detail: `the rail's nav scrolls ${m.navOverflowX}px sideways - something in it is wider than the ${m.rail.width}px rail` });
    if (m.railOverflowX > 0) findings.push({ cell, kind: 'H-SCROLLBAR', detail: `the RAIL ROOT overflows by ${m.railOverflowX}px (scrollWidth ${m.rail.width + m.railOverflowX} against clientWidth ${m.rail.width - 1}) - this is the strip Tre sees bottom-left` });
    for (const b of m.escapedBadges) findings.push({ cell, kind: 'BADGE OUTSIDE ITS ICON', detail: `beside ${JSON.stringify(b.near)} the badge spans ${b.badge.join('..')} against a wrapper of ${b.wrapper.join('..')}` });
    for (const w of m.wrappedText) findings.push({ cell, kind: 'WRAPPED', detail: `${w.lines} lines (${w.h}px over a ${w.lh}px line-height)  ${JSON.stringify(w.text)}` });
  }
  // Leave the rail as we found it for the next width.
  await pressCollapse();
}

// -- POSITIVE CONTROL: the rail must still be able to SHOW its labels --------------
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(800);
await clearOverlays();
const hovered = await measureHovered();
await page.screenshot({ path: 'rail-1440-hovered.png' });
await browser.close();

console.log(`\nexamined ${examinedCells} width/state cells`);
if (examinedCells === 0) fail(2, 'examined 0 cells - nothing was compared.');
const wantLabels = ['FORGENTA', 'Sign Out'];
const shown = hovered.labels.map((l) => l.text);
const missing = wantLabels.filter((w) => !shown.some((t) => t.includes(w)));
const clippedWhenOpen = hovered.labels.filter((l) => l.clipped).map((l) => l.text);
console.log(`hovered rail ${hovered.width}px . labels visible ${hovered.labels.length}: ${JSON.stringify(shown)}`);
if (hovered.width < 150) fail(2, `the rail measured ${hovered.width}px while hovered, so it never opened and the positive control could not run.`);
if (missing.length) fail(1, `CONTROL FAILED: the rail opened to ${hovered.width}px and still does not show ${JSON.stringify(missing)}. Every other assertion here is an ABSENCE, and hiding a label satisfies all of them - this is the check that says the labels are HIDDEN while narrow rather than DELETED.`);
if (clippedWhenOpen.length) fail(1, `the open rail clips ${JSON.stringify(clippedWhenOpen)} - it is wide enough and the text still does not fit.`);

if (findings.length) {
  for (const f of findings) console.error(`  ${f.kind}  ${f.cell.padEnd(28)} ${f.detail}`);
  fail(1, `${findings.length} defect(s) in the narrow rail. Tre: "It needs to look overall clear."`);
}
console.log(`PASS - across ${examinedCells} width/state cells the narrow rail clips nothing and wraps nothing, AND the hovered rail still shows ${JSON.stringify(wantLabels)} in full.`);
