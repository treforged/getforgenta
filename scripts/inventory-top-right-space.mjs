#!/usr/bin/env node
/**
 * inventory-top-right-space.mjs - how much of each tab's TOP-RIGHT is empty, measured.
 *
 * WHY THIS EXISTS
 * Tre, 2026-09-16: *"format the pill in the settings tab cleaner. and reduce the empty space in
 * the top right. some other tabs also have this issue. big blank spaces."*
 *
 * ⚠️ HE NAMED ONE SCREEN AND TOLD US IT IS GENERAL, so the screen he named is a SAMPLE and not the
 * scope. Fixing Settings alone is the shape that brings him back in a week. This is therefore an
 * INVENTORY first and an opinion second: it prints every route's number so the judgement about
 * which are waste is made against measurements rather than against whichever screen was open.
 *
 * ⚠️ AND IT IS DELIBERATELY NOT A PASS/FAIL GATE. `check-panel-rows.mjs` already explains why the
 * stacked-header class resists one: on Settings, Garage and Accounts a second header row held one
 * small Guide button and an empty top-right, which is waste - but on Dashboard the second row holds
 * two real action buttons that TRE HIMSELF asked to be centred there on 2026-08-19. A gate failing
 * that is wrong on ordinary work, and a gate that is wrong on ordinary work is the one somebody
 * switches off on the day it matters. So this reports, and a person decides.
 *
 * WHAT IT MEASURES, per route, at 390x844 and 1440x900, signed in:
 *   headerRows   distinct `top` values among the header block's children - 2+ means it stacked.
 *   rightGapPx   unused width between the rightmost thing on the TITLE row and the container edge.
 *   headerPx     the header block's own height, the vertical half of the same complaint.
 * A route with 2+ rows AND a large right gap is the exact shape he photographed: content pushed to
 * a second line while the first line's right-hand side sits empty.
 *
 * ⚠️ INSTRUMENT WARNINGS, both measured on this machine on 2026-09-16, both fatal to this check:
 *   - CLAUDE-IN-CHROME's `resize_window` REPORTS SUCCESS AND MOVES NOTHING. It returned
 *     "Successfully resized ... to 390x844" while `innerWidth` stayed 1154. A phone-width reading
 *     taken with it is silently a DESKTOP reading. Playwright with a real viewport is the
 *     instrument, which is why this file exists rather than a browser session.
 *   - Read any rendered frame at `--force-device-scale-factor=2`: at default scale a near-black
 *     `#18181b` read as BLUE here and a palette defect was nearly filed.
 *
 * POSITIVE CONTROL: the run must find a header on a MAJORITY of routes, and at least one route must
 * report a stacked header. If no route stacks, this is either measuring nothing or the selector is
 * wrong - and "no waste found" and "the probe found no headers" must never be the same output.
 *
 * WHAT IT DOES NOT COVER: colour, the look of the pill (that is `check:panel-rows`), whether the
 * buttons in a header are the RIGHT buttons, and anything below the header block.
 *
 * USAGE:  node scripts/inventory-top-right-space.mjs
 * EXITS:  0 inventory printed . 2 could not measure (no routes, no headers, no control)
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };

const ROUTES = [
  '/dashboard', '/transactions', '/debt', '/vehicles', '/account',
  '/settings', '/accounts', '/forecast', '/goals',
];
const VIEWPORTS = [
  { label: 'phone', width: 390, height: 844 },
  { label: 'desktop', width: 1440, height: 900 },
];

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
// The same refusal every walk script here carries: this must never script a sign-in to a real account.
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to script a sign-in for "${email}".`);

const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}: ${JSON.stringify(session).slice(0, 200)}`);

// First-run dialogs cover the header, which is the one thing being measured here.
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

/**
 * Runs IN THE PAGE. Finds the header block and measures it.
 *
 * ⚠️ THE HEADER IS FOUND BY SHAPE, NEVER BY A CORRECTNESS MARKER. Selecting on a class that only a
 * TIDY header carries would make this blind to exactly the untidy ones it exists to find, and its
 * zero would be a fact about the selector. So: the first `<h1>` on the page, and the header block is
 * that heading's nearest ancestor which is a direct sibling-level child of the main content column.
 */
