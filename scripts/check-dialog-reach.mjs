#!/usr/bin/env node
// check:dialog-reach - the money and Garage dialogs that no other probe reaches (e1b0fffc, 2026-10-08):
// New/Edit Build, Log Service, Share debt-free date, Read a statement, Add Extra Payment (LumpSum) and
// Start Loan Tracking (BuyIt). On /demo, no credentials, at 390x844, 320x568 and 1440x900.
//
// For each: the dialog OPENS (the control - a selector that finds nothing would pass every other
// assertion), every button/input in it is REACHABLE (on screen, or inside a scroller that lives in the
// dialog's own fixed layer - a document scroll does not move a fixed overlay), none is COVERED (its
// centre paints the control, not a card from the page), and its close button is >= 44px.
//
// What it found on its first run, all fixed the same day:
//   - Add Extra Payment rendered INSIDE its `.card-forged` card (backdrop-filter makes the card the
//     containing block for position:fixed): the next card painted over it, "Add Payment" below the screen.
//   - New/Edit Build at 320x568: 745px tall, no scroll - Close at -69px, Save at 595px.
//   - Close targets of 27px (Build, Log Service) and 14px (Share, Read a statement).
// Red: STRIP=1 is not offered; prove it by reverting LumpSumPanel's createPortal (exit 1).
// Does NOT cover: signed-in data, other dialogs (check:narrow-overflow DIALOGS=1), what the forms SAVE.
// PW_EXECUTABLE=<path> launches a specific Chromium (the cloud container's /opt/pw-browsers/chromium).
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const VIEWPORTS = [[390, 844], [320, 568], [1440, 900]];
const fail = [];

function findUnreachable(scope) {
  const out = [];
  const root = scope ? [...document.querySelectorAll(scope)].filter(e => e.getBoundingClientRect().width).pop() : document.body;
  if (!root) return ['NO SCOPE ' + scope];
  for (const el of root.querySelectorAll('button, input, select, textarea, a[href]')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    const inView = r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1;
    if (inView) continue;
    let scroller = false;
    for (let a = el.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll)/.test(s.overflowY + s.overflowX) && (a.scrollHeight > a.clientHeight + 1 || a.scrollWidth > a.clientWidth + 1)) { scroller = true; break; } if (s.position === 'fixed') break; }
    let fixedAnc = false; for (let a = el; a; a = a.parentElement) if (getComputedStyle(a).position === 'fixed') { fixedAnc = true; break; }
    if (!scroller && (fixedAnc || !(document.scrollingElement.scrollHeight > innerHeight && r.left >= 0 && r.right <= innerWidth))) out.push(`${el.tagName} "${(el.innerText||el.getAttribute('aria-label')||el.name||'').trim().slice(0,30)}" at ${r.left|0},${r.top|0} ${r.width|0}x${r.height|0}`);
  }
  return out;
}
function findCovered(scope) {
  const out = [];
  const roots = [...document.querySelectorAll(scope)].filter(e => e.getBoundingClientRect().width);
  const root = roots[roots.length - 1]; if (!root) return ['NO DIALOG'];
  for (const el of root.querySelectorAll('button, input, select, textarea, a[href]')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const x = r.left + r.width / 2; const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
    let clipped = false;
    for (let a = el.parentElement; a && a !== root.parentElement; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(s.overflowY + s.overflowX)) { const b = a.getBoundingClientRect(); if (y < b.top || y > b.bottom || x < b.left || x > b.right) { clipped = true; break; } } }
    if (clipped) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && !el.contains(hit) && !hit.contains(el) && !(el.labels && [...el.labels].some(l => l.contains(hit)))) out.push(`${el.tagName} "${(el.innerText||el.getAttribute('aria-label')||el.placeholder||'').trim().slice(0,30)}" covered by ${hit.tagName}.${String(hit.className).split(' ').slice(0,3).join('.')}`);
  }
  return out;
}


