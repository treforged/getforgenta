#!/usr/bin/env node
/**
 * check-overview-strip.mjs - the Command Center's Net Worth strip, RENDERED, signed in, at 1440x900 and 1024x900.
 * Tre, 2026-10-02 (7a9319ae): "The top numbers in the command center are not aligned in a straight line, and then
 * there's a lot of empty space also between the four numbers on the right and that worth."
 * ASSERTS, at each width:
 *   ONE LINE - the four stat labels (Liquid Cash, Investments, Retirement, CC Debt) share one top (spread <= 1px).
 *     Liquid Cash is a button; stretched, it centred its content in a row CC Debt's extra line made taller (10px low).
 *   NO DEAD BAND - from the right edge of the Net Worth TEXT (a Range over its characters, not its box, which
 *     fills its column) to the divider is <= 40px. It was ~230px at 1440 while the column took a third of the card.
 * CONTROL: all four labels and the Net Worth figure must be found at each width, or exit 2.
 * DOES NOT COVER: phone widths (the strip stacks there), colour, or whether the figures are right.
 * USAGE: node scripts/check-overview-strip.mjs   EXITS: 0 pass . 1 finding . 2 could not measure
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };
const env = readFileSync('.env.local', 'utf8');
let creds;
try { creds = readFileSync('.env.deck-walk.local', 'utf8'); }
catch { fail(2, '.env.deck-walk.local is missing - see scripts/seed-walk-account.sql.'); }
const pick = (s, k) => (s.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const url = pick(env, 'VITE_SUPABASE_URL');
const anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
const email = pick(creds, 'REACH_TEST_EMAIL');
const password = pick(creds, 'REACH_TEST_PASSWORD');
if (!url || !anon || !email || !password) fail(2, 'missing supabase url/key or walk credentials.');
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to script a sign-in for "${email}".`);
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}.`);
const ref = new URL(url).hostname.split('.')[0];

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

const browser = await chromium.launch();
const problems = [];
for (const width of [1440, 1024]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s]) => {
    localStorage.setItem(k, JSON.stringify(s));
    localStorage.setItem('tre_cookie_consent', JSON.stringify({ version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false }));
  }, [`sb-${ref}-auth-token`, session]);
  // Reads only: nothing this check does may write to the walk account.
  await page.route(/\/rest\/v1\//, r => (['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : r.abort()));
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  const strip = page.locator('.card-forged', { hasText: 'liabilities' }).first();
  try { await strip.waitFor({ state: 'visible', timeout: 40000 }); }
  catch { await browser.close(); fail(2, `[${width}] CONTROL FAILED: the Net Worth strip never rendered.`); }
  await page.waitForTimeout(1500);
  const r = await strip.evaluate(card => {
    const labels = ['Liquid Cash', 'Investments', 'Retirement', 'CC Debt'].map(t => {
      const p = [...card.querySelectorAll('p')].find(x => x.textContent.trim() === t);
      return p ? { t, top: Math.round(p.getBoundingClientRect().top) } : null;
    });
    const nw = [...card.querySelectorAll('p')].find(x => x.textContent.trim() === 'Net Worth');
    const left = nw?.closest('.grid > div');
    const divider = left?.nextElementSibling;
    let textRight = -Infinity;
    if (left) {
      const w = document.createTreeWalker(left, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!n.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const b of range.getClientRects()) if (b.width > 0) textRight = Math.max(textRight, b.right);
      }
    }
    return {
      labels,
      deadBand: divider && Number.isFinite(textRight) ? Math.round(divider.getBoundingClientRect().left - textRight) : null,
    };
  });
  await strip.screenshot({ path: `test-results/overview-strip-${width}.png` });
  console.log(`[${width}] ${JSON.stringify(r)}`);
  if (r.labels.some(l => !l) || r.deadBand === null) { await browser.close(); fail(2, `[${width}] CONTROL FAILED: labels or the Net Worth column not found.`); }
  const tops = r.labels.map(l => l.top);
  const spread = Math.max(...tops) - Math.min(...tops);
  if (spread > 1) problems.push(`[${width}] the four labels are not on one line (tops ${tops.join(', ')}; spread ${spread}px)`);
  if (r.deadBand > 40) problems.push(`[${width}] ${r.deadBand}px of empty space between Net Worth and the divider (want <= 40)`);
  await ctx.close();
}
await browser.close();
if (problems.length) { for (const p of problems) console.error(`FAIL: ${p}`); process.exit(1); }
console.log('PASS: the four labels share one line and Net Worth sits beside the figures at 1440 and 1024. Frames test-results/overview-strip-{1440,1024}.png');
