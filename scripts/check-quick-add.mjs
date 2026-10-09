#!/usr/bin/env node
/**
 * check-quick-add.mjs - QUICK ADD's tap count (ask 661548f5, Tre: "quick add like Fincend").
 *
 * Fincend saves a $36 groceries expense in 5 taps: `+`, Groceries, 3, 6, "Add $36". Before this,
 * Forgenta took 7 taps + 2 keystrokes and had no add door on Home
 * (docs/quick-add-comparison-2026-10-07.md). This walks the same entry FROM HOME on /demo (no
 * credentials) and COUNTS every press, then requires:
 *   - the door is on Home: the bottom bar's centre `+` at phone widths, Home's "Add" at WIDTH>=1024
 *     (the bar is lg:hidden there);
 *   - PRESSING it opens the "Quick add" dialog (a change, found by its own heading);
 *   - Groceries is a one-tap chip, 3 and 6 are keypad keys, the hero reads "-$36" and the save
 *     button says "Add $36" - all ON SCREEN without scrolling (the OS keyboard never opens);
 *   - pressing save reaches the write: /demo is read only, so the hook's own refusal toast
 *     ("The demo is read only") is the proof the press got to the mutation and not just to a button;
 *   - <= 5 presses in all, the Fincend number;
 *   - at phone widths every bottom-bar label is still WHOLE beside the extra cell.
 * Red on the pre-change app (no `+`, Home's Add was a link to /transactions): exit 1.
 *
 * It does NOT prove a signed-in save lands (the demo cannot write; quick-add.test.ts owns the row's
 * shape, and it is the same `add` hook the full form uses), and it does not cover a free account,
 * where the same door goes to /premium by the existing gate.
 *
 * ENV: WIDTH (390), HEIGHT (844), BASE_URL (http://localhost:8080), PW_CHROMIUM (an executable path
 * when the bundled browser is not installed). Frames: test-results/quick-add/.
 * EXITS: 0 pass . 1 a finding . 2 could not test.
 */
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const WIDTH = Number(process.env.WIDTH || 390);
const HEIGHT = Number(process.env.HEIGHT || 844);
const DESKTOP = WIDTH >= 1024;
const MAX_TAPS = 5;
const OUT = 'test-results/quick-add';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };

let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'Could not load @playwright/test.'); }
try { await fetch(BASE, { redirect: 'manual' }); } catch (err) { fail(2, `${BASE} is not serving (${err.message}).`); }
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const done = async (code, msg) => { await browser.close(); (code ? console.error : console.log)(msg); process.exit(code); };
mkdirSync(OUT, { recursive: true });

const page = await (await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 })).newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false })));
await page.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });

// CONTROL: Home has rendered. Without it, a missing door is indistinguishable from an unmounted page.
const home = page.getByRole('heading', { name: 'Command Center' });
let ready = false;
for (let i = 0; i < 30 && !ready; i += 1) {
  await page.waitForTimeout(1000);
  for (let j = 0; j < 4 && (await page.locator('div.modal-overlay [role=dialog]').count()); j += 1) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }
  ready = (await home.count()) > 0 && (await page.locator('.skeleton-shimmer').count()) === 0;
}
if (!ready) await done(2, `CONTROL FAILED: /demo never showed a settled Home at ${WIDTH}px.`);
if (!page.url().includes('/dashboard')) await done(2, `CONTROL FAILED: /demo landed on ${page.url()}, not Home.`);

let taps = 0;
const press = async (locator, what) => {
  if (!(await locator.count())) await done(1, `FINDING: no ${what} to press (after ${taps} presses).`);
  await locator.first().click();
  taps += 1;
  console.log(`press ${taps}: ${what}`);
};
// Inside the viewport AND inside the sheet's own scroll box: a button the sheet clips is not on screen.
const onScreen = async (locator) => locator.first().evaluate((el, h) => {
  const r = el.getBoundingClientRect();
  const box = el.closest('[role=dialog]').getBoundingClientRect();
  return r.width > 0 && r.top >= Math.max(0, box.top) && r.bottom <= Math.min(h, box.bottom) + 0.5;
}, HEIGHT);

// Phone: every bar label must be whole beside the `+` cell (the bar sizes cells to their words).
if (!DESKTOP) {
  const cut = await page.evaluate(() => [...document.querySelectorAll('nav a span[data-text-scale-exempt]')]
    .filter(s => s.scrollWidth > s.clientWidth + 0.5).map(s => s.textContent));
  const labels = await page.locator('nav a span[data-text-scale-exempt]').count();
  if (labels < 5) await done(2, `CONTROL FAILED: found ${labels} bottom-bar labels, expected 5.`);
  if (cut.length) await done(1, `FINDING: bottom-bar label(s) cut beside the + at ${WIDTH}px: ${cut.join(', ')}.`);
}

const door = DESKTOP ? page.getByTestId('home-quick-add') : page.getByTestId('nav-quick-add');
await press(door, DESKTOP ? "Home's Add button" : "the bottom bar's +");
const sheet = page.getByRole('dialog', { name: 'Quick add' });
try { await sheet.waitFor({ timeout: 5000 }); } catch { await done(1, `FINDING: pressing the door opened no "Quick add" dialog (url ${page.url()}).`); }

const groceries = sheet.getByRole('group', { name: 'Category' }).getByRole('button', { name: /Groceries/ });
if (!(await groceries.count())) await done(1, 'FINDING: Groceries is not a one-tap chip.');
if ((await groceries.first().getAttribute('aria-pressed')) === 'true') console.log('Groceries already selected (last used): no press needed.');
else await press(groceries, 'the Groceries chip');
if ((await groceries.first().getAttribute('aria-pressed')) !== 'true') await done(1, 'FINDING: the Groceries chip did not select.');

const keypad = sheet.getByRole('group', { name: 'Amount keypad' });
await press(keypad.getByRole('button', { name: '3', exact: true }), 'keypad 3');
await press(keypad.getByRole('button', { name: '6', exact: true }), 'keypad 6');
const hero = (await sheet.getByTestId('quick-add-amount').innerText()).trim();
if (hero !== '-$36') await done(1, `FINDING: the amount reads "${hero}", expected "-$36".`);

const save = sheet.getByRole('button', { name: 'Add $36' });
if (!(await save.count())) await done(1, 'FINDING: no save button saying "Add $36".');
for (const [what, loc] of [['the amount', sheet.getByTestId('quick-add-amount')], ['the Groceries chip', groceries], ['keypad 3', keypad.getByRole('button', { name: '3', exact: true })], ['the save button', save]]) {
  if (!(await onScreen(loc))) await done(1, `FINDING: ${what} is not on screen at ${WIDTH}x${HEIGHT} without scrolling.`);
}
await sheet.screenshot({ path: `${OUT}/sheet-${WIDTH}.png` });
await press(save, 'Add $36');

const refusal = page.getByText(/The demo is read only/);
try { await refusal.first().waitFor({ timeout: 5000 }); } catch { await done(1, 'FINDING: pressing "Add $36" did not reach the write (no read-only refusal on /demo).'); }
if (!(await sheet.count())) await done(1, 'FINDING: the sheet closed on a refused write; what was typed is lost.');

if (taps > MAX_TAPS) await done(1, `FINDING: ${taps} presses from Home to save, more than Fincend's ${MAX_TAPS}.`);
await done(0, `PASS: ${taps} presses from Home to "Add $36" at ${WIDTH}x${HEIGHT} (Fincend: ${MAX_TAPS}; before: 7 + 2 keystrokes). Frame: ${OUT}/sheet-${WIDTH}.png`);
