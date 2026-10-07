#!/usr/bin/env node
/**
 * check-narrow-overflow.mjs - TEXT CUT OFF at the narrowest phone this app supports (ask e1b0fffc).
 * IPHONEOS_DEPLOYMENT_TARGET is 15.0, which still runs the 320px-wide iPhone SE (1st gen), and no
 * gate here had read any route below 360. On /demo (no credentials), at 320x568, it reads every
 * main route and flags each visible text run whose CHARACTERS (a Range, not the element box - a
 * box check could not see the 320px spill on Debt's "Finish sooner" rows) end past the viewport
 * or past an ancestor that clips them.
 * Not flagged: text inside a container that scrolls sideways on purpose, deliberate ellipsis
 * truncation, aria-hidden text, and anything not painted.
 * A planted control runs first: a clipped nowrap string must be flagged, a wrapping one must not.
 * Each route is read until two reads agree; one that never settles exits 2.
 * EXITS: 0 pass . 1 a finding . 2 could not test.
 * It also flags two text runs whose characters OVERLAP (fixed/sticky chrome left out; planted control).
 * It also requires every bottom-nav label to be WHOLE (no ellipsis), since the sweep skips ellipsis text.
 * TEXT_SCALE=150 sets the root font to 150% (the measurable half of Dynamic Type).
 * VIEW_MODE=simple (needs SIGNED_IN=1) forces the Simple view by rewriting the profile read.
 * SIGNED_IN=1 reads the walk account instead of /demo; table writes are aborted, rpc passes.
 * Does NOT cover: vertical clipping, dialogs or menus, or whether a wrap looks right.
 */
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const WIDTH = Number(process.env.WIDTH || 320);
const ROUTES = ['/dashboard', '/budget', '/transactions', '/debt', '/forecast', '/goals', '/vehicles', '/net-worth', '/account'];
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };
let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'Could not load @playwright/test.'); }
try { await fetch(BASE, { redirect: 'manual' }); } catch (err) { fail(2, `${BASE} is not serving (${err.message}).`); }

