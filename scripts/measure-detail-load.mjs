#!/usr/bin/env node
/**
 * measure-detail-load.mjs - an INVENTORY, not a pass/fail gate (ask 7515c3fa, simple vs advanced view).
 *
 * Tre, 2026-10-05: "a little too much detail that sometimes can make it a little overwhelming".
 * This turns "too much detail" into numbers per screen, at 390x844, signed in as the walk account:
 *   cards     - visible .card-forged boxes
 *   figures   - visible "$<digits>" strings (each money figure the eye has to read)
 *   screens   - full scroll height / 844 (how many phone screens to reach the bottom)
 * and saves a full-page frame of each to test-results/detail-load/.
 *
 * READ-ONLY: every non-GET request to Supabase is ANSWERED 204 in the browser and never sent (the dashboard writes a
 * money-glance snapshot after 5 s; it must not, from an instrument). Reads settle by two equal
 * consecutive counts, never by a fixed sleep. A route that never settles prints UNSTABLE, exit 2.
 * Positive control: /dashboard must show >= 1 card and >= 1 figure, else exit 2 (a blank page and
 * a simple page must not look the same).
 *
 * Usage: node scripts/measure-detail-load.mjs   (dev server on :8080, .env.deck-walk.local)
 */
import { readFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const OUT = 'test-results/detail-load';
const ROUTES = (process.env.ROUTES || '/dashboard,/dashboard?tab=goals,/dashboard?tab=accounts,/transactions?tab=transactions,/transactions?tab=budget,/transactions?tab=forecast,/debt').split(',');
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

const { chromium } = await import('@playwright/test');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
let aborted = 0;
await ctx.route(`${url}/**`, (route) => {
  const m = route.request().method();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS' || /\/auth\/v1\//.test(route.request().url())) return route.continue();
  aborted += 1;
  // ANSWERED in-browser, never sent: an abort reads as a network failure and raises the app's
  // outage banner, which the first run then counted as content.
  return route.fulfill({ status: 204, body: '' });
});
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => { localStorage.setItem(k, JSON.stringify(s)); localStorage.setItem('cookie-consent', 'declined'); }, [`sb-${ref}-auth-token`, session]);

const read = () => page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const cards = [...document.querySelectorAll('.card-forged')].filter(vis).length;
  let figures = 0;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const m = n.textContent.match(/\$\s?-?[\d,]+(\.\d+)?/g);
    if (m && n.parentElement && vis(n.parentElement)) figures += m.length;
  }
  const sc = [...document.querySelectorAll('main, [data-scroll-root], body')].reduce((a, el) => Math.max(a, el.scrollHeight), 0);
  const loading = /Loading your setup/i.test(document.body.innerText) ? 1 : 0;
  return { cards, figures, height: sc, skeleton: document.querySelectorAll('.skeleton-shimmer').length + loading };
});

await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /^reject$/i }).click({ timeout: 8000 }).catch(() => {});
const rows = [];
let unstable = false;
for (const r of ROUTES) {
  await page.goto(`${BASE}${r}`, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Escape').catch(() => {}); }
  let prev = null, cur = null, ok = false;
  for (let t = 0; t < 20; t++) {
    await page.waitForTimeout(1500);
    for (const d of await page.getByRole('dialog').all()) { await page.keyboard.press('Escape').catch(() => {}); void d; }
    cur = await read();
    if (prev && cur.skeleton === 0 && cur.cards > 0 && cur.cards === prev.cards && cur.figures === prev.figures) { ok = true; break; }
    prev = cur;
  }
  if (!ok) unstable = true;
  await page.getByRole('button', { name: /^reject$/i }).click({ timeout: 1500 }).catch(() => {});
  const name = r.replace(/[/?=&]/g, '_').replace(/^_/, '');
  // The app scrolls an inner container, so fullPage captures one viewport. Grow the viewport to
  // the measured height for the frame, then put it back.
  await page.setViewportSize({ width: 390, height: Math.min(cur.height + 120, 12000) });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  rows.push({ route: r, ...cur, screens: +(cur.height / 844).toFixed(1), settled: ok });
}
await browser.close();

console.log('route'.padEnd(34), 'cards', 'figures', 'screens', 'settled');
for (const x of rows) console.log(x.route.padEnd(34), String(x.cards).padStart(5), String(x.figures).padStart(7), String(x.screens).padStart(7), x.settled ? '' : 'UNSTABLE');
console.log(`writes answered in-browser (not sent): ${aborted}`);
const dash = rows.find((x) => x.route === '/dashboard');
if (!dash || dash.cards < 1 || dash.figures < 1) fail(2, 'CONTROL FAILED: /dashboard read no cards or no figures.');
if (unstable) process.exit(2);
