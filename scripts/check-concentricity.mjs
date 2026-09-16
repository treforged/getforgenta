#!/usr/bin/env node
/**
 * check-concentricity.mjs - measure CORNER CONCENTRICITY on RENDERED boxes and assert
 * that every nested rounded pair whose arcs actually interact satisfies
 *
 *     r_inner = r_outer - gap        (only when gap < r_outer)
 *
 * The rule, the arithmetic and the scoping condition are Tre's standing design rule in
 * ~/.claude/rules/common/corner-concentricity.md. This file is the INSTRUMENT.
 *
 * WHY THIS EXISTS WHEN A SOURCE GATE ALREADY DOES
 * `src/lib/__tests__/corner-concentricity.gate.test.ts` reads JSX nesting inside a file.
 * That is the right instrument for hand-written markup and it is green. It is also
 * STRUCTURALLY BLIND to the defect this file was written for.
 *
 * MEASURED 2026-09-16: `TabsList` is `rounded-md p-1` and `TabsTrigger` was `rounded-sm`.
 * Rendered, that is r_outer 10px, gap 4px, r_inner 8px - want 6px - so the inner arc
 * bulged out and pinched the outer one at every corner of every tab strip in the app.
 * The source gate passed 12/12 with that exact defect restored, and it was right to:
 * the two halves are SEPARATE COMPONENTS that are never nested in one JSX tree. They meet
 * only at a call site, as `<TabsList><TabsTrigger/></TabsList>`, where the radius classes
 * are not visible at all.
 *
 * ⚠️ SO THE GENERAL POINT, because it is the reason to keep this file: a design system's
 * radius defects live exactly ON the component boundary, which is the one place a
 * per-file source scan cannot look. Only a rendered box can see through a component name.
 *
 * WHAT IT ASSERTS
 *   1. Every JUDGED pair satisfies the arithmetic within 1px.
 *   2. The positive controls behave: a planted bad pair is FOUND, and a planted correct
 *      sibling is NOT. Without those, a matcher that resolves nothing reports a clean app.
 *   3. Something was actually judged. `0 violations` and `0 corners examined` must never
 *      read the same, so an empty judged count is exit 2, not success.
 *
 * WHAT IS DELIBERATELY NOT JUDGED, and each exclusion is a measured one
 *   - A CHILD THAT DRAWS NO BOX. A text span or an <svg> has no visible arc, so it has no
 *     corner to be concentric with. Including them produced 51 "violations" on the
 *     dashboard alone, every one of them a label or an icon. `<svg>` is the subtle half:
 *     its UA default is `overflow:hidden`, so a naive "does it clip?" test admits every
 *     icon in the app - 12 more false positives after the first 39 were removed.
 *   - PILLS. `rounded-full` is excluded by the rule itself; detected by radius against the
 *     box's own half-height rather than by class, so an inline style cannot slip past.
 *   - DEGENERATE PAIRS, where gap >= r_outer. The arcs do not share corner space, so the
 *     formula does not bind. This is the scoping condition that took a sibling repo from
 *     17 findings to 10 genuine ones, and here it accounts for most of what is skipped.
 *
 * WHAT IT DOES NOT CATCH, stated so nobody trusts it past its reach
 *   - Colour, contrast, spacing, copy, and any corner whose PARENT is not itself rounded.
 *   - Routes /demo does not expose. Demo mode reaches dashboard, transactions, debt,
 *     vehicles, account and settings; /budget, /forecast and /goals are NOT reachable
 *     without credentials, so they are UNMEASURED here rather than clean.
 *   - Anything that renders only after an interaction - an open dialog, an expanded row.
 *   - LIGHT THEME. The app sets `color-scheme` inline alongside the class, so flipping the
 *     class alone is not a theme switch; this runs in the app's own default theme.
 *
 * Needs the dev server. Run: node scripts/dev-session.mjs up
 */

const BASE = process.env.FORGENTA_BASE ?? 'http://localhost:8080';
const TOLERANCE_PX = 1;

function fail(code, msg) {
  console.error(`FAIL ${msg}`);
  process.exit(code);
}

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }

