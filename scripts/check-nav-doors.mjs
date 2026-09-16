#!/usr/bin/env node
/**
 * check-nav-doors.mjs - WALK THE NAV IA IN A REAL BROWSER, AT A PHONE VIEWPORT AND AT DESKTOP.
 *
 * WHY THIS EXISTS
 * Tre, 2026-09-16: *"pressing the user icon in the top left takes the user to settings. pressing
 * the hamburger and settings also takes you there. to many places."* and *"the hamburger should
 * open the settings page, including the log out button, like how instagram does it."* Settings had
 * THREE doors on a phone and now has ONE: Account tab -> hamburger -> Settings.
 *
 * ⚠️ THE SOURCE GATE CANNOT SEE ANY OF THIS. `settings-reachable.gate.test.ts` proves the route is
 * declared and that the link exists in the file. It runs in jsdom, which has NO LAYOUT and cannot
 * evaluate an `lg:` breakpoint - so `lg:hidden` and `lg:inline-flex` are invisible to it, and it
 * cannot tell a rendered hamburger from one that is display:none, off screen, or covered.
 *
 * ⚠️ AND THE EXACT FAILURE THIS GUARDS AGAINST HAS SHIPPED HERE BEFORE. 2026-08-19, from
 * TestFlight: `viewport-fit=cover` put the 44px hamburger UNDER the notch, so it was untappable -
 * and the hamburger is the ONLY route to Settings on a phone, so Settings was out of reach on
 * every notched iPhone. It threw nothing and rendered fine. That is why assertion 2 below is a
 * HIT TEST (`elementFromPoint` at the control's own centre) and not a visibility check: a button
 * that is visible and covered passes every visibility assertion ever written.
 *
 * WHAT IT ASSERTS
 *   PHONE (390x844)
 *     1. The hamburger is ABSENT on Home, Transactions, Debt and Garage.
 *     2. It is PRESENT on Account, and the topmost element at its own centre point is the
 *        hamburger itself - i.e. a real thumb would land on it.
 *     3. Pressing it lands on /settings.
 *     4. Settings carries an ordinary Sign Out that is NOT the "Sign Out All Devices" control,
 *        and both exist as DISTINCT elements - the ordinary one was missing before 2026-09-16.
 *     5. The identity badge in the top-left goes to /account (not to /settings - that was door 1).
 *   DESKTOP (1440x900)
 *     6. The Account page's Settings button is VISIBLE. The desktop rail has no Settings row, so
 *        that button is the ONLY desktop route to Settings, and it is `hidden lg:inline-flex`.
 *
 * POSITIVE CONTROLS, run BEFORE the absences are believed. Four of the assertions above are
 * ABSENCES, and an absence proves nothing until the selector is shown to be able to find the
 * thing. So: the hamburger selector MUST match on /account, and the identity-badge selector MUST
 * match, before any "not found" elsewhere is read as a finding. A zero from a broken selector and
 * a zero from a correct app are the same zero.
 *
 * WHAT IT DOES NOT COVER
 *   Colours, spacing, contrast, the look of anything, the real iOS safe area (the inset is 0 in a
 *   desktop Chromium - assertion 2 catches a control covered by CHROME, not one hidden under a
 *   physical notch; only a device does that), and anything on Settings beyond the two sign-out
 *   controls.
 *
 * USAGE:  node scripts/check-nav-doors.mjs
 * EXITS:  0 pass . 1 a door is wrong . 2 could not test
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };

const HAMBURGER = '[aria-label="Open menu"]';
/** The four tab routes that must NOT show it, and the one that must. */
const NO_BURGER = ['/dashboard', '/transactions', '/debt', '/vehicles'];
const BURGER_ON = '/account';

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

// Settle the first-run dialogs, or a modal overlay intercepts every press below.
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
const failures = [];
const note = (m) => { console.log(`  ${m}`); };

/** Open a signed-in context at one viewport. */
async function openAt(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
  await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
    version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
  })));
  return { ctx, page };
}

/** Dismiss anything that would intercept a press, then say whether the page is clear. */
async function clearOverlays(page) {
  const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';
  for (let i = 0; i < 6 && (await page.locator(OVERLAY).count()); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const still = page.locator(OVERLAY);
    if (await still.count()) { await still.first().dispatchEvent('click'); await page.waitForTimeout(600); }
  }
  return (await page.locator(OVERLAY).count()) === 0;
}