const measure = () => {
  // ⚠️ DECLARED INSIDE, because this function is serialised and run IN THE PAGE - it cannot close
  // over anything in this file. The first version kept it outside and died with
  // `HEADER_ZONE_PX is not defined` at the first evaluate, which is the loud version of this
  // mistake; a captured value that happened to exist in both scopes would be the quiet one.
  const HEADER_ZONE_PX = 220;
  const h1 = document.querySelector('h1');
  if (!h1) return null;
  const hb = h1.getBoundingClientRect();
  if (hb.width === 0 || hb.height === 0) return null;

  // ⚠️ LEAVES ONLY, AND A BOUNDED ZONE. The first version of this climbed ancestors until it hit
  // `main`, which on most routes IS the whole content column - so it reported 305 "rows" and a
  // 4908px header inside an 844px viewport, and a NEGATIVE right gap. Those numbers described the
  // selector, not the app, and they were only obviously wrong because they were impossible. A
  // subtler version of the same mistake would have been believed. So: no climbing, and only
  // elements that actually draw their own box.
  const leaves = [...document.querySelectorAll('*')].filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    // A wrapper whose box is just its children's box is not a thing on the page.
    return ![...el.children].some((c) => {
      const cr = c.getBoundingClientRect();
      return cr.width >= r.width - 2 && cr.height >= r.height - 2;
    });
  });

  // The header zone: the title's own row plus whatever sits immediately under it. Bounded, so this
  // can never drift into the page body the way the ancestor walk did.
  // ⚠️ CLAMPED TO THE BAND, NOT FILTERED OUT OF IT. Two versions of this were wrong in opposite
  // directions. Filtering on `top` alone admitted a list container that begins under the title and
  // runs the whole page - a 4872px "header" in an 844px viewport. REQUIRING the element to fit the
  // band then EXCLUDED every header taller than the band, so three phone routes reported no header
  // at all: the probe lost sight of exactly the tall headers it exists to find, and the
  // "most routes have a header" control still passed 15 of 18 without noticing.
  // So an element that overruns the band is KEPT and its box is clipped to it.
  const bandBottom = hb.bottom + HEADER_ZONE_PX;
  const clip = (r) => ({
    top: Math.max(r.top, hb.top), bottom: Math.min(r.bottom, bandBottom),
    left: r.left, right: r.right,
  });
  const zone = leaves
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= hb.top - 8 && r.top < bandBottom;
    })
    .map((el) => ({ el, r: clip(el.getBoundingClientRect()) }))
    .filter(({ r }) => r.bottom - r.top >= 4);
  if (zone.length === 0) return null;

  // ⚠️ THE REFERENCE EDGE MUST NOT BE DERIVED FROM WHAT IS BEING MEASURED. This used to be the
  // widest drawn thing in the zone - and on most routes the widest thing IS the title row's own
  // control, so hiding that control lowered the reference and the measured edge TOGETHER and the
  // gap stayed 0. The red control caught it: a planted empty top-right was invisible, which is the
  // probe measuring its own subject against itself.
  // So the edge comes from the LAYOUT: the content column, found by walking up from the title while
  // the ancestor still fits the viewport. That is a fact about the page's structure and does not
  // move when a button is hidden.
  let column = h1;
  while (
    column.parentElement
    && column.parentElement.getBoundingClientRect().width <= window.innerWidth + 1
    && column.parentElement.getBoundingClientRect().width > 0
  ) {
    column = column.parentElement;
  }
  const contentRight = column.getBoundingClientRect().right;

  // Anything sharing the title's vertical band: its centre sits inside the h1's own rows.
  // A Range over a BLOCK element's contents returns its LINE BOX, which is full width - so that
  // read `hb.right` all over again and the red control stayed inert. Measure the glyphs instead,
  // with the element's own computed font. Independent of layout, which is the property needed here.
  const cs1 = getComputedStyle(h1);
  const ctx2d = document.createElement('canvas').getContext('2d');
  ctx2d.font = `${cs1.fontStyle} ${cs1.fontWeight} ${cs1.fontSize} ${cs1.fontFamily}`;
  const textWidth = ctx2d.measureText((h1.textContent || '').trim()).width;
  const textRight = cs1.textAlign === 'center'
    ? hb.left + (hb.width + textWidth) / 2
    : hb.left + textWidth;
  // ⚠️ CONTENT ON THE TITLE ROW, NOT THE ROW ITSELF. This used to take every element whose centre
  // sits in the title's band - which includes the PADDED ROW WRAPPER that holds the title and its
  // controls. A wrapper reaches the column's inner edge by definition, so `titleRight` was pinned
  // there and every route's gap came out as exactly its column padding: 14px on phone, 36px on
  // desktop, a suspiciously uniform baseline that looked like a tidy app and was an unmeasured one.
  // Anything starting LEFT of the title's glyphs spans the title and is a container, not content.
  const onTitleRow = zone.filter(({ r }) => {
    const mid = r.top + (r.bottom - r.top) / 2;
    if (mid < hb.top - 4 || mid > hb.bottom + 4) return false;
    return r.left >= textRight - 4;
  });
  // ⚠️ THE TITLE'S TEXT, NOT ITS BOX. An `<h1>` is a block element and usually fills the column, so
  // using `hb.right` pinned this to the column's padding: every route read 14px on phone and 36px
  // on desktop, which is the padding, not the emptiness. It also made the red control inert - the
  // h1 held the edge no matter how many controls were hidden. A Range over the text gives the
  // painted extent, which is what a person actually sees the title reach.
  const titleRight = Math.max(...onTitleRow.map(({ r }) => r.right), textRight);

  // ⚠️ ROWS ARE COUNTED FROM INTERACTIVE ITEMS AND THE TITLE, NEVER FROM EVERY LEAF. Counting leaf
  // tops reported 9-24 "rows" inside a 240px band, because an icon, a label and a baseline-shifted
  // span inside ONE row each scored as a row. What a person reads as a second row is a row of
  // CONTROLS under the title. 12px granularity, because items in one row differ by a few pixels.
  const rowItems = zone.filter(({ el }) => el.matches('button, a, [role="button"], [role="tab"], h1'));
  const tops = [...new Set(rowItems.map(({ r }) => Math.round(r.top / 12) * 12))].sort((a, b) => a - b);

  // Things BELOW the title row that a person clicks - the second row's actual payload. One small
  // control down there beside an empty top-right is the waste he photographed; two real actions is
  // the Dashboard layout he asked for himself.
  const belowActions = zone.filter(({ el, r }) => {
    if (r.top < hb.bottom - 4) return false;
    return el.matches('button, a, [role="button"], [role="tab"]');
  }).length;

  return {
    headerRows: tops.length,
    // ⚠️ MEASURED TO THE LAST ROW ITEM, NOT TO THE BAND. This used to take the lowest bottom in the
    // zone, and once elements were clipped to the band that became the BAND CEILING - every route
    // read 238-256px. An identical value across independent samples is a bug signature, not a
    // measurement, so the column now ends where the header's own last control ends.
    headerPx: Math.round(
      Math.max(...(rowItems.length ? rowItems : zone).map(({ r }) => r.bottom)) - hb.top,
    ),
    rightGapPx: Math.round(contentRight - titleRight),
    belowActions,
    title: (h1.textContent || '').trim().slice(0, 24),
  };
};

