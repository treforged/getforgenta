#!/usr/bin/env node
/**
 * check-landing-first-screen.mjs - the first screen a NEW ARRIVAL sees, measured in a real
 * browser at phone width, in BOTH themes.
 *
 * WHY THIS EXISTS
 * The Instagram bio link went live, so getforgenta.com now takes real arrivals through
 * Instagram's in-app browser on iPhone. Tre, 2026-09-17: "the page loads very strangely and
 * looks very off with spacing and like the top right with sign in like the text is wrapped
 * weirdly and the containers look weird."
 *
 * Three defects, all above the fold:
 *   1. the header packs FORGENTA, a full-width language <select>, Sign In and Start Free onto
 *      one 390px row, so Sign In wraps to two lines and Start Free wraps inside its own pill;
 *   2. that pill is clipped by the right edge of the viewport;
 *   3. the cookie banner covers BOTH primary CTAs at the fold.
 *
 * ⚠️ WHY NO EXISTING GATE SAW ANY OF IT. Every gate on this screen is a jsdom TEXT assertion,
 * and jsdom reports every box as 0x0. The commit that closed the previous spacing regression
 * (9db3dd77) WROTE DOWN that a Playwright rendered frame was needed. That limit was written,
 * believed, and never scheduled - which is how the identical complaint came back. A limit in a
 * comment is a to-do nobody picks up.
 *
 * ⚠️ AND DO NOT REACH FOR THE CHROME TOOL'S resize_window HERE. Measured on this machine
 * 2026-09-16: it reports "Successfully resized ... to 390x844" while window.innerWidth stays
 * 1154. The call succeeds and nothing moves, so a desktop layout gets measured while the
 * operator believes they have a phone. Playwright is the instrument that works.
 *
 * WHAT IT ASSERTS, all from RENDERED geometry, never from a class list
 *   H1  every element in the header sits fully inside the viewport horizontally.
 *   H2  every element in the header sits fully inside the header's OWN box vertically -
 *       the header is a fixed h-14, so a child that grows taller spills over the hero.
 *   H3  the Sign In and Start Free controls each occupy exactly ONE line, computed from each
 *       element's OWN line-height and padding, never a pixel constant.
 *   C1  each primary hero CTA is the thing a finger actually lands on: elementFromPoint at its
 *       centre must resolve to the CTA or a descendant. A CTA hidden under the cookie banner
 *       passes every visibility assertion ever written and cannot be pressed.
 *   C2  each primary hero CTA is inside the viewport at first paint - above the fold.
 *   T1  NO toast is raised on a first arrival. A signed-out visitor was being told
 *       "Your session has ended. Please sign in again." - see the note beside the assertion.
 *   L1  EXACTLY ONE visible language control on the page, and it is not clipped. The fix moves
 *       that control out of the phone header into the footer; zero would mean the signed-out
 *       language promise was quietly traded away, two would mean it is duplicated.
 *
 * THE POSITIVE CONTROLS, and C3 is the one that makes C1 mean anything
 *   P1  the header is found, and it contains the brand, a Sign In link and a Start Free link.
 *   P2  two primary hero CTAs are found.
 *   P3  THE CONSENT BANNER IS ON SCREEN. Without it C1 is vacuous: with the banner already
 *       dismissed nothing could ever cover the CTAs and the check would pass over the defect.
 *   P4  the resolved theme is the one asked for, read back off <html>. A theme that did not
 *       apply makes the second arm a duplicate of the first wearing a different label.
 *   Every control failure exits 2, never 1 - an exit-1 finding gets fixed, an exit-2 tooling
 *   fault gets re-run and then ignored, so they must not be confusable.
 *
 * WHAT IT DOES NOT COVER
 *   Colour, contrast, copy, anything below the fold, desktop widths, other routes, the real
 *   Instagram in-app WebView (this is Chromium at its viewport), and whether the layout is
 *   PRETTY - only that nothing wraps, spills or sits under something else.
 *
 * USAGE:  node scripts/check-landing-first-screen.mjs
 * EXITS:  0 pass . 1 a defect on the first screen . 2 could not test
 */