// SIGNED_IN=1: the walk account (an @forgenta.test address, never a real user). Every table write,
// function and storage call is aborted in the browser; rpc calls pass (aborting them raises the
// offline banner, which would change the layout being measured).
const SIGNED_IN = process.env.SIGNED_IN === '1';
let session = null; let ref = null;
if (SIGNED_IN) {
  const { readFileSync } = await import('node:fs');
  const pick = (t, k) => (t.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
  let env; let creds;
  try { env = readFileSync('.env.local', 'utf8'); creds = readFileSync('.env.deck-walk.local', 'utf8'); }
  catch { fail(2, '.env.local or .env.deck-walk.local is missing.'); }
  const url = pick(env, 'VITE_SUPABASE_URL'); const anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
  const email = pick(creds, 'REACH_TEST_EMAIL'); const password = pick(creds, 'REACH_TEST_PASSWORD');
  if (!url || !anon || !email || !password) fail(2, 'missing supabase url/key or walk credentials.');
  if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to script a sign-in for "${email}".`);
  ref = new URL(url).hostname.split('.')[0];
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  session = await res.json().catch(() => ({}));
  if (!session.access_token) fail(2, `sign-in returned ${res.status}.`);
}
const browser = await chromium.launch();
const done = async (code, msg) => { await browser.close(); (code ? console.error : console.log)(msg); process.exit(code); };
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 568 }, deviceScaleFactor: 2 });
let blocked = 0;
if (SIGNED_IN) await ctx.route(/supabase\.co\/(rest|functions|storage)\//, (route) => {
  const m = route.request().method();
  const rpc = /\/rest\/v1\/rpc\//.test(route.request().url());
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS' || rpc) return route.continue();
  blocked += 1; return route.abort();
});
// TEXT_SCALE=150: the root font at 150%, the half of Dynamic Type a browser can measure (as check:text-scale).
const TEXT_SCALE = Number(process.env.TEXT_SCALE || 100);
if (TEXT_SCALE !== 100) await ctx.addInitScript((pct) => {
  const set = () => { document.documentElement.style.fontSize = `${pct}%`; };
  if (document.documentElement) set(); document.addEventListener('DOMContentLoaded', set);
}, TEXT_SCALE);
// VIEW_MODE=simple (with SIGNED_IN=1): rewrite the profile READ in the browser, as check:dark-contrast
// does. Nothing is written; the walk account's view_mode is unchanged.
if (process.env.VIEW_MODE) {
  if (!SIGNED_IN) fail(2, 'VIEW_MODE needs SIGNED_IN=1: /demo does not read the view from a profile row.');
  await ctx.route(/\/rest\/v1\/profiles/, async (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    try {
      const resp = await r.fetch(); let body = await resp.text();
      try { const j = JSON.parse(body); const set = (o) => ({ ...o, view_mode: process.env.VIEW_MODE }); body = JSON.stringify(Array.isArray(j) ? j.map(set) : set(j)); } catch { /* not JSON */ }
      return await r.fulfill({ response: resp, body });
    } catch { return r.abort().catch(() => {}); }
  });
  console.log(`view mode forced: ${process.env.VIEW_MODE}`);
}
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false })));
if (SIGNED_IN) await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [`sb-${ref}-auth-token`, session]);
else await page.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

// Runs in the page. Returns one line per text run that is cut off.
function findCut() {
  const vw = document.documentElement.clientWidth;
  const out = [];
  const scrollsX = (el) => {
    const s = getComputedStyle(el);
    return /(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1;
  };
  const clips = (el) => /(hidden|clip)/.test(getComputedStyle(el).overflowX);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest('[aria-hidden="true"], script, style, noscript, svg, .sr-only, #seo-landing, #boot-splash')) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || Number(st.opacity) === 0 || st.textOverflow === 'ellipsis') continue;
    const r = document.createRange(); r.selectNodeContents(n);
    const rects = [...r.getClientRects()].filter((q) => q.width > 0 && q.height > 0);
    if (!rects.length) continue;
    const right = Math.max(...rects.map((q) => q.right));
    const left = Math.min(...rects.map((q) => q.left));
    let limit = vw; let by = 'viewport'; let skip = false;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      if (scrollsX(a)) { skip = true; break; }
      const as = getComputedStyle(a);
      if (as.textOverflow === 'ellipsis') { skip = true; break; }
      if (clips(a)) {
        const b = a.getBoundingClientRect();
        if (b.width > 0 && b.right < limit) { limit = b.right; by = `${a.tagName.toLowerCase()}.${String(a.className).split(' ').slice(0, 2).join('.')}`; }
      }
    }
    if (skip || left >= vw) continue;
    if (right > limit + 1) out.push(`"${n.textContent.trim().slice(0, 50)}" ends at ${right.toFixed(0)}px, cut at ${limit.toFixed(0)} by ${by}`);
  }
  return [...new Set(out)];
}


// Runs in the page. Two text runs whose CHARACTERS overlap (the demo banner caption sat under the
// "Home" button at 320 and no box check saw it). A pair is compared only inside ONE layer: the same
// nearest fixed/sticky ancestor, or both unpinned. Content under the floating bar, or a sheet over
// the banner, is stacking by design, not two strings colliding.
function findOverlap() {
  const runs = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const pinned = (el) => { for (let a = el; a; a = a.parentElement) { const p = getComputedStyle(a).position; if (p === 'fixed' || p === 'sticky') return a; } return null; };
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest('[aria-hidden="true"], script, style, noscript, svg, .sr-only, #seo-landing, #boot-splash')) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    // Clip each box to every ancestor (itself included) that hides overflow: a truncated caption's
    // characters run on under its own clip, and a Range does not know that.
    let cl = -Infinity; let ct = -Infinity; let cr = Infinity; let cb = Infinity;
    for (let c = el; c && c !== document.body; c = c.parentElement) {
      if (/(hidden|clip)/.test(getComputedStyle(c).overflowX)) { const b = c.getBoundingClientRect(); cl = Math.max(cl, b.left); cr = Math.min(cr, b.right); ct = Math.max(ct, b.top); cb = Math.min(cb, b.bottom); }
    }
    const rects = [...r.getClientRects()].map((q) => ({ left: Math.max(q.left, cl), right: Math.min(q.right, cr), top: Math.max(q.top, ct), bottom: Math.min(q.bottom, cb) }))
      .filter((q) => q.right - q.left > 1 && q.bottom - q.top > 1 && q.bottom > 0 && q.top < innerHeight);
    if (rects.length) runs.push({ el, pin: pinned(el), t: n.textContent.trim().slice(0, 30), rects });
  }
  const out = [];
  for (let i = 0; i < runs.length; i += 1) for (let j = i + 1; j < runs.length; j += 1) {
    const A = runs[i]; const B = runs[j];
    if (A.el === B.el || A.pin !== B.pin) continue; // different layers (content under the bar, a sheet over the banner) stack by design
    const hit = A.rects.some((a) => B.rects.some((b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2));
    if (hit) out.push(`"${A.t}" overlaps "${B.t}"`);
  }
  return [...new Set(out)];
}

async function settledRead() {
  let prev = null;
  for (let i = 0; i < 8; i += 1) {
    for (let j = 0; j < 4 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay').count()); j += 1) {
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    }
    await page.waitForTimeout(1500);
    if (await page.locator('.skeleton-shimmer').count()) continue;
    const cur = [...await page.evaluate(findCut), ...await page.evaluate(findOverlap)];
    if (prev && JSON.stringify(prev) === JSON.stringify(cur)) return cur;
    prev = cur;
  }
  return null;
}

// Positive control: a clipped nowrap string must be flagged; a wrapping one must not.
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const mk = (txt, nowrap) => {
    const box = document.createElement('div');
    box.setAttribute('data-plantedcut', '1');
    box.style.cssText = 'position:fixed;top:0;left:0;width:200px;overflow:hidden;z-index:99999;background:#000;color:#fff';
    const t = document.createElement('span'); t.textContent = txt;
    if (nowrap) t.style.whiteSpace = 'nowrap';
    box.appendChild(t); document.body.appendChild(box); return box;
  };
  const a = mk('PLANTEDCUT this string is far too long to fit in two hundred pixels', true);
  const b = mk('PLANTEDWRAP this string wraps onto several lines inside its box', false);
  return [a, b].length;
});
const ctl = await page.evaluate(findCut);
const cutSeen = ctl.some((l) => l.includes('PLANTEDCUT'));
const wrapSeen = ctl.some((l) => l.includes('PLANTEDWRAP'));
if (!cutSeen || wrapSeen) await done(2, `CONTROL FAILED: planted cut seen=${cutSeen}, planted wrap seen=${wrapSeen} (want true/false).`);
console.log('control: planted cut flagged, planted wrap not flagged');
await page.evaluate(() => {
  document.querySelectorAll('[data-plantedcut]').forEach((b) => b.remove());
  const box = document.createElement('div'); box.setAttribute('data-planted', '1');
  box.style.cssText = 'position:fixed;top:300px;left:0;z-index:99999;background:#000;color:#fff';
  const x = document.createElement('span'); x.textContent = 'PLANTEDLAPA';
  const y = document.createElement('span'); y.textContent = 'PLANTEDLAPB'; y.style.cssText = 'position:absolute;left:10px;top:0';
  box.append(x, y); document.body.appendChild(box);
});
const lap = await page.evaluate(findOverlap);
if (!lap.some((l) => l.includes('PLANTEDLAPA') && l.includes('PLANTEDLAPB'))) await done(2, 'CONTROL FAILED: planted overlapping text was not flagged.');
const lapPlanted = lap.filter((l) => l.includes('PLANTEDLAPA') && !l.includes('PLANTEDLAPB'));
if (lapPlanted.length) await done(2, `CONTROL FAILED: PLANTEDLAPA overlaps app text: ${lapPlanted[0]}`);
console.log('control: planted overlap flagged');
await page.evaluate(() => document.querySelectorAll('[data-planted]').forEach((b) => b.remove()));

mkdirSync('test-results/narrow-overflow', { recursive: true });
let findings = 0; let unstable = 0;
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  if (new URL(page.url()).pathname.startsWith('/auth')) await done(2, `${route} bounced to /auth: ${SIGNED_IN ? 'the walk session' : 'demo mode'} did not hold.`);
  const cut = await settledRead();
  if (cut === null) { unstable += 1; console.log(`${route}: UNSTABLE`); continue; }
  console.log(`${route}: ${cut.length} cut`);
  for (const l of cut) console.log(`   ${l}`);
  findings += cut.length;
  await page.screenshot({ path: `test-results/narrow-overflow/${route.slice(1)}-${WIDTH}${SIGNED_IN ? '-signed-in' : ''}.png`, fullPage: true });
}
if (unstable) await done(2, `${unstable} route(s) never settled.`);
// Bottom-nav labels: the sweep above skips ellipsis text, so a truncated "Tran…" passes it. A nav
// label must be whole (Tre 2026-08-27: one name, "Transactions", at every width).
const navCut = await page.evaluate(() => [...document.querySelectorAll('nav a')]
  .filter((a) => a.getBoundingClientRect().width > 0)
  .flatMap((a) => [...a.querySelectorAll('span')].filter((s) => s.getBoundingClientRect().width > 0 && !s.children.length && s.textContent.trim().length > 1)
    .map((s) => ({ t: s.textContent.trim(), cut: s.scrollWidth > s.clientWidth + 1, need: s.scrollWidth, have: s.clientWidth }))));
if (!navCut.length) await done(2, 'CONTROL FAILED: found no bottom-nav labels to measure.');
const navBad = navCut.filter((n) => n.cut);
console.log(`nav labels: ${navCut.map((n) => n.t + (n.cut ? ` (CUT ${n.need}>${n.have}px)` : '')).join(', ')}`);
findings += navBad.length;
// Adjacent labels need daylight between them: at 320 with 150% text they touched ("HomeTransactions").
const navGap = await page.evaluate(() => {
  const r = [...document.querySelectorAll('nav a span[data-text-scale-exempt], nav a span.truncate')]
    .map((s) => { const g = document.createRange(); g.selectNodeContents(s); const q = [...g.getClientRects()][0]; return q && q.width > 0 ? q : null; })
    .filter(Boolean).sort((a, b) => a.left - b.left);
  let min = Infinity; for (let i = 1; i < r.length; i += 1) min = Math.min(min, r[i].left - r[i - 1].right);
  return { n: r.length, min: Math.round(min * 10) / 10 };
});
console.log(`nav label gaps: ${navGap.n} labels, smallest gap ${navGap.min}px`);
if (navGap.n < 2) await done(2, 'CONTROL FAILED: fewer than 2 nav labels to measure gaps between.');
if (navGap.min < 4) { findings += 1; console.log(`   FINDING: two nav labels sit ${navGap.min}px apart (need >= 4)`); }
if (SIGNED_IN) console.log(`signed in (walk account); ${blocked} write(s) aborted in-browser`);
await done(findings ? 1 : 0, findings ? `FAIL: ${findings} cut text run(s) at ${WIDTH}px.` : `PASS: 0 cut text runs on ${ROUTES.length} routes at ${WIDTH}px${TEXT_SCALE !== 100 ? `, text ${TEXT_SCALE}%` : ''}.`);
