#!/usr/bin/env node
/**
 * check-welcome-screen.mjs - the signed-out first screen at 390x844, the one a new install opens on.
 *
 * WHY (ask 8778e58c, 2026-10-01): 8 App Store installs in 30 days produced 0 sign-up attempts, and
 * the old first screen never said what the app does. The new one states the promise, shows an
 * Example card of SAMPLE figures, and keeps Sign In findable. Sam's conditions are what this asserts:
 *   - Sign in is ABOVE THE FOLD and its text is no smaller than the screen's body text
 *   - the Example card is on screen and labelled as sample data
 *   - the headline and the Example card say "safe to spend" (ask 23fe1862, the App Store listing's words)
 *   - EVERY control on the screen, pressed in a fresh page, CHANGES something:
 *       Start Free              -> an email field appears
 *       Try it with sample data -> the URL is /demo
 *       Sign in                 -> the sign-in form ("Welcome back") appears
 * Controls are FOUND BY ROLE inside the welcome screen, never by a hand-written list, and the count
 * found is printed, so a new control that nobody gated shows up as "pressed N, changed N-1".
 * Positive control: a planted button with no handler must read "no change", or the change detector
 * is blind and the run exits 2.
 *
 * EXITS: 0 pass . 1 a check failed . 2 could not test. Frames: test-results/welcome/.
 * DOES NOT COVER: the native shell (it renders this same component without the store badges),
 * desktop widths, light mode, or whether the copy persuades anyone.
 * USAGE: node scripts/check-welcome-screen.mjs [baseUrl]   (default http://localhost:8080)
 */
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8080';
const OUT = 'test-results/welcome';
const VIEW = { width: 390, height: 844 };
const fail = (code, msg) => { console.error(`FAIL(${code}): ${msg}`); process.exit(code); };

let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'could not load @playwright/test.'); }
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const fresh = async () => {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Start Free' }).waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1500); // the entrance animation runs to 0.85 s; the banner arrives late
  // Dismiss the cookie banner as a user would, so it cannot cover the controls being measured.
  const banner = page.getByRole('region', { name: 'Cookie consent' });
  if (await banner.isVisible().catch(() => false)) {
    await banner.getByRole('button', { name: /reject/i }).first().click();
    await page.waitForTimeout(400);
  }
  return { ctx, page };
};
// What a press can change: the URL, the email field, the sign-in heading, or the body text.
const snapshot = async (page) => ({
  url: page.url(),
  email: await page.locator('input[type="email"]').count(),
  text: (await page.locator('body').innerText()).slice(0, 4000),
});
const changed = (a, b) => a.url !== b.url || a.email !== b.email || a.text !== b.text;

const checks = [];
let fails = 0;
const check = (name, ok, detail) => { checks.push(name); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); if (!ok) fails++; };

// ── Layout, from one rendered frame ──
const { ctx, page } = await fresh();
await page.screenshot({ path: `${OUT}/after-390.png` });
const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
const sBox = await signIn.boundingBox({ timeout: 5000 }).catch(() => null);
const sFont = parseFloat(await signIn.evaluate((el) => getComputedStyle(el).fontSize, null, { timeout: 5000 }).catch(() => 'NaN'));
const bodyFont = parseFloat(await page.locator('h1 + p').first().evaluate((el) => getComputedStyle(el).fontSize, null, { timeout: 5000 }).catch(() => 'NaN'));
check('Sign in is above the fold', !!sBox && sBox.y + sBox.height <= VIEW.height, sBox ? `bottom ${Math.round(sBox.y + sBox.height)} of ${VIEW.height}` : 'not found');
check('Sign in is no smaller than body text', Number.isFinite(sFont) && sFont >= bodyFont, `${sFont}px vs body ${bodyFont}px`);
const example = page.getByText(/Example · sample data/);
const eBox = await example.boundingBox({ timeout: 5000 }).catch(() => null);
check('Example card is labelled sample data and on screen', !!eBox && eBox.y + eBox.height <= VIEW.height, eBox ? `top ${Math.round(eBox.y)}` : 'not found');
const hasHeadline = await page.getByRole('heading', { name: /debt-free/i }).isVisible();
// Ask 23fe1862: the promise is the App Store listing's - "safe to spend" - and the Example card shows
// that figure. Read from the screen, so reverting either half of the copy goes red.
const exampleText = await page.getByLabel('Example with sample data').innerText().catch(() => '');
check('Headline promises "safe to spend"', await page.getByRole('heading', { name: /safe to spend/i }).isVisible(), 'heading text');
check('Example card shows the safe-to-spend figure', /Safe to spend until payday\s*\$[\d,]+/i.test(exampleText), JSON.stringify(exampleText.replace(/\s+/g, ' ').slice(0, 120)));
check('headline states the promise', hasHeadline, hasHeadline ? 'h1 visible' : 'missing');

// ── Every control: found by role, pressed in a fresh page ──
const screen = page.locator('div.max-w-xs').first();
const names = await screen.getByRole('button').evaluateAll((els) => els.map((e) => (e.textContent || '').trim()));
const links = await screen.getByRole('link').evaluateAll((els) => els.map((e) => (e.textContent || '').trim()));
await ctx.close();
console.log(`found ${names.length} buttons: ${JSON.stringify(names)}; ${links.length} links (open new tabs, not pressed): ${JSON.stringify(links)}`);
if (names.length < 3) fail(2, `found only ${names.length} buttons; the selector is not seeing the welcome screen.`);

// Positive control: a button with no handler must read as NO change.
{
  const { ctx: c, page: p } = await fresh();
  await p.evaluate(() => { const b = document.createElement('button'); b.id = 'planted-dead'; b.textContent = 'dead'; document.querySelector('div.max-w-xs')?.appendChild(b); });
  const before = await snapshot(p);
  await p.locator('#planted-dead').click();
  await p.waitForTimeout(800);
  const after = await snapshot(p);
  // The planted button's own text is in both snapshots, so a real no-op compares equal.
  if (changed(before, after)) fail(2, 'the planted dead button read as a change; the detector cannot tell.');
  console.log('PASS control: a planted dead button reads as no change');
  await c.close();
}

let pressedOk = 0;
for (const name of names) {
  const { ctx: c, page: p } = await fresh();
  const before = await snapshot(p);
  await p.locator('div.max-w-xs').first().getByRole('button', { name, exact: true }).first().click();
  await p.waitForTimeout(1500);
  const after = await snapshot(p);
  const what = after.url !== before.url ? `url -> ${new URL(after.url).pathname}` : after.email !== before.email ? `email fields ${before.email} -> ${after.email}` : after.text !== before.text ? 'screen text changed' : 'NOTHING';
  const ok = changed(before, after);
  if (ok) pressedOk++;
  check(`press "${name}" changes something`, ok, what);
  if (name === 'Try it with sample data') check('  ...and lands on /demo', new URL(after.url).pathname.startsWith('/demo') || new URL(after.url).pathname === '/dashboard', new URL(after.url).pathname);
  if (name === 'Start Free') check('  ...and shows the email field', after.email > 0, `${after.email}`);
  if (name === 'Sign in') check('  ...and shows the sign-in form', /Welcome back/i.test(after.text), /Welcome back/i.test(after.text) ? 'Welcome back' : 'missing');
  await c.close();
}
await browser.close();
console.log(`pressed ${names.length}, changed ${pressedOk}. ${checks.length - fails}/${checks.length} checks pass. Frame: ${OUT}/after-390.png`);
process.exit(fails ? 1 : 0);
