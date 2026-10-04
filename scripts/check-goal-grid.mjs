#!/usr/bin/env node
// check:goal-grid - the Dashboard's Goal Progress card at 1440x900, signed in as the walk account.
// The walk account has NO goals, so the savings_goals read is answered IN THE BROWSER (route.fulfill)
// with 1, 2 and 3 goals in turn - nothing is written. For each count the tiles must span the card:
// the last tile's right edge sits within 2px of the first tile's row container's right edge.
// A fixed md:grid-cols-3 put one goal in a third of a 1296px card (red, proven before the fix).
// Does NOT cover phone widths (one column there by design), colour, or the empty state.
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const VIEW = { width: 1440, height: 900 };
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

const goal = (i) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`, user_id: session.user.id, name: `Probe goal ${i}`,
  goal_type: 'Custom', target_amount: 1000, current_amount: 250 * i, monthly_contribution: 0,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
});
const browser = await chromium.launch();
const failures = [];
for (const n of [1, 2, 3]) {
  const ctx = await browser.newContext({ viewport: VIEW });
  const page = await ctx.newPage();
  await page.route('**/rest/v1/savings_goals*', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Array.from({ length: n }, (_, i) => goal(i + 1))) })
    : route.abort()));
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
  const h = page.getByRole('heading', { name: 'Goal Progress' });
  await h.first().waitFor({ timeout: 25000 }).catch(() => {});
  if (!(await h.count())) { await browser.close(); fail(2, `n=${n}: no "Goal Progress" heading on ${page.url()}.`); }
  await h.first().scrollIntoViewIfNeeded();
  const r = await h.first().evaluate((el) => {
    const grid = el.nextElementSibling;
    const tiles = grid ? [...grid.children] : [];
    const g = grid?.getBoundingClientRect();
    return { tiles: tiles.length, gridW: g?.width ?? 0, gap: g ? g.right - Math.max(...tiles.map((t) => t.getBoundingClientRect().right)) : -1 };
  });
  await page.screenshot({ path: `test-results/goal-grid-${n}.png` });
  console.log(`n=${n}: tiles ${r.tiles}, grid ${r.gridW.toFixed(0)}px, unused right ${r.gap.toFixed(1)}px`);
  if (r.tiles !== n) failures.push(`n=${n}: rendered ${r.tiles} tiles (positive control)`);
  else if (r.gap > 2) failures.push(`n=${n}: ${r.gap.toFixed(0)}px of the card right of the last tile`);
  await ctx.close();
}
await browser.close();
if (failures.length) fail(1, failures.join('; '));
console.log('PASS - Goal Progress tiles span the card at 1, 2 and 3 goals.');
