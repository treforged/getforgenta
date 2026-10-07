#!/usr/bin/env node
/**
 * check-dark-contrast.mjs - RENDERED text contrast in DARK mode, measured against the pixel a
 * string is actually drawn on.
 *
 * WHY A RENDERED PROBE WHEN A TOKEN TEST ALREADY EXISTS. `theme-contrast.test.ts` proves the
 * PALETTE clears AA. It cannot see a string whose colour comes from a Tailwind literal rather
 * than a token, it does not know which surface a given string actually sits on (a card is not
 * the page background), and it has no idea whether the element is on screen at all. Tre's
 * complaint was about text he was LOOKING AT, so the honest instrument reads pixels.
 *
 * Tre, 2026-09-18: "some of the text is very dull compared to the background ... it should be
 * white instead because it's kind of hard to read", and "dark mode looks a little dull and
 * boring". The token half is fixed in 44c67c0f (4.19:1 -> 7.80:1); this finds what that missed.
 *
 * ⚠️ IT WALKS UP FOR THE BACKGROUND, because almost every element is transparent. Taking an
 * element's own `background-color` would read `rgba(0,0,0,0)` nearly everywhere and compute a
 * confident, meaningless ratio against black. The first ancestor with a non-transparent
 * background is the surface the text is really drawn on.
 *
 * ⚠️ IT IS AN INVENTORY WITH AN EXIT CODE, NOT A STYLE GATE. It reports every visible text node
 * under 4.5:1 and exits 1 if any exist. It does NOT judge whether the screen looks vibrant -
 * "vibrant" is not a number, and a probe claiming to measure it would be the kind of instrument
 * this repo keeps filing as a lie.
 *
 * WHAT IT DOES NOT COVER, said plainly: light mode; text over images, gradients or backdrop
 * blur (the walk-up finds a colour but the real backdrop is composited); the 3:1 large-text
 * exemption, since everything is held to 4.5:1 rather than guessing which text counts as large;
 * anything off this route; and disabled or placeholder text, which WCAG exempts and this does
 * not attempt to tell apart - so a finding on one of those is a false positive to check by hand.
 *
 * ⚠️ MEASURED 2026-09-24: IT PASSES A GRADIENT BLIND. It reads `backgroundColor` only, so a
 * change made of `background-image` is invisible to it. The dark ambient glow (bf48946c) read
 * 465 strings, 0 below AA here, while a PIXEL probe found gold controls on the glow at 4.13 and
 * 4.21, plus "$4,200" on desktop /debt at 4.45. The pixel probe hid the text, took screenshots,
 * found the worst background pixel in each text's glyph area, compared glow on vs off, and used
 * a control proving the pixels move. A PASS from this gate is NOT evidence about any gradient,
 * image or blur. Ask 'make check:dark-contrast measure pixels' tracks the fix.
 *
 * USAGE:  node scripts/check-dark-contrast.mjs
 * EXITS:  0 nothing under 4.5:1 . 1 at least one string is . 2 could not measure
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
// The same refusal every browser gate here carries: this scripts a password sign-in, so it must
// only ever be able to do so for the dedicated walk account.
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
/**
 * ⚠️ THE SURVEY FLAG IS DERIVED, NOT TYPED, AND THAT IS WHY THIS GATE WAS BROKEN.
 *
 * The dialog-suppression list below was HAND-NAMED - `new_user_done`, `premium_done`,
 * `whats_new_<version>` - so it was blind to the modal nobody added to it. The PMF survey
 * shipped later, became eligible for the walk account (7+ days old, onboarded, never answered),
 * and this probe has been REFUSING AT EXIT 2 on /dashboard ever since: "a modal overlay is still
 * up". Escape does not close it and it carries no control matching the closer vocabulary, so the
 * gate could not run at all - the gate-nobody-runs failure its own comment warns about, arrived
 * by a different door.
 *
 * Reading the flag name out of `pmf-survey.ts` means a rename cannot silently re-break this.
 */
