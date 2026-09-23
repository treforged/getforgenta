// Raw App Store captures from /demo, phone and 13" iPad, dark. Unframed; nothing is uploaded.
//
//   node scripts/capture-store-frames.mjs <out-dir> [base-url]      (base-url default http://localhost:8080)
//
// Writes <out-dir>/01-dashboard.png ... 08-garage.png at 430x932 @3x (1290x2796), and
// <out-dir>/ipad-13/{01,02,03,04,05,08}-*.png at 1032x1376 @2x (2064x2752).
//
// Written 2026-09-23 (ask b0822110), because the 09-23 set was shot ad hoc and a persona change made
// three of its frames stale with no way to re-shoot them. EVERY PRESS ASSERTS ITS SCREEN APPEARED
// (a marker text is visible) before the frame is saved, so a press that does nothing fails loudly
// instead of saving a second copy of the previous screen. Exit 1 on any failed frame, 2 on no frames.
//
// The cookie banner is REJECTED before the first frame, so the capture fires no analytics.
// demo-data.ts computes its dates from the day it loads: a capture on another day shows other dates.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const BASE = process.argv[3] ?? 'http://localhost:8080';
if (!OUT) { console.error('usage: node scripts/capture-store-frames.mjs <out-dir> [base-url]'); process.exit(2); }

/** Each frame: where to go, what to press, and the text that proves the screen is showing. */
const FRAMES = [
  { file: '01-dashboard.png', route: '/dashboard', marker: /NET WORTH/i },
  { file: '02-debt.png', route: '/debt', marker: /Credit Card Payoff/i },
  // The Decision Deck opens by itself on /transactions, so 03 needs no press, and 04/05 close it first.
  { file: '03-decisions.png', route: '/transactions', marker: /Is this your/i },
  { file: '04-forecast.png', route: '/transactions', closeDeck: true, press: { role: 'tab', name: /Forecast/i }, marker: /NEXT MILESTONE/i },
  { file: '05-plan.png', route: '/transactions', closeDeck: true, press: { role: 'tab', name: /^Plan/i }, selected: true },
  { file: '06-accounts.png', route: '/dashboard', press: { role: 'button', name: /^Accounts$/i }, marker: /Northvale Checking/i },
  { file: '07-goals.png', route: '/dashboard', press: { role: 'button', name: /^Goals$/i }, marker: /Add Goal/i },
  { file: '08-garage.png', route: '/vehicles', press: { role: 'button', name: /^Vehicles/i }, marker: /Honda Civic/i },
];
const IPAD = new Set(['01-dashboard.png', '02-debt.png', '03-decisions.png', '04-forecast.png', '05-plan.png', '08-garage.png']);

async function shoot(browser, dir, viewport, scale, only) {
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  // Reject the VISIBLE banner button, then prove the banner is gone: a hidden duplicate took the
  // click on the first run and every frame carried the banner. Its accessible name is "Reject
  // non-essential" (aria-label) even where the visible text is only "Reject".
  const banner = page.getByText(/We use cookies/i).filter({ visible: true });
  const reject = page.getByRole('button', { name: /^Reject non-essential$/ }).filter({ visible: true });
  // The banner mounts late, so wait for it rather than skipping Reject when it is not there yet.
  await banner.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (await reject.count()) await reject.first().click();
  await page.waitForTimeout(800);
  if (await banner.count()) throw new Error('cookie banner still visible after Reject');
  const failures = [];
  let saved = 0;
  for (const f of FRAMES.filter(x => !only || only.has(x.file))) {
    try {
      await page.goto(`${BASE}${f.route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);
      if (f.closeDeck) {
        const dialogs = page.getByRole('dialog').filter({ visible: true });
        for (let i = 0; i < 4 && await dialogs.count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(600); }
        if (await dialogs.count()) throw new Error('Decision Deck would not close');
      }
      if (f.press) {
        const target = page.getByRole(f.press.role, { name: f.press.name }).filter({ visible: true }).first();
        await target.click();
        await page.waitForTimeout(1500);
        if (f.selected && (await target.getAttribute('aria-selected')) !== 'true') throw new Error('tab did not become selected');
      }
      // visible only: the app renders hidden duplicates for other breakpoints, and `.first()` alone picks them.
      if (f.marker) await page.getByText(f.marker).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 8000 });
      if (await banner.count()) throw new Error('cookie banner visible');
      await page.screenshot({ path: join(dir, f.file) });
      saved++;
    } catch (e) {
      failures.push(`${f.file}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  }
  await ctx.close();
  return { saved, failures };
}

const browser = await chromium.launch();
const phone = await shoot(browser, OUT, { width: 430, height: 932 }, 3);
const ipad = await shoot(browser, join(OUT, 'ipad-13'), { width: 1032, height: 1376 }, 2, IPAD);
await browser.close();

const saved = phone.saved + ipad.saved;
const failures = [...phone.failures, ...ipad.failures.map(x => `ipad-13/${x}`)];
console.log(`saved ${saved} of ${FRAMES.length + IPAD.size} frames`);
for (const f of failures) console.log(`FAILED ${f}`);
process.exit(saved === 0 ? 2 : failures.length ? 1 : 0);
