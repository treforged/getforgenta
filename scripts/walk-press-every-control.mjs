#!/usr/bin/env node
/**
 * walk-press-every-control.mjs - visit every route at 390px, enumerate every visible control, press
 * each one in a FRESH page, and require that the press CHANGED something.
 *
 * WHY. The charter's full walk says "press every button", and until 2026-09-23 no instrument here did.
 * walk:routes proves a route RENDERS; check:account, check:nav and the undo walks press the controls
 * somebody thought to name. A control nobody named could throw nothing and do nothing for ever - the
 * forged-glass dead-tab shape - and every gate would stay green.
 *
 * WHAT COUNTS AS A CHANGE (any one): the URL moved; the number of open dialogs moved; the page's
 * visible text changed; the pressed control's own aria-expanded / -pressed / -selected / -checked
 * moved; a popup or download opened. Text is only trusted on a route whose text is STILL when nobody
 * presses anything (read twice first): on a route with a ticking clock or animation, text is ignored
 * and the other signals decide, and that route is printed as text-unstable.
 *
 * WHAT IS NEVER PRESSED, and is COUNTED rather than hidden:
 *   destructive - delete, remove, sign out, cancel a subscription, disconnect, reset ...
 *   write       - labels that commit data (save, confirm, import, mark paid ...), and every control
 *                 whose ROLE persists on press (switch, checkbox, radio). This is the walk
 *                 account, but three other walks depend on its fixture, and a crawler that spends
 *                 their fixture turns a green suite red for a reason unrelated to any defect.
 *   external    - links off this origin, mailto:, tel:.
 * Shared chrome (the bottom bar, the header) repeats on every route, so each control is pressed ONCE,
 * keyed by role + name + href, at the first route that shows it.
 *
 * POSITIVE CONTROLS, run before the crawl on a fresh /dashboard, and the crawl does not start unless
 * both classify correctly: a PLANTED DEAD button must come back no-change, and a PLANTED LIVE button
 * (it rewrites its own label) must come back changed. Without the first, a crawler that calls every
 * press "changed" reports a perfect app; without the second, one that calls every press "no-change"
 * reports a broken one.
 *
 * WHAT IT DOES NOT COVER: controls that appear only after an interaction (inside a dialog, a menu, a
 * second step) - it presses the top layer of each route only; whether a change is the RIGHT change;
 * param routes; desktop widths. A no-change is a CANDIDATE: a link to the page you are already on, or
 * a copy-to-clipboard button, legitimately changes nothing visible. Each one is saved as a frame.
 *
 * USAGE:  node scripts/walk-press-every-control.mjs [out-dir]   (dev server on :8080, .env.deck-walk.local)
 * EXITS:  0 every pressed control changed something . 1 at least one no-change . 2 could not test
 */
import { readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:8080';
const OUT = process.argv[2] || 'press-walk-frames';
const SETTLE_MS = 2500;
const AFTER_PRESS_MS = 1200;
const WORKERS = Number(process.env.PRESS_WORKERS) || 2; // 4 starved the dev server: 50 controls not-found at 4, 0 of 25 on /dashboard at 1 (2026-09-23)
/** Debug aid: PRESS_ONLY=/dashboard crawls one route. Printed, so a partial run cannot pass for a full one. */
const ONLY = process.env.PRESS_ONLY || null;
const fail = (code, msg) => { console.error(`FAIL(${code}): ${msg}`); process.exit(code); };

const DESTRUCTIVE = /\b(delete|remove|sign ?out|log ?out|cancel (my )?(subscription|plan|premium)|disconnect|unlink|reset|erase|deactivate|close (my )?account|revoke|clear all)\b/i;
const WRITE = /^(save|confirm|submit|apply|import|mark|pay|ignore|accept|approve|add to my ledger|record|create|send|upload|restore|undo)\b/i;

// -- Routes, derived from the router (same matcher as walk-every-route.mjs) ------------------------
const app = readFileSync('src/App.tsx', 'utf8');
const declared = [];
const re = /<Route\s+path="([^"]+)"([\s\S]*?)(?=<Route\s|<\/Routes>)/g;
let m;
while ((m = re.exec(app)) !== null) declared.push({ path: m[1], redirect: /<Navigate\s+to="([^"]+)"/.exec(m[2])?.[1] ?? null });
if (declared.length === 0) fail(2, 'parsed 0 routes out of src/App.tsx - the matcher is broken, not the app.');
// `/demo` is skipped because VISITING it switches the whole browser context into demo mode, so every
// route crawled after it was the demo surface, not the walk account: 25 of the first run's 65
// not-found controls were that leak (2026-09-23). The demo has its own capture script.
const SKIP_ROUTE = new Set(['*', '/oauth', '/akoya-oauth', '/auth-callback', '/__error-test', '/onboarding', '/auth', '/demo']);
const routes = declared
  .filter((r) => !SKIP_ROUTE.has(r.path) && !r.path.includes(':') && !r.redirect)
  .map((r) => r.path)
  .filter((p) => !ONLY || p === ONLY);