const pmfSeenFlag = (readFileSync('src/lib/pmf-survey.ts', 'utf8')
  .match(/PMF_SEEN_FLAG\s*=\s*'([^']+)'/) || [])[1];
if (!pmfSeenFlag) fail(2, 'could not read PMF_SEEN_FLAG out of src/lib/pmf-survey.ts.');

const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
const prof = await fetch(`${url}/rest/v1/profiles?select=tour_flags&user_id=eq.${session.user.id}`, { headers: rest });
if (!prof.ok) fail(2, `reading the walk account's profile returned ${prof.status}.`);
const flags = (await prof.json())[0]?.tour_flags ?? {};
const patch = await fetch(`${url}/rest/v1/profiles?user_id=eq.${session.user.id}`, {
  method: 'PATCH',
  headers: { ...rest, Prefer: 'return=representation' },
  body: JSON.stringify({
    founder_note_seen: true,
    tour_flags: { ...flags, new_user_done: true, premium_done: true, [`whats_new_${releaseVersion}`]: true, [pmfSeenFlag]: true },
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
/**
 * WHICH THEME IS BEING MEASURED. Defaults to dark, so the existing `check:dark-contrast`
 * behaves exactly as before; `--theme light` measures the OTHER half.
 *
 * ⚠️ LIGHT MODE HAD NO RENDERED GATE AT ALL until 2026-09-22 (ask 149fb21f). Both rendered
 * probes deliberately REFUSED to report a light reading, which was honest and left an entire
 * theme unmeasured - and this repo records that a stated limit is a to-do nobody schedules
 * rather than an absolution.
 *
 * It is one argument rather than a second script because a copied probe drifts: the two would
 * have to agree about the AA floor, the exemptions, the settle loop and the six routes, and
 * nothing would make them.
 */
const THEME = (() => {
  const i = process.argv.indexOf('--theme');
  const v = i > -1 ? process.argv[i + 1] : 'dark';
  if (v !== 'dark' && v !== 'light') {
    console.error(`FAIL(2): --theme must be "dark" or "light", got ${JSON.stringify(v)}.`);
    process.exit(2);
  }
  return v;
})();

/**
 * WHICH WIDTH. Defaults to the phone (390x844), so both existing scripts behave as before;
 * `--width 1440` measures the desktop layout, which no contrast probe had ever read (ask
 * 149fb21f). Desktop is a different DOM, not a wider phone: the sidebar rail, the header buttons
 * and the multi-column cards exist only there.
 */
const WIDTH = (() => {
  const i = process.argv.indexOf('--width');
  const v = i > -1 ? Number(process.argv[i + 1]) : 390;
  if (v !== 320 && v !== 390 && v !== 1440) {
    console.error(`FAIL(2): --width must be 320, 390 or 1440, got ${JSON.stringify(process.argv[i + 1])}.`);
    process.exit(2);
  }
  return v;
})();
console.log(`theme ${THEME}, viewport ${WIDTH}x${WIDTH === 390 ? 844 : WIDTH === 320 ? 568 : 900}`);

const ctx = await browser.newContext({ viewport: { width: WIDTH, height: WIDTH === 390 ? 844 : WIDTH === 320 ? 568 : 900 }, deviceScaleFactor: 2 });
// TEXT_SCALE=150: root text at 150% (as check:narrow-overflow), so text that re-flowed onto a new
// background with large text is measured there (969da7ed, 10-07).
const TEXT_SCALE = Number(process.env.TEXT_SCALE || 100);
if (TEXT_SCALE !== 100) {
  await ctx.addInitScript((pct) => {
    const set = () => { document.documentElement.style.fontSize = `${pct}%`; };
    if (document.documentElement) set(); document.addEventListener('DOMContentLoaded', set);
  }, TEXT_SCALE);
  console.log(`text scale ${TEXT_SCALE}%`);
}
const page = await ctx.newPage();
// VIEW_MODE=simple measures the Simple view (ask 5ce71f3a) by rewriting the user's own profile READ in the
// browser. Nothing is written; the walk account's view_mode is unchanged.
if (process.env.VIEW_MODE) {
  await ctx.route(/\/rest\/v1\/profiles/, async (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    try {
      const resp = await r.fetch();
      let body = await resp.text();
      try {
        const j = JSON.parse(body);
        const set = (o) => ({ ...o, view_mode: process.env.VIEW_MODE });
        body = JSON.stringify(Array.isArray(j) ? j.map(set) : set(j));
      } catch { /* not JSON: pass through */ }
      return await r.fulfill({ response: resp, body });
    } catch {
      return r.abort().catch(() => { /* page already closed */ });
    }
  });
  console.log(`view mode forced: ${process.env.VIEW_MODE}`);
}
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
// `--landing` reads the SIGNED-OUT pages (2026-10-07): no contrast probe had ever read the landing page,
// where the FTC testimonial disclosure lives. No session is written, so `/` renders the landing.
const LANDING = process.argv.includes('--landing');
if (!LANDING) {
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
}
// ⚠️ THE THEME IS SET THROUGH THE APP'S OWN MECHANISM, NOT BY FLIPPING A CLASS ON <html>.
// `src/lib/theme.ts` also sets `root.style.colorScheme`, and this repo has already recorded that
// a bare class flip is NOT a theme switch where the app sets the colour scheme inline - the light
// palette simply never gets exercised. Writing the stored CHOICE makes the app do its own work,
// and `applyTheme` then removes both classes before adding one, which is the behaviour we want.
await page.evaluate((th) => localStorage.setItem('forgenta.theme.v1', th), THEME);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));
// ⚠️ SIX ROUTES, NOT ONE. This walked /budget ALONE until 2026-09-18, which made it the only
// colour-blind contrast instrument in the repo AND scoped it to a single screen - so five of the
// six screens a user actually opens had never been measured by anything. That matters more than
// it looks: `check-destructive-contrast.mjs` finds its candidates BY COLOUR and is therefore
// structurally blind to text nobody repointed, so THIS is the only gate that can catch a
// low-contrast string whose colour nobody thought to look for. A one-route version left that
// job undone on 83% of the app.
// `--more` walks the other signed-in screens (2026-10-07): the six above were the only ones any
// contrast probe had read, so Transactions, Goals, Garage, Net Worth, Premium and the AI advisor
// were never measured.
const MORE = ['/transactions', '/goals', '/vehicles', '/builds', '/net-worth', '/premium', '/ai', '/subscriptions'];
const ROUTES = LANDING ? ['/'] : process.argv.includes('--more') ? MORE : ['/dashboard', '/budget', '/debt', '/forecast', '/account', '/settings'];
const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';

const readPage = () => page.evaluate(() => {
  // ⚠️ RESOLVED THROUGH A CANVAS, NOT A REGEX (2026-10-07, be864a14). Chrome reports any colour with
  // opacity - every Tailwind `text-x/NN` - as oklab(), which the old rgba-only regex returned null for,
  // and the loop below then skipped anything translucent. So `text-primary/75` was invisible to this
  // gate in both themes while reading 3.73:1 on screen. A canvas resolves any CSS colour to sRGB.
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const parse = (s) => {
    if (!s || s === 'transparent') return null;
    cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = s; cv.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cv.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { const n = v / 255; return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  // The surface the text is REALLY on: the nearest ancestor that paints something.
  const surfaceOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.95) return c;
    }
    return parse(getComputedStyle(document.body).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
  };
  const out = [];
  let examined = 0;
  for (const el of document.querySelectorAll('body *')) {
    // Only elements that draw their OWN text, so a wrapper is not credited with its child's string.
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    if (!own) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;      // sr-only and measuring nodes
    // ⚠️ aria-hidden IS THE ONE EXEMPTION, and it is DERIVED from the app rather than a list of
    // strings somebody maintained. WCAG's contrast floor is about text presented to a user; a
    // decorative glyph hidden from assistive tech is not that. The dashboard's "|" separator is
    // the real case - at 1.35:1 it is a divider drawn as a character, and making it AA-legible
    // would turn a hairline into a prominent pipe. THE RISK IS REAL AND WORTH STATING: hiding a
    // genuine string would silence this gate for it. That is already a worse accessibility bug
    // than low contrast, and it is not one this probe was ever able to catch.
    if (el.closest('[aria-hidden="true"]')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const raw = parse(cs.color);
    if (!raw || raw.a === 0) continue;
    // A translucent colour is composited over the opaque surface it sits on, rather than skipped.
    const surface = surfaceOf(el);
    const fg = { r: raw.r * raw.a + surface.r * (1 - raw.a), g: raw.g * raw.a + surface.g * (1 - raw.a), b: raw.b * raw.a + surface.b * (1 - raw.a) };
    examined += 1;
    const r = ratio(fg, surface);
    if (r < 4.5) {
      out.push({
        text: own.slice(0, 48), ratio: Math.round(r * 100) / 100,
        color: cs.color, size: cs.fontSize, weight: cs.fontWeight,
        cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || '')).slice(0, 70),
      });
    }
  }
  return { examined, findings: out, theme: document.documentElement.className };
});

/**
 * ⚠️ THE PIXEL ARM (ask ea989790, 2026-09-29). The walk-up above reads `background-color` and is
 * BLIND to anything painted another way: the dark glow, gradients, `background-image`, backdrop
 * blur. It passed the dark glow 465/0 while a pixel probe measured 4.13 / 4.21 / 4.45 on the same
 * screens. So each route is ALSO measured against the pixels a string is really drawn on:
 * collect each text's OWN glyph rect (a Range over its text nodes, not the element box, which
 * carries borders), hide all text, screenshot, and take the WORST background pixel under it.
 * Occluded text (under the floating nav, under a sticky header) is skipped by elementFromPoint,
 * because it sampled the covering element's pixels and read as a failure. Findings are keyed by
 * text AND position, never by index, so a re-render cannot pair one "$0" with another.
 * The walk-up stays as the first arm: it names the CSS colour, which is what a fix changes.
 *
 * LIMITS OF THIS ARM, stated so a green is not over-read: it reads only strings ON SCREEN in the
 * first viewport (about 129 of ~477 on a phone), not the whole page; its control DISCRIMINATES
 * only in dark mode (in light the walk-up also flags the planted grey string, so the control there
 * proves only that the pixel arm can flag); and a string partly under the floating nav is judged
 * by its centre point, so its lower edge can sample the nav's glass.
 * FIRST RUNS, 2026-09-29, after two instrument fixes (edge-cut strings skipped; two agreeing reads):
 * dark 390 and light 390 clean (128 strings). The white "1" badge on gold /debt (light) read 3.61 and
 * was a REAL defect, fixed in index.css and proven red without the fix. Still open (ask 13fdd69f):
 * "Mar 2031" /debt at 1440, 4.43 dark / 3.26 light, muted text on a translucent chip the walk-up
 * skips; "Reset & Recalculate" /debt light 1440, 4.36.
 */
const HIDE_TEXT = '*{color:transparent!important;-webkit-text-fill-color:transparent!important;'
  + 'text-shadow:none!important;caret-color:transparent!important;transition:none!important;animation:none!important}'
  // SVG text is painted by FILL, not colour, so `color: transparent` left chart labels drawn and
  // the arm measured a label against its own glyphs ("Mar 2031" at 4.43 on /debt, 2026-09-29).
  + 'svg text,svg tspan{fill:transparent!important;stroke:transparent!important}';
const PLANT_ID = 'contrast-pixel-control';

async function readPixels() {
  // HIDE FIRST, then read the rects and screenshot back to back. Reading rects before hiding let
  // a late layout shift on /dashboard move "Guide" onto the gold Add button beside it between the
  // read and the shot, and it measured 1.38:1 against a button it was not on (2026-09-29).
  // `color: transparent` changes no layout, so the rects are the ones the user sees.
  // ⚠️ TRANSITIONS OFF FOR THE WHOLE READ. This arm's own hide/unhide starts the app's colour
  // transitions, so the NEXT read stamped half-faded colours (alpha 0.176 on "Guide", 0.694 on the
  // nav) and reported 1.38:1 for gold text on a dark button (measured 2026-09-29). The instrument
  // manufactured the finding; with transitions off every colour is the settled one.
  const still = await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
  await page.waitForTimeout(150);
  // The real text colour is stamped BEFORE hiding: once hidden, getComputedStyle reads transparent.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      // SVG text's visible colour is its FILL; `color` there is only what it inherits.
      const svgText = el instanceof SVGTextContentElement && /^rgb/.test(cs.fill);
      el.setAttribute('data-cc', svgText ? cs.fill : cs.color);
    }
  });
  const tag = await page.addStyleTag({ content: HIDE_TEXT });
  await page.waitForTimeout(300);
  const texts = await page.evaluate(() => {
    const out = [];
    let occluded = 0;
    const W = innerWidth, H = innerHeight;
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('[aria-hidden="true"]')) continue;
      const tn = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (!tn.length) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || +st.opacity === 0) continue;
      const rg = document.createRange();
      rg.setStartBefore(tn[0]); rg.setEndAfter(tn[tn.length - 1]);
      const r = rg.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) continue;
      // A string cut by the viewport edge is half off screen and sits in whatever is at the edge -
      // on a phone that is the floating nav's shadow. It is not text anyone reads THERE, so it is
      // skipped and counted, not measured (a forecast line at y=835 of 844 read 3.79:1 on the shadow).
      if (r.top < 0 || r.bottom > H || r.left < 0 || r.right > W) { occluded += 1; continue; }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) { occluded += 1; continue; }
      const m = (el.getAttribute('data-cc') || '').match(/rgba?\(([^)]+)\)/);
      if (!m) continue;
      const x = Math.max(0, r.left), y = Math.max(0, r.top);
      out.push({
        t: el.textContent.trim().slice(0, 40), c: m[1].split(',').map(Number), plant: el.id === 'contrast-pixel-control',
        x, y, w: Math.min(W, r.right) - x, h: Math.min(H, r.bottom) - y,
      });
    }
    return { out, occluded };
  });
  const shot = await page.screenshot();
  if (process.env.CONTRAST_DEBUG_DIR) (await import('node:fs')).writeFileSync(`${process.env.CONTRAST_DEBUG_DIR}/px-${Date.now()}.png`, shot);
  const png = shot.toString('base64');
  await tag.evaluate((n) => n.remove());
  await page.evaluate(() => { for (const el of document.querySelectorAll('[data-cc]')) el.removeAttribute('data-cc'); });
  await still.evaluate((n) => n.remove());
  const res = await page.evaluate(async ({ png, texts }) => {
    const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    const sx = img.width / innerWidth;
    const lum = (r, gg, b) => {
      const f = (v) => { const n = v / 255; return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b);
    };
    return texts.map((t) => {
      const d = g.getImageData(Math.floor(t.x * sx), Math.floor(t.y * sx),
        Math.max(1, Math.floor(t.w * sx)), Math.max(1, Math.floor(t.h * sx))).data;
      const a = t.c.length > 3 ? t.c[3] : 1;
      // ⚠️ THE 5TH-PERCENTILE PIXEL, NOT THE SINGLE WORST. A rotated chart label's box takes in the
      // 1px tick line beside it, and the minimum read "Mar 2031" at 4.43 against that line while the
      // label itself is plainly legible (2026-09-29). A thin line under part of a box does not make
      // text unreadable; a fill under 5% or more of it does, and that is what this still catches.
      const samples = [];
      for (let i = 0; i < d.length; i += 16) {
        // a translucent text colour is composited over the very pixel it sits on
        const L1 = lum(t.c[0] * a + d[i] * (1 - a), t.c[1] * a + d[i + 1] * (1 - a), t.c[2] * a + d[i + 2] * (1 - a));
        const L2 = lum(d[i], d[i + 1], d[i + 2]);
        const r = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        samples.push([r, d[i], d[i + 1], d[i + 2]]);
      }
      samples.sort((p, q) => p[0] - q[0]);
      const pick = samples[Math.floor(samples.length * 0.05)] || [99];
      const worst = pick[0];
      const worstPx = pick.length > 1 ? pick.slice(1) : null;
      return { fg: t.c.join(','), bg: worstPx ? worstPx.join(',') : '', key: `${t.t}@${Math.round(t.x)},${Math.round(t.y)}`, text: t.t, plant: t.plant, ratio: Math.round(worst * 100) / 100 };
    });
  }, { png, texts: texts.out });
  return { res, occluded: texts.occluded };
}