function closeSizes(sel) {
  const d = [...document.querySelectorAll(sel)].filter(e => e.getBoundingClientRect().width).pop();
  return [...d.querySelectorAll('button')].filter(b => /^close$/i.test(b.getAttribute('aria-label') || '') || b.querySelector('svg.lucide-x'))
    .map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
}

const garage = async (page) => {
  await page.goto(`${BASE}/vehicles`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3500);
  await page.locator('button', { hasText: /^\s*Builds\s*$/ }).first().click(); await page.waitForTimeout(1500);
};
const debt = (q) => async (page) => { await page.goto(`${BASE}/debt${q}`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(4000); };
const press = (loc) => async (page) => { const b = loc(page); await b.scrollIntoViewIfNeeded(); await b.click(); };

const CASES = [
  ['Edit Build', garage, press(p => p.locator('button[title="Edit build"]'))],
  ['New Build', garage, press(p => p.locator('button', { hasText: /New Build/i }))],
  ['Log Service', garage, press(p => p.locator('button', { hasText: /Log Service/i }))],
  ['Share your debt-free date', debt(''), press(p => p.locator('button[aria-label="Share your debt-free date"]').first())],
  ['Read a statement', debt(''), press(p => p.locator('button[aria-label^="Read a statement for"]').first())],
  ['Add Extra Payment', debt('?tab=auto'), press(p => p.locator('button', { hasText: /^\s*Add\s*$/ }).first())],
  ['Start Loan Tracking', debt('?tab=auto'), press(p => p.locator('button', { hasText: /I bought it/ }).first())],
];

const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
for (const [w, h] of VIEWPORTS) {
  // One context per viewport, one page at a time: memory is tight and two browsers got a run killed.
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({ version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false })));
  await page.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(4000);
  for (const [name, go, open] of CASES) {
    const tag = `${name} @ ${w}x${h}`;
    await go(page);
    try { await open(page); } catch (e) { fail.push(`${tag}: CONTROL - could not press its trigger (${e.message.split('\n')[0]})`); continue; }
    await page.waitForTimeout(800);
    const sel = `[role=dialog][aria-label^="${name}"], [role=dialog]:has(h2:text-is("${name}"))`;
    const n = await page.locator('[role=dialog]').count();
    const named = await page.evaluate((nm) => [...document.querySelectorAll('[role=dialog]')].some(d => d.getBoundingClientRect().width && ((d.getAttribute('aria-label') || '').startsWith(nm) || [...d.querySelectorAll('h2')].some(h => h.textContent.trim().startsWith(nm)))), name);
    if (!n || !named) { fail.push(`${tag}: CONTROL - no dialog named "${name}" opened`); continue; }
    const dsel = '[role=dialog]';
    const unr = await page.evaluate(findUnreachable, dsel);
    const cov = await page.evaluate(findCovered, dsel);
    const close = await page.evaluate(closeSizes, dsel);
    const small = close.filter(([cw, ch]) => cw < 44 || ch < 44);
    for (const u of unr) fail.push(`${tag}: UNREACHABLE ${u}`);
    for (const c of cov) fail.push(`${tag}: COVERED ${c}`);
    for (const [cw, ch] of small) fail.push(`${tag}: close button ${cw}x${ch}, under 44px`);
    console.log(`${(unr.length || cov.length || small.length) ? 'FAIL' : 'ok  '} ${tag}: close ${close.map(c => c.join('x')).join(',') || 'none (Cancel only)'}, unreachable ${unr.length}, covered ${cov.length}`);
  }
  await ctx.close();
}
await browser.close();
if (fail.some(f => f.includes('CONTROL'))) { console.error(fail.join('\n')); process.exit(2); }
if (fail.length) { console.error(`\n${fail.length} finding(s):\n${fail.join('\n')}`); process.exit(1); }
console.log(`\nPASS - ${CASES.length} dialogs x ${VIEWPORTS.length} viewports reachable, uncovered, close >= 44px.`);