try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

/**
 * The measurement, run inside the page. Returns violations plus the counts that make a
 * zero readable: a zero beside `judged: 0` is a non-result, not a pass.
 */
const MEASURE = () => {
  const px = (v) => parseFloat(v) || 0;

  const drawsBox = (el, cs) => {
    // An icon or an image has no authored box. `<svg>` defaults to overflow:hidden, which
    // is a UA default and not a design decision - admitting it flags every icon in the app.
    if (el instanceof SVGElement || el.tagName === 'IMG') return false;
    const bg = cs.backgroundColor;
    const hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    const hasBorder = px(cs.borderTopWidth) > 0 || px(cs.borderLeftWidth) > 0;
    const hasImage = cs.backgroundImage !== 'none';
    // Clipping counts only when the author also set a radius - that is the
    // "overflow-hidden clips the child's corner flat" case the rule names.
    const clipsWithRadius = cs.overflow !== 'visible' && px(cs.borderTopLeftRadius) > 0;
    return hasBg || hasBorder || hasImage || clipsWithRadius;
  };

  const out = { violations: [], counts: { pairs: 0, judged: 0, degenerate: 0, noBox: 0, notAtCorner: 0 } };

  for (const el of document.querySelectorAll('*')) {
    const parent = el.parentElement;
    if (!parent) continue;
    const cs = getComputedStyle(el);
    const ps = getComputedStyle(parent);

    const rOuter = px(ps.borderTopLeftRadius);
    if (rOuter <= 0) continue;

    const er = el.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    if (!er.width || !pr.width) continue;

    // Pills: excluded by the rule. Detected geometrically so an inline 9999px is caught too.
    if (rOuter >= Math.min(pr.width, pr.height) / 2 - 0.5) continue;
    const rInner = px(cs.borderTopLeftRadius);
    if (rInner > 0 && rInner >= Math.min(er.width, er.height) / 2 - 0.5) continue;

    out.counts.pairs++;

    if (!drawsBox(el, cs)) { out.counts.noBox++; continue; }

    const gap = Math.min(
      er.left - pr.left, er.top - pr.top,
      pr.right - er.right, pr.bottom - er.bottom,
    );
    // gap >= rOuter -> the arcs never share corner space, so the rule is degenerate here.
    if (!(gap >= 0 && gap < rOuter)) { out.counts.degenerate++; continue; }

    // ⚠️ THE CHILD MUST ACTUALLY OCCUPY A CORNER. A middle row of a `divide-y` list is
    // nested inside a rounded card and has NO corner relationship with it - it sits in the
    // straight part of the edge, where there is no arc to be concentric with. Without this
    // the gate reported every list row in the app (10 on /transactions alone), all of them
    // correct. A child is in a corner when its box reaches into the parent's corner square.
    const inCorner =
      (Math.abs(er.left - pr.left) <= rOuter + gap && Math.abs(er.top - pr.top) <= rOuter + gap) ||
      (Math.abs(er.right - pr.right) <= rOuter + gap && Math.abs(er.top - pr.top) <= rOuter + gap) ||
      (Math.abs(er.left - pr.left) <= rOuter + gap && Math.abs(er.bottom - pr.bottom) <= rOuter + gap) ||
      (Math.abs(er.right - pr.right) <= rOuter + gap && Math.abs(er.bottom - pr.bottom) <= rOuter + gap);
    if (!inCorner) { out.counts.notAtCorner++; continue; }

    out.counts.judged++;
    const want = rOuter - gap;

    // The two failure modes are NOT symmetrical, so they are not tested as one.
    //   TOO LARGE is always a defect: the inner arc bulges out and pinches the outer one.
    //   TOO SMALL only shows when there is a visible gap AND the parent does not clip. A
    //   square child flush inside a clipping rounded card is the ordinary correct pattern -
    //   the card's own radius does the work - and flagging it would cry wolf on every list.
    const parentClips = ps.overflow !== 'visible';
    const tooLarge = rInner - want > 1;
    const tooSmall = want - rInner > 1 && gap > 0.5 && !parentClips;
    if (tooLarge || tooSmall) {
      out.violations.push({
        tag: el.tagName,
        cls: (el.className || '').toString().slice(0, 80),
        text: (el.innerText || '').slice(0, 40).replace(/\s+/g, ' '),
        parentCls: (parent.className || '').toString().slice(0, 60),
        how: tooLarge ? 'TOO LARGE (arcs pinch)' : 'TOO SMALL (gap swells at the corner)',
        rInner: +rInner.toFixed(1), rOuter: +rOuter.toFixed(1),
        gap: +gap.toFixed(1), want: +want.toFixed(1),
      });
    }
  }
  return out;
};


