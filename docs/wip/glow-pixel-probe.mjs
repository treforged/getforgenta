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

/**
 * WHICH WIDTH. Defaults to the phone (390x844), so both existing scripts behave as before;
 * `--width 1440` measures the desktop layout, which no contrast probe had ever read (ask
 * 149fb21f). Desktop is a different DOM, not a wider phone: the sidebar rail, the header buttons
 * and the multi-column cards exist only there.
 */
const WIDTH = (() => {
  const i = process.argv.indexOf('--width');
  const v = i > -1 ? Number(process.argv[i + 1]) : 390;
  if (v !== 390 && v !== 1440) {
    console.error(`FAIL(2): --width must be 390 or 1440, got ${JSON.stringify(process.argv[i + 1])}.`);
    process.exit(2);
  }
  return v;
})();
console.log(`theme ${THEME}, viewport ${WIDTH}x${WIDTH === 390 ? 844 : 900}`);

const ctx = await browser.newContext({ viewport: { width: WIDTH, height: WIDTH === 390 ? 844 : 900 }, deviceScaleFactor: 2 });
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
const HIDE = '*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}';

async function measure(glowOn) {
  const n = await page.evaluate((on) => { const e = document.querySelector('[data-glowprobe]') || document.querySelector('.app-shell'); if (!e) return 0; e.setAttribute('data-glowprobe','1'); e.classList.toggle('app-shell', on); return 1; }, glowOn); if (!n) fail(2, 'no app-shell element');
  await page.waitForTimeout(400);
  const texts = await page.evaluate(() => {
    const out = [];
    const W = innerWidth, H = innerHeight;
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('[aria-hidden="true"]')) continue;
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || +st.opacity === 0) continue;
      // the GLYPH area: the text nodes' own range, not the element's box (which carries border + padding)
      const rg = document.createRange(); const tn = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
      rg.setStartBefore(tn[0]); rg.setEndAfter(tn[tn.length - 1]);
      const r = rg.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) continue;
      // OCCLUDED/CLIPPED text is not on screen: text scrolled under the footer sampled the
      // footer's pixels and read as a glow failure (2026-09-24, '$4,200' at y=862).
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) { window.__occluded = (window.__occluded || 0) + 1; continue; }
      const m = st.color.match(/rgba?\(([^)]+)\)/); if (!m) continue;
      const p = m[1].split(',').map(Number);
      out.push({ t: el.textContent.trim().slice(0, 30), c: p, x: Math.max(0, r.left), y: Math.max(0, r.top), w: Math.min(W, r.right) - Math.max(0, r.left), h: Math.min(H, r.bottom) - Math.max(0, r.top) });
    }
    return out;
  });
  const h = await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(300);
  const png = (await page.screenshot()).toString('base64');
  await h.evaluate(n => n.remove());
  return page.evaluate(async ({ png, texts }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    const sx = img.width / innerWidth;
    const lum = (r, gg, b) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b); };
    const res = [];
    for (const t of texts) {
      const d = g.getImageData(Math.floor(t.x * sx), Math.floor(t.y * sx), Math.max(1, Math.floor(t.w * sx)), Math.max(1, Math.floor(t.h * sx))).data;
      const a = t.c.length > 3 ? t.c[3] : 1;
      let worst = 99;
      for (let i = 0; i < d.length; i += 16) {
        const tr = t.c[0] * a + d[i] * (1 - a), tg = t.c[1] * a + d[i + 1] * (1 - a), tb = t.c[2] * a + d[i + 2] * (1 - a);
        const L1 = lum(tr, tg, tb), L2 = lum(d[i], d[i + 1], d[i + 2]);
        const r = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        if (r < worst) worst = r;
      }
      res.push({ k: t.t + '@' + Math.round(t.x) + ',' + Math.round(t.y), t: t.t, worst: +worst.toFixed(2) });
    }
    // control pixel: the shell's top-left corner, where the gold field is strongest
    const cp = g.getImageData(2, Math.floor(innerHeight * sx) - 4, 1, 1).data;
    const tl = g.getImageData(Math.floor(innerWidth*sx) - 3, Math.floor(innerHeight*0.45*sx), 1, 1).data;
    return { res, ctl: [...tl].slice(0, 3) };
  }, { png, texts });
}

let totalOn = 0, below = [], ctlDiff = 0;
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  for (let i = 0; i < 6 && (await page.locator(OVERLAY).count()); i += 1) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  for (let i = 0; i < 6 && (await page.getByRole('dialog').count()); i += 1) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  const off = await measure(false);
  const on = await measure(true);
  const d = Math.abs(on.ctl[0] - off.ctl[0]) + Math.abs(on.ctl[1] - off.ctl[1]) + Math.abs(on.ctl[2] - off.ctl[2]);
  ctlDiff = Math.max(ctlDiff, d);
  const minOn = Math.min(99, ...on.res.map(r => r.worst)), minOff = Math.min(99, ...off.res.map(r => r.worst));
  // element-wise: a string the GLOW pushes below 4.5 (it passed with glow off)
  const offBy = new Map(off.res.map(r => [r.k, r])); const unmatched = on.res.filter(r => !offBy.has(r.k)).length;
  if (unmatched > 2) console.log(`   UNSETTLED: ${unmatched} glow-ON strings had no glow-OFF twin`);
  const b = on.res.filter(r => r.worst < 4.5 && (!offBy.has(r.k) || offBy.get(r.k).worst >= 4.5));
  const belowOn = on.res.filter(r => r.worst < 4.5).map(r => `${r.t}=${r.worst}`);
  if (belowOn.length) console.log(`   ALL below 4.5 with glow ON: ${belowOn.join(' | ')}`);
  const bOff = off.res.filter(r => r.worst < 4.5).length;
  const drops = on.res.map(r => offBy.has(r.k) ? +(offBy.get(r.k).worst - r.worst).toFixed(2) : 0);
  console.log(`   max contrast drop from glow ${Math.max(0, ...drops)}; worst glow-ON among those passing without it ${Math.min(99, ...on.res.filter(r=>offBy.has(r.k)&&offBy.get(r.k).worst>=4.5).map(r=>r.worst))}`);
  totalOn += on.res.length; below.push(...b.map(x => `${route} "${x.t}" ${x.worst} at ${x.k}`));
  console.log(`${route.padEnd(11)} texts ${String(on.res.length).padStart(3)}  worst glow-ON ${minOn}  glow-OFF ${minOff}  newly-below-4.5 ${b.length} (pre-existing ${bOff})  ctlPixelDelta ${d}`);
}
await browser.close();
console.log(`examined ${totalOn}; control (shell pixel moved by glow) max delta ${ctlDiff}`);
if (ctlDiff < 6) fail(2, 'CONTROL FAILED: the glow did not change the shell pixel, so this instrument cannot see it.');
if (below.length) { console.log(below.slice(0, 40).join('\n')); process.exit(1); }
console.log('PASS');
