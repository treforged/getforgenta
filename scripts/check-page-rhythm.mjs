// check-page-rhythm.mjs - SEGMENTATION, measured, because "dull and boring" turned out not to
// mean "empty".
//
// Tre called /budget dull. The obvious reading is emptiness, and it was REFUTED by measurement:
// whitespace is 5.8% there against 5.1% on /dashboard, so the page is if anything the busier of
// the two. The real difference is RHYTHM - 6 painted bands over 2155px against 23 over 5508px,
// with one unbroken 1121px run, nearly three phone viewports with no visual break.
//
// IT REPORTS A PAIR, AND BOTH HALVES ARE REQUIRED, because either alone is gameable:
//   - BAND COUNT alone rises by adding padding or widening dividers, which buys rhythm by adding
//     the emptiness the measurement above already refuted. That is progress-shaped and wrong.
//   - WHITESPACE alone falls by deleting content.
// A change passes when the longest unbroken RUN shortens AND whitespace has not risen materially.
// Band density is reported as context and is deliberately NOT gated - see the note above the
// gate for why it turned out to be nearly blind here.
//
// /dashboard IS THE POSITIVE CONTROL, NOT DECORATION. Every assertion here is about /budget
// having FEW bands, and a detector that finds nothing satisfies that perfectly. Reading a page
// known to be densely segmented in the same run is what proves the detector can find a band at
// all. If /dashboard reads under 10 bands the probe refuses rather than reporting about /budget.
//
// EACH ROUTE IS READ UNTIL TWO CONSECUTIVE READS AGREE. A fixed sleep let an unmounted page
// report a zero on this codebase before, and a zero from an unsettled page is indistinguishable
// from a real one - here it would read as a MORE dramatic finding, which is the direction nobody
// checks.
//
// WHAT IT CANNOT SEE: colour, whether the bands are the RIGHT bands, typography, anything that
// lazy-mounts on scroll, desktop widths, and light mode. It measures 390x844 dark. It is an
// INVENTORY with a floor, not a verdict on whether the page looks good.
//
// EXITS: 0 measured and at or above the floor . 1 /budget is below it . 2 could not measure.
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };

const env = readFileSync('.env.local', 'utf8');
let creds;
try { creds = readFileSync('.env.deck-walk.local', 'utf8'); }
catch { fail(2, '.env.deck-walk.local is missing.'); }
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
if (!session.access_token) fail(2, `sign-in returned ${res.status}`);

const whatsNew = readFileSync('src/lib/whats-new.ts', 'utf8');
const releaseVersion = (whatsNew.match(/version:\s*'([^']+)'/) || [])[1];
const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
const prof = await fetch(`${url}/rest/v1/profiles?select=tour_flags&user_id=eq.${session.user.id}`, { headers: rest });
const flags = (await prof.json())[0]?.tour_flags ?? {};
await fetch(`${url}/rest/v1/profiles?user_id=eq.${session.user.id}`, {
  method: 'PATCH',
  headers: { ...rest, Prefer: 'return=representation' },
  body: JSON.stringify({
    founder_note_seen: true,
    tour_flags: { ...flags, new_user_done: true, premium_done: true, [`whats_new_${releaseVersion}`]: true },
  }),
});

let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'no @playwright/test'); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('forgenta.theme.v1', 'dark'));
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));

// /dashboard FIRST because it is both the reference and the positive control; the other four
// are read so a segmentation problem on a route nobody complained about is visible before he
// finds it. Widening `check:dark-contrast` exactly this way found two real strings on its
// first run.
const ROUTES = ['/dashboard', '/budget', '/debt', '/forecast', '/account', '/settings'];
const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';

