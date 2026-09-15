#!/usr/bin/env node
/**
 * check-glass.mjs - prove the app's glass chrome is REALLY translucent, by measuring
 * that its pixels change when different content passes underneath it.
 *
 * WHY THIS EXISTS
 * Tre, 2026-09-15: "give my app the iphone glass effect. to integrate it wherever
 * possible." The reel he sent teaches `expo-glass-effect`, and its caption is explicit
 * that it renders the real native iOS 26 material, "not a fake blur".
 *
 * ⚠️ THAT PACKAGE CANNOT BE USED HERE, measured rather than assumed: package.json
 * carries no `expo*` and no `react-native*` dependency - this app is React 19 + Vite in
 * a Capacitor WebView. So the honest route is CSS `backdrop-filter`, which samples the
 * REAL pixels behind an element rather than painting a gradient that looks like glass.
 *
 * AND THAT DISTINCTION IS EXACTLY WHAT THIS CHECK MEASURES. A painted "glassy" fill and
 * a genuinely translucent one are indistinguishable in a class list, in a computed style,
 * and in a single screenshot. They differ in one observable way: move different content
 * under a real one and its pixels change. So:
 *
 *   1. Screenshot the glass bar's own box at scroll position A.
 *   2. Scroll the page so different content is beneath it.
 *   3. Screenshot the same box again and require the mean per-pixel difference to be
 *      material. A painted fill returns ~0 and fails.
 *
 * THE CONTROLS, and the second is the one that makes the first mean anything
 *   - `backdrop-filter` must be supported in this browser, or the property is inert and
 *     everything below would be measuring nothing. Exit 2.
 *   - THE COMPARATOR MUST BE ABLE TO RETURN "NO CHANGE". Before the real comparison it
 *     shoots the same box twice at the SAME scroll position and requires ~0 difference.
 *     Without that, a comparator that always reports "different" - a timing artefact, an
 *     animation, a caret - would pass this check over painted plastic.
 *   - At least one glass element must be found, and the count is printed. "0 failures"
 *     and "0 examined" are the same output.
 *
 * WHAT IT DOES NOT COVER
 *   Whether the effect looks GOOD, contrast of text over it, the opaque `@supports not`
 *   fallback path (this browser supports the property, so that branch is not exercised
 *   here), and any surface not on the page it opens.
 *
 * USAGE:  node scripts/check-glass.mjs
 * EXITS:  0 pass . 1 a glass surface is not really translucent . 2 could not test
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
// `.test` can never be a real mailbox - see walk-deck-undo.mjs for why that is what
// makes scripting this sign-in legitimate. Remove this and the dev-signin rule returns.
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to script a sign-in for "${email}".`);

const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}: ${JSON.stringify(session).slice(0, 200)}`);

// Settle the one-time dialogs in the ACCOUNT, not by racing their backdrops in the
// browser - see check-collapsed-rail.mjs for why that race is unwinnable.
const whatsNew = readFileSync('src/lib/whats-new.ts', 'utf8');
const releaseVersion = (whatsNew.match(/version:\s*'([^']+)'/) || [])[1];
if (!releaseVersion) fail(2, "could not read the current release version out of src/lib/whats-new.ts.");
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
// A phone viewport: the glass chrome under test (MobileNav, MobileTopBar) is `lg:hidden`
// and does not exist at desktop width, where this check would pass by absence.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);

const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';
for (let i = 0; i < 6 && (await page.locator(OVERLAY).count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const still = page.locator(OVERLAY);
  if (await still.count()) { await still.first().dispatchEvent('click'); await page.waitForTimeout(600); }
}
if (await page.locator(OVERLAY).count()) {
  await browser.close();
  fail(2, 'a modal overlay is still up; every screenshot below would be of the dialog, not of the chrome.');
}

// CONTROL 1 - is the property even live in this engine?
const supported = await page.evaluate(() =>
  CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'));
if (!supported) { await browser.close(); fail(2, 'this browser does not support backdrop-filter, so the property is inert and nothing below would measure anything.'); }

/**
 * Find the glass chrome BY ITS COMPUTED PROPERTY, never by class name. A hand-named list
 * is blind to the surface nobody added to it, which is always the newest one. Modal
 * overlays are excluded by position: they blur the whole page by design and would make
 * this check pass without any app chrome being glass at all.
 */
const targets = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const st = getComputedStyle(el);
    const bf = st.backdropFilter || st.webkitBackdropFilter || 'none';
    if (bf === 'none' || !bf) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 16) continue;
    if (r.width >= innerWidth && r.height >= innerHeight) continue; // a full-screen scrim
    out.push({
      label: (el.className || '').toString().split(' ').slice(0, 3).join(' ') || el.tagName,
      filter: bf,
      box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
      fixed: st.position === 'fixed' || st.position === 'sticky',
    });
  }
  return out;
});

console.log(`glass surfaces found on /dashboard at 390px: ${targets.length}`);
for (const t of targets) console.log(`  ${t.filter.padEnd(34)} ${t.box.width}x${t.box.height} at ${t.box.x},${t.box.y}  ${t.fixed ? 'pinned' : 'in flow'}  ${t.label}`);
if (targets.length === 0) {
  await browser.close();
  fail(1, 'no element on the dashboard has a backdrop-filter, so "the glass is real" would be a statement about nothing.');
}