async function go(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  if (!(await clearOverlays(page))) {
    failures.push(`a modal overlay is still up on ${path}; it would intercept every press, so nothing below is measurable.`);
    return false;
  }
  const landed = new URL(page.url()).pathname.replace(/\/+$/, '') || '/';
  if (landed !== path) {
    failures.push(`${path} landed on ${landed} - the walk account is not past first run, so this route was never exercised.`);
    return false;
  }
  return true;
}

// PHONE
console.log('PHONE 390x844');
const { ctx: phoneCtx, page: phone } = await openAt(390, 844);

// POSITIVE CONTROL FIRST. Until the selector is shown to match somewhere, every absence
// below is a fact about the selector rather than about the app.
let controlOk = false;
if (await go(phone, BURGER_ON)) {
  const n = await phone.locator(HAMBURGER).count();
  note(`control: ${HAMBURGER} matches ${n} element(s) on ${BURGER_ON}`);
  if (n === 1) controlOk = true;
  else failures.push(`CONTROL FAILED: the hamburger selector matches ${n} element(s) on ${BURGER_ON}. Expected exactly 1. Every "absent" result below is therefore unreadable - this is an instrument fault, not a finding about the app.`);
}
if (!controlOk) {
  await browser.close();
  for (const f of failures) console.error(`  ${f}`);
  fail(2, 'the hamburger selector could not be shown to work, so no absence can be believed.');
}

// 2 - PRESENT and actually TAPPABLE. The hit test is the point: visible-and-covered is the
// shape that put Settings out of reach on every notched iPhone in 2026-08.
const hit = await phone.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return { ok: false, why: 'not in the DOM' };
  const r = el.getBoundingClientRect();
  if (r.width < 44 || r.height < 44) return { ok: false, why: `touch target is ${Math.round(r.width)}x${Math.round(r.height)}, under the 44px floor` };
  if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) {
    return { ok: false, why: `box top=${Math.round(r.top)} left=${Math.round(r.left)} bottom=${Math.round(r.bottom)} right=${Math.round(r.right)} is outside the ${innerWidth}x${innerHeight} viewport` };
  }
  const topmost = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!topmost || !el.contains(topmost)) {
    const d = topmost ? `${topmost.tagName.toLowerCase()} ${String(topmost.className || '').slice(0, 60)}` : 'nothing';
    return { ok: false, why: `the topmost element at its own centre is "${d}", not the hamburger - a thumb would hit that instead` };
  }
  return { ok: true, box: `${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.left)},${Math.round(r.top)}` };
}, HAMBURGER);
if (hit.ok) note(`hamburger on ${BURGER_ON}: tappable, ${hit.box}`);
else failures.push(`the hamburger on ${BURGER_ON} is NOT tappable: ${hit.why}.`);

// 5 - the identity badge, with its own positive control.
// ⚠️ DO NOT MATCH ON AN ICON. The first version of this required `a.querySelector('svg')` and
// found NOTHING - because `resolveIdentity` renders INITIALS ("DW") rather than a User icon
// whenever it has a name to work with. The selector required the one thing the control does not
// have, so its zero was a fact about the selector. Matched on POSITION and a rendered box
// instead: this is the only link occupying the top-left corner of the phone bar.
const badge = await phone.evaluate(() => {
  const links = [...document.querySelectorAll('a[href]')];
  const el = links.find((a) => {
    const r = a.getBoundingClientRect();
    return !(a.getAttribute('aria-label') || '').includes('Open menu')
      && r.width > 0 && r.height > 0 && r.left < 80 && r.top < 100;
  });
  if (!el) return { found: false };
  return { found: true, href: el.getAttribute('href'), label: el.getAttribute('aria-label') };
});
if (!badge.found) {
  failures.push('CONTROL FAILED: no top-left identity control was found at all on the Account tab, so "the badge goes to /account" is unmeasured rather than passing.');
} else {
  note(`identity badge: href=${badge.href} label=${JSON.stringify(badge.label)}`);
  if (badge.href !== '/account') {
    failures.push(`the top-left identity badge points at ${badge.href}, not /account. Tre removed that door on 2026-09-16 - pressing the user icon must land on the Account tab, not on Settings.`);
  }
}

