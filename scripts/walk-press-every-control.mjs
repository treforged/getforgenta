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
/**
 * ⚠️ TWO EQUAL COUNTS ARE NOT A SETTLED PAGE. Supabase REST calls after an idle gap stall 4-6 s on
 * this project (cb1d9ada), so /dashboard read 7 controls twice in a row with 12 requests still in
 * flight, and 25 once they landed (/goals 7 -> 23 with 19 in flight). That is the ~6% run-to-run
 * swing in `enumerated` (348 vs 370): which routes caught a cold backend. Measured 2026-09-24:
 * count-agreement alone 336, after a quiet network 370, and 8 s later still 370.
 * So wait until no Supabase request has been in flight for 1.5 s (cap 20 s). False = never quiet.
 */
async function quietNetwork(page, quietMs = 1500, capMs = 20000) {
  let quiet = 0;
  for (let waited = 0; waited < capMs; waited += 250) {
    await page.waitForTimeout(250);
    quiet = page.inflight.size ? 0 : quiet + 250;
    if (quiet >= quietMs) return true;
  }
  return false;
}
/**
 * ⚠️ THE STUB PHASE (Sam, 2026-09-24). A write-blocked press proves only that a write was TRIED -
 * never that the user sees its result. So each write-blocked control is pressed twice more, with
 * the write ANSWERED instead of aborted: 'ok' echoes the request as a 200, 'err' returns a 500.
 * `route.fulfill` answers inside this browser, so the request never leaves the machine and no real
 * row - the walk account's or anyone's - is touched. Only REST (tables + rpc) is stubbed; functions
 * (checkout, Plaid) and storage stay aborted, because a fake 200 there would drive an external flow.
 * The 'err' arm exists because a control that always shows success passes the 'ok' arm.
 */
const STUBBABLE = new RegExp(`^https://${ref}\\.supabase\\.co/rest/v1/`);
function stubBody(req, stub) {
  if (stub === 'err') return { status: 500, json: { code: 'XX000', message: 'walk stub: simulated failure', details: null, hint: null } };
  const u = new URL(req.url());
  if (u.pathname.includes('/rpc/')) return { status: 200, json: [] };
  let body = null;
  try { body = req.postDataJSON(); } catch { body = null; }
  const id = /^eq\.(.+)$/.exec(u.searchParams.get('id') ?? '')?.[1];
  const row = { ...(body && typeof body === 'object' && !Array.isArray(body) ? body : {}), ...(id ? { id } : {}) };
  const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
  return { status: req.method() === 'POST' ? 201 : 200, json: single ? row : [row] };
}
async function isolatedPage(stub = null) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, storageState: BASELINE });
  const page = await c.newPage();
  page.blockedWrites = [];
  page.stubbedWrites = [];
  page.restWrites = new Set(); // which blocked writes were REST (tables/rpc), so the stub phase can pick them
  // In-flight Supabase requests, so enumeration can wait for the DATA rather than for a count that
  // happens to repeat (see quietNetwork).
  page.inflight = new Set();
  page.on('request', (r) => { if (r.url().includes('.supabase.co/')) page.inflight.add(r); });
  const settleReq = (r) => page.inflight.delete(r);
  page.on('requestfinished', settleReq); page.on('requestfailed', settleReq);
  await page.route(DATA_PLANE, (r) => {
    const req = r.request();
    if (READ_METHODS.has(req.method())) return r.continue();
    const rpc = /\/rest\/v1\/rpc\/(\w+)/.exec(new URL(req.url()).pathname);
    if (rpc && READ_ONLY_RPC.has(rpc[1].toLowerCase())) return r.continue();
    const key = `${req.method()} ${new URL(req.url()).pathname.replace(/^\/(rest|functions|storage)\/v1\//, '')}`;
    // An AMBIENT write (made on load, pressed or not) stays aborted even here: failed on 'err', it
    // could raise an error toast of its own and be credited to the press.
    if (stub && STUBBABLE.test(req.url()) && !AMBIENT.has(key)) {
      page.stubbedWrites.push(key);
      return r.fulfill(stubBody(req, stub));
    }
    if (STUBBABLE.test(req.url())) page.restWrites.add(key);
    page.blockedWrites.push(key);
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
      // React often REUSES the pressed <button> node and swaps its children (a pencil becomes an X when an
      // inline editor opens), so neither 'gone' nor its text moves. Its markup and the visible field count do.
      targetHtml: t ? t.innerHTML : null,
      fields: [...document.querySelectorAll('input, select, textarea')].filter((e) => e.getBoundingClientRect().width > 0).length,
      // A toast IS what the user sees after a save (useAccounts: 'Account updated'), and it counts even
      // on routes whose body text is too unstable to diff.
      toasts: document.querySelectorAll('[data-sonner-toast]').length,
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
  if (a.targetHtml !== b.targetHtml) why.push('own content');
  if (a.fields !== b.fields) why.push(`fields ${a.fields} -> ${b.fields}`);
  if (a.toasts !== b.toasts) why.push(`toasts ${a.toasts} -> ${b.toasts}`);
  return why;
}

/** Open a fresh page at `route`, optionally plant a control, and press `c`. */
/** Visible failure feedback: error toasts, alerts, and failure wording in the page. */
async function failureSignals(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 0;
    const toasts = [...document.querySelectorAll('[data-sonner-toast][data-type="error"], [role="alert"]')].filter(vis).length;
    const words = (document.body.innerText.match(/\b(failed|error|couldn.t|could not|try again|went wrong|not saved)\b/gi) ?? []).length;
    return { toasts, words };
  });
}

