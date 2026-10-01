#!/usr/bin/env node
/**
 * check-payoff-today.mjs - ask 25d01fda (Ruby, 2026-10-01): two payoff figures on /demo disagreed with
 * the card total beside them. The Dashboard hero read "$2,800 today" next to CC Debt $6,482, and the
 * Debt page's trajectory chart started near $3.4k next to Total CC Balance $6,482. Both drew month 0's
 * END balance (after this month's payment) where the screen said, or implied, TODAY.
 *
 * On /demo at 430x932 (no credentials), it asserts:
 *   1. the hero's "$X today" equals the CC Debt tile;
 *   2. on /debt, the chart's FIRST x-axis tick is "Today", and HOVERING that point shows card values
 *      that sum to "Total CC Balance" (within $2 of rounding).
 * The hover is the press: it must open a tooltip (a change), or the check exits 2, never 0.
 * Saves frames to test-results/payoff-today/. It does NOT judge the later points of the curve.
 * EXITS: 0 pass . 1 a finding . 2 could not test.
 */
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const OUT = 'test-results/payoff-today';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };
let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'Could not load @playwright/test.'); }
try { await fetch(BASE, { redirect: 'manual' }); } catch (err) { fail(2, `${BASE} is not serving (${err.message}).`); }
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const done = async (code, msg) => { await browser.close(); (code ? console.error : console.log)(msg); process.exit(code); };
const page = await (await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })).newPage();
const dollars = t => Number(String(t).replace(/[^0-9.]/g, ''));
const dismiss = async () => {
  for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay').count()); i += 1) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }
};

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false })));
await page.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });
await page.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {});

// 1. Hero "today" vs the CC Debt tile. Read until two reads agree (the projection settles late).
const readHero = () => page.evaluate(() => {
  const leaves = [...document.querySelectorAll('span, p, div')].filter(el => el.children.length === 0 && el.getClientRects().length > 0);
  const today = leaves.map(el => (el.textContent || '').trim()).find(t => /^\$[\d,]+ today$/.test(t)) ?? null;
  const label = leaves.find(el => /^CC Debt$/i.test((el.textContent || '').trim()));
  const tile = label?.parentElement?.textContent?.match(/\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?/)?.[0] ?? null;
  return { today, tile };
});
let hero = null; let prev = null;
for (let i = 0; i < 30; i += 1) {
  await page.waitForTimeout(1000); await dismiss();
  const r = await readHero();
  if (r.today && r.tile && prev && r.today === prev.today && r.tile === prev.tile) { hero = r; break; }
  prev = r;
}
if (!hero) await done(2, `CONTROL FAILED: hero "today" or CC Debt never settled (last read ${JSON.stringify(prev)}).`);
await page.screenshot({ path: `${OUT}/dashboard-430.png` });
console.log(`hero: "${hero.today}" | CC Debt tile ${hero.tile}`);
const heroOk = Math.abs(dollars(hero.today) - dollars(hero.tile)) <= 1;

// 2. The Debt chart. Demo mode is in-memory state, so /debt is reached by a client-side click.
const link = page.locator('a[href="/debt"]:visible').first();
if (!(await link.count())) await done(2, 'CONTROL FAILED: no visible /debt link in demo.');
await link.click();
try { await page.getByText('Total CC Balance').first().waitFor({ state: 'visible', timeout: 30000 }); }
catch { await done(2, 'CONTROL FAILED: "Total CC Balance" never rendered on /debt.'); }
await page.waitForTimeout(2500); await dismiss();
const total = await page.evaluate(() => {
  const label = [...document.querySelectorAll('*')].find(el => el.children.length === 0 && /^Total CC Balance$/i.test((el.textContent || '').trim()));
  let n = label?.parentElement; let m = null;
  for (let i = 0; i < 3 && n && !m; i += 1) { m = n.textContent?.match(/\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?/)?.[0] ?? null; n = n.parentElement; }
  return m;
});
const heading = page.getByText('Credit Card Debt Payoff Trajectory').first();
if (!(await heading.count())) await done(2, 'CONTROL FAILED: the trajectory chart heading is not on /debt.');
await heading.scrollIntoViewIfNeeded();
const chart = page.locator('.recharts-wrapper').filter({ has: page.locator('.recharts-line') }).first();
if (!(await chart.count())) await done(2, 'CONTROL FAILED: no line chart rendered.');
// This recharts build has no `.recharts-xAxis` wrapper; X ticks render before Y ticks, so the first
// tick value is the X axis's first label (the Y axis labels are dollar figures).
const xTick = chart.locator('.recharts-cartesian-axis-tick-value').filter({ hasNotText: /^\$/ }).first();
const firstTick = (await xTick.textContent())?.trim();
const tickBox = await xTick.boundingBox();
const plot = await chart.boundingBox();
if (!tickBox || !plot) await done(2, 'CONTROL FAILED: could not measure the chart.');
// The label is rotated -45 and end-anchored, so its box sits LEFT of the point. Its `x` attribute is
// the point's own x in SVG units; add the SVG's left edge to get the screen position.
const pointX = await xTick.evaluate(t => t.ownerSVGElement.getBoundingClientRect().left + Number(t.getAttribute('x')));
await page.mouse.move(pointX + 1, plot.y + plot.height * 0.4);
await page.waitForTimeout(600);
const items = await chart.locator('.recharts-tooltip-item').allTextContents();
if (items.length === 0) await done(2, 'CONTROL FAILED: hovering the first point opened no tooltip.');
await page.screenshot({ path: `${OUT}/debt-chart-430.png` });
const sum = items.reduce((s, t) => s + dollars(t.split(':').pop()), 0);
console.log(`chart: first tick "${firstTick}" | tooltip ${JSON.stringify(items)} = ${sum} | Total CC Balance ${total}`);

const findings = [];
if (!heroOk) findings.push(`hero "${hero.today}" != CC Debt ${hero.tile}`);
if (firstTick !== 'Today') findings.push(`chart's first tick is "${firstTick}", not "Today"`);
if (!total || Math.abs(sum - dollars(total)) > 2) findings.push(`chart's first point sums to ${sum}, not Total CC Balance ${total}`);
if (findings.length) await done(1, `FAIL: ${findings.join('; ')}`);
await done(0, 'PASS: the hero "today" equals CC Debt, and the chart starts at Today with the card total.');