// 3 - press it, and require the URL to CHANGE to /settings.
const before = new URL(phone.url()).pathname;
await phone.locator(HAMBURGER).click();
await phone.waitForTimeout(2500);
const after = new URL(phone.url()).pathname.replace(/\/+$/, '');
note(`pressed the hamburger: ${before} -> ${after || '/'}`);
if (after !== '/settings') {
  failures.push(`pressing the hamburger went to ${after || '/'} rather than /settings. Tre: "the hamburger should open the settings page ... like how instagram does it" - one page, not an intermediate menu.`);
}

// 4 - the two sign-out controls, and they must be DIFFERENT, RENDERED elements.
//
// ⚠️ TWO THINGS THE FIRST VERSION GOT WRONG, both of which made a correct app look broken:
//   · It counted elements with a ZERO BOX. The desktop rail (`Sidebar.tsx`) carries its own
//     "Sign Out" row, and at 390px that row is in the DOM with a 0x0 rect inside an `lg:` wrapper.
//     So "ordinary=2" was one real control and one that no phone user can see. Every count here
//     now requires a rendered box, because a control nobody can press is not a control.
//   · It looked for "Sign Out All Devices" on whatever panel Settings opened on. Settings is a
//     FOUR-PANEL page (Account · Security · Preferences · Plan) and the all-devices control lives
//     in SECURITY only - correctly, it is a security control. The default panel is Account, so the
//     matcher was reading a panel that never contained it.
// Both are instrument faults. Neither was a defect in the app.
if (after === '/settings') {
  const rendered = () => phone.evaluate(() => {
    const box = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const text = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
    const all = [...document.querySelectorAll('button, a')].filter(box);
    const allDevices = all.filter((e) => /sign\s*out\s*all/i.test(text(e)));
    const ordinary = all.filter((e) => /^sign\s*out$/i.test(text(e)));
    return {
      allDevices: allDevices.length,
      ordinary: ordinary.length,
      // The two must not be one element wearing two labels: same element = the ordinary
      // control does not exist, and pressing it would end every session on every device.
      sameElement: ordinary.some((o) => allDevices.includes(o)),
    };
  });

  const onDefaultPanel = await rendered();
  note(`settings (default panel): ordinary Sign Out=${onDefaultPanel.ordinary}, all-devices=${onDefaultPanel.allDevices}`);
  if (onDefaultPanel.ordinary !== 1) {
    failures.push(`Settings shows ${onDefaultPanel.ordinary} rendered ordinary "Sign Out" control(s); expected exactly 1. Before 2026-09-16 this page carried only "Sign Out All Devices" - a security control - so a user who wanted to log out of this phone had to use it. That is the defect the nav change closed, and it must not come back.`);
  }

  // The all-devices control is the POSITIVE CONTROL for this matcher, and it lives in Security.
  const segs = phone.locator('.seg-item');
  const segCount = await segs.count();
  const labels = [];
  for (let i = 0; i < segCount; i += 1) labels.push((await segs.nth(i).innerText()).trim());
  note(`settings panels: ${JSON.stringify(labels)}`);
  const securityIndex = labels.findIndex((l) => /security/i.test(l));
  if (securityIndex < 0) {
    failures.push(`CONTROL FAILED: Settings has no Security panel among ${JSON.stringify(labels)}, so the all-devices control cannot be located and the ordinary-sign-out result above has no control behind it.`);
  } else {
    await segs.nth(securityIndex).click();
    await phone.waitForTimeout(1500);
    const onSecurity = await rendered();
    note(`settings (Security panel): ordinary Sign Out=${onSecurity.ordinary}, all-devices=${onSecurity.allDevices}`);
    if (onSecurity.allDevices < 1) {
      failures.push('CONTROL FAILED: the Security panel renders no "Sign out all devices" control, so this matcher is not reading the page and the ordinary-sign-out result above is unreadable rather than passing.');
    }
    if (onSecurity.sameElement) {
      failures.push('the ordinary "Sign Out" and "Sign out all devices" resolve to the SAME element. Same words, very different blast radius - merging them means the everyday log-out ends every session on every device.');
    }
    if (onSecurity.ordinary !== 1) {
      failures.push(`the ordinary "Sign Out" is rendered ${onSecurity.ordinary} time(s) on the Security panel; expected exactly 1. It sits below the panels and must be on every one of them - Tre asked for the log-out to be on the Settings page, not on one tab of it.`);
    }
  }
}