/**
 * THE PIXEL ARM'S CONTROL, run once on the first route. A string in mid-grey on a mid-grey
 * BACKGROUND-IMAGE: the walk-up reads `background-color`, finds the dark page, and passes it; the
 * pixels are grey on grey (about 1.2:1), so the pixel arm MUST flag it. That pair is exactly the
 * blindness this arm exists to close. If the pixel arm does not flag it, it cannot see an image
 * background and its silence means nothing - exit 2.
 */
async function pixelControl() {
  await page.evaluate((id) => {
    const d = document.createElement('div');
    d.id = id; d.textContent = 'PIXEL CONTROL';
    Object.assign(d.style, {
      position: 'fixed', top: '160px', left: '20px', zIndex: '2147483647', padding: '8px',
      color: 'rgb(150,150,150)', backgroundImage: 'linear-gradient(rgb(128,128,128), rgb(128,128,128))',
      fontSize: '16px',
    });
    document.body.appendChild(d);
  }, PLANT_ID);
  await page.waitForTimeout(200);
  const walk = (await readPage()).findings.some((f) => f.text === 'PIXEL CONTROL');
  const px = (await readPixels()).res.find((r) => r.plant);
  await page.evaluate((id) => document.getElementById(id)?.remove(), PLANT_ID);
  return { walkFlagged: walk, pixelRatio: px ? px.ratio : null };
}

