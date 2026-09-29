#!/usr/bin/env node
/**
 * check-forecast-assumptions.mjs - on a SMALL phone, press Forecast > Controls > Assumptions
 * and assert the panel is ON SCREEN afterwards.
 *
 * WHY THIS EXISTS
 * Tre, 2026-09-24 (ask e2b355ad): "when opening assumptions, it opens lower on the page, so for
 * people with smaller phones they won't see it actually. It looks like nothing happened." The
 * panel rendered below the milestone card, so the press changed the DOM and moved nothing the
 * user could see. A jsdom test passes that forever: the panel is "open". Only a rendered viewport
 * can tell open-and-visible from open-and-below-the-fold.
 *
 * WHAT IT ASSERTS, at 375x667 (the smallest iPhone the app supports):
 *   1. Positive control: before the press the panel (found by its own heading) is ABSENT.
 *      Without this, a panel that was always open would pass step 2.
 *   2. After the press the panel's heading is inside the viewport with at least 120px below it
 *      on screen. That is the user's claim, measured.
 *
 * WHAT IT DOES NOT COVER
 *   Desktop widths, the panel's own contents, contrast, and whether the smooth scroll feels
 *   right. It reads the geometry after the scroll settles, not during it.
 *
 * USAGE:  node scripts/check-forecast-assumptions.mjs
 * EXITS:  0 pass . 1 the panel is not on screen . 2 could not test
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const VIEW = { width: 375, height: 667 };
const MIN_VISIBLE = 120;
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
await page.evaluate(() => {
  localStorage.setItem('tre_cookie_consent', JSON.stringify({
    version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
  }));
  // Start closed, and past the one-time Assumptions tutorial, whatever a previous run left.
  localStorage.setItem('tre:forecast:showAssumptions', 'false');
  localStorage.setItem('tre:forecast:showControls', 'false');
  localStorage.setItem('tre:forecast:assumptionsTutorialSeen', 'true');
});
// /forecast is a redirect to this tab (src/App.tsx), so go to the tab itself.
await page.goto(`${BASE}/transactions?tab=forecast`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);

const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';
for (let i = 0; i < 6 && (await page.locator(OVERLAY).count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const still = page.locator(OVERLAY);
  if (await still.count()) { await still.first().dispatchEvent('click'); await page.waitForTimeout(600); }
}
if (await page.locator(OVERLAY).count()) await done(2, 'a modal overlay is still up; it would intercept the presses.');
if (!(await page.getByRole('heading', { name: 'Forecast', exact: true }).count())) {
  await done(2, `no Forecast heading on ${page.url()} - the tab did not render.`);
}

const controls = page.getByRole('button', { name: /^Controls/ });
if (!(await controls.count())) await done(2, 'no Controls disclosure at this width - is the viewport a phone?');
await controls.first().click();
const button = page.getByRole('button', { name: /Assumptions/ }).first();
if (!(await button.isVisible())) await done(2, 'the Assumptions button is not visible after opening Controls.');

// The panel is found by its OWN heading, which every version of it carries - never by the id or
// aria-expanded the fix added. A selector only the fixed page satisfies cannot see the defect: on
// the old page it would report "could not test" instead of "off screen".
const panel = page.getByRole('heading', { level: 3, name: 'Forecast Assumptions' });

// 1. Positive control: closed before the press.
if (await panel.count()) await done(2, 'the panel is already open before the press, so a pass would prove nothing.');

// 2. Press, let the smooth scroll settle, measure what the user sees.
await button.click();
await page.waitForTimeout(1500);
if (!(await panel.count())) await done(1, 'after the press there is no Forecast Assumptions panel.');
// The heading is the top of the panel, so its position is where the user's eye has to go.
const box = await panel.boundingBox();
if (!box) await done(1, 'the panel has no box (not rendered).');
const visible = VIEW.height - box.y; // screen left for the panel below its heading
const where = `top=${Math.round(box.y)} visible=${Math.round(visible)}px of a ${VIEW.height}px screen`;
if (box.y < 0 || box.y >= VIEW.height || visible < MIN_VISIBLE) {
  await done(1, `the panel opened OFF SCREEN (${where}) - the press looks like nothing happened.`);
}
await done(0, `PASS - closed before the press, and after it the panel is on screen at ${VIEW.width}x${VIEW.height} (${where}).`);
