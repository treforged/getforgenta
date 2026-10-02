#!/usr/bin/env node
/**
 * check-word-breaks.mjs - no word on a phone screen breaks across lines. Signed in, 390x844, the main routes.
 * Tre, 2026-10-01 (build 1218): "we didnt fix all the text wrapping problems". The defect shape: a text column
 * beside shrink-0 controls gets so narrow that a name breaks per syllable ("emer / genc / y"). 91e8ac5c fixed
 * the surplus list; this looks for the same shape EVERYWHERE rather than on the screen that was reported.
 * HOW: every visible text node is split into words; a word whose Range paints on more than one line top is a
 * mid-word break. That is the exact symptom, read from the rendered page, never from class names.
 * POSITIVE CONTROL: on each route a planted 44px box holding "emergency" must be found broken, or exit 2.
 * Each route is read until two consecutive reads agree (a fixed sleep reads an unmounted page as clean).
 * DOES NOT COVER: desktop widths, anything behind a press (dialogs, menus), param routes, or text that wraps
 * at word boundaries into too many lines OUTSIDE a heading (FYI only). A heading (h1-h4) squeezed under 140px onto
 * 3+ lines DOES fail: that is the chart-title shape ("Credit Card Debt Payoff Trajectory", 125px x 3, 2026-10-02).
 * Writes nothing: every non-GET REST call is aborted. The only write is settling first-run dialogs on the walk account.
 * USAGE: node scripts/check-word-breaks.mjs    EXITS: 0 pass . 1 a word breaks . 2 could not test
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const ROUTES = [
  '/dashboard', '/dashboard?tab=accounts', '/dashboard?tab=goals', '/budget', '/transactions', '/debt',
  '/debt?tab=use', '/goals', '/forecast', '/net-worth', '/subscriptions', '/car-fund', '/account', '/settings',
];
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

// Runs in the page. Returns every word painted on more than one line, plus the narrowest multi-line columns.
const scan = () => {
  const broken = [];
  const narrow = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || !node.textContent.trim()) continue;
    if (el.closest('[aria-hidden="true"], script, style, svg')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    // A break AT a hyphen or slash is ordinary typography ("Interest-/Bearing"), so those split words.
    const re = /[^\s\-‐-—/]{4,}/g;
    for (let m = re.exec(node.textContent); m; m = re.exec(node.textContent)) {
      const range = document.createRange();
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const tops = new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top)));
      if (tops.size > 1) {
        const key = `${m[0]}|${Math.round(box.left)}|${Math.round(box.top)}`;
        if (!seen.has(key)) {
          seen.add(key);
          broken.push({ word: m[0].slice(0, 30), lines: tops.size, width: Math.round(box.width), text: el.textContent.trim().slice(0, 50) });
        }
      }
    }
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) {
      narrow.push({ width: Math.round(box.width), lines: 1, clipped: true, text: el.textContent.trim().slice(0, 50) });
    }
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    const lines = Math.round(box.height / lh);
    if (lines >= 3 && box.width < 140) {
      narrow.push({ width: Math.round(box.width), lines, heading: !!el.closest('h1, h2, h3, h4'), text: el.textContent.trim().slice(0, 50) });
    }
  }
  return { broken, narrow };
};

const browser = await chromium.launch();
const done = async (code, msg) => { await browser.close(); if (code) fail(code, msg); console.log(msg); process.exit(0); };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => {
  localStorage.setItem('tre_cookie_consent', JSON.stringify({
    version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
  }));
});
await page.route(/\/rest\/v1\//, route => (['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort()));

const failures = [];
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  for (let i = 0; i < 6 && (await page.locator('[role="dialog"]').count()); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  let prev = null;
  let result = null;
  for (let read = 0; read < 8; read += 1) {
    result = await page.evaluate(scan);
    const sig = JSON.stringify(result.broken.map(b => b.word));
    if (prev === sig && read > 0) break;
    prev = sig;
    result = null;
    await page.waitForTimeout(1500);
  }
  if (!result) await done(2, `UNSTABLE: ${route} never gave two agreeing reads.`);
  // Positive control: a word the instrument MUST see broken, planted after the real read.
  const control = await page.evaluate(scan => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;left:0;width:44px;font-size:16px;word-break:break-word;z-index:99999;background:#000;color:#fff';
    d.textContent = 'emergency';
    document.body.appendChild(d);
    const found = new Function(`return (${scan})()`)().broken.some(b => b.word === 'emergency');
    d.remove();
    return found;
  }, scan.toString());
  if (!control) await done(2, `CONTROL FAILED on ${route}: a planted broken word was not found.`);
  const slug = route.replace(/[^a-z]+/gi, '-').replace(/^-|-$/g, '');
  await page.screenshot({ path: `test-results/word-breaks-${slug}.png`, fullPage: true });
  console.log(`${route}: ${result.broken.length} broken word(s), ${result.narrow.length} narrow column(s)`);
  for (const b of result.broken) {
    console.log(`  BROKEN "${b.word}" on ${b.lines} lines, box ${b.width}px: ${b.text}`);
    failures.push(`${route} "${b.word}"`);
  }
  for (const n of result.narrow) {
    if (n.heading) {
      console.log(`  SQUEEZED HEADING ${n.width}px x ${n.lines} lines: ${n.text}`);
      failures.push(`${route} heading "${n.text}" squeezed to ${n.lines} lines`);
    } else console.log(`  fyi ${n.clipped ? 'CLIPPED (ellipsis)' : 'narrow'} ${n.width}px x ${n.lines} lines: ${n.text}`);
  }
}
await ctx.close();
if (failures.length) await done(1, `${failures.length} wrap defect(s) at 390: ${failures.join(' | ')}`);
await done(0, `PASS: ${ROUTES.length} routes at 390, no word breaks across lines and no heading is squeezed; the planted control was found on every route.`);