if (ONLY) console.log(`PARTIAL RUN: only ${ONLY}`);
if (routes.length === 0) fail(2, `no route to crawl${ONLY ? ` - PRESS_ONLY=${ONLY} matches no declared route (Git Bash rewrites a leading slash; set MSYS_NO_PATHCONV=1)` : ''}.`);
if (!ONLY && !routes.includes('/dashboard')) fail(2, `derived routes ${JSON.stringify(routes)} lack /dashboard - the matcher is broken, not the app.`);

// -- Sign in (walk account only) --------------------------------------------------------------------
const env = readFileSync('.env.local', 'utf8');
let creds;
try { creds = readFileSync('.env.deck-walk.local', 'utf8'); }
catch { fail(2, '.env.deck-walk.local is missing - see scripts/seed-walk-account.sql.'); }
const pick = (s, k) => (s.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const url = pick(env, 'VITE_SUPABASE_URL');
const anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
const email = pick(creds, 'REACH_TEST_EMAIL');
const password = pick(creds, 'REACH_TEST_PASSWORD');
if (!url || !anon) fail(2, 'VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing from .env.local.');
if (!email || !password) fail(2, '.env.deck-walk.local carries no email/password.');
// THE GUARD: `.test` is an IANA-reserved TLD, so this can never be a real person's money.
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to script a sign-in for "${email}" - @forgenta.test accounts only.`);
const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}`);
console.log(`signed in as ${session.user.email}`);