const BASE = 'http://localhost:8080';
/**
 * TWO VIEWPORTS, and the SHORT one is the one the complaint came from.
 * Tre was in Instagram's in-app browser, which spends about 180px of an iPhone's screen on
 * its own top and bottom chrome. A check run only at a full-height 844 viewport puts the
 * hero CTAs comfortably above a bottom-fixed banner and passes over the exact defect he
 * photographed. 664 is the height that is left.
 */
const VIEWPORTS = [
  { width: 390, height: 844, label: 'safari' },
  { width: 390, height: 664, label: 'in-app' },
  // Desktop is here for ONE reason: the fix moves the language control between the header and
  // the footer on a breakpoint, and both arms above are 390px wide, so the header instance is
  // hidden in both. Without a width past `sm` the "exactly one" assertion can only ever see
  // the footer copy, and a DUPLICATE on desktop would pass forever.
  { width: 1440, height: 900, label: 'desktop' },
];
const THEMES = ['dark', 'light'];

const fail = (code, msg) => { console.error(`FAIL(${code}): ${msg}`); process.exit(code); };

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

const browser = await chromium.launch();
const findings = [];
let examined = 0;

for (const VIEWPORT of VIEWPORTS) {
for (const theme of THEMES) {
  const arm = `${theme}/${VIEWPORT.label}`;
  const ctx = await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    colorScheme: theme,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  // Set the STORED choice before the app boots. Flipping a class afterwards is not a theme
  // switch here - `applyTheme` owns <html>'s class and would overwrite it on the next render.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => {
    localStorage.setItem('forgenta.theme.v1', t);
    localStorage.removeItem('tre_cookie_consent'); // the banner MUST be up - see P3.
  }, theme);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  const shot = async (name) => {
    await page.screenshot({ path: `landing-first-screen-${theme}-${VIEWPORT.label}${name}.png` });
  };

  const read = await page.evaluate(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
    const header = document.querySelector('header');
    if (!header) return { ok: false, why: 'no <header> on the page' };

    // Header children, found BY SHAPE: anything in the header that draws a box and carries
    // text or is a control. Never by a class the correct version happens to have.
    const headerParts = [...header.querySelectorAll('a, button, select, span')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        // Skip wrappers that merely contain another part - measure the leaf that draws.
        return !el.querySelector('a, button, select');
      })
      .map((el) => {
        const st = getComputedStyle(el);
        const lh = parseFloat(st.lineHeight) || parseFloat(st.fontSize) * 1.2;
        const padY = parseFloat(st.paddingTop) + parseFloat(st.paddingBottom);
        const bordY = parseFloat(st.borderTopWidth) + parseFloat(st.borderBottomWidth);
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24),
          rect: box(el),
          lineHeight: lh,
          lines: lh > 0 ? Math.round((r.height - padY - bordY) / lh) : 0,
          isControl: el.tagName !== 'SPAN',
        };
      });

    /**
     * The PRIMARY hero CTAs, found BY SHAPE: the first pair of links in the hero that share a
     * row (their tops agree within 8px). That is what a primary CTA row IS. A label list
     * ("Start Free", "See Demo") would go blind the moment the copy or the language changes -
     * and the page is rendered here with a language switcher on it.
     *
     * Scoping to that ROW also matters for the assertion below: the hero holds further links
     * lower down, and a bottom-fixed banner covering something further down the page is
     * ordinary behaviour, not a defect. The defect is the banner covering the PRIMARY pair.
     */
    const hero = document.querySelector('main section');
    const heroLinks = hero ? [...hero.querySelectorAll('a')] : [];
    let row = [];
    for (const el of heroLinks) {
      const t = el.getBoundingClientRect().top;
      const mates = heroLinks.filter((o) => Math.abs(o.getBoundingClientRect().top - t) <= 8);
      if (mates.length >= 2) { row = mates; break; }
    }
    const ctas = row.length
      ? row.map((el) => {
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.left + r.width / 2);
        const cy = Math.round(r.top + r.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        return {
          text: (el.textContent || '').trim().slice(0, 24),
          rect: box(el),
          hitIsSelf: !!hit && (hit === el || el.contains(hit)),
          hitDesc: hit ? `${hit.tagName.toLowerCase()}${hit.className && typeof hit.className === 'string' ? '.' + hit.className.split(/\s+/).slice(0, 2).join('.') : ''}` : 'nothing',
          hitInBanner: !!hit && !!hit.closest('[aria-label="Cookie consent"]'),
        };
      })
      : [];

    const banner = document.querySelector('[aria-label="Cookie consent"]');

    /**
     * T1 - A NEW ARRIVAL IS TOLD NOTHING UNTRUE ABOUT THEMSELVES.
     * Found while reading the rendered frame for the spacing fix, which is the argument for
     * looking at a frame rather than at numbers: a clean first load of `/` raised the toast
     * "Your session has ended. Please sign in again." at a visitor who had never had a session.
     * `useDerivedCountry` guarded on `!profile`, and `useProfile` returns DEFAULT_PROFILE when
     * signed out, so it fired a profile write for every anonymous arrival.
     * Nothing anywhere went red: the write is fire-and-forget and react-query swallows the throw.
     * So the assertion is the OBSERVABLE one - the landing page shows NO toast at all.
     */
    const toasts = [...document.querySelectorAll('[data-sonner-toast], [role="status"], [role="alert"]')]
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean);

    /**
     * L1 - THE LANGUAGE CONTROL SURVIVED BEING MOVED.
     * The fix takes it out of the phone header and puts it in the footer. The way that fix
     * goes wrong is that it ends up in NEITHER, or in BOTH - and a Spanish speaker who cannot
     * read the sign-in page is exactly the person who then has no way to change the language.
     * So: EXACTLY ONE visible language control on the page, at every width. Counting visible
     * boxes catches both halves in one number.
     */
    const langs = [...document.querySelectorAll('select[aria-label="Language"]')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });

    return {
      ok: true,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      headerRect: box(header),
      headerParts,
      ctas,
      bannerRect: banner ? box(banner) : null,
      toasts,
      visibleLanguageControls: langs.length,
      languageControlRects: langs.map(box),
      htmlClass: document.documentElement.className,
    };
  });

  if (!read.ok) { await shot('-control'); await browser.close(); fail(2, `${arm}: ${read.why}`); }
  if (read.innerWidth !== VIEWPORT.width) {
    await browser.close();
    fail(2, `${arm}: viewport did not take - innerWidth is ${read.innerWidth}, expected ${VIEWPORT.width}.`);
  }

  // ---- P4: the theme actually applied. Dark is the ABSENCE of a class in this app.
  const isLight = read.htmlClass.split(/\s+/).includes('light');
  if ((theme === 'light') !== isLight) {
    await browser.close();
    fail(2, `${arm}: theme did not apply - <html class="${read.htmlClass}">. The two arms would be duplicates.`);
  }

  // ---- P1: the header and its three parts exist.
  const txt = (s) => read.headerParts.find((p) => p.text.toLowerCase().includes(s));
  const brand = txt('forgenta');
  const signIn = txt('sign in') || txt('sign');
  const startFree = read.headerParts.find((p) => p.tag === 'a' && p !== signIn && p.text.length > 0 && p !== brand);
  if (!brand || !signIn || !startFree) {
    await shot('-control');
    await browser.close();
    fail(2, `${arm}: header controls not found (brand=${!!brand} signIn=${!!signIn} startFree=${!!startFree}); found ${read.headerParts.map((p) => `${p.tag}:"${p.text}"`).join(', ')}`);
  }

  // ---- P2 / P3
  if (read.ctas.length < 2) {
    await shot('-control');
    await browser.close();
    fail(2, `${arm}: expected 2 primary hero CTAs, found ${read.ctas.length}.`);
  }
  if (!read.bannerRect) {
    await shot('-control');
    await browser.close();
    fail(2, `${arm}: the consent banner is NOT on screen, so the "covers the CTAs" arm is vacuous and would pass over the defect.`);
  }

  // ---- T1: no toast on a first arrival.
  examined += 1;
  for (const msg of read.toasts) {
    findings.push(`${arm}: a first arrival is shown a toast on the landing page: "${msg.slice(0, 90)}". A visitor who has never signed in must not be told anything about their session.`);
  }

  // ---- L1: exactly one visible language control, wherever it lives at this width.
  examined += 1;
  if (read.visibleLanguageControls !== 1) {
    findings.push(`${arm}: expected exactly 1 visible language control on the page, found ${read.visibleLanguageControls}. Zero means the signed-out language promise was traded away by the move; two means it is duplicated.`);
  }
  for (const r of read.languageControlRects) {
    if (r.right > read.innerWidth + 0.5 || r.left < -0.5) {
      findings.push(`${arm}: the language control is clipped by the viewport - left ${r.left.toFixed(1)}, right ${r.right.toFixed(1)}, viewport 0..${read.innerWidth}.`);
    }
  }

  // ---- H1: nothing in the header leaves the viewport horizontally.
  for (const p of read.headerParts) {
    examined += 1;
    if (p.rect.right > read.innerWidth + 0.5 || p.rect.left < -0.5) {
      findings.push(`${arm}: header ${p.tag} "${p.text}" is clipped by the viewport - left ${p.rect.left.toFixed(1)}, right ${p.rect.right.toFixed(1)}, viewport 0..${read.innerWidth}.`);
    }
  }

  // ---- H2: nothing in the header spills out of the header's own box.
  for (const p of read.headerParts) {
    if (p.rect.top < read.headerRect.top - 0.5 || p.rect.bottom > read.headerRect.bottom + 0.5) {
      findings.push(`${arm}: header ${p.tag} "${p.text}" spills out of the header box - ${p.rect.top.toFixed(1)}..${p.rect.bottom.toFixed(1)} against header ${read.headerRect.top.toFixed(1)}..${read.headerRect.bottom.toFixed(1)}.`);
    }
  }

  // ---- H3: every header CONTROL is on one line.
  for (const p of read.headerParts) {
    if (!p.isControl) continue;
    if (p.lines > 1) {
      findings.push(`${arm}: header ${p.tag} "${p.text}" wraps onto ${p.lines} lines (height ${p.rect.h.toFixed(1)}, line-height ${p.lineHeight.toFixed(1)}).`);
    }
  }

  // ---- C1 / C2: the hero CTAs are pressable and above the fold.
  for (const c of read.ctas) {
    examined += 1;
    if (!c.hitIsSelf) {
      const by = c.hitInBanner ? 'THE COOKIE BANNER' : c.hitDesc;
      findings.push(`${arm}: hero CTA "${c.text}" cannot be pressed - the point at its centre belongs to ${by}.`);
    }
    if (c.rect.bottom > read.innerHeight + 0.5 || c.rect.top < 0) {
      findings.push(`${arm}: hero CTA "${c.text}" is not on the first screen - ${c.rect.top.toFixed(1)}..${c.rect.bottom.toFixed(1)} against viewport 0..${read.innerHeight}.`);
    }
  }

  await shot('');
  await ctx.close();
}
}

await browser.close();

if (examined === 0) fail(2, 'examined 0 elements - "0 findings" and "nothing was looked at" must not read the same.');

console.log(`examined ${examined} rendered boxes across ${THEMES.length} themes x ${VIEWPORTS.length} viewports (${VIEWPORTS.map(v=>v.width+'x'+v.height+' '+v.label).join(', ')})`);
if (findings.length) {
  console.error(`\n${findings.length} finding(s) on the first screen:`);
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('PASS: header fits on one row inside the viewport, and both primary CTAs are pressable above the fold.');
