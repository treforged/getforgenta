#!/usr/bin/env node
/**
 * check-safe-to-spend.mjs - the Dashboard's "Safe to Spend until <date>" figure (ask 23fe1862),
 * at 390x844, on /demo (no credentials; the demo has a pay schedule, bills and cards).
 * NOT the deck-walk account: its income rules and checking are inactive, so it correctly shows
 * the EMPTY state ("Add your pay schedule"), which is walk:empty's territory, not this check's.
 *
 * It PRESSES the figure and requires the calculator drawer to open (a change, not an absence of
 * error), then reads the drawer back: the last row must equal the figure on the card, and
 * "Lowest point" minus "Cash floor" (never below 0) must equal it too. Saves the card and the
 * drawer to test-results/safe-to-spend/. The note under the figure must show and quote the same
 * Available figure as the donut centre (Sam 2026-10-01: two headlines need their relation stated).
 * It does NOT prove the figure is RIGHT for this account - `safe-to-spend.test.ts` owns the maths.
 * It proves the figure renders, is pressable, and the drawer's column agrees with it.
 * EXITS: 0 pass . 1 a finding . 2 could not test (no figure on the demo, which has every input, is a 1).
 */
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };
let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'Could not load @playwright/test.'); }
try { await fetch(BASE, { redirect: 'manual' }); } catch (err) { fail(2, `${BASE} is not serving (${err.message}).`); }
const browser = await chromium.launch();
const done = async (code, msg) => { await browser.close(); (code ? console.error : console.log)(msg); process.exit(code); };
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false })));
await page.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });

const label = page.getByText(/^Safe to Spend until /);
let found = false;
for (let i = 0; i < 30 && !found; i += 1) {
  await page.waitForTimeout(1000);
  for (let j = 0; j < 4 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay').count()); j += 1) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }
  found = (await label.count()) > 0;
}
const empty = await page.getByTestId("safe-to-spend-empty").count();
if (empty) console.log(`empty state reads: "${await page.getByTestId("safe-to-spend-empty").first().innerText()}"`);
if (!found) await done(1, `FINDING: no "Safe to Spend until" figure on /demo${empty ? ' (the EMPTY state rendered instead)' : ''}.`);
const button = label.first().locator('xpath=ancestor::button[1]');
const cardValue = (await button.innerText()).split('\n').map(s => s.trim()).filter(Boolean)[1];
mkdirSync('test-results/safe-to-spend', { recursive: true });
await button.scrollIntoViewIfNeeded();
await page.waitForTimeout(2000); // the donut animates in
await page.locator('.card-forged', { has: label }).first().screenshot({ path: 'test-results/safe-to-spend/card.png' });
console.log(`card: "${(await label.first().innerText()).trim()}" = ${cardValue}`);
// Sam 2026-10-01: the two money headlines must state their relation. The note must show and must
// quote the SAME Available figure the donut centre prints, or it explains a number nobody sees.
const note = page.getByTestId('safe-to-spend-note');
if (!(await note.count())) await done(1, 'FINDING: no note relating Safe to spend to Available to deploy.');
const noteText = await note.first().innerText();
const centre = await page.locator('.card-forged', { has: label }).first().evaluate((el) => {
  const t = el.innerText; const i = t.toUpperCase().indexOf('AVAILABLE\n');
  return i < 0 ? null : (t.slice(i).match(/\$[\d,]+(?:\.\d\d)?/) || [null])[0];
});
const noteFig = (noteText.match(/\$[\d,]+/) || [null])[0];
console.log(`note: "${noteText.trim()}" | donut centre ${centre}`);
if (!centre || !noteFig || Math.round(Number(centre.replace(/[$,]/g, ''))) !== Number(noteFig.replace(/[$,]/g, ''))) {
  await done(1, `FINDING: the note quotes ${noteFig} but the donut centre reads ${centre}.`);
}

await button.click();
const title = page.getByText('Safe to Spend until Payday', { exact: true });
try { await title.waitFor({ timeout: 5000 }); } catch { await done(1, 'FINDING: pressing the figure opened no drawer.'); }
await page.waitForTimeout(600);
await page.screenshot({ path: 'test-results/safe-to-spend/drawer.png' });
const drawerText = await page.locator('[role="dialog"]').last().innerText();
const num = (s) => Number(String(s).replace(/[^0-9.-]/g, ''));
const lineValue = (re) => { const m = drawerText.match(re); return m ? num(m[1]) : null; };
const low = lineValue(/Lowest point[^\n]*\n?\s*[=]?\s*(-?\$[\d,]+\.\d\d)/);
const floor = lineValue(/Cash floor\s*\n?\s*[−-]?\s*(\$[\d,]+\.\d\d)/) ?? 0;
const total = lineValue(/Safe to spend until [A-Z][a-z]{2} \d+\s*\n?\s*[=]?\s*(\$[\d,]+\.\d\d)/);
console.log(`drawer: lowest ${low}, floor ${floor}, total ${total}, card ${num(cardValue)}`);
if (low === null || total === null) await done(2, `COULD NOT TEST: drawer rows not read.\n${drawerText.slice(0, 600)}`);
if (Math.abs(total - Math.max(0, low - floor)) > 0.01) await done(1, `FINDING: drawer total ${total} != max(0, ${low} - ${floor}).`);
if (Math.abs(Math.round(total) - num(cardValue)) > 1) await done(1, `FINDING: card ${cardValue} disagrees with drawer total ${total}.`);
await done(0, `PASS: figure ${cardValue} renders, presses open its drawer, and the drawer agrees (lowest ${low} - floor ${floor} = ${total}).`);