let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { const ping = await fetch(BASE, { redirect: 'manual' }); if (ping.status >= 500) fail(2, `${BASE} answered ${ping.status}.`); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}).`); }

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addInitScript(([k, s]) => { try { localStorage.setItem(k, s); } catch { /* opaque origin */ } }, [`sb-${ref}-auth-token`, JSON.stringify(session)]);

// Dismiss the consent banner once; the choice persists for the context.
{
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(SETTLE_MS);
  try {
    const reject = p.getByRole('button', { name: /reject non-essential/i }).filter({ visible: true });
    if (await reject.count()) { await reject.first().click({ timeout: 5000 }); await p.waitForTimeout(600); }
  } catch { console.log('note: could not dismiss the consent banner; continuing.'); }
  await p.close();
}
/**
 * ⚠️ EVERY ENUMERATION AND EVERY PRESS GETS ITS OWN CONTEXT, cloned from this baseline. The app
 * saves UI state (which Dashboard tab is open, which Account section) in local storage, so with one
 * shared context a press on one page changed what the NEXT "fresh" page opened on - and 53 controls
 * came back not-found because they were enumerated in one state and looked for in another.
 */
const BASELINE = await ctx.storageState();
/**
 * ⚠️ THE WRITE GUARD. Labels and roles cannot find every control that persists: the deduction $/%
 * buttons, the deck's category chips and a ToggleSwitch all write, and none of them says "save".
 * 2026-09-23 the crawler flipped the walk account's Discover It "pay in full" switch that way. So
 * every non-read request to the Supabase data plane (rest, functions, storage) is ABORTED in the
 * crawler's browser. Auth (token refresh) is allowed. A press that tried to write is reported as
 * write-blocked; it is not pressed "for real" and it is not counted as changed.
 */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/**
 * PostgREST calls EVERY rpc with POST, reads included, so blocking by method alone starved pages of
 * data: the first guarded run enumerated 249 controls against 315 and pressed 75 against 147, and
 * still printed PASS. A function declared STABLE or IMMUTABLE cannot write, so those are let
 * through. The set is DERIVED from supabase/migrations (the last definition of a name wins), and
 * the volatility word is read only OUTSIDE the dollar-quoted body, so a comment cannot flip it.
 */
function readOnlyRpcs() {
  const out = new Map();
  const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = readFileSync(join('supabase/migrations', f), 'utf8');
    const head = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi;
    let h;
    while ((h = head.exec(sql)) !== null) {
      const open = /\$(\w*)\$/.exec(sql.slice(h.index));
      if (!open) continue;
      const bodyStart = h.index + open.index;
      const closeAt = sql.indexOf(open[0], bodyStart + open[0].length);
      if (closeAt < 0) continue;
      const tailEnd = sql.indexOf(';', closeAt);
      const outside = sql.slice(h.index, bodyStart) + sql.slice(closeAt + open[0].length, tailEnd < 0 ? undefined : tailEnd);
      out.set(h[1].toLowerCase(), /\b(stable|immutable)\b/i.test(outside));
    }
  }
  return new Set([...out].filter(([, ro]) => ro).map(([n]) => n));
}
const READ_ONLY_RPC = readOnlyRpcs();
// Controls on the parse, both directions, from functions whose volatility was read from pg_proc.
if (!READ_ONLY_RPC.has('leaderboard_global_stats') || !READ_ONLY_RPC.has('follow_profiles')) fail(2, 'CONTROL FAILED - the migration parse missed a function pg_proc says is STABLE.');
if (READ_ONLY_RPC.has('claim_milestone_achievements')) fail(2, 'CONTROL FAILED - the migration parse let through a function pg_proc says is VOLATILE.');
console.log(`read-only rpcs let through: ${READ_ONLY_RPC.size}`);
const DATA_PLANE = new RegExp(`^https://${ref}\\.supabase\\.co/(rest|functions|storage)/v1/`);
async function isolatedPage() {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, storageState: BASELINE });
  const page = await c.newPage();
  page.blockedWrites = [];
  await page.route(DATA_PLANE, (r) => {
    const req = r.request();
    if (READ_METHODS.has(req.method())) return r.continue();
    const rpc = /\/rest\/v1\/rpc\/(\w+)/.exec(new URL(req.url()).pathname);
    if (rpc && READ_ONLY_RPC.has(rpc[1].toLowerCase())) return r.continue();
    page.blockedWrites.push(`${req.method()} ${new URL(req.url()).pathname.replace(/^\/(rest|functions|storage)\/v1\//, '')}`);
    return r.abort('blockedbyclient');
  });
  page.once('close', () => { c.close().catch(() => { /* already gone with the browser */ }); });
  return page;
}

// -- Enumeration and state, run inside the page -----------------------------------------------------
const SELECTOR = 'button, a[href], [role="button"], [role="tab"]';

/** Visible, enabled controls in DOM order, each with a key that survives a reload. */
async function enumerate(page) {
  return page.evaluate((sel) => {
    const out = [];
    const seen = new Map();
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      const role = el.getAttribute('role') || (el.tagName === 'A' ? 'link' : 'button');
      const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const href = el.tagName === 'A' ? el.getAttribute('href') : null;
      const base = `${role}|${name}|${href ?? ''}`;
      const nth = seen.get(base) ?? 0;
      seen.set(base, nth + 1);
      const active = ['aria-selected', 'aria-pressed', 'aria-checked'].some((a) => el.getAttribute(a) === 'true')
        || el.getAttribute('aria-current') === 'page' || el.getAttribute('data-state') === 'active';
      let self = false;
      if (href) { try { const u = new URL(href, location.href); self = u.origin === location.origin && u.pathname + u.search === location.pathname + location.search; } catch { /* unparseable href */ } }
      out.push({ role, name, href, nth, key: base, active, self });
    }
    return out;
  }, SELECTOR);
}