const pixelFindings = [];
let pixelExamined = 0;
let pixelOccluded = 0;
let control = null;

const report = { examined: 0, findings: [], theme: '' };
const perRouteExamined = new Map();   // route -> how many strings it actually rendered
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  // A signed-out walk that got bounced is measuring the wrong page; refuse rather than report it.
  if (LANDING && new URL(page.url()).pathname !== route) fail(2, `${route} redirected to ${page.url()}.`);
  // ⚠️ ESCAPE ALONE IS NOT ENOUGH, and /forecast is the case that proved it. It auto-opens a real
  // "Forecast Assumptions" dialog that survived six Escapes and an overlay click, so the gate
  // refused at exit 2 - correctly, but a gate that exits 2 on an ordinary run is a gate nobody
  // runs. So press the dialog's OWN close control as well. It is found by ROLE and accessible
  // name rather than by a hand-written label list, because a list is blind to the dialog nobody
  // added to it.
  for (let i = 0; i < 6 && (await page.locator(OVERLAY).count()); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    if (!(await page.locator(OVERLAY).count())) break;
    const closer = page.getByRole('button', { name: /close|done|cancel|dismiss|got it/i }).first();
    if (await closer.count()) {
      await closer.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(600);
      if (!(await page.locator(OVERLAY).count())) break;
    }
    const still = page.locator(OVERLAY);
    if (await still.count()) { await still.first().dispatchEvent('click'); await page.waitForTimeout(600); }
  }
  if (await page.locator(OVERLAY).count()) {
    // NAME THE MODAL AND ITS CONTROLS. "a modal overlay is still up" sends the reader hunting;
    // printing what was actually on screen makes the difference between an app change and a
    // dismissal vocabulary that has fallen behind visible in one read.
    const what = await page.evaluate(() => {
      const el = document.querySelector('[role="dialog"], [role="alertdialog"], [data-state="open"]');
      if (!el) {
        return {
          found: false,
          whatMatchedOverlay: [...document.querySelectorAll('div.backdrop-blur-sm, div.modal-overlay')]
            .map((d) => {
              const st = getComputedStyle(d);
              const b = d.getBoundingClientRect();
              return {
                cls: d.className.slice(0, 90),
                position: st.position,
                zIndex: st.zIndex,
                box: `${Math.round(b.width)}x${Math.round(b.height)}`,
                text: (d.textContent || '').trim().slice(0, 50),
              };
            }).slice(0, 5),
        };
      }
      return {
        found: true,
        name: el.getAttribute('aria-label') || '',
        heading: (el.querySelector('h1,h2,h3')?.textContent || '').trim(),
        text: (el.textContent || '').trim().slice(0, 160),
        buttons: [...el.querySelectorAll('button')].map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean),
      };
    });
    await browser.close();
    fail(2, `a modal overlay is still up on ${route}; it would intercept the reads below.
`
      + `  dialog: ${JSON.stringify(what)}`);
  }
  // ⚠️ READ UNTIL TWO CONSECUTIVE READS AGREE. A fixed sleep read /dashboard as 0 elements on one
  // run and 16 on the next in the sibling probe, minutes apart, with no code change - the widgets
  // had not mounted. AN UNSETTLED PAGE'S ZERO IS INDISTINGUISHABLE FROM A CLEAN ONE, and here it
  // would quietly shrink `examined`, which is the very number the control below relies on.
  let r = await readPage();
  const seen = [r.examined];
  let settled = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.waitForTimeout(2500);
    const again = await readPage();
    seen.push(again.examined);
    if (again.examined === r.examined) { r = again; settled = true; break; }
    r = again;
  }
  if (!settled) {
    await browser.close();
    fail(2, `UNSTABLE: ${route} never settled - examined counts ${seen.join(' -> ')}. Not averaging them.`);
  }
  if (!control) control = await pixelControl();
  // ⚠️ READ TWICE AND KEEP ONLY WHAT BOTH READS AGREE ON, with no dialog up. On 2026-09-29 one light
  // run caught /forecast's Assumptions dialog still CLOSING - its scrim greyed the page - and reported
  // 11 strings at 3.05-3.71; the next run read the same route clean. A finding one read makes and the
  // next does not is a fact about timing, and it is printed as UNSTABLE rather than counted.
  for (let i = 0; i < 6 && (await page.getByRole('dialog').count()); i += 1) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  }
  if (await page.getByRole('dialog').count()) {
    await browser.close();
    fail(2, `a dialog is still open on ${route}; the pixel arm would measure its scrim.`);
  }
  await page.waitForTimeout(800);
  const px = await readPixels();
  const px2 = await readPixels();
  const again = new Set(px2.res.filter((p) => p.ratio < 4.5).map((p) => p.key));
  const firstBelow = px.res.filter((p) => !p.plant && p.ratio < 4.5);
  const pxBelow = firstBelow.filter((p) => again.has(p.key));
  if (firstBelow.length !== pxBelow.length) {
    console.log(`   UNSTABLE on ${route}: ${firstBelow.length - pxBelow.length} pixel finding(s) did not repeat on a second read - not counted`);
  }
  pixelExamined += px.res.length;
  pixelOccluded += px.occluded;
  for (const p of pxBelow) pixelFindings.push({ route, ...p });
  console.log(`${route.padEnd(12)} examined ${String(r.examined).padStart(4)}  below AA ${r.findings.length}  (settled after ${seen.length} reads)`
    + `   | pixels: ${px.res.length} on screen, ${px.occluded} occluded, below AA ${pxBelow.length}`);
  perRouteExamined.set(route, r.examined);
  report.examined += r.examined;
  report.theme = r.theme;
  for (const f of r.findings) report.findings.push({ route, ...f });
}