// Only a PINNED surface can be measured this way: something in normal flow scrolls with
// the content behind it, so nothing new ever passes underneath and the comparison has no
// signal. Say so rather than quietly dropping them.
const pinned = targets.filter((t) => t.fixed);
const inFlow = targets.filter((t) => !t.fixed);
for (const t of inFlow) console.log(`  (not measurable by scrolling: ${t.label} is in normal flow, so the same content stays behind it)`);
/**
 * ⚠️ NO PINNED GLASS IS A FAILURE, NOT A "COULD NOT TEST", AND THE FIRST VERSION HAD
 * THIS WRONG. Exiting 2 here would mean that deleting `backdrop-filter` from the app
 * chrome - the one change this gate exists to catch - makes the gate go QUIET rather
 * than red. Proven by mutation: removing the property from `@utility glass` dropped the
 * pinned count to zero and the check reported "could not test". A gate that falls silent
 * exactly when the feature is removed is not a gate.
 * Pinned chrome being glass is the product decision under test, so its absence is the
 * defect. The in-flow surfaces are still reported, and still honestly described as
 * unmeasurable by this method.
 */
if (pinned.length === 0) {
  await browser.close();
  fail(1, `not one of the ${targets.length} glass surfaces is pinned. The app chrome that is supposed to be glass - the mobile nav and the top bar - either lost its backdrop-filter or is no longer on this page.`);
}

const png = (buf) => buf; // screenshots come back as raw PNG buffers
async function shoot(box) { return png(await page.screenshot({ clip: box })); }
/**
 * Mean absolute byte difference of two PNG buffers of identical geometry.
 * ⚠️ THIS IS A CHANGE DETECTOR, NOT A PERCEPTUAL MEASURE. PNG is compressed, so the
 * number says "these frames are not the same bytes" and nothing about how different
 * they LOOK - a one-pixel change and a total repaint can both read near the top of the
 * range. That is enough for the only question being asked here (did anything behind it
 * come through at all?) and it is not enough for anything else, which is why the
 * still-frame control below is what makes the reading mean something.
 */
function diff(a, b) {
  if (a.length !== b.length) return 255;
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

/**
 * ⚠️ THE APP DOES NOT SCROLL THE WINDOW, AND MY FIRST INSTRUMENT WAS BLIND TO THAT.
 * `DashboardLayout` scrolls an inner `overflow-y-auto` container, so `window.scrollTo`
 * moves nothing. The first run of this check reported the mobile nav as FLAT with a
 * difference of exactly 0.00 - which is what a painted fill looks like AND what two
 * identical screenshots of a page that never moved look like. It would have accused a
 * working feature on the strength of the harness not knowing where the scrollbar is.
 *
 * So the scroller is FOUND rather than assumed, and `scrollBy` ASSERTS ITS OWN EFFECT:
 * if the position does not change, this exits 2 (could not test) and never 1 (the glass
 * is fake). A tooling fault and a defect must not produce the same verdict.
 */
const scrollerInfo = await page.evaluate(() => {
  let best = null;
  for (const el of [document.scrollingElement, ...document.querySelectorAll('body *')]) {
    if (!el) continue;
    const over = el.scrollHeight - el.clientHeight;
    if (over > (best?.over ?? 0)) best = { el, over };
  }
  if (!best) return null;
  best.el.dataset.glassScroller = '1';
  return { over: best.over, tag: best.el.tagName, cls: (best.el.className || '').toString().slice(0, 50) };
});
if (!scrollerInfo || scrollerInfo.over < 200) {
  await browser.close();
  fail(2, `no element on this page scrolls by more than 200px (best: ${JSON.stringify(scrollerInfo)}), so no new content can pass behind the pinned chrome and this check has nothing to read.`);
}
console.log(`scroller: <${scrollerInfo.tag}> ${JSON.stringify(scrollerInfo.cls)} with ${scrollerInfo.over}px of overflow`);

const setScroll = (top) => page.evaluate((y) => {
  const el = document.querySelector('[data-glass-scroller="1"]');
  el.scrollTop = y;
  return el.scrollTop;
}, top);

const failures = [];
for (const t of pinned) {
  await setScroll(0);
  await page.waitForTimeout(900);

  // CONTROL 2 - the comparator must be able to say "nothing changed".
  const a1 = await shoot(t.box);
  await page.waitForTimeout(400);
  const a2 = await shoot(t.box);
  const noise = diff(a1, a2);

  const landedAt = await setScroll(900);
  await page.waitForTimeout(1100);
  if (landedAt < 100) {
    await browser.close();
    fail(2, `scrolling the container moved it to ${landedAt}px, so nothing new passed behind the chrome. This is the instrument failing, not the glass - refusing to report a verdict either way.`);
  }
  const b = await shoot(t.box);
  const moved = diff(a1, b);

  const real = moved > Math.max(noise * 4, 1.5);
  console.log(`  ${real ? 'REAL' : 'FLAT'}  ${t.label.padEnd(30)} still-frame noise ${noise.toFixed(2)} . after scrolling ${moved.toFixed(2)}`);
  if (noise > 4) {
    await browser.close();
    fail(2, `${t.label}: two screenshots at the SAME scroll position already differ by ${noise.toFixed(2)}, so this comparator cannot tell a real change from its own noise. Every verdict below it would be meaningless.`);
  }
  if (!real) failures.push({ ...t, noise, moved });
}

await setScroll(0);
await page.waitForTimeout(700);
await page.screenshot({ path: 'glass-390.png' });
await browser.close();

console.log(`\nexamined ${pinned.length} pinned glass surface(s) of ${targets.length} found`);
if (failures.length) {
  for (const f of failures) {
    console.error(`  FLAT  ${f.label} - its pixels moved by only ${f.moved.toFixed(2)} when the content behind it changed (noise floor ${f.noise.toFixed(2)}). That is a painted fill, not translucency.`);
  }
  fail(1, `${failures.length} of ${pinned.length} glass surface(s) do not actually sample what is behind them.`);
}
console.log(`PASS - all ${pinned.length} pinned glass surface(s) genuinely re-render when different content passes underneath.`);
