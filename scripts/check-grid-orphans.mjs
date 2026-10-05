#!/usr/bin/env node
/**
 * check-grid-orphans.mjs - ask 4ee0a129 (Tre, 2026-10-05: "too much blank spacing ... not even
 * orientation. make sure you look at all versions of screen sizes").
 *
 * Signed in as the walk account, at 360, 390, 768, 1024, 1280, 1440 and 1920 wide, on every main
 * screen, it measures every CSS grid of card-sized children (>= 80x40) and fails on:
 *   ORPHAN    the last row holds fewer tiles than the first AND leaves > 25% of the grid's width
 *             empty (Minimums Due alone under three tiles).
 *   OVERSIZED a tile > 1.4x the median width of its siblings whose TEXT spans < 60% of its inner
 *             width (Monthly Income spanning two columns with its right half blank).
 * Geometry is read from the RENDERED boxes; a source scan cannot see either defect.
 *
 * READ-ONLY: every non-GET Supabase request is answered 204 in the browser and never sent.
 * Each route is read until two reads agree. Positive controls run first on a planted page: a
 * 3+1 grid must read ORPHAN, a blank double-width tile must read OVERSIZED, and an even 2x2
 * must read clean - else exit 2, because a zero from a blind instrument looks like a pass.
 *
 * Usage: node scripts/check-grid-orphans.mjs   (dev server on :8080, .env.deck-walk.local)
 * Env: WIDTHS=390,1440  ROUTES=/debt   to narrow a run.
 * Does NOT cover: grids behind a dialog or a press, flex-wrap rows, colour, or param routes.
 */
import { readFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const WIDTHS = (process.env.WIDTHS || '360,390,768,1024,1280,1440,1920').split(',').map(Number);
const ROUTES = (process.env.ROUTES || '/dashboard,/dashboard?tab=goals,/dashboard?tab=accounts,/transactions?tab=transactions,/transactions?tab=budget,/transactions?tab=forecast,/debt').split(',');
const OUT = 'test-results/grid-orphans';
const fail = (code, msg) => { console.error(msg); process.exit(code); };

const env = readFileSync('.env.local', 'utf8');
let creds;
try { creds = readFileSync('.env.deck-walk.local', 'utf8'); } catch { fail(2, '.env.deck-walk.local is missing.'); }
const pick = (s, k) => (s.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const url = pick(env, 'VITE_SUPABASE_URL');
const anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
const email = pick(creds, 'REACH_TEST_EMAIL');
const password = pick(creds, 'REACH_TEST_PASSWORD');
if (!url || !anon || !email || !password) fail(2, 'missing env or walk credentials.');
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to sign in as "${email}" - @forgenta.test only.`);
const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}`);

/** Runs in the page. Returns findings for every qualifying grid. */
function scan() {
  const out = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width >= 80 && r.height >= 40 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const textSpan = (el) => {
    let l = Infinity, r = -Infinity;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const b of rg.getClientRects()) { if (b.width > 0) { l = Math.min(l, b.left); r = Math.max(r, b.right); } }
    }
    return r > l ? r - l : 0;
  };
  for (const g of document.querySelectorAll('*')) {
    if (getComputedStyle(g).display !== 'grid') continue;
    const kids = [...g.children].filter(vis);
    if (kids.length < 2) continue;
    const gr = g.getBoundingClientRect();
    const rows = [];
    for (const k of kids) {
      const r = k.getBoundingClientRect();
      let row = rows.find((x) => Math.abs(x.top - r.top) < 4);
      if (!row) { row = { top: r.top, items: [] }; rows.push(row); }
      row.items.push(r);
    }
    rows.sort((a, b) => a.top - b.top);
    if (Math.max(...rows.map((x) => x.items.length)) < 2) continue; // a single column is a list, not a tile grid
    const label = (g.innerText || '').trim().split('\n')[0].slice(0, 40);
    const first = rows[0], last = rows[rows.length - 1];
    if (rows.length > 1 && last.items.length < first.items.length) {
      const used = last.items.reduce((s, r) => s + r.width, 0);
      const empty = 1 - used / gr.width;
      if (empty > 0.25) out.push({ kind: 'ORPHAN', grid: label, detail: `last row ${last.items.length} of ${first.items.length}, ${Math.round(empty * 100)}% empty` });
    }
    const widths = kids.map((k) => k.getBoundingClientRect().width).sort((a, b) => a - b);
    const median = widths[Math.floor(widths.length / 2)];
    if (kids.length >= 3) {
      for (const k of kids) {
        const w = k.getBoundingClientRect().width;
        if (w <= median * 1.4) continue;
        const cs = getComputedStyle(k);
        const inner = w - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const fill = textSpan(k) / inner;
        if (fill < 0.6) out.push({ kind: 'OVERSIZED', grid: label, detail: `"${(k.innerText || '').trim().split('\n')[0].slice(0, 30)}" ${Math.round(w)}px vs median ${Math.round(median)}px, text spans ${Math.round(fill * 100)}%` });
      }
    }
  }
  return out;
}