/** Tag the nth control with this key so Playwright can press exactly it. */
async function mark(page, c) {
  return page.evaluate(([sel, c]) => {
    let n = 0;
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      const role = el.getAttribute('role') || (el.tagName === 'A' ? 'link' : 'button');
      const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const href = el.tagName === 'A' ? el.getAttribute('href') : null;
      if (`${role}|${name}|${href ?? ''}` !== c.key) continue;
      if (n++ === c.nth) { el.setAttribute('data-press-target', '1'); return true; }
    }
    return false;
  }, [SELECTOR, c]);
}

async function state(page) {
  return page.evaluate(() => {
    const t = document.querySelector('[data-press-target]');
    const aria = t ? ['aria-expanded', 'aria-pressed', 'aria-selected', 'aria-checked'].map((a) => t.getAttribute(a)).join(',') : 'gone';
    return {
      url: location.pathname + location.search + location.hash,
      dialogs: document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]').length,
      text: document.body.innerText,
      aria,
      targetText: t ? t.innerText : null,
    };
  });
}

function diff(a, b, textTrusted) {
  const why = [];
  if (a.url !== b.url) why.push(`url ${a.url} -> ${b.url}`);
  if (a.dialogs !== b.dialogs) why.push(`dialogs ${a.dialogs} -> ${b.dialogs}`);
  if (a.aria !== b.aria) why.push(`aria ${a.aria} -> ${b.aria}`);
  if (textTrusted && a.text !== b.text) why.push('text');
  if (!textTrusted && a.targetText !== b.targetText) why.push('own label');
  return why;
}

/** Open a fresh page at `route`, optionally plant a control, and press `c`. */
async function pressFresh(route, c, textTrusted, plant, plantWith) {
  const page = await isolatedPage();
  let popup = false;
  page.on('popup', () => { popup = true; });
  page.on('download', () => { popup = true; });
  try {
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(SETTLE_MS);
    if (plantWith) await plantWith(page);
    else if (plant) await page.evaluate(plant);
    // Poll: a fresh page under parallel load can take longer than SETTLE_MS to render its data-backed
    // controls, and a single look reported 65 of them missing on the first run (2026-09-23).
    let found = false;
    for (let i = 0; i < 8 && !found; i++) { found = await mark(page, c); if (!found) await page.waitForTimeout(750); }
    if (!found) {
      const nf = join(OUT, `NOTFOUND_${route.replace(/\W+/g, '_')}__${c.name.replace(/\W+/g, '_').slice(0, 40)}_${c.nth}.png`);
      await page.screenshot({ path: nf });
      return { outcome: 'not-found', frame: nf, why: `landed ${new URL(page.url()).pathname}` };
    }
    const before = await state(page);
    const writesBefore = page.blockedWrites.length;
    for (const w of page.blockedWrites) { loadBlocked.add(w); AMBIENT.add(w); }
    try {
      await page.locator('[data-press-target]').first().click({ timeout: 4000 });
    } catch (e) {
      return { outcome: 'unpressable', why: String(e.message).split('\n')[0].slice(0, 140) };
    }
    await page.waitForTimeout(AFTER_PRESS_MS);
    const after = await state(page);
    // Only a write the app does NOT make on its own is the press's. The app PATCHes
    // leaderboard_snapshots on load, and that can land inside any press window (it turned the
    // planted DEAD control into write-blocked once, 2026-09-23). AMBIENT is derived, not named.
    const attempted = page.blockedWrites.slice(writesBefore).filter((w) => !AMBIENT.has(w));
    if (attempted.length) return { outcome: 'write-blocked', why: [...new Set(attempted)].join(', ') };
    const why = diff(before, after, textTrusted);
    if (popup) why.push('popup/download');
    if (why.length) return { outcome: 'changed', why: why.join('; ') };
    const file = join(OUT, `${route.replace(/\W+/g, '_')}__${c.name.replace(/\W+/g, '_').slice(0, 40)}_${c.nth}.png`);
    await page.screenshot({ path: file });
    return { outcome: 'no-change', frame: file };
  } finally {
    await page.close();
  }
}