/**
 * Find VISIBLE TEXT that is cut off by a clipping ancestor or by the viewport edge.
 * This is the mobile failure mode in this app: the containers carry `overflow-x-hidden`,
 * so content that does not fit is silently trimmed rather than causing a page scroll.
 * Only leaf text nodes are considered - a clipped wrapper whose text is fully visible is
 * not a defect, and reporting wrappers buries the real ones.
 */
const CLIPPED = () => {
  const vw = document.documentElement.clientWidth;
  const items = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length > 0) continue;              // leaves only
    // ⚠️ SVG IS EXCLUDED, for the same reason it is excluded from the corner arm.
    // An <svg> has its own coordinate system and viewBox scaling, so a <tspan>'s client
    // rect cannot be compared against a clip box in CSS pixels. The first run reported a
    // chart axis label "Sep 16" ending at 1387px inside a 390px viewport - a coordinate
    // artifact, not a defect. Chart labels are also clipped at the axis edge BY DESIGN.
    if (el instanceof SVGElement || el.closest('svg')) continue;
    const text = (el.textContent || '').trim();
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    // `truncate` / text-overflow:ellipsis is a DELIBERATE trim, not a defect.
    if (cs.textOverflow === 'ellipsis') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;

    let cutBy = null;
    if (r.right > vw + 1) cutBy = { what: 'the viewport', edge: vw };
    else {
      let a = el.parentElement;
      while (a && a !== document.body) {
        const as = getComputedStyle(a);
        if (as.overflowX !== 'visible') {
          const ar = a.getBoundingClientRect();
          if (r.right > ar.right + 1) cutBy = { what: (a.className || a.tagName).toString().slice(0, 40), edge: +ar.right.toFixed(1) };
          break;
        }
        a = a.parentElement;
      }
    }
    if (cutBy) {
      items.push({
        tag: el.tagName, cls: (el.className || '').toString().slice(0, 60),
        text: text.slice(0, 45), right: +r.right.toFixed(1),
        cutBy: cutBy.what, edge: cutBy.edge,
      });
    }
  }
  return { vw, items: items.slice(0, 8) };
};

/**
 * Plant one pair that MUST be flagged and one that MUST NOT, measure, remove.
 * A zero from a broken matcher and a zero from a clean app are the same zero; this is the
 * only thing that tells them apart. The good sibling matters as much as the bad one - a
 * matcher that flags everything would "pass" a fires-on-defect check by itself.
 */
const CONTROL = () => {
  const host = document.createElement('div');
  host.setAttribute('data-concentricity-control', '');
  host.innerHTML = `
    <div style="border-radius:16px;padding:4px;background:#222;width:400px;height:200px">
      <div data-bad style="border-radius:16px;width:380px;height:180px;background:#444"></div>
    </div>
    <div style="border-radius:16px;padding:4px;background:#222;width:400px;height:200px">
      <div data-good style="border-radius:12px;width:380px;height:180px;background:#444"></div>
    </div>`;
  document.body.appendChild(host);
  return host;
};

/* VIEWPORTS. Tre, 2026-09-16: "make sure you look at mobile viewport sizing as well".
 * This is not a formality - the app is a Capacitor app, so the PHONE is the primary
 * surface and the desktop is the secondary one. Layout changes at every breakpoint, so a
 * corner that is correct at 1440 says nothing about the same corner at 390: different
 * padding utilities apply (`p-3 sm:p-5` is all over this repo), rows stack, and controls
 * that sat side by side wrap. 390x844 is an iPhone 14/15; 768 is the tablet breakpoint. */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'phone', width: 390, height: 844 },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