const { chromium } = await import('@playwright/test');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

// -- Positive controls ------------------------------------------------------------------------
{
  const p = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const tile = (t) => `<div style="height:80px;border:1px solid #888;padding:8px"><span>${t}</span></div>`;
  await p.setContent(`
    <div id="a" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:900px">${tile('A1')}${tile('A2')}${tile('A3')}${tile('A4')}</div>
    <div id="b" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;width:900px;margin-top:20px">
      <div style="grid-column:span 2;height:80px;border:1px solid #888;padding:8px"><span>B1</span></div>${tile('B2')}${tile('B3')}</div>
    <div id="c" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;width:900px;margin-top:20px">${tile('C1 wide enough text here')}${tile('C2')}${tile('C3')}${tile('C4')}</div>`);
  const f = await p.evaluate(scan);
  const has = (kind, g) => f.some((x) => x.kind === kind && x.grid.startsWith(g));
  if (!has('ORPHAN', 'A1')) fail(2, `CONTROL FAILED: a planted 3+1 grid did not read ORPHAN. ${JSON.stringify(f)}`);
  if (!has('OVERSIZED', 'B1')) fail(2, `CONTROL FAILED: a planted blank double tile did not read OVERSIZED. ${JSON.stringify(f)}`);
  if (f.some((x) => x.grid.startsWith('C1'))) fail(2, `CONTROL FAILED: an even 2x2 grid was flagged. ${JSON.stringify(f)}`);
  console.log('controls: 3+1 -> ORPHAN, blank double -> OVERSIZED, even 2x2 -> clean');
  await p.close();
}

let total = 0, unstable = 0, examined = 0;
for (const W of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, colorScheme: 'dark' });
  await ctx.route(`${url}/**`, (route) => {
    const m = route.request().method();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS' || /\/auth\/v1\//.test(route.request().url())) return route.continue();
    return route.fulfill({ status: 204, body: '' });
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
  for (const r of ROUTES) {
    await page.goto(`${BASE}${r}`, { waitUntil: 'domcontentloaded' });
    let prev = null, cur = null, ok = false;
    for (let t = 0; t < 20; t++) {
      await page.waitForTimeout(1500);
      await page.keyboard.press('Escape').catch(() => {});
      const loading = await page.evaluate(() => /Loading your setup/i.test(document.body.innerText) || document.querySelectorAll('.skeleton-shimmer').length > 0);
      cur = await page.evaluate(scan);
      const key = JSON.stringify(cur);
      if (!loading && prev === key) { ok = true; break; }
      prev = key;
    }
    examined += 1;
    if (!ok) { unstable += 1; console.log(`UNSTABLE ${W} ${r}`); continue; }
    for (const x of cur) { total += 1; console.log(`${x.kind.padEnd(9)} ${String(W).padStart(4)} ${r.padEnd(30)} [${x.grid}] ${x.detail}`); }
    if (cur.length) await page.screenshot({ path: `${OUT}/${W}${r.replace(/[/?=&]/g, '_')}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log(`examined ${examined} route x width reads, ${total} finding(s), ${unstable} unstable`);
if (examined === 0) process.exit(2);
if (total) process.exit(1);
if (unstable) process.exit(2);