// -- Positive controls ------------------------------------------------------------------------------
const PLANT = () => {
  const host = document.querySelector('main') || document.body;
  const dead = document.createElement('button');
  dead.textContent = 'ZZ planted dead';
  dead.style.cssText = 'display:block;width:200px;height:40px';
  const live = document.createElement('button');
  live.textContent = 'ZZ planted live';
  live.style.cssText = 'display:block;width:200px;height:40px';
  live.addEventListener('click', () => { live.textContent = 'ZZ planted live pressed'; });
  host.prepend(live);
  host.prepend(dead);
};
// A planted control that WRITES must come back write-blocked, or the guard is not in the path.
const loadBlocked = new Set();
/** Writes the app makes with nobody pressing anything: a calibration page, plus every pre-press write seen. */
const AMBIENT = new Set();
{
  const cal = await isolatedPage();
  await cal.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await cal.waitForTimeout(SETTLE_MS + 4 * AFTER_PRESS_MS);
  for (const w of cal.blockedWrites) AMBIENT.add(w);
  await cal.close();
}
console.log(`ambient writes (made with no press, never attributed to one): ${AMBIENT.size ? [...AMBIENT].join(', ') : 'none'}`);
const PLANT_WRITE = (dataUrl) => {
  const b = document.createElement('button');
  b.textContent = 'ZZ planted write';
  b.style.cssText = 'display:block;width:200px;height:40px';
  b.addEventListener('click', () => { fetch(dataUrl, { method: 'PATCH', body: '{}' }).catch(() => { /* aborted by the guard */ }); });
  (document.querySelector('main') || document.body).prepend(b);
};
const writeProbeUrl = `https://${ref}.supabase.co/rest/v1/zz_write_guard_probe`;
const deadResult = await pressFresh('/dashboard', { key: 'button|ZZ planted dead|', nth: 0, name: 'ZZ planted dead' }, false, PLANT);
const liveResult = await pressFresh('/dashboard', { key: 'button|ZZ planted live|', nth: 0, name: 'ZZ planted live' }, false, PLANT);
const writeResult = await pressFresh('/dashboard', { key: 'button|ZZ planted write|', nth: 0, name: 'ZZ planted write' }, false,
  () => {}, (page) => page.evaluate(PLANT_WRITE, writeProbeUrl));
console.log(`control: planted dead -> ${deadResult.outcome}; planted live -> ${liveResult.outcome}; planted write -> ${writeResult.outcome}`);
for (const [n, r] of [['dead', deadResult], ['live', liveResult], ['write', writeResult]]) if (r.why) console.log(`  control ${n}: ${r.why}`);
if (deadResult.outcome !== 'no-change' || liveResult.outcome !== 'changed' || writeResult.outcome !== 'write-blocked') {
  await browser.close();
  fail(2, 'CONTROL FAILED - the crawler cannot tell a dead control from a live one, so every verdict below would be meaningless.');
}

// -- Crawl ------------------------------------------------------------------------------------------
const tally = { 'already-active': 0, 'self-link': 0, enumerated: 0, pressed: 0, changed: 0, 'no-change': 0, unpressable: 0, 'not-found': 0, 'write-blocked': 0, destructive: 0, write: 0, external: 0, repeat: 0 };
const findings = [];
const unstable = [];
const pressedKeys = new Set();
const jobs = [];

