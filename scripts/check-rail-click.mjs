#!/usr/bin/env node
// check:rail-click - the desktop rail CLOSES after a mouse click, and still OPENS for the keyboard.
// At 1440x900 on /demo (no credentials). Measured 2026-10-05: the rail expanded on `focus-within`,
// and a mouse click leaves the clicked link focused, so after clicking "Debt" the rail stayed 234px
// wide over the page with the pointer gone - covering text and taking clicks meant for the page
// (elementFromPoint at x=150 hit the rail). The fix expands on `:focus-visible`, which a click never
// sets and Tab does.
// Arms: (1) hover the rail -> it widens (control: the instrument sees an open rail); (2) MOUSE-click
// Debt, move the pointer to the page -> rail back to its collapsed width and x=150 is page content;
// (3) KEYBOARD: Tab into the rail -> it widens again (focus still opens it for keyboard users).
// Red on the focus-within rail: arm 2 fails. Does NOT cover touch, other widths, or the rail's look.
const BASE = 'http://localhost:8080';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };
let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'Could not load @playwright/test.'); }
try { await fetch(BASE, { redirect: 'manual' }); } catch (err) { fail(2, `${BASE} is not serving (${err.message}).`); }
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));
await page.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });
await page.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(4000);
for (let i = 0; i < 6; i += 1) await page.keyboard.press('Escape');
const width = () => page.evaluate(() => Math.round(document.querySelector('aside > div')?.getBoundingClientRect().width ?? -1));
const covered = () => page.evaluate(() => !!document.elementFromPoint(150, 450)?.closest('aside'));
const settle = () => page.waitForTimeout(700); // the rail animates its width over 200ms
await page.mouse.move(900, 450); await settle();
const closed = await width();
await page.mouse.move(30, 300); await settle();
const hovered = await width();
console.log(`arm 1: rail ${closed}px closed, ${hovered}px hovered`);
if (closed < 0 || hovered <= closed + 50) { await browser.close(); fail(2, `CONTROL FAILED - hovering did not widen the rail (${closed} -> ${hovered}).`); }
const failures = [];
const debt = await page.getByRole('link', { name: 'Debt' }).first().boundingBox();
await page.mouse.click(debt.x + debt.width / 2, debt.y + debt.height / 2);
await page.mouse.move(900, 450); await page.waitForTimeout(1500);
const afterClick = await width(); const cover = await covered();
console.log(`arm 2: after a mouse click on Debt, pointer on the page: rail ${afterClick}px, x=150 ${cover ? 'COVERED by the rail' : 'is page content'}`);
if (afterClick > closed + 5 || cover) failures.push(`arm 2: the rail stayed open (${afterClick}px) over the page after a mouse click`);
await page.mouse.click(900, 860); await settle();
await page.keyboard.press('Tab');
let tabbed = 0;
for (let i = 0; i < 25; i += 1) {
  if (await page.evaluate(() => !!document.activeElement?.closest('aside'))) { tabbed = await (settle(), width()); break; }
  await page.keyboard.press('Tab');
}
await settle(); tabbed = await width();
console.log(`arm 3: keyboard focus in the rail: rail ${tabbed}px`);
if (tabbed <= closed + 50) failures.push(`arm 3: Tab into the rail did not open it (${tabbed}px) - keyboard users lose the labels`);
await page.screenshot({ path: 'test-results/rail-click-1440.png' });
await browser.close();
if (failures.length) fail(1, failures.join('; '));
console.log('PASS - the rail closes after a mouse click and opens for keyboard focus.');
