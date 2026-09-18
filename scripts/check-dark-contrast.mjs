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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
// ⚠️ THE THEME IS SET THROUGH THE APP'S OWN MECHANISM, NOT BY FLIPPING A CLASS ON <html>.
// `src/lib/theme.ts` also sets `root.style.colorScheme`, and this repo has already recorded that
// a bare class flip is NOT a theme switch where the app sets the colour scheme inline - the light
// palette simply never gets exercised. Writing the stored CHOICE makes the app do its own work,
// and `applyTheme` then removes both classes before adding one, which is the behaviour we want.
await page.evaluate(() => localStorage.setItem('forgenta.theme.v1', 'dark'));
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));
await page.goto(`${BASE}/budget`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);

const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';
for (let i = 0; i < 6 && (await page.locator(OVERLAY).count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const still = page.locator(OVERLAY);
  if (await still.count()) { await still.first().dispatchEvent('click'); await page.waitForTimeout(600); }
}
if (await page.locator(OVERLAY).count()) {
  await browser.close();
  fail(2, 'a modal overlay is still up; it would intercept the reads below.');
}

const report = await page.evaluate(() => {
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

await browser.close();

// -- POSITIVE CONTROL ----------------------------------------------------------------------
// "0 findings" and "0 strings examined" are the same zero, and only one of them is good news.
if (report.examined === 0) {
  fail(2, 'examined ZERO text elements - the probe never reached a rendered screen, so a clean '
    + 'result here would be a fact about the instrument rather than about the app.');
}
if (!/dark/.test(report.theme)) {
  fail(2, `the document is not in dark mode (html class = ${JSON.stringify(report.theme)}), and `
    + 'this probe only means anything in dark. Refusing to report a light-mode reading as a dark one.');
}

console.log(`examined ${report.examined} rendered text elements in dark mode; `
  + `${report.findings.length} below 4.5:1`);
for (const f of report.findings.sort((a, b) => a.ratio - b.ratio)) {
  console.log(`  ${String(f.ratio).padStart(5)}:1  ${f.size}/${f.weight}  ${JSON.stringify(f.text)}`);
  console.log(`            color=${f.color}  class=${f.cls}`);
}

if (report.findings.length) {
  fail(1, `${report.findings.length} rendered string(s) are below the WCAG AA floor of 4.5:1. `
    + 'Check each by hand before changing anything - disabled and placeholder text is exempt and '
    + 'this probe cannot tell it apart.');
}
console.log('PASS: every rendered string measured clears 4.5:1.');