for (const route of routes) {
  const page = await isolatedPage();
  await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(SETTLE_MS);
  const t1 = await page.evaluate(() => document.body.innerText);
  const controls = await enumerate(page);
  await page.waitForTimeout(AFTER_PRESS_MS);
  const t2 = await page.evaluate(() => document.body.innerText);
  const landedUrl = new URL(page.url());
  const landed = landedUrl.pathname;
  // Press from the DECLARED route, not the landed URL: /accounts, /budget and /goals redirect
  // client-side and carry the chosen tab in router STATE, so the landed URL reopens the default tab
  // (46 not-found, 2026-09-23). Re-entering by the declared route replays the redirect exactly.
  const pressFrom = route;
  await page.close();
  if (landed !== route) { console.log(`  ${route.padEnd(22)} lands on ${landed}; its controls are pressed from there`); }
  const textTrusted = t1 === t2;
  if (!textTrusted) unstable.push(route);
  tally.enumerated += controls.length;
  for (const c of controls) {
    const globalKey = `${c.key}#${c.nth}`;
    if (DESTRUCTIVE.test(c.name)) { tally.destructive++; continue; }
    if (WRITE.test(c.name)) { tally.write++; continue; }
    // A switch or checkbox PERSISTS on press (ToggleSwitch -> updateAccount.mutate), whatever its label
    // says. 2026-09-23 the crawler flipped the walk account's "Always pay Discover It in full" and
    // called it no-change only because the refetch landed after AFTER_PRESS_MS. Judged by ROLE.
    if (/^(switch|checkbox|radio|menuitemcheckbox)$/.test(c.role)) { tally.write++; continue; }
    if (c.href && (/^(mailto:|tel:)/.test(c.href) || (/^https?:/.test(c.href) && !c.href.startsWith(BASE)))) { tally.external++; continue; }
    // Pressing the tab you are on, or a link to the page you are on, changes nothing BY DESIGN.
    // Counted, never pressed - on the first run they were 8 of the 11 "no-change" findings.
    if (c.active) { tally['already-active']++; continue; }
    if (c.self) { tally['self-link']++; continue; }
    if (pressedKeys.has(globalKey)) { tally.repeat++; continue; }
    pressedKeys.add(globalKey);
    jobs.push({ route, from: pressFrom, c, textTrusted });
  }
}
console.log(`routes ${routes.length} . controls enumerated ${tally.enumerated} . to press ${jobs.length}`);

let next = 0;
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++];
    const r = await pressFresh(j.from, j.c, j.textTrusted);
    tally[r.outcome]++;
    if (r.outcome === 'changed' || r.outcome === 'no-change') tally.pressed++;
    if (r.outcome !== 'changed') findings.push({ route: j.route, name: j.c.name || '(no name)', role: j.c.role, ...r });
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
await browser.close();

// -- Report -----------------------------------------------------------------------------------------
for (const f of findings.sort((a, b) => a.outcome.localeCompare(b.outcome) || a.route.localeCompare(b.route))) {
  console.log(`  ${f.outcome.padEnd(11)} ${f.route.padEnd(18)} ${f.role.padEnd(6)} "${f.name}"${f.frame ? `  frame ${f.frame}` : ''}${f.why ? `  (${f.why})` : ''}`);
}
if (unstable.length) console.log(`text-unstable routes (text ignored, other signals decide): ${unstable.join(', ')}`);
console.log(`enumerated ${tally.enumerated} . pressed ${tally.pressed} . changed ${tally.changed} . no-change ${tally['no-change']} . unpressable ${tally.unpressable} . not-found ${tally['not-found']}`);
console.log(`write-blocked ${tally['write-blocked']} (pressed; its write was aborted, so nothing persisted). Blocked during page LOAD, before any press: ${loadBlocked.size ? [...loadBlocked].join(', ') : 'none'}`);
console.log(`skipped: destructive ${tally.destructive} . write ${tally.write} . external ${tally.external} . repeat-chrome ${tally.repeat} . already-active ${tally['already-active']} . self-link ${tally['self-link']}`);
if (tally.pressed === 0) fail(2, 'pressed 0 controls - nothing was tested.');
if (tally['no-change'] > 0) { console.log(`FINDINGS: ${tally['no-change']} pressed control(s) changed nothing. Each has a frame in ${OUT}.`); process.exit(1); }
console.log('PASS - every pressed control changed something.');