async function pressFresh(route, c, textTrusted, plant, plantWith, stub = null) {
  const page = await isolatedPage(stub);
  let popup = false;
  page.on('popup', () => { popup = true; });
  page.on('download', () => { popup = true; });
  try {
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(SETTLE_MS);
    // Same cold-backend stall as enumeration: look for the control only once its data has landed.
    await quietNetwork(page);
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
    const failBefore = stub ? await failureSignals(page) : null;
    // Record every toast/alert that APPEARS after the press. Sampling once at the end missed them:
    // the stub wait can outlast a Sonner toast's ~4 s life, so a real "Account updated" read as
    // no change on one run and a change on the next (Activate Alliant Checking, 2026-09-24).
    if (stub) {
      await page.evaluate(() => {
        window.__zzSeen = [];
        new MutationObserver((muts) => {
          for (const m of muts) for (const n of m.addedNodes) {
            if (!(n instanceof Element)) continue;
            for (const e of [n, ...n.querySelectorAll('[data-sonner-toast], [role="alert"]')]) {
              if (e.matches('[data-sonner-toast], [role="alert"]')) window.__zzSeen.push({ type: e.getAttribute('data-type') || e.getAttribute('role'), text: e.textContent });
            }
          }
        }).observe(document.body, { childList: true, subtree: true });
      });
    }
    const stubbedBefore = page.stubbedWrites.length;
    const writesBefore = page.blockedWrites.length;
    for (const w of page.blockedWrites) { loadBlocked.add(w); AMBIENT.add(w); }
    try {
      await page.locator('[data-press-target]').first().click({ timeout: 4000 });
    } catch (e) {
      return { outcome: 'unpressable', why: String(e.message).split('\n')[0].slice(0, 140) };
    }
    await page.waitForTimeout(AFTER_PRESS_MS);
    if (stub) {
      // Wait for the answered write to be handled, then judge what the USER sees.
      await quietNetwork(page, 1000, 8000);
      await page.waitForTimeout(AFTER_PRESS_MS);
      const stubbed = [...new Set(page.stubbedWrites.slice(stubbedBefore))];
      if (!stubbed.length) return { outcome: 'stub-no-write', why: 'the press made no stubbable write this time' };
      const after = await state(page);
      const failAfter = await failureSignals(page);
      const seen = await page.evaluate(() => window.__zzSeen ?? []);
      const failWord = /\b(failed|error|couldn.t|could not|try again|went wrong|not saved)\b/i;
      const failureShown = failAfter.toasts > failBefore.toasts || failAfter.words > failBefore.words
        || seen.some((t) => t.type === 'error' || t.type === 'alert' || failWord.test(t.text));
      const why = diff(before, after, textTrusted);
      if (seen.length) why.push(`saw ${seen.map((t) => `${t.type}:"${t.text.slice(0, 40)}"`).join(', ')}`);
      if (stub === 'ok') {
        if (failureShown) return { outcome: 'stub-ok-shows-failure', why: `answered 200 yet a failure showed (${stubbed.join(', ')})` };
        return why.length ? { outcome: 'stub-ok-changed', why: why.join('; ') } : { outcome: 'stub-ok-nochange', why: stubbed.join(', ') };
      }
      return failureShown
        ? { outcome: 'stub-err-shown', why: `toasts ${failBefore.toasts}->${failAfter.toasts}, words ${failBefore.words}->${failAfter.words}` }
        : { outcome: 'stub-err-silent', why: `answered 500, no failure visible (${stubbed.join(', ')})` };
    }
    const after = await state(page);
    // Only a write the app does NOT make on its own is the press's. The app PATCHes
    // leaderboard_snapshots on load, and that can land inside any press window (it turned the
    // planted DEAD control into write-blocked once, 2026-09-23). AMBIENT is derived, not named.
    const attempted = page.blockedWrites.slice(writesBefore).filter((w) => !AMBIENT.has(w));
    if (attempted.length) return { outcome: 'write-blocked', why: [...new Set(attempted)].join(', '), rest: attempted.every((w) => page.restWrites.has(w)) };
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
// Stub-phase controls: an HONEST control reports what the server said; a LIAR shows success
// whatever happens. Honest must read changed on 200 and shown on 500; the liar must read SILENT
// on 500, or the err arm cannot catch the defect it exists for.
const PLANT_STUB = ([dataUrl, liar]) => {
  const b = document.createElement('button');
  b.textContent = liar ? 'ZZ planted liar' : 'ZZ planted honest';
  b.style.cssText = 'display:block;width:200px;height:40px';
  b.addEventListener('click', async () => {
    let ok = false;
    try { ok = (await fetch(dataUrl, { method: 'PATCH', body: '{}' })).ok; } catch { ok = false; }
    if (ok || liar) { b.textContent = 'ZZ saved'; return; }
    const a = document.createElement('div');
    a.setAttribute('role', 'alert');
    a.textContent = 'ZZ could not save';
    b.after(a);
  });
  (document.querySelector('main') || document.body).prepend(b);
};
const stubControl = (liar, stub) => pressFresh('/dashboard', { key: `button|ZZ planted ${liar ? 'liar' : 'honest'}|`, nth: 0, name: 'ZZ planted stub' }, false,
  () => {}, (page) => page.evaluate(PLANT_STUB, [writeProbeUrl, liar]), stub);
const sc = { honestOk: await stubControl(false, 'ok'), honestErr: await stubControl(false, 'err'), liarErr: await stubControl(true, 'err') };
console.log(`stub control: honest 200 -> ${sc.honestOk.outcome}; honest 500 -> ${sc.honestErr.outcome}; liar 500 -> ${sc.liarErr.outcome}`);
if (sc.honestOk.outcome !== 'stub-ok-changed' || sc.honestErr.outcome !== 'stub-err-shown' || sc.liarErr.outcome !== 'stub-err-silent') {
  await browser.close();
  fail(2, 'STUB CONTROL FAILED - the stub phase cannot tell a control that reports failure from one that hides it.');
}

// -- Crawl ------------------------------------------------------------------------------------------
const tally = { 'already-active': 0, 'self-link': 0, enumerated: 0, pressed: 0, changed: 0, 'no-change': 0, unpressable: 0, 'not-found': 0, 'write-blocked': 0, destructive: 0, write: 0, external: 0, repeat: 0 };
const findings = [];
const unstable = [];
const unsettled = [];
const pressedKeys = new Set();
const jobs = [];

for (const route of routes) {
  const page = await isolatedPage();
  await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(SETTLE_MS);
  // Enumerate until two consecutive reads agree. One look at SETTLE_MS read 307 controls on one run and
  // 347 on the next with no code change, because data-backed lists had not mounted (2026-09-23). A count
  // that never settles is printed, never averaged.
  let controls = await enumerate(page);
  let settled = false;
  for (let i = 0; i < 10 && !settled; i++) {
    const prev = controls.length;
    await page.waitForTimeout(1000);
    controls = await enumerate(page);
    settled = controls.length === prev;
  }
  if (!(await quietNetwork(page))) settled = false;
  else controls = await enumerate(page);
  if (!settled) { unsettled.push(route); console.log(`  ${route.padEnd(22)} UNSETTLED: its control count was still moving after 10 reads (${controls.length})`); }
  const t1 = await page.evaluate(() => document.body.innerText);
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

// -- Stub phase: what the user SEES when a blocked write succeeds, and when it fails ----------------
const stubJobs = jobs.filter((j) => findings.some((f) => f.outcome === 'write-blocked' && f.route === j.route
  && f.name === (j.c.name || '(no name)') && f.rest));
const stubFindings = [];
const stubTally = { ok: 0, err: 0, flaky: 0, background: 0 };
for (const j of stubJobs) {
  for (const stub of ['ok', 'err']) {
    const r = await pressFresh(j.from, j.c, j.textTrusted, undefined, undefined, stub);
    // A TAB's job is switching the view; a write it makes on the way (claiming milestones on the
    // Achievements tab) is background work, retried on the next open. Printed, not a finding.
    if (r.outcome === 'stub-err-silent' && j.c.role === 'tab') {
      stubTally.background++;
      stubFindings.push({ route: j.route, name: j.c.name, role: j.c.role, ...r, outcome: 'stub-err-silent-bg' });
      continue;
    }
    if (r.outcome === 'stub-ok-changed' || r.outcome === 'stub-err-shown') stubTally[stub]++;
    else { if (r.outcome === 'stub-no-write' || r.outcome === 'not-found') stubTally.flaky++; stubFindings.push({ route: j.route, name: j.c.name || '(no name)', role: j.c.role, ...r }); }
  }
}
await browser.close();

// -- Report -----------------------------------------------------------------------------------------
for (const f of findings.sort((a, b) => a.outcome.localeCompare(b.outcome) || a.route.localeCompare(b.route))) {
  console.log(`  ${f.outcome.padEnd(11)} ${f.route.padEnd(18)} ${f.role.padEnd(6)} "${f.name}"${f.frame ? `  frame ${f.frame}` : ''}${f.why ? `  (${f.why})` : ''}`);
}
if (unstable.length) console.log(`text-unstable routes (text ignored, other signals decide): ${unstable.join(', ')}`);
console.log(`enumerated ${tally.enumerated} . pressed ${tally.pressed} . changed ${tally.changed} . no-change ${tally['no-change']} . unpressable ${tally.unpressable} . not-found ${tally['not-found']}`);
console.log(`write-blocked ${tally['write-blocked']} (pressed; its write was aborted, so nothing persisted). Blocked during page LOAD, before any press: ${loadBlocked.size ? [...loadBlocked].join(', ') : 'none'}`);
console.log(`skipped: destructive ${tally.destructive} . write ${tally.write} . external ${tally.external} . repeat-chrome ${tally.repeat} . already-active ${tally['already-active']} . self-link ${tally['self-link']}`);
if (unsettled.length) console.log(`UNSETTLED routes (their count is a lower bound): ${unsettled.join(', ')}`);
for (const f of stubFindings) console.log(`  ${f.outcome.padEnd(21)} ${f.route.padEnd(18)} ${f.role.padEnd(6)} "${f.name}"${f.why ? `  (${f.why})` : ''}`);
console.log(`stub phase: ${stubJobs.length} write-blocked REST controls . 200 shows a change ${stubTally.ok} . 500 shows a failure ${stubTally.err} . inconclusive ${stubTally.flaky} . background tab writes ${stubTally.background} . findings ${stubFindings.length - stubTally.flaky - stubTally.background}`);
if (tally.pressed === 0) fail(2, 'pressed 0 controls - nothing was tested.');
if (tally['no-change'] > 0) { console.log(`FINDINGS: ${tally['no-change']} pressed control(s) changed nothing. Each has a frame in ${OUT}.`); process.exit(1); }
const stubReal = stubFindings.length - stubTally.flaky - stubTally.background;
if (stubReal > 0) { console.log(`FINDINGS: ${stubReal} write control(s) hide their result - listed above as stub-ok-nochange, stub-ok-shows-failure or stub-err-silent.`); process.exit(1); }
console.log('PASS - every pressed control changed something, and every stubbed write showed its success and its failure.');
