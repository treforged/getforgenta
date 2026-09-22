#!/usr/bin/env node
/**
 * check:toast-contrast - error text, the surface the page-walk contrast gates cannot see.
 *
 * Every rendered contrast gate here (check:dark-contrast, check:light-contrast,
 * check:destructive-contrast) measures only what renders WITHOUT INTERACTION. This app shows its
 * errors as sonner toasts (`toast.error`, app-wide through src/components/ui/sonner.tsx), so
 * error text has never been measured at all (ask 149fb21f).
 *
 * It raises a REAL error the way a user does: /auth -> "Sign In" -> a sign-in the server refuses
 * -> toast.error (one auth request, reserved test domain, nothing created). In each theme it composites the toast's
 * background over the page and asserts the title text is at least 4.5:1 (WCAG AA, normal text).
 *
 * It ALSO asserts the toast IS the app's card surface in that theme, not sonner's built-in black.
 * CONTROLS: an error toast (data-type=error) must exist (an absent toast is not a pass);
 * the <html> class must be the theme asked for (a reading in the wrong theme is not evidence).
 * Signed out, 390x844, dev server on :8080. Exit 0 pass, 1 fail, 2 instrument.
 * Does NOT cover: success/info toasts, inline field errors (none exist today), desktop widths.
 */
import { chromium } from 'playwright';

const BASE = process.env.TOAST_BASE ?? 'http://localhost:8080';
const FLOOR = 4.5;

const browser = await chromium.launch();
let failed = 0;
const done = async (code, msg) => { console.log(`${code === 2 ? 'INSTRUMENT' : 'FAIL'}: ${msg}`); await browser.close(); process.exit(code); };

for (const theme of ['dark', 'light']) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const ok = await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }).catch(() => null);
  if (!ok) await done(2, `dev server not reachable at ${BASE}`);
  await page.evaluate((th) => {
    localStorage.setItem('forgenta.theme.v1', th);
    localStorage.setItem('tre_cookie_consent', JSON.stringify({
      version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
    }));
  }, theme);
  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
  // A REAL error path: a sign-in that fails. Measured first, the client-side paths cannot reach a
  // toast - the reset email is `required` (the browser blocks the submit) and "Create Account" stays
  // disabled until the form is valid - so in practice error toasts come from SERVER refusals, and
  // this is the commonest one. One auth request, for an address on the reserved test domain that
  // does not exist; nothing is created.
  const signIn = page.getByRole('button', { name: 'Sign In', exact: true });
  try { await signIn.waitFor({ timeout: 20000 }); await signIn.click(); }
  catch { await done(2, `${theme}: /auth never showed "Sign In"`); }
  try {
    await page.locator('form input[type="email"]').fill('toast-contrast-probe@forgenta.test', { timeout: 10000 });
    await page.locator('form input[type="password"]').first().fill('Not-a-real-password-1', { timeout: 10000 });
    await page.locator('form button[type="submit"]').first().click({ timeout: 10000 });
  } catch (err) { await done(2, `${theme}: could not submit the sign-in form (${String(err.message).split('\n')[0]})`); }

  const toast = page.locator('[data-sonner-toast][data-type="error"]').first();
  try { await toast.waitFor({ timeout: 8000 }); } catch { await done(2, `${theme}: no error toast appeared - the error path was not reached`); }
  await page.waitForTimeout(600); // sonner animates in; read the settled colours

  const r = await page.evaluate(() => {
    const parse = (s) => { const m = s.match(/[\d.]+/g) || []; return { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] }; };
    const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const toast = document.querySelector('[data-sonner-toast][data-type="error"]');
    const title = toast.querySelector('[data-title]') || toast;
    // Composite every background from <html> down to the toast, so a translucent layer is
    // measured against what is really behind it rather than against white by accident.
    const chain = [];
    for (let el = toast; el; el = el.parentElement) chain.unshift(el);
    let bg = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (bg.a === 0) bg = parse(getComputedStyle(document.body).backgroundColor);
    if (bg.a === 0) bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const el of chain) { const c = parse(getComputedStyle(el).backgroundColor); if (c.a > 0) bg = over(c, bg); }
    const fg = over(parse(getComputedStyle(title).color), bg);
    const L1 = lum(fg), L2 = lum(bg);
    // What the app's own card colour resolves to in this theme, read off a probe element, so the
    // toast can be required to BE the app's surface rather than sonner's built-in black.
    const probe = document.createElement('div');
    probe.style.background = 'hsl(var(--card))';
    document.body.appendChild(probe);
    const cardColor = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      toastBg: getComputedStyle(toast).backgroundColor,
      cardColor,
      htmlClass: document.documentElement.className,
      text: title.textContent.trim(),
      ratio: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05),
      fg: getComputedStyle(title).color, bg: `rgb(${bg.r.toFixed(0)},${bg.g.toFixed(0)},${bg.b.toFixed(0)})`,
    };
  });

  if (!r.htmlClass.split(/\s+/).includes(theme)) await done(2, `asked for ${theme}, <html class="${r.htmlClass}">`);
  const pass = r.ratio >= FLOOR;
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${theme}: "${r.text}" ${r.fg} on ${r.bg} = ${r.ratio.toFixed(2)}:1 (floor ${FLOOR})`);
  // THEMED, not just legible: until 2026-09-22 every toast was sonner's own black in BOTH themes
  // (20:1, so the ratio alone passed it) while the app's classes were silently outranked.
  const themed = r.toastBg === r.cardColor;
  if (!themed) failed++;
  console.log(`${themed ? 'PASS' : 'FAIL'} ${theme}: toast background ${r.toastBg} ${themed ? '==' : '!='} the app's card ${r.cardColor}`);
  const shotArg = process.argv.indexOf('--shots');
  if (shotArg > 0) await page.screenshot({ path: `${process.argv[shotArg + 1]}/toast-${theme}.png` });
  await page.context().close();
}
await browser.close();
console.log(failed ? `${failed} FAILED` : 'toast contrast: all checks passed');
process.exit(failed ? 1 : 0);
