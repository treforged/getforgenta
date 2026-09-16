#!/usr/bin/env node
/**
 * check-desktop-rail.mjs - the desktop rail's POP-OUT paints OVER the page, and the panel
 * pills stay centred while it does.
 *
 * WHY THIS EXISTS
 * Tre, 2026-09-16, with a desktop screenshot: *"this is a bug on desktop btw. the pop out
 * should go over the items, not behind."* Every glass card on every desktop route painted over
 * the expanded rail.
 *
 * ⚠️ A z-INDEX READ CANNOT ANSWER THIS, WHICH IS WHY THIS GATE MEASURES A PAINTED PIXEL.
 * The rail carried `z-40` and the class list looked correct. `position: sticky` creates a
 * stacking context even at `z-index: auto`, so the rail's z-40 only ranked it INSIDE its
 * `<aside>`; in the root stacking context that aside sat at level 0 against `.card-forged`,
 * which is ALSO a level-0 stacking context because it carries a `backdrop-filter`. Between two
 * level-0 contexts DOM ORDER decides, and the content column comes second. `elementFromPoint`
 * is the only instrument that reports the winner rather than the intention.
 *
 * WHAT IT ASSERTS, at 1440x900, signed in, on /accounts:
 *   1. Hovering the rail EXPANDS it (positive control - without this the overlay is untested).
 *   2. A point inside the expanded rail is painted by the RAIL, not by page content.
 *   3. Every `.seg-track` on the screen shares one horizontal centre. The Balances pill sits in
 *      a flex row with "+ Add Account"; making that side `shrink-0` for the phone fix pushed the
 *      whole group right on desktop, and Tre reported it from a screenshot within minutes.
 *
 * WHAT IT DOES NOT COVER
 *   Colour, spacing, phone widths (that is check:panel-rows), other routes, the rail's own
 *   contents, and whether a MODAL still covers the rail - modals are z-50 by convention and
 *   nothing here checks that convention holds.
 *
 * USAGE:  node scripts/check-desktop-rail.mjs   (needs the dev server and .env.deck-walk.local)
 * EXITS:  0 pass . 1 a real defect . 2 could not test
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
if (!patch.ok) fail(2, `settling the first-run dialogs returned HTTP ${patch.status}.`);

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));
await page.goto(`${BASE}/accounts`, { waitUntil: 'domcontentloaded' });
// ⚠️ WAIT FOR THE SECOND PILL, DO NOT SLEEP AT IT. A fixed 5s found two pills on three runs and
// ONE on the fourth - the sub-panel mounts after its own query settles. A short run would have
// exited 2 saying "could not test", which is honest but useless, and a long one wastes the time
// on every healthy run.
try {
  await page.waitForFunction(() => document.querySelectorAll('.seg-track').length >= 2, { timeout: 20000 });
} catch {
  await browser.close();
  fail(2, 'only one panel pill ever appeared on /accounts within 20s - the second never mounted, so there was nothing to compare centres against.');
}
await page.waitForTimeout(600);

const problems = [];

// ── 1. The pills share a centre ──────────────────────────────────────────────
const centres = await page.evaluate(() => [...document.querySelectorAll('.seg-track')].map((t) => {
  const r = t.getBoundingClientRect();
  return {
    labels: [...t.children].map((k) => (k.innerText || '').replace(/\s+/g, ' ').trim()).join(' | '),
    centre: Math.round(r.left + r.width / 2),
  };
}));
console.log('--- panel pill centres at 1440 ---');
for (const c of centres) console.log(`  centre ${String(c.centre).padStart(5)}  [${c.labels}]`);
if (centres.length < 2) {
  await browser.close();
  fail(2, `found ${centres.length} panel pill(s) on /accounts - this check needs at least two to compare, so a pass would mean nothing.`);
}
const spread = Math.max(...centres.map((c) => c.centre)) - Math.min(...centres.map((c) => c.centre));
if (spread > 2) {
  problems.push(`the panel pills on this screen do not share a centre - ${spread}px apart. One of them is in a flex row with another control that is taking the width unevenly. ${centres.map((c) => `${c.centre}px [${c.labels}]`).join('  vs  ')}`);
}

// ── 2. The pop-out paints over the page ──────────────────────────────────────
const RAIL = '[class*="fine-pointer:absolute"]';
const widthOf = () => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  return el ? Math.round(el.getBoundingClientRect().width) : null;
}, RAIL);
const before = await widthOf();
if (before === null) { await browser.close(); fail(2, 'the desktop rail was not found, so nothing here tested the overlay.'); }
const rail = await page.$(RAIL);
await rail.hover();
await page.waitForTimeout(800);

const out = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  const r = el.getBoundingClientRect();
  // 12px inside the expanded rail's right edge, below its own nav rows.
  const x = Math.round(r.left + r.width - 12);
  const y = Math.round(r.top + r.height * 0.55);
  const hit = document.elementFromPoint(x, y);
  return {
    width: Math.round(r.width), x, y,
    owner: hit ? (el.contains(hit) ? 'RAIL' : 'CONTENT') : 'NOTHING',
    hitTag: hit ? `${hit.tagName}.${String(hit.className).slice(0, 70)}` : null,
  };
}, RAIL);

console.log('--- rail pop-out stacking ---');
console.log(`  rail width ${before}px unhovered -> ${out.width}px hovered`);
console.log(`  point (${out.x},${out.y}) inside the expanded rail is painted by: ${out.owner}`);
console.log(`  top element there: ${out.hitTag}`);
await browser.close();

// The positive control, and it runs BEFORE the verdict on purpose: if the rail never expanded,
// "the rail is on top" would be a statement about a 72px strip nothing overlaps.
if (out.width <= before) {
  fail(2, `CONTROL FAILED: hovering did not widen the rail (${before}px -> ${out.width}px), so no overlay was exercised and neither answer would mean anything.`);
}
if (out.owner !== 'RAIL') {
  problems.push(`the expanded rail is painted BEHIND the page: the top element at (${out.x},${out.y}), well inside the pop-out, is ${out.hitTag}. Raising a z-index on the rail itself does NOT fix this - see this file's header.`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`  ${p}`);
  fail(1, `${problems.length} desktop chrome problem(s).`);
}
console.log(`
PASS - the pop-out paints over the page (${before}px -> ${out.width}px) and ${centres.length} panel pills share one centre.`);