// 7 - THE BOTTOM BAR IS A FLOATING PILL, AND CONTENT CLEARS IT.
//
// Tre, 2026-09-16: *"i want the bottom selection of tabs like the liquid glass instagram does.
// for iphone"* - iOS 26 Instagram's bar is held OFF all the edges, not pinned to the bottom.
//
// ⚠️ THE CLEARANCE HALF IS THE ONE THAT SHIPS SILENTLY. The bar used to be pinned and absorb the
// safe area as padding; it now floats, so the space it occupies is (gap + height) and the layout
// reserves that separately, in `DashboardLayout`'s `pb-[calc(5.5rem+env(safe-area-inset-bottom))]`.
// Those two numbers live in different files and nothing makes them agree. If the bar grows past
// the reserve, the last row of every page hides behind it - and that throws nothing, renders
// fine, and is invisible to every other gate in this repo. So this MEASURES the gap rather than
// trusting the arithmetic: scroll a real page to its end and require the lowest text to sit above
// the bar's top edge.
//
// ⚠️ THE BAR IS FOUND BY ITS SHAPE, NEVER BY `rounded-full`. The first version of this block
// selected `nav[class*="rounded-full"]` - the CORRECTNESS MARKER - so when it was proven red by
// restoring the old pinned bar, the selector matched nothing and the gate printed
// "CONTROL FAILED: no bottom tab bar with a pill radius was found". That is the worst possible
// output: an exit-2 "the instrument is broken" on exactly the day the defect is real, and a
// tooling fault gets re-run and then ignored where a finding gets fixed. A gate that discovers
// candidates by the property it is testing for can only ever measure the already-correct.
// So: the bar is the rendered, fixed-position <nav> in the bottom half of the phone viewport -
// a description true of the pinned bar and the pill alike - and the pill radius is then an
// ASSERTION about what was found rather than a condition of finding it.
await go(phone, '/dashboard');
// ⚠️ WAIT FOR CONTENT BEFORE MEASURING CLEARANCE, or the control fires on TIMING rather than on
// anything real. Seen once: a run reached the measurement before the dashboard's cards had
// rendered, found no text inside `#scroll-main`, and correctly refused to report a clearance -
// which is the right behaviour and the wrong reason. A control that fires on a slow load teaches
// the reader to skim past it, which is precisely what a control must never do.
try {
  await phone.waitForFunction(() => {
    const m = document.getElementById('scroll-main');
    return !!m && (m.innerText || '').trim().length > 80;
  }, { timeout: 20000 });
} catch {
  failures.push('the dashboard rendered no text inside #scroll-main within 20s, so the bar-clearance measurement below had nothing to measure against.');
}
const bar = await phone.evaluate(() => {
  const nav = [...document.querySelectorAll('nav')].find((el) => {
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).position === 'fixed'
      && r.width > 0 && r.height > 0 && r.bottom > innerHeight / 2;
  });
  if (!nav) return { found: false };
  const n = nav.getBoundingClientRect();
  const main = document.getElementById('scroll-main');
  if (main) main.scrollTop = main.scrollHeight;
  return new Promise((resolve) => setTimeout(() => {
    let lowest = null;
    for (const el of (main ? main.querySelectorAll('*') : [])) {
      const b = el.getBoundingClientRect();
      if (b.width > 8 && b.height > 8 && (el.innerText || '').trim()) {
        if (!lowest || b.bottom > lowest.bottom) lowest = { bottom: b.bottom, txt: (el.innerText || '').trim().slice(0, 40) };
      }
    }
    resolve({
      found: true,
      left: Math.round(n.left), right: Math.round(n.right),
      top: Math.round(n.top), bottom: Math.round(n.bottom), height: Math.round(n.height),
      vw: innerWidth, vh: innerHeight,
      radius: parseFloat(getComputedStyle(nav).borderTopLeftRadius) || 0,
      lowestBottom: lowest ? Math.round(lowest.bottom) : null,
      lowestTxt: lowest ? lowest.txt : null,
      clearance: lowest ? Math.round(n.top - lowest.bottom) : null,
    });
  }, 1500));
});
if (!bar.found) {
  failures.push('CONTROL FAILED: no rendered fixed-position <nav> was found in the bottom half of the 390px viewport - the phone has NO bottom tab bar at all, or this selector cannot see it. Nothing below about the bar was measured.');
} else {
  note(`tab bar: ${bar.left},${bar.top} -> ${bar.right},${bar.bottom} (${bar.height}px tall) in a ${bar.vw}x${bar.vh} viewport, radius ${Math.round(bar.radius)}px`);
  note(`lowest content bottom=${bar.lowestBottom} (${JSON.stringify(bar.lowestTxt)}) . clearance to the bar = ${bar.clearance}px`);
  // FLOATING: held off all three edges. A pinned bar reads left=0, right=vw, bottom=vh.
  if (bar.left <= 0 || bar.right >= bar.vw || bar.bottom >= bar.vh) {
    failures.push(`the tab bar is pinned to the viewport edges (left=${bar.left}, right=${bar.right}/${bar.vw}, bottom=${bar.bottom}/${bar.vh}), not floating. Tre asked for the iOS 26 Instagram shape, which is inset from every edge.`);
  }
  // PILL: `rounded-full` resolves to a very large radius; a rounded rectangle does not.
  if (bar.radius < bar.height / 2) {
    failures.push(`the tab bar's corner radius is ${Math.round(bar.radius)}px against a height of ${bar.height}px. A pill needs at least half its height; this is a rounded rectangle.`);
  }
  // CLEARANCE: the assertion that catches the silent one.
  if (bar.clearance === null) {
    failures.push('CONTROL FAILED: no rendered text was found inside #scroll-main, so the clearance figure above is not a measurement of anything.');
  } else if (bar.clearance < 0) {
    failures.push(`the lowest content on /dashboard (${JSON.stringify(bar.lowestTxt)}) ends ${-bar.clearance}px BELOW the top of the floating tab bar, so it is hidden behind the bar. DashboardLayout's bottom reserve no longer covers (gap + bar height).`);
  }
}

