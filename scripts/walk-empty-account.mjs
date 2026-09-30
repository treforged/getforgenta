#!/usr/bin/env node
/**
 * walk-empty-account.mjs - what a NEW user sees in week one: every main screen, signed in as an
 * account with NO data (no bank, no accounts, no rules), at 390x844.
 *
 * WHY (ask 813d6b21, Tre approved 2026-09-30): 23 of 29 real users never finished onboarding, and
 * every other walk here signs in as the deck-walk account, which is FULL of fixture data. No gate
 * had ever looked at the empty state, which is the only state a new user has.
 *
 * PER ROUTE it reports: the URL it landed on, an ErrorBoundary, number-shaped junk in visible text
 * (NaN, undefined, Infinity, $-0, "null"), and how much text the page shows. It saves one frame per
 * route to test-results/empty-walk/ for a human-eye pass.
 * POSITIVE CONTROL: a planted "$NaN" string must be flagged, or the junk matcher is blind (exit 2).
 *
 * ACCOUNT: a throwaway @forgenta.test user, created in SQL (no signup email to bounce) and DELETED
 * after the run. Credentials come from EMPTY_WALK_EMAIL / EMPTY_WALK_PASSWORD and are never stored.
 * The only write is the shared first-run PATCH (onboarding_completed + dialog flags) on that user.
 *
 * DOES NOT COVER: the onboarding wizard itself (check:first-save owns it), desktop widths, presses.
 * EXITS: 0 no finding . 1 a finding . 2 could not test
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const VIEW = { width: 390, height: 844 };
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };

const env = readFileSync('.env.local', 'utf8');
const pick = (s, k) => (s.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const url = pick(env, 'VITE_SUPABASE_URL');
const anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
const email = process.env.EMPTY_WALK_EMAIL;
const password = process.env.EMPTY_WALK_PASSWORD;
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
    onboarding_completed: true,
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
  localStorage.setItem('tre:debtpayoff:activeTab', JSON.stringify('cards'));
});
// /forecast is a redirect to this tab (src/App.tsx), so go to the tab itself.

const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';
const ROUTES = ['/dashboard', '/budget', '/transactions', '/transactions?tab=forecast', '/debt', '/goals',
  '/vehicles', '/accounts', '/account', '/settings'];
const JUNK = /(\$-0(?:\.00)?\b|\bNaN\b|\bundefined\b|\bInfinity\b|\bnull\b)/g;
const read = () => page.evaluate((src) => {
  const re = new RegExp(src, 'g');
  const text = document.body.innerText;
  return { text: text.length, junk: [...new Set(text.match(re) ?? [])],
    boundary: /couldn.t load\.|Something went wrong loading this page/.test(text) };
}, JUNK.source);

// Positive control on the matcher, against the real page.
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.evaluate(() => { const d = document.createElement('div'); d.textContent = 'Total $NaN'; document.body.appendChild(d); });
if (!(await read()).junk.includes('NaN')) await done(2, 'CONTROL FAILED: a planted "$NaN" was not flagged - the matcher is blind.');

const { mkdirSync } = await import('node:fs');
mkdirSync('test-results/empty-walk', { recursive: true });
let findings = 0;
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  for (let i = 0; i < 4 && (await page.locator(OVERLAY).count()); i += 1) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }
  const r = await read();
  const landed = new URL(page.url()).pathname;
  const bad = r.boundary || r.junk.length > 0 || r.text < 40;
  if (bad) findings += 1;
  console.log(`${bad ? 'FINDING' : 'ok     '} ${route.padEnd(26)} -> ${landed.padEnd(14)} text ${String(r.text).padStart(5)}`
    + `${r.boundary ? ' ERRORBOUNDARY' : ''}${r.junk.length ? ` junk ${r.junk.join(',')}` : ''}${r.text < 40 ? ' BLANK' : ''}`);
  const name = route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
  await page.screenshot({ path: `test-results/empty-walk/${name}.png`, fullPage: false });
}
await done(findings ? 1 : 0, `${findings ? 'FINDINGS' : 'PASS'}: ${ROUTES.length} routes walked on an empty account, ${findings} with a finding.`);