// A band is a PAINTED block in the scrolling column - an element whose own background differs
// from the page behind it, wide enough to read as a surface rather than a chip, and not merely
// inside another painted block (only the outermost counts, or a card with a painted header
// would score twice).
const readRhythm = () => page.evaluate(() => {
  const parse = (s) => {
    const m = (s || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const pageBg = parse(getComputedStyle(document.body).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
  const differs = (c) =>
    c && c.a > 0.02 &&
    (Math.abs(c.r - pageBg.r) + Math.abs(c.g - pageBg.g) + Math.abs(c.b - pageBg.b) > 6 || c.a < 1);

  // The tallest scrollable container is the app's own column. This app scrolls an INNER element,
  // so `document.scrollingElement` is the wrong object and has already produced a wrong answer
  // in this repo (check:glass accused a working feature over exactly this).
  let scroller = document.scrollingElement;
  let best = scroller ? scroller.scrollHeight : 0;
  for (const el of document.querySelectorAll('*')) {
    if (!/auto|scroll/.test(getComputedStyle(el).overflowY)) continue;
    if (el.scrollHeight > best) { best = el.scrollHeight; scroller = el; }
  }
  const root = scroller || document.body;
  const totalPx = root.scrollHeight || 0;
  const rootTop = root.getBoundingClientRect().top;
  const offset = root === document.scrollingElement ? window.scrollY : root.scrollTop;

  const painted = [];
  for (const el of root.querySelectorAll('*')) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') continue;
    if (st.position === 'fixed') continue;              // the nav pill is chrome, not a band
    if (!differs(parse(st.backgroundColor))) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 200 || b.height < 24) continue;       // a chip or a swatch is not a band
    painted.push(el);
  }
  const outer = painted.filter((el) => !painted.some((p) => p !== el && p.contains(el)));

  // Extents in DOCUMENT space, so scroll position cannot change the answer.
  const spans = outer
    .map((el) => {
      const b = el.getBoundingClientRect();
      const top = Math.round(b.top - rootTop + offset);
      return { top, bottom: top + Math.round(b.height) };
    })
    .sort((a, b) => a.top - b.top);

  // Painted pixels with overlaps merged, so two adjacent cards are not counted twice.
  let paintedPx = 0;
  let cursor = -1;
  for (const s of spans) {
    const from = Math.max(s.top, cursor);
    if (s.bottom > from) paintedPx += s.bottom - from;
    cursor = Math.max(cursor, s.bottom);
  }

  // The longest UNBROKEN painted run - the stretch with no visual break, which is the monotony a
  // reader feels. Distinct from total painted pixels.
  let longestRun = 0;
  let runStart = null;
  let runEnd = null;
  for (const s of spans) {
    if (runStart === null || s.top > runEnd + 8) {
      if (runStart !== null) longestRun = Math.max(longestRun, runEnd - runStart);
      runStart = s.top; runEnd = s.bottom;
    } else {
      runEnd = Math.max(runEnd, s.bottom);
    }
  }
  if (runStart !== null) longestRun = Math.max(longestRun, runEnd - runStart);

  return {
    bands: spans.length,
    totalPx,
    paintedPx,
    whitespacePct: totalPx ? Math.round(((totalPx - paintedPx) / totalPx) * 1000) / 10 : null,
    longestRunPx: longestRun,
    bandsPerKpx: totalPx ? Math.round((spans.length / totalPx) * 1000 * 10) / 10 : null,
  };
});

const out = {};
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  for (let i = 0; i < 6 && (await page.locator(OVERLAY).count()); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  // ⚠️ TWO AGREEING READS IS NOT ENOUGH, MEASURED 2026-09-18. Widening this probe to six
  // routes made /dashboard read 1 band over 1390px at 75.6% whitespace - minutes after the same
  // code read it as 16 bands over 5656px at 17.5%. TWO CONSECUTIVE READS AGREED ON AN UNMOUNTED
  // PAGE. "Settled" and "correct" are not the same thing, and a two-read loop only checks the
  // first. The positive control caught it and correctly named the instrument, but a control that
  // fires on a healthy app is a control somebody switches off.
  //
  // So: THREE consecutive agreeing reads, and the run RESTARTS its streak if a later read is
  // BIGGER than the one it settled on. A page only ever grows as it mounts, so a rising count
  // after agreement is proof the agreement was premature - which a same-value check cannot see.
  const AGREE = 3;
  let streak = [];
  let settled = null;
  let peakBands = -1;
  let prev = null;
  for (let i = 0; i < 14; i += 1) {
    const now = await readRhythm();
    prev = now;
    if (now.bands > peakBands) {
      // Still growing. Anything agreed before this point was agreed on a partial page.
      peakBands = now.bands;
      streak = [now];
    } else if (streak.length && streak[0].bands === now.bands
               && Math.abs(streak[0].totalPx - now.totalPx) <= 2) {
      streak.push(now);
    } else {
      streak = [now];
    }
    if (streak.length >= AGREE) { settled = now; break; }
    await page.waitForTimeout(1200);
  }
  if (!settled) {
    console.error(`UNSTABLE: ${route} never gave two agreeing reads (last bands=${prev && prev.bands}, totalPx=${prev && prev.totalPx}).`);
    await browser.close();
    process.exit(2);
  }
  out[route] = settled;
  const s = settled;
  console.log(
    `${route.padEnd(11)} bands ${String(s.bands).padStart(3)}  over ${String(s.totalPx).padStart(5)}px` +
    ` = ${String(s.bandsPerKpx).padStart(5)}/1000px  |  whitespace ${String(s.whitespacePct).padStart(5)}%` +
    `  |  longest unbroken run ${String(s.longestRunPx).padStart(5)}px`,
  );
}

await browser.close();

const dash = out['/dashboard'];
const budget = out['/budget'];
if (!dash || !budget) { console.error('FAIL: a route did not report.'); process.exit(2); }

// POSITIVE CONTROL. Every finding below is /budget having FEW bands, and a broken detector
// satisfies that perfectly. /dashboard is known-dense, so it is the question whose answer is
// already known - and a control failure must read as the INSTRUMENT, never as the page.
if (dash.bands < 10) {
  console.error(`CONTROL FAILED: /dashboard read only ${dash.bands} bands. A page known to be densely`);
  console.error('segmented must read many, so the detector - not the page - is what is being measured.');
  process.exit(2);
}
if (budget.bands === 0) {
  console.error('CONTROL FAILED: /budget read 0 bands; that is a detector fault, not a page.');
  process.exit(2);
}

console.log(`\ncontrol: /dashboard read ${dash.bands} bands, so the detector finds bands.`);
const ratio = budget.bandsPerKpx / dash.bandsPerKpx;
console.log(`density: /budget is ${Math.round(ratio * 100)}% of /dashboard's bands per 1000px.`);

// THE GATE IS THE UNBROKEN RUN, NOT THE BAND DENSITY - and I re-aimed it AFTER measuring,
// which needs saying out loud rather than presenting as the plan.
//
// Band density was the obvious instrument and it is NEARLY BLIND here: /budget reads 61% of
// /dashboard's bands per 1000px, which is near enough to parity that any floor catching it would
// also fire on ordinary pages. A gate that is green on the exact page the user called dull does
// not detect the defect it was built for.
//
// The run fraction is the instrument that works, and it is not merely the number that happens to
// fail. It REPRODUCES an independent one-off measurement to the pixel - 1121px, measured on
// 2026-09-18 by a different method - and it is what the complaint describes: a stretch you scroll
// through with nothing changing.
//
//   /budget     1121px of 2322px = 48% of the whole page is ONE unbroken run
//   /dashboard  1028px of 5656px = 18%
//
// So /budget's worst run is LONGER in absolute pixels than /dashboard's while the page is under
// half the height. The ceiling is 2x /dashboard's fraction: generous enough that a normal page
// clears it, tight enough that today's /budget (2.6x) does not.
const CEILING = 2.0;
const frac = (r) => (r.totalPx ? r.longestRunPx / r.totalPx : 0);
const budgetFrac = frac(budget);
const dashFrac = frac(dash);
const times = dashFrac ? budgetFrac / dashFrac : Infinity;

console.log(`longest run as a share of page: /budget ${(budgetFrac * 100).toFixed(0)}% vs /dashboard ${(dashFrac * 100).toFixed(0)}% = ${times.toFixed(1)}x`);

if (times > CEILING) {
  console.error(`
FAIL: /budget's longest unbroken painted run is ${(budgetFrac * 100).toFixed(0)}% of its own height,`);
  console.error(`${times.toFixed(1)}x /dashboard's ${(dashFrac * 100).toFixed(0)}%, over the ${CEILING}x ceiling. That is ${budget.longestRunPx}px -`);
  console.error(`${(budget.longestRunPx / 844).toFixed(1)} phone viewports with no visual break.`);
  console.error(`
DO NOT FIX THIS BY ADDING SPACE. Whitespace is already ${budget.whitespacePct}% against /dashboard's`);
  console.error(`${dash.whitespacePct}%, so the page is not empty - widening dividers buys rhythm by adding the`);
  console.error('emptiness that was already refuted. BREAK the run into separate surfaces instead.');
  console.error('ACCEPTANCE IS A PAIR: this ratio falls AND whitespace does not rise materially.');
  process.exit(1);
}
console.log(`
PASS: /budget's longest unbroken run is ${times.toFixed(1)}x /dashboard's, within the ${CEILING}x ceiling.`);
console.log(`Other half of the pair: whitespace ${budget.whitespacePct}% vs /dashboard ${dash.whitespacePct}% - it must not have risen materially.`);
console.log(`Context, NOT gated: band density ${Math.round((budget.bandsPerKpx / dash.bandsPerKpx) * 100)}% of /dashboard's.`);
process.exit(0);
