#!/usr/bin/env node
/**
 * check-forecast-table.mjs - the Forecast monthly table on a phone keeps its cents and still fits.
 *
 * WHY: ask 4066ff23 (Tre, 2026-10-03: "lets just use the decimals. that way theres no rounding
 * issues"). The engine keeps cents since then; this table printed whole dollars. Adding ".00" to
 * three narrow columns is exactly how a figure starts to wrap or clip.
 *
 * ASSERTS (390x844, signed in): at least 6 table rows (positive control); every Take-Home,
 * Expenses and End Cash cell shows two decimals; none wraps (height > 1.6x line-height) or
 * overflows its cell. DOES NOT COVER: desktop widths, the chips under each row, colour.
 * USAGE: node scripts/check-forecast-table.mjs   EXITS: 0 pass . 1 a cell lacks cents, wraps or clips . 2 could not test
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const VIEW = { width: 390, height: 844 };
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

const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}: ${JSON.stringify(session).slice(0, 200)}`);

// Settle the first-run dialogs on the WALK account only, exactly as check:account does.
const whatsNew = readFileSync('src/lib/whats-new.ts', 'utf8');
const releaseVersion = (whatsNew.match(/version:\s*'([^']+)'/) || [])[1];
if (!releaseVersion) fail(2, 'could not read the current release version out of src/lib/whats-new.ts.');
const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
const prof = await fetch(`${url}/rest/v1/profiles?select=tour_flags&user_id=eq.${session.user.id}`, { headers: rest });
if (!prof.ok) fail(2, `reading the walk account's profile returned ${prof.status}.`);
const flags = (await prof.json())[0]?.tour_flags ?? {};
const patch = await fetch(`${url}/rest/v1/profiles?user_id=eq.${session.user.id}`, {
  method: 'PATCH',
  headers: { ...rest, Prefer: 'return=representation' },
  body: JSON.stringify({
    founder_note_seen: true,
    tour_flags: { ...flags, new_user_done: true, premium_done: true, [`whats_new_${releaseVersion}`]: true },
  }),
});
const patched = await patch.json().catch(() => []);
if (!patch.ok || !Array.isArray(patched) || patched.length === 0) {
  fail(2, `settling the first-run dialogs matched no profile row (HTTP ${patch.status}).`);
}

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

const browser = await chromium.launch();
const done = async (code, msg) => { await browser.close(); if (code) fail(code, msg); console.log(msg); process.exit(0); };
const ctx = await browser.newContext({ viewport: VIEW });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));
await page.goto(`${BASE}/forecast`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay').count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}
const toggle = page.getByRole('button', { name: /Monthly breakdown/i });
if (!(await toggle.count())) await done(2, `no "Monthly breakdown" disclosure on ${page.url()}.`);
await toggle.first().scrollIntoViewIfNeeded();
await toggle.first().click();
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('div.grid')].filter((g) => g.className.includes('grid-cols-[5rem_1fr_1fr_1fr]') && g.className.includes('py-2'));
  const bad = [];
  let cells = 0;
  for (const g of rows) {
    const kids = [...g.children].slice(1, 4);
    for (const c of kids) {
      const text = (c.firstChild?.textContent ?? c.textContent).trim();
      if (!/^-?\$/.test(text)) continue;
      cells += 1;
      if (!/\.\d\d$/.test(text)) bad.push(`"${text}" has no cents`);
      const lh = parseFloat(getComputedStyle(c).lineHeight) || parseFloat(getComputedStyle(c).fontSize) * 1.2;
      const h = c.firstChild?.nodeType === 3 ? (() => { const rg = document.createRange(); rg.selectNodeContents(c.firstChild); return rg.getBoundingClientRect().height; })() : c.getBoundingClientRect().height;
      if (h > lh * 1.6) bad.push(`"${text}" wraps (${Math.round(h)}px, line ${Math.round(lh)}px)`);
      if (c.scrollWidth > c.clientWidth + 1) bad.push(`"${text}" overflows its cell`);
    }
  }
  return { rows: rows.length, cells, bad };
});
await toggle.first().evaluate((b) => b.scrollIntoView({ block: 'start' }));
await page.screenshot({ path: 'test-results/forecast-table-390.png', fullPage: false });
console.log(`rows ${r.rows}, money cells ${r.cells}`);
if (r.rows < 6 || r.cells < 18) await done(2, `expected >= 6 table rows, found ${r.rows} (${r.cells} cells) - not looking at the table.`);
if (r.bad.length) await done(1, `table cells: ${r.bad.slice(0, 8).join('; ')}`);
await done(0, `PASS - ${r.cells} figures carry cents and fit at ${VIEW.width}x${VIEW.height}. Frame test-results/forecast-table-390.png`);