/**
 * THE RED CONTROL, and the probe is not evidence without it.
 *
 * ⚠️ NOTHING SO FAR SHOWS THIS CAN REPORT WASTE WHERE WASTE EXISTS. Every quiet column could equally
 * be a selector that finds nothing, and this repo has already shipped a gate whose zero was a fact
 * about its own matcher. So a known-bad header is PLANTED at runtime - the rightmost control on the
 * title row is hidden, which is precisely the defect being hunted: a title row whose right-hand side
 * sits empty. `rightGapPx` must GROW. If it does not, the probe cannot see its subject and the run
 * exits 2 rather than printing a clean table.
 *
 * Planted in the page and never written to a file, so it cannot leak into the app.
 */
const plantEmptyTopRight = () => {
  const h1 = document.querySelector('h1');
  if (!h1) return false;
  const hb = h1.getBoundingClientRect();
  // The same glyph measurement `measure` uses, so the plant and the metric share ONE boundary.
  const cs1 = getComputedStyle(h1);
  const ctx2d = document.createElement('canvas').getContext('2d');
  ctx2d.font = `${cs1.fontStyle} ${cs1.fontWeight} ${cs1.fontSize} ${cs1.fontFamily}`;
  const tw = ctx2d.measureText((h1.textContent || '').trim()).width;
  const textRight = cs1.textAlign === 'center' ? hb.left + (hb.width + tw) / 2 : hb.left + tw;
  // ⚠️ THE PLANT MUST MATCH WHAT THE METRIC MEASURES. This used to hide only buttons and links,
  // while `titleRight` is the max over EVERYTHING on the title row - so an input, a badge or a
  // drawn wrapper kept holding the edge and the gap never moved. A plant narrower than the metric
  // produces "not detected" from a probe that detects perfectly well, which is the most expensive
  // possible reading of a control.
  const controls = [...document.querySelectorAll('*')]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => {
      const mid = r.top + r.height / 2;
      // ⚠️ `textRight`, NEVER `hb.right`. An `<h1>` is a block element and fills its column, so
      // `hb.right` IS the column edge and nothing is ever right of it - the plant hid NOTHING and
      // the control reported NOT DETECTED from a probe that was working.
      return r.width >= 4 && r.height >= 4 && mid >= hb.top - 4 && mid <= hb.bottom + 4 && r.left >= textRight - 4;
    })
    .sort((a, b) => b.r.right - a.r.right);
  if (controls.length === 0) return false;
  // ⚠️ ALL OF THEM, NOT JUST THE RIGHTMOST. Hiding one moved nothing, because `titleRight` is the
  // max over everything on the row - a second control sitting just left of it simply took over and
  // the gap stayed 0. The planted defect has to be the real one: a title row with NOTHING to its
  // right. Hiding one control was a plant too weak to be detected, which reads exactly like a probe
  // that cannot detect - and telling those two apart is the entire job of this control.
  for (const c of controls) c.el.style.visibility = 'hidden';
  return true;
};

