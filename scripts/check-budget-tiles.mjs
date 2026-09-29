#!/usr/bin/env node
/**
 * check-budget-tiles.mjs - the dashboard's "This Month's Budget" tiles on a phone: how tall the
 * section is, and that every figure still sits on ONE line with nothing clipped.
 *
 * WHY: Tre, 2026-09-24 (ask aaafa7ee): "on the dashboard, where this months budget is, there's a
 * lot of empty space". Five tiles each took a full row at 390px. They now go two across. Halving a
 * tile's width is exactly how a figure starts to wrap or clip, so the height alone would be a
 * one-sided check: a smaller section with a cut-off number would pass it.
 *
 * ASSERTS (390x844, signed in): the section exists with 7 tiles (positive control); no tile's
 * value wraps (its height exceeds 1.6x its line-height) or overflows its box. PRINTS the section
 * height so a before/after pair can be compared.
 * DOES NOT COVER: desktop widths, colour, other dashboard sections.
 * USAGE: node scripts/check-budget-tiles.mjs    EXITS: 0 pass . 1 a figure wraps or clips . 2 could not test
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
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay').count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}
const heading = page.getByRole('heading', { name: "This Month's Budget" });
if (!(await heading.count())) await done(2, `no "This Month's Budget" heading on ${page.url()} - is the Overview tab showing?`);
await heading.first().scrollIntoViewIfNeeded();
const r = await heading.first().evaluate((h) => {
  const sec = h.parentElement;
  const tiles = [...sec.querySelectorAll('.card-forged')];
  const bad = [];
  for (const t of tiles) {
    const v = [...t.querySelectorAll('p,span,div')].find((e) => /^-?\$[\d,.]+$/.test(e.textContent.trim()) && e.children.length === 0);
    if (!v) { bad.push(`no figure in "${t.textContent.trim().slice(0, 30)}"`); continue; }
    const lh = parseFloat(getComputedStyle(v).lineHeight) || parseFloat(getComputedStyle(v).fontSize) * 1.2;
    const rect = v.getBoundingClientRect();
    if (rect.height > lh * 1.6) bad.push(`"${v.textContent}" wraps (${Math.round(rect.height)}px tall, line ${Math.round(lh)}px)`);
    if (v.scrollWidth > v.clientWidth + 1 || rect.right > t.getBoundingClientRect().right + 1) bad.push(`"${v.textContent}" overflows its tile`);
  }
  return { tiles: tiles.length, height: Math.round(sec.getBoundingClientRect().height), bad };
});
console.log(`section height ${r.height}px, ${r.tiles} tiles`);
if (r.tiles !== 7) await done(2, `expected 7 budget tiles, found ${r.tiles} - the instrument is not looking at the right section.`);
if (r.bad.length) await done(1, `figures do not fit: ${r.bad.join('; ')}`);
await done(0, `PASS - all 7 figures on one line, none clipped, at ${VIEW.width}x${VIEW.height}.`);
