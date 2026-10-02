#!/usr/bin/env node
/**
 * check-surplus-rows.mjs - the "Where the extra money goes" list (SurplusRankingSection), signed in, at
 * 390x844 AND 1440x900. Tre, 2026-10-01 (build 1218): "we didnt fix all the text wrapping problems" - goal
 * names broke one syllable per line because the row's trailing controls took the width.
 * ASSERTS at 390: every row's name column is at least 60% of the row's width, and the controls group sits
 * BELOW the name (its top >= the name's bottom). At 1440: the controls sit on the SAME line (inline).
 * POSITIVE CONTROL: at least 1 row found (the walk account ranks one) at each width, or exit 2. Writes nothing (every non-GET aborted).
 * DOES NOT COVER: colour, the split indent's own width, or rows behind "As one group".
 * USAGE: node scripts/check-surplus-rows.mjs    EXITS: 0 pass . 1 a row is squeezed . 2 could not test
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
const failures = [];
for (const VIEWPORT of [VIEW, { width: 1440, height: 900 }]) {
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => {
  localStorage.setItem('tre_cookie_consent', JSON.stringify({
    version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
  }));
});
await page.route(/\/rest\/v1\//, route => (['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort()));
await page.goto(`${BASE}/dashboard?tab=goals`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay').count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}
// Wait for the list rather than trusting a fixed sleep: one 1440 read found 0 rows on a page that
// had simply not mounted yet, and a zero from an unsettled page reads like a missing list.
try { await page.locator('[data-testid="surplus-row-controls"]').first().waitFor({ state: 'attached', timeout: 25000 }); }
catch { /* the count below reports it */ }
const rows = await page.locator('[data-testid="surplus-row-controls"]').evaluateAll(groups => groups.map(g => {
  const li = g.closest('li');
  const name = li.querySelector('div.flex-1.min-w-0 p');
  const r = li.getBoundingClientRect(), n = name.getBoundingClientRect(), c = g.getBoundingClientRect();
  return { text: name.textContent.trim().slice(0, 40), row: r.width, name: n.width, nameBottom: n.bottom, nameTop: n.top, ctrlTop: c.top };
}));
const w = VIEWPORT.width;
console.log(`${w}px: ${rows.length} rows`);
if (rows.length < 1) await done(2, `CONTROL FAILED at ${w}px: no surplus rows found.`);
for (const r of rows) {
  const pct = Math.round((100 * r.name) / r.row);
  console.log(`  ${pct}% name width  ctrl ${r.ctrlTop >= r.nameBottom - 1 ? 'below' : 'inline'}  ${r.text}`);
  if (w < 640) {
    if (pct < 60) failures.push(`${w}px: "${r.text}" name column is ${pct}% of the row`);
    if (r.ctrlTop < r.nameBottom - 1) failures.push(`${w}px: "${r.text}" controls are not below the name`);
  } else if (r.ctrlTop >= r.nameBottom - 1) {
    failures.push(`${w}px: "${r.text}" controls dropped below the name on desktop`);
  }
}
await page.locator('[data-testid="surplus-row-controls"]').first().evaluate(e => e.closest('li').scrollIntoView({ block: 'center' }));
await page.waitForTimeout(400);
await page.screenshot({ path: `test-results/surplus-rows-${w}.png`, fullPage: false });
await ctx.close();
}
if (failures.length) await done(1, `${failures.length} squeezed row(s): ${failures.join(' | ')}`);
await done(0, 'PASS: at 390 every name column is at least 60% of its row with the controls below it; at 1440 the controls stay inline.');