await browser.close();

// -- POSITIVE CONTROL ----------------------------------------------------------------------
// "0 findings" and "0 strings examined" are the same zero, and only one of them is good news.
if (report.examined === 0) {
  fail(2, 'examined ZERO text elements - the probe never reached a rendered screen, so a clean '
    + 'result here would be a fact about the instrument rather than about the app.');
}

/**
 * ⚠️ A PER-ROUTE FLOOR, BECAUSE "SETTLED" IS NOT "MOUNTED". Observed 2026-09-22: /dashboard read
 * SIX elements and reported "settled after 2 reads" with 0 below AA, on a run whose sibling read
 * it at 163. Two agreeing reads of a page that has not mounted agree perfectly - a stuck page is
 * the most consistent thing there is - so the settle loop alone cannot tell a clean screen from
 * an absent one, and that zero is indistinguishable from a pass.
 *
 * Ten is not a tuned number and is not meant to be: every route in this app renders far more
 * than ten strings, so anything under it means the screen was not there. The floor exists to
 * refuse an under-read, not to grade one.
 */
const thin = [...perRouteExamined.entries()].filter(([, n]) => n < 10);
if (thin.length) {
  fail(2, `these routes rendered almost nothing, so their zero is a fact about the probe rather `
    + `than about the app: ${thin.map(([r, n]) => `${r} (${n})`).join(', ')}. `
    + 'Re-run; if it persists the page is genuinely not mounting.');
}
// ⚠️ THE THEME IT MEASURED MUST BE THE THEME IT ASKED FOR. A reading taken in the wrong theme
// is not a weaker result, it is a result about something else - and the two palettes differ most
// exactly where contrast is marginal. `applyTheme` removes both classes before adding one, so
// this is an exact check rather than a substring that could match either.
// ⚠️ `\\b`, NOT `\b`. Inside a template literal `\b` is a BACKSPACE character (0x08), not a word
// boundary - so the pattern became /<BS>dark<BS>/, which can never match, and this refused a
// reading taken in exactly the theme it asked for. Silent, invisible in every viewer, and the
// same trap this machine has recorded hitting three separate desks.
if (!new RegExp(`\\b${THEME}\\b`).test(report.theme)) {
  fail(2, `asked for ${THEME} but the document is in ${JSON.stringify(report.theme)}. Refusing to `
    + 'report a reading taken in the other theme.');
}

