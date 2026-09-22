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

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
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
const ROUTES = ['/dashboard', '/budget', '/debt', '/forecast', '/account', '/settings'];
const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';

const readPage = () => page.evaluate(() => {
  const parse = (s) => {
    const m = (s || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
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
    const fg = parse(cs.color);
    if (!fg || fg.a < 0.95) continue;                    // a translucent colour needs compositing
    examined += 1;
    const r = ratio(fg, surfaceOf(el));
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

const report = { examined: 0, findings: [], theme: '' };
const perRouteExamined = new Map();   // route -> how many strings it actually rendered
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
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
  console.log(`${route.padEnd(12)} examined ${String(r.examined).padStart(4)}  below AA ${r.findings.length}  (settled after ${seen.length} reads)`);
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

console.log(`examined ${report.examined} rendered text elements in ${THEME} mode; `
  + `${report.findings.length} below 4.5:1`);
for (const f of report.findings.sort((a, b) => a.ratio - b.ratio)) {
  console.log(`  ${String(f.ratio).padStart(5)}:1  ${String(f.route).padEnd(11)} ${f.size}/${f.weight}  ${JSON.stringify(f.text)}`);
  console.log(`            color=${f.color}  class=${f.cls}`);
}

if (report.findings.length) {
  fail(1, `${report.findings.length} rendered string(s) are below the WCAG AA floor of 4.5:1. `
    + 'Check each by hand before changing anything - disabled and placeholder text is exempt and '
    + 'this probe cannot tell it apart.');
}
console.log('PASS: every rendered string measured clears 4.5:1.');