// Consent first, so the banner is not covering the app when the boxes are measured.
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(),
  essential: true, analytics: false, marketing: false,
})));

// /demo needs NO credentials and writes nothing to the production database.
await page.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);

if (!/\/dashboard$/.test(new URL(page.url()).pathname)) {
  fail(2, `/demo did not land on the dashboard (got ${page.url()}) - nothing was measured.`);
}

/* THE ROUTES ARE DERIVED FROM THE APP'S OWN NAV, never hand-named. A hand-typed list is
 * blind to the screen nobody added to it, and this repo has already paid for that twice.
 * Hard-navigating to a route drops demo mode, so these are visited through the SPA. */
const routes = await page.evaluate(() => [...new Set(
  [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')),
)].filter((h) => !['/', '/auth', '/privacy', '/terms'].includes(h)));

if (routes.length === 0) fail(2, 'derived zero routes from the demo nav - the instrument found nothing to walk.');

// --- the positive controls, run once on a real app screen -------------------------
const control = await page.evaluate(([measureSrc, controlSrc]) => {
  const measure = eval(`(${measureSrc})`);
  const plant = eval(`(${controlSrc})`);
  const host = plant();
  const withPlant = measure();
  const fires = withPlant.violations.some((v) => v.rOuter === 16 && v.gap === 4 && v.rInner === 16);
  const falsePositive = withPlant.violations.some((v) => v.rOuter === 16 && v.gap === 4 && v.rInner === 12);
  host.remove();
  return { fires, falsePositive };
}, [MEASURE.toString(), CONTROL.toString()]);

if (!control.fires) {
  fail(2, 'POSITIVE CONTROL DID NOT FIRE: a planted 16px-in-16px/gap-4 pair was not flagged. The matcher is broken, so any zero below is meaningless.');
}
if (control.falsePositive) {
  fail(2, 'POSITIVE CONTROL FLAGGED A CORRECT PAIR: a correctly derived 12px-in-16px/gap-4 child was reported. The matcher is too loose.');
}
console.log('positive controls OK - the planted defect is found, the correct sibling is not');

/* THE MOBILE ARM, AND ITS CONTROL CHANGED THE ARM ITSELF.
 * The first version asked "does the page scroll sideways?" via documentElement.scrollWidth.
 * ITS CONTROL FAILED: a planted 1200px box in a 390px viewport left the document at 390px.
 * The cause is the app's own layout - `stack-section overflow-x-hidden` on the containers -
 * so a too-wide box is CLIPPED and never widens the document. scrollWidth is structurally
 * blind to overflow here, and "0 sideways scrolls across 30 cells" from it would have been
 * a confident zero from an instrument that cannot see the thing it names.
 * So the arm is aimed at the failure mode this app ACTUALLY has: content cut off at the
 * edge of a clipping ancestor, silently and with no scrollbar to reveal it. */
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const before = await page.evaluate((src) => eval(`(${src})`)(), CLIPPED.toString());
  await page.evaluate(() => {
    const host = document.querySelector('main') || document.body;
    const d = document.createElement('div');
    d.id = '__clip_control';
    d.textContent = 'PLANTED BOX THAT IS FAR WIDER THAN ANY PHONE SCREEN';
    d.style.cssText = 'width:1200px;height:20px;background:red;white-space:nowrap';
    host.appendChild(d);
  });
  await page.waitForTimeout(300);
  const during = await page.evaluate((src) => eval(`(${src})`)(), CLIPPED.toString());
  await page.evaluate(() => document.getElementById('__clip_control')?.remove());
  await page.waitForTimeout(300);
  const after = await page.evaluate((src) => eval(`(${src})`)(), CLIPPED.toString());

  const fired = during.items.some((i) => /PLANTED BOX/.test(i.text));
  if (!fired) {
    fail(2, `MOBILE CLIPPING CONTROL DID NOT FIRE: a planted 1200px box in a 390px viewport was not reported as clipped (${during.items.length} items seen). The arm cannot see cut-off content, so its zeros mean nothing.`);
  }
  if (after.items.length !== before.items.length) {
    fail(2, `MOBILE CLIPPING CONTROL DID NOT CLEAR: ${before.items.length} items before, ${after.items.length} after removing the planted box - the arm cannot return to its baseline, so a PASS is not trustworthy.`);
  }
  console.log(`mobile clipping control OK - baseline ${before.items.length} clipped, planted box detected, back to ${after.items.length} after removal`);
}