const browser = await chromium.launch();
const rows = [];
let examined = 0;
let headersFound = 0;
/** Per viewport: did hiding the rightmost title-row control make `rightGapPx` grow? */
const redControl = {};

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
  await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
    version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
  })));

  for (const route of ROUTES) {
    examined += 1;
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    const m = await page.evaluate(measure);
    if (m) headersFound += 1;
    rows.push({ viewport: vp.label, route, ...(m ?? { headerRows: null }) });

    // THE RED CONTROL, run on the FIRST route of each viewport that offers a title-row control.
    // Reloaded afterwards so the planted defect cannot reach the next route's reading.
    if (m && redControl[vp.label] === undefined) {
      // ⚠️ PLANT AND MEASURE IN ONE EVALUATION. Two separate `page.evaluate` calls leave a window in
      // which React re-renders and wipes the inline style off the planted nodes, so the "after"
      // reading was taken from a page that had already healed itself - which reads as NOT DETECTED
      // from a probe that detects fine. Same family as a reset whose verification runs before the
      // app has had its say.
      const planted = await page.evaluate(
        ([plantSrc, measureSrc]) => {
          const plant = eval(`(${plantSrc})`);
          const meas = eval(`(${measureSrc})`);
          return plant() ? meas() : null;
        },
        [plantEmptyTopRight.toString(), measure.toString()],
      );
      if (planted) {
        const after = planted;
        redControl[vp.label] = {
          route,
          before: m.rightGapPx,
          after: after?.rightGapPx ?? null,
          grew: after != null && after.rightGapPx > m.rightGapPx,
        };
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
      }
    }
  }
  await ctx.close();
}
await browser.close();