// -- PIXEL ARM CONTROL -----------------------------------------------------------------------
console.log(`pixel control: walk-up flagged it=${control?.walkFlagged}  pixel ratio=${control?.pixelRatio}`);
if (!control || control.pixelRatio === null || control.pixelRatio >= 4.5) {
  fail(2, 'PIXEL CONTROL FAILED: a grey-on-grey background-image string was not flagged by the pixel '
    + 'arm, so it cannot see image backgrounds and its silence is not evidence.');
}
if (pixelExamined === 0) fail(2, 'the pixel arm examined ZERO strings - it never read a screen.');

console.log(`pixel arm: ${pixelExamined} on-screen strings, ${pixelOccluded} skipped as occluded or cut by the viewport edge; `
  + `${pixelFindings.length} below 4.5:1 against the pixels they are drawn on`);
for (const f of pixelFindings.sort((a, b) => a.ratio - b.ratio)) {
  console.log(`  ${String(f.ratio).padStart(5)}:1  ${String(f.route).padEnd(11)} (pixels) ${JSON.stringify(f.text)} at ${f.key.split('@')[1]}  text rgb(${f.fg}) on pixel rgb(${f.bg})`);
}

console.log(`examined ${report.examined} rendered text elements in ${THEME} mode; `
  + `${report.findings.length} below 4.5:1`);
for (const f of report.findings.sort((a, b) => a.ratio - b.ratio)) {
  console.log(`  ${String(f.ratio).padStart(5)}:1  ${String(f.route).padEnd(11)} ${f.size}/${f.weight}  ${JSON.stringify(f.text)}  [${f.color}] .${f.cls}`);
  console.log(`            color=${f.color}  class=${f.cls}`);
}

if (report.findings.length || pixelFindings.length) {
  fail(1, `${report.findings.length} (walk-up) and ${pixelFindings.length} (pixels) rendered string(s) are below the WCAG AA floor of 4.5:1. `
    + 'Check each by hand before changing anything - disabled and placeholder text is exempt and '
    + 'this probe cannot tell it apart.');
}
console.log('PASS: every rendered string measured clears 4.5:1.');
