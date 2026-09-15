#!/usr/bin/env node
/**
 * check-mobile-squeeze.mjs - find text that has been SQUEEZED into a narrow column on a
 * phone, because something beside it refused to give up any width.
 *
 * WHY THIS EXISTS
 * Found 2026-09-15 in a rendered frame while checking something else: the two-factor
 * banner on /dashboard at 390px put its headline on SEVEN lines - "Your / account / has /
 * no / two- / factor / protection" - because the "Secure my account" button carries
 * `shrink-0` and the text column carried no `min-w-0`, so the button kept its ~190px and
 * the sentence got what was left. It is legible, nothing overflows, nothing throws, and
 * it is the second thing a new user sees.
 *
 * ⚠️ NO EXISTING CHECK COULD SEE IT. jsdom reports every box as 0x0, so the 4,592-test
 * suite is structurally incapable of measuring a wrap. `check:rail` reads line counts but
 * only inside the sidebar. A class-list scan cannot see it at all, because every class
 * involved is individually correct - the defect is the ARITHMETIC of them together.
 *
 * WHAT IT MEASURES, and why it is two conditions and not one
 * A long paragraph on many lines is normal and must not be flagged. A SQUEEZE is
 * different in a way that can be stated as numbers: the text is on many lines AND it has
 * been given a small share of the width available to it. So an element is reported only
 * when BOTH hold:
 *   - its own text wraps to 4 or more lines, measured against its OWN computed
 *     line-height rather than a pixel constant, and
 *   - its box is under 55% of its nearest block-level ancestor's content width.
 * A full-width paragraph of four lines passes. A four-word sentence pressed into a 120px
 * column does not.
 *
 * THE CONTROLS
 *   - The viewport must actually be narrow and the page must have rendered: the inventory
 *     of text elements is printed and an empty one exits 2, because "0 squeezed" and
 *     "0 examined" are the same output.
 *   - Line counts come from each element's own line-height; an element reporting a
 *     line-height of 0 or `normal` with no font size is skipped and COUNTED as skipped,
 *     never silently dropped.
 *
 * WHAT IT DOES NOT COVER
 *   Overflow, clipping, contrast, anything off the routes it opens, and any squeeze that
 *   happens to stay under four lines. It is a floor, not a proof of good layout.
 *
 * USAGE:  node scripts/check-mobile-squeeze.mjs
 * EXITS:  0 pass . 1 squeezed text found . 2 could not test
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

const ROUTES = ['/dashboard', '/transactions', '/debt', '/account', '/settings'];

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

const MIN_LINES = 4;
const MAX_WIDTH_SHARE = 0.55;

const findings = [];
let examined = 0;
let skipped = 0;

for (const route of ROUTES) {
  await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
  /**
   * WAIT ON A SIGNAL THE APP ITSELF RAISES, NOT ON A STOPWATCH. Dashboard.tsx sets
   * `window.__forgenta_dashboard_ready` when it has mounted. A fixed timeout is a guess
   * about a machine's speed: at 9 seconds this check twice measured a page of loading
   * skeletons - 8 text elements against 234 on a good run - and on the first of those it
   * reported "0 squeezed" about content that had not arrived. The per-route floor below
   * is the backstop for every page that raises no such signal.
   */
  await page.waitForFunction(() => window.__forgenta_dashboard_ready === true, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(6000);
  if (!(await clearOverlays())) { await browser.close(); fail(2, `${route}: a modal overlay would not close, so the page underneath could not be measured.`); }

  const r = await page.evaluate(([minLines, maxShare]) => {
    const out = [];
    let seen = 0;
    let skip = 0;
    for (const el of document.querySelectorAll('body *')) {
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') continue;
      const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim()).join(' ').trim();
      if (!own) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;

      const lh = parseFloat(st.lineHeight) || parseFloat(st.fontSize) * 1.2;
      if (!lh || !Number.isFinite(lh)) { skip += 1; continue; }
      seen += 1;
      const lines = box.height / lh;
      if (lines < minLines) continue;

      /**
       * ⚠️ COMPARE AGAINST THE PAGE COLUMN, NOT THE IMMEDIATE PARENT - and the first
       * version of this got it wrong in a way that hid the exact defect it was written
       * for. A squeezed <p> fills its own squeezed <div> completely, so measured against
       * that parent its share is ~100% and it reads as perfectly comfortable. The
       * squeeze is one level up. So walk out to the nearest ancestor that actually
       * spans the screen and ask what share of THAT the text was given.
       */
      const isMultiColumnGrid = (node) => {
        const cs = getComputedStyle(node);
        return cs.display.includes('grid')
          && cs.gridTemplateColumns.split(' ').filter(Boolean).length > 1;
      };
      let column = el.parentElement;
      let insideMultiColumnGrid = false;
      while (column && column.getBoundingClientRect().width < innerWidth * 0.8) {
        if (isMultiColumnGrid(column)) insideMultiColumnGrid = true;
        column = column.parentElement;
      }
      if (!column) column = document.body;
      /**
       * ⚠️ AND TEST THE COLUMN ITSELF, WHICH THE LOOP NEVER REACHED. The loop STOPS at the
       * first ancestor wide enough to be the page column - and on /dashboard that ancestor
       * IS the two-column grid making the tile narrow. So the exemption below was written
       * for "above floor / monthly burn" by name, and could never fire for it: the only
       * node that could have set the flag was the one node the loop excluded by
       * construction. Measured 2026-09-15 - the gate was RED on main over the exact
       * element its own comment says is out of scope.
       */
      if (column !== document.body && isMultiColumnGrid(column)) insideMultiColumnGrid = true;
      /**
       * ⚠️ A MULTI-COLUMN GRID IS A DELIBERATE DECISION TO MAKE BOXES NARROW, so text
       * inside one is out of scope and saying so is the point. The metric tiles on
       * /dashboard put "above floor / monthly burn" on four lines in 57px, and the first
       * version of this check reported it beside the real finding. It is not the same
       * thing: the banner's headline was squeezed because a SIBLING in a full-width row
       * refused to shrink, while a tile is narrow because somebody chose a two-column
       * grid. A gate that is wrong on ordinary work is one somebody switches off on the
       * day it matters, and widening the threshold instead would have been the version
       * that passes by lying. THE COST, stated rather than hidden: a genuine squeeze
       * inside a grid cell is now invisible to this check.
       */
      if (insideMultiColumnGrid) continue;
      const pBox = column.getBoundingClientRect();
      if (pBox.width === 0) continue;
      const share = box.width / pBox.width;
      if (share >= maxShare) continue;

      out.push({
        text: own.slice(0, 50),
        lines: Math.round(lines * 10) / 10,
        width: Math.round(box.width),
        parentWidth: Math.round(pBox.width),
        share: Math.round(share * 100),
      });
    }
    return { out, seen, skip };
  }, [MIN_LINES, MAX_WIDTH_SHARE]);

  examined += r.seen;
  skipped += r.skip;
  console.log(`  ${route.padEnd(15)} text elements ${String(r.seen).padStart(4)} . skipped ${r.skip} . squeezed ${r.out.length}`);
  /**
   * ⚠️ A PER-ROUTE FLOOR, AND IT CAUGHT THIS CHECK BEING WRONG ON ITS FIRST RUN.
   * The first version waited 5s and found EIGHT text elements on /dashboard against 302
   * on /transactions - it was measuring a page of loading skeletons and reporting
   * "0 squeezed" about content that had not arrived. A thin inventory and a clean page
   * produce the same line. The floor is deliberately low: it is there to separate "this
   * page never rendered" from "this page is fine", not to judge how much text a screen
   * should have.
   */
  if (r.seen < 15) {
    await page.screenshot({ path: `squeeze-thin${route.replace(/\//g, '-')}.png`, fullPage: true });
    await browser.close();
    fail(2, `${route}: only ${r.seen} text-bearing elements were found, which is a page that had not finished rendering rather than a page with nothing on it. Refusing to report "0 squeezed" about content that was not there.`);
  }
  for (const f of r.out) findings.push({ route, ...f });
  if (r.out.length) await page.screenshot({ path: `squeeze${route.replace(/\//g, '-')}.png`, fullPage: true });
}

await browser.close();

console.log(`\nexamined ${examined} text-bearing elements across ${ROUTES.length} routes (${skipped} skipped for an unreadable line-height)`);
if (examined === 0) fail(2, 'examined 0 text elements - nothing was compared, so a pass would be a statement about an empty set.');

if (findings.length) {
  for (const f of findings) {
    console.error(`  SQUEEZED  ${f.route}  ${f.lines} lines in ${f.width}px, ${f.share}% of its ${f.parentWidth}px parent  ${JSON.stringify(f.text)}`);
  }
  fail(1, `${findings.length} text element(s) are squeezed into a narrow column at 390px - many lines in a small share of the width available. Something beside them is refusing to shrink.`);
}
console.log(`PASS - none of ${examined} text elements is squeezed (>=${MIN_LINES} lines in under ${MAX_WIDTH_SHARE * 100}% of its parent's width) at 390px.`);