// ⚠️ ZERO EXAMINED MUST NEVER READ AS A CLEAN APP, and neither must zero headers found.
if (examined === 0) fail(2, 'examined 0 routes.');
if (headersFound < examined / 2) {
  fail(2, `found a header on only ${headersFound} of ${examined} route/viewport pairs - the selector is the likely fault, not the app.`);
}

const pad = (s, n) => String(s ?? '-').padEnd(n);
console.log(`\nTOP-RIGHT SPACE INVENTORY - ${examined} route/viewport pairs, ${headersFound} with a header\n`);
console.log(`${pad('viewport', 9)}${pad('route', 15)}${pad('rows', 6)}${pad('headerPx', 10)}${pad('rightGap', 10)}${pad('below', 7)}title`);
console.log('-'.repeat(72));
for (const r of rows) {
  console.log(
    `${pad(r.viewport, 9)}${pad(r.route, 15)}${pad(r.headerRows, 6)}${pad(r.headerPx, 10)}${pad(r.rightGapPx, 10)}${pad(r.belowActions, 7)}${r.title ?? ''}`,
  );
}

// ⚠️ THE RED CONTROL IS CHECKED BEFORE THE TABLE IS TRUSTED, NOT AFTER. A probe that has never been
// shown to move when the defect is present is not an instrument, and its quiet columns would be a
// confident zero. This must have run and must have GROWN in at least one viewport.
const redRuns = Object.values(redControl);
if (redRuns.length === 0) {
  fail(2, 'the red control never ran - no route offered a control on its title row to hide, so nothing shows this probe can see an empty top-right.');
}
if (!redRuns.some((r) => r.grew)) {
  fail(2, `the red control did not move rightGapPx in any viewport (${redRuns.map(r => `${r.route} ${r.before}->${r.after}`).join(', ')}) - the probe cannot detect the defect it exists to find.`);
}
console.log('');
console.log('RED CONTROL - hiding the rightmost title-row control must widen the gap:');
for (const [vp, r] of Object.entries(redControl)) {
  console.log(`  ${vp} ${r.route}: rightGap ${r.before} -> ${r.after}  ${r.grew ? 'DETECTED' : 'NOT DETECTED'}`);
}

const stacked = rows.filter((r) => (r.headerRows ?? 0) >= 2);
// POSITIVE CONTROL ON THE ROW COUNTER. If nothing anywhere stacks, this probe cannot tell a tidy
// app from a counter that always returns 1, and reporting "no waste" would be the confident zero.
if (stacked.length === 0) {
  fail(2, 'no route reported a stacked header at any width - the row counter cannot be shown to work, so a clean result is not trustworthy.');
}

console.log(`\nSTACKED HEADERS (2+ rows): ${stacked.length} of ${rows.length}`);
for (const r of stacked) {
  console.log(`  ${r.viewport} ${r.route} - ${r.headerRows} rows, ${r.rightGapPx}px empty right of the title, ${r.belowActions} action(s) on the rows below`);
}
console.log('\nThis is an inventory, not a verdict. A second row holding REAL actions is fine;');
console.log('a second row holding one small button beside an empty top-right is the waste he reported.\n');