// 1 - THE ABSENCES, now that the selector is proven able to find it.
for (const path of NO_BURGER) {
  if (!(await go(phone, path))) continue;
  const n = await phone.locator(HAMBURGER).count();
  const visible = n ? await phone.locator(HAMBURGER).first().isVisible() : false;
  note(`${path}: hamburger count=${n}${n ? ` visible=${visible}` : ''}`);
  if (n && visible) {
    failures.push(`${path} still shows the hamburger. Tre, 2026-09-16: it "is only viewable and accessible from the account page".`);
  }
}
await phoneCtx.close();

// DESKTOP
console.log('DESKTOP 1440x900');
const { ctx: deskCtx, page: desk } = await openAt(1440, 900);
if (await go(desk, '/account')) {
  const settingsBtn = await desk.evaluate(() => {
    const el = [...document.querySelectorAll('a[href="/settings"], button')]
      .find((e) => /settings/i.test((e.innerText || '').replace(/\s+/g, ' ').trim()));
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return {
      found: true,
      w: Math.round(r.width), h: Math.round(r.height),
      display: st.display, visibility: st.visibility, opacity: st.opacity,
    };
  });
  if (!settingsBtn.found) {
    failures.push('the Account page shows NO Settings control at 1440px. The desktop rail has no Settings row, so that button is the ONLY desktop route to Settings - without it, Settings is unreachable on a desktop.');
  } else {
    note(`account Settings button at 1440: ${settingsBtn.w}x${settingsBtn.h} display=${settingsBtn.display} visibility=${settingsBtn.visibility} opacity=${settingsBtn.opacity}`);
    if (settingsBtn.w === 0 || settingsBtn.h === 0 || settingsBtn.display === 'none' || settingsBtn.visibility === 'hidden') {
      failures.push(`the Account page's Settings button is present but not rendered at 1440px (${settingsBtn.w}x${settingsBtn.h}, display=${settingsBtn.display}). It is "hidden lg:inline-flex" - if the lg variant is not applying, Settings has no desktop door at all.`);
    }
  }
  // The hamburger must NOT be a desktop control - it is lg:hidden.
  const dn = await desk.locator(HAMBURGER).count();
  const dvis = dn ? await desk.locator(HAMBURGER).first().isVisible() : false;
  note(`/account at 1440: hamburger count=${dn}${dn ? ` visible=${dvis}` : ''}`);
  if (dn && dvis) failures.push('the hamburger is visible at 1440px. It is `lg:hidden` phone chrome; showing it on desktop restores the extra door.');
}
await deskCtx.close();
await browser.close();

if (failures.length) {
  console.error('');
  for (const f of failures) console.error(`  ${f}`);
  fail(1, `${failures.length} problem(s) in the nav doors.`);
}
console.log('PASS - one door to Settings on a phone (Account -> hamburger -> Settings, tappable), the badge goes to /account, Settings has an ordinary Sign Out distinct from the all-devices control, and the desktop Settings button renders.');