// --- the sweep ---------------------------------------------------------------------
const findings = [];
const totals = { pairs: 0, judged: 0, degenerate: 0, noBox: 0, notAtCorner: 0 };
const walked = [];
const overflowFindings = [];
let overflowCells = 0;

for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(600);

  for (const route of routes) {
    await page.evaluate((r) => {
      history.pushState({}, '', r);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, route);
    await page.waitForTimeout(2200);

    const landed = new URL(page.url()).pathname;
    const res = await page.evaluate((src) => eval(`(${src})`)(), MEASURE.toString());

    /* THE MOBILE ARM, per viewport, because clipping is a property of the WIDTH. */
    const clip = await page.evaluate((src) => eval(`(${src})`)(), CLIPPED.toString());
    if (clip.items.length > 0) {
      overflowFindings.push({ viewport: `${vp.name} ${vp.width}`, route: landed, items: clip.items });
    }
    overflowCells++;

    for (const k of Object.keys(totals)) totals[k] += res.counts[k];
    walked.push({ viewport: `${vp.name} ${vp.width}x${vp.height}`, asked: route, landed, ...res.counts, violations: res.violations.length });
    for (const v of res.violations) findings.push({ viewport: `${vp.name} ${vp.width}`, route: landed, ...v });
  }
}

await browser.close();

console.log('\nroutes walked (asked -> landed):');
for (const w of walked) {
  const note = w.asked === w.landed ? '' : '   [REDIRECTED - not coverage of the asked route]';
  console.log(`  [${w.viewport}] ${w.asked} -> ${w.landed}  pairs=${w.pairs} judged=${w.judged} notAtCorner=${w.notAtCorner} degenerate=${w.degenerate} noBox=${w.noBox} violations=${w.violations}${note}`);
}
console.log(`\ntotals: ${totals.pairs} nested rounded pairs, ${totals.judged} JUDGED, ${totals.degenerate} degenerate (arcs do not interact), ${totals.noBox} children draw no box`);

// A zero that examined nothing is not a pass.
if (totals.judged === 0) {
  fail(2, `examined ${totals.pairs} pairs and JUDGED NONE of them. "0 violations" here would mean "0 corners were looked at" - that is a non-result, not a clean app.`);
}

console.log(`
mobile clipping arm: ${overflowCells} route/viewport cells measured, ${overflowFindings.length} with cut-off text`);
if (overflowFindings.length > 0) {
  console.error(`
${overflowFindings.length} CELL(S) WITH TEXT CUT OFF - silently trimmed, with no scrollbar to reveal it:`);
  for (const o of overflowFindings) {
    console.error(`  [${o.viewport}] ${o.route}`);
    for (const c of o.items) {
      console.error(`      <${c.tag} class="${c.cls}">  "${c.text}"  ends at ${c.right}px, cut by ${c.cutBy} at ${c.edge}px`);
    }
  }
}

if (findings.length > 0 || overflowFindings.length > 0) {
  console.error(`\n${findings.length} CONCENTRICITY VIOLATION(S), out of ${totals.judged} judged corners:`);
  for (const f of findings) {
    console.error(`  [${f.viewport}] ${f.route}  <${f.tag} class="${f.cls}">  "${f.text}"  ${f.how}`);
    console.error(`      inside class="${f.parentCls}"`);
    console.error(`      r_inner=${f.rInner}px  r_outer=${f.rOuter}px  gap=${f.gap}px  -> want r_inner=${f.want}px`);
  }
  process.exit(1);
}

console.log(`\nPASS - ${totals.judged} corners judged across ${walked.length} routes, 0 violations.`);
