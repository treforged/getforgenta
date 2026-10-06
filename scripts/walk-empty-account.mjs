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
 * INVENTED FIGURES (Sam 2026-10-01): on Dashboard and Forecast every money figure must trace to a row the
 * user wrote, or be an empty state. This account wrote NO rows, so ANY visible "$<digits>" there is a
 * finding - a confident $0 where the app means "unknown" is the same defect as the phantom $97.5k salary
 * (ask 9f385515), which this walk once passed 10/10. Its control: a planted "$1,234" must be read.
 * FIGURE_ALLOW lists figures that are not the user's money at all (a price), each with its reason.
 * SAFE TO SPEND (ask 23fe1862): /dashboard must not show the "Safe to Spend until" figure at all.
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
// /budget joined 2026-10-06: a new user's Plan drew a donut of five "(0%)" shares above the real empty state.
const MONEY_ROUTES = new Set(['/dashboard', '/budget', '/transactions?tab=forecast']);
const FIGURE_ALLOW = [];
const figures = () => page.evaluate(() => {
  const out = [];
  // A share of the user's money is a figure too: "Fixed (0%)" on an empty account is the same confident zero.
  const re = /-?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmMbB]\b)?|-?\b\d+(?:\.\d+)?%/g;
  // Read each element's OWN text nodes JOINED, never one node at a time: React renders
  // `{label} ({pct}%)` as four sibling nodes ("Fixed", " (", "0", "%)"), so a per-node match
  // never sees "0%" - which is how this walk passed the Plan donut's five "(0%)" rows.
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || el.closest('[aria-hidden="true"]')) continue;
    seen.add(el);
    const box = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (box.width === 0 || box.height === 0 || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const own = [...el.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE).map((c) => c.textContent).join('');
    for (const m of own.match(re) ?? []) {
      const host = el.closest('section, [class*="card"], li, tr') ?? el;
      out.push({ fig: m.trim(), ctx: host.innerText.replace(/\s+/g, ' ').slice(0, 70) });
    }
  }
  return out;
});
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
await page.evaluate(() => { const d = document.createElement('div'); d.textContent = 'Income $1,234'; document.body.appendChild(d); });
if (!(await figures()).some((f) => f.fig === '$1,234')) await done(2, 'CONTROL FAILED: a planted "$1,234" was not read - the figure reader is blind.');
// Planted as SEPARATE text nodes, the way React renders `{label} ({pct}%)` - one node would pass a blind reader.
await page.evaluate(() => { const d = document.createElement('span'); for (const t of ['Fixed', ' (', '12', '%)']) d.appendChild(document.createTextNode(t)); document.body.appendChild(d); });
if (!(await figures()).some((f) => f.fig === '12%')) await done(2, 'CONTROL FAILED: a planted "Fixed (12%)" split across text nodes was not read - the share reader is blind.');

const { mkdirSync } = await import('node:fs');
mkdirSync('test-results/empty-walk', { recursive: true });
// SETTLE, never a fixed sleep (2026-10-01): a 6 s wait read /dashboard as 52 characters of SKELETON
// and reported "figures 0" - a pass from a page that had not loaded. A route is read only once no
// .skeleton-shimmer is on screen AND two reads a second apart agree; one that never settles is
// UNSTABLE and makes the run exit 2, because a zero from it is not a measurement.
const settle = async () => {
  let last = -1;
  for (let i = 0; i < 25; i += 1) {
    await page.waitForTimeout(1000);
    for (let j = 0; j < 4 && (await page.locator(OVERLAY).count()); j += 1) {
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    }
    const now = await page.evaluate(() => ({
      text: document.body.innerText.length,
      skeletons: document.querySelectorAll('.skeleton-shimmer').length,
    }));
    if (now.skeletons === 0 && now.text === last) return true;
    last = now.skeletons === 0 ? now.text : -1;
  }
  return false;
};
let findings = 0;
let unstable = 0;
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  if (!(await settle())) {
    unstable += 1;
    console.log(`UNSTABLE ${route.padEnd(26)} never settled (skeleton or text still changing after 25 s)`);
    continue;
  }
  const r = await read();
  const landed = new URL(page.url()).pathname;
  const invented = MONEY_ROUTES.has(route)
    ? (await figures()).filter((f) => !FIGURE_ALLOW.some((a) => a.test(f)))
    : [];
  // Ask 23fe1862 (Sam's gate): an empty account must show NO "Safe to Spend until <date>" figure.
  // That label only renders beside a figure, so its presence alone is the finding.
  const sts = route === '/dashboard' && (await page.evaluate(() => /safe to spend until/i.test(document.body.innerText)));
  const bad = r.boundary || r.junk.length > 0 || r.text < 40 || invented.length > 0 || sts;
  if (bad) findings += 1;
  console.log(`${bad ? 'FINDING' : 'ok     '} ${route.padEnd(26)} -> ${landed.padEnd(14)} text ${String(r.text).padStart(5)}`
    + `${r.boundary ? ' ERRORBOUNDARY' : ''}${r.junk.length ? ` junk ${r.junk.join(',')}` : ''}${r.text < 40 ? ' BLANK' : ''}`
    + `${MONEY_ROUTES.has(route) ? ` figures ${invented.length}` : ''}${sts ? ' SAFE-TO-SPEND FIGURE' : ''}`);
  for (const f of invented.slice(0, 12)) console.log(`          invented ${f.fig.padEnd(10)} in "${f.ctx}"`);
  const name = route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
  await page.screenshot({ path: `test-results/empty-walk/${name}.png`, fullPage: false });
}
const summary = `${ROUTES.length} routes walked on an empty account, ${findings} with a finding, ${unstable} unstable.`;
if (findings) await done(1, `FINDINGS: ${summary}`);
if (unstable) await done(2, `COULD NOT TEST: ${summary}`);
await done(0, `PASS: ${summary}`);
