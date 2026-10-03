#!/usr/bin/env node
/**
 * inventory-fill.mjs - an INVENTORY (not pass/fail) of boxes that are mostly empty, signed in, 390x844 AND 1440x900.
 * Tre, 2026-10-03 (ask 1be673ad): "content fills its box or the box shrinks", app-wide. Measured from the rendered
 * page, never from class names.
 * BOX: any visible element whose border or background differs from its parent, with radius > 0 or class card-forged,
 *   and border-box area >= 2000px^2. EXCLUDED: nav / aside / app header (outside <main>), position:fixed things,
 *   toasts, and a box that is mostly made of another box (a descendant box covers >= 80% of its area - the inner one
 *   is the real box).
 * FILL = area of the UNION of visible content rects (text via Range.getClientRects, img/svg/canvas/input/select/
 *   textarea/button/switch/progressbar rects) clipped to the padding box / padding-box area.
 * EMPTY HEIGHT = padding-box height - the vertical extent from the first content top to the last content bottom
 *   (whole height when the box holds no content).
 * REPORTED: fill < 0.35 AND empty height >= 24px, worst (largest empty height) first.
 * DEMO ARM: /demo (no credentials) for goals and the debt tabs the walk account does not carry.
 * POSITIVE CONTROLS, on every route and width, before the results are trusted (or exit 2): a planted 300x200 box
 *   holding ONE word must read fill < 0.1 and be reportable; a planted 300x200 box full of text must read fill >= 0.5
 *   and must NOT be reportable.
 * Each route is read until two consecutive reads agree (same boxes, same sizes), or it prints UNSTABLE and exits 2.
 * WRITES: every non-GET/HEAD request to Supabase REST is aborted in the browser. The script itself writes nothing.
 * DOES NOT COVER: anything behind a press (menus, dialogs, collapsed panels), param routes, a chart or image counted
 *   as full content (an svg/canvas/img rect is treated as filled even if mostly blank), horizontal slack that is not
 *   a whole empty row (a one-word line in a wide box reads as filled by the glyph box only), or whether the
 *   emptiness is deliberate.
 * USAGE: node scripts/inventory-fill.mjs [--json out.json]   EXITS: 0 ran . 2 UNSTABLE route or a control failed
 */
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const ROUTES = [
  '/dashboard', '/dashboard?tab=accounts', '/dashboard?tab=goals', '/budget', '/debt', '/debt?tab=use',
  '/forecast', '/net-worth', '/vehicles', '/account', '/settings',
];
const DEMO_ROUTES = ['/dashboard?tab=goals', '/goals', '/debt?tab=auto', '/debt?tab=student', '/vehicles'];
const WIDTHS = [{ width: 390, height: 844 }, { width: 1440, height: 900 }];
const FILL_MAX = 0.35;
const EMPTY_MIN = 24;
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

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

// Runs in the page. Returns EVERY qualifying box with its fill; the caller applies the thresholds.
const measure = () => {
  const visible = el => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  };
  const alpha = c => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return c === 'transparent' ? 0 : 1;
    const p = m[1].split(/[ ,/]+/).filter(Boolean);
    return p.length > 3 ? parseFloat(p[3]) : 1;
  };
  const fixedUp = el => { for (let n = el; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') return true; return false; };
  const shell = el => el.closest('nav, aside, [role="navigation"], [data-sonner-toaster], [data-sonner-toast]')
    || (el.closest('header') && !el.closest('main')) || fixedUp(el);
  const cands = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.id === '__fill_probe_root') continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.display === 'contents') continue;
    const b = el.getBoundingClientRect();
    if (b.width * b.height < 2000) continue;
    const bw = ['Top', 'Right', 'Bottom', 'Left'].map(s => (cs['border' + s + 'Style'] !== 'none' && alpha(cs['border' + s + 'Color']) > 0 ? parseFloat(cs['border' + s + 'Width']) : 0));
    const hasBorder = bw.some(w => w > 0);
    const par = el.parentElement ? getComputedStyle(el.parentElement) : null;
    const hasBg = (alpha(cs.backgroundColor) > 0 && (!par || cs.backgroundColor !== par.backgroundColor)) || cs.backgroundImage !== 'none';
    if (!hasBorder && !hasBg) continue;
    const radius = ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].some(s => parseFloat(cs['border' + s + 'Radius']) > 0);
    if (!radius && !el.classList.contains('card-forged')) continue;
    if (!visible(el) || shell(el)) continue;
    cands.push({ el, b, bw });
  }
  // Drop a wrapper whose area is mostly one inner box.
  const kept = cands.filter(c => !cands.some(o => o !== c && c.el.contains(o.el) && o.b.width * o.b.height >= 0.8 * c.b.width * c.b.height));
  const out = [];
  for (const { el, b, bw } of kept) {
    const pb = { l: b.left + bw[3], t: b.top + bw[0], r: b.right - bw[1], bt: b.bottom - bw[2] };
    const pw = pb.r - pb.l;
    const ph = pb.bt - pb.t;
    if (pw <= 0 || ph <= 0) continue;
    const rects = [];
    const label = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const rs = [];
      if (n.nodeType === 3) {
        if (!n.textContent.trim() || !n.parentElement || !visible(n.parentElement)) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) rs.push(r);
        if (label.length < 1) label.push(n.textContent.trim().replace(/\s+/g, ' ').slice(0, 40));
      } else if (n.matches('img, svg, input, select, textarea, button, canvas, [role="switch"], [role="progressbar"]') && visible(n)) {
        rs.push(n.getBoundingClientRect());
        if (label.length < 1) label.push(n.getAttribute('aria-label') || `<${n.tagName.toLowerCase()}>`);
      }
      for (const r of rs) {
        const l = Math.max(r.left, pb.l); const rr = Math.min(r.right, pb.r);
        const t = Math.max(r.top, pb.t); const bb = Math.min(r.bottom, pb.bt);
        if (rr > l && bb > t) rects.push([l, t, rr, bb]);
      }
    }
    // Union area by coordinate compression.
    const xs = [...new Set(rects.flatMap(r => [r[0], r[2]]))].sort((a, c) => a - c);
    let area = 0;
    for (let i = 0; i < xs.length - 1; i += 1) {
      const iv = rects.filter(r => r[0] <= xs[i] && r[2] >= xs[i + 1]).map(r => [r[1], r[3]]).sort((a, c) => a[0] - c[0]);
      let cur = -Infinity; let len = 0;
      for (const [a, c] of iv) { const s = Math.max(a, cur); if (c > s) { len += c - s; cur = c; } }
      area += len * (xs[i + 1] - xs[i]);
    }
    const extent = rects.length ? Math.max(...rects.map(r => r[3])) - Math.min(...rects.map(r => r[1])) : 0;
    const hintEl = el.closest('[data-testid]');
    const hint = hintEl ? `testid:${hintEl.getAttribute('data-testid')}` : (typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 4).join('.') : '') || el.tagName.toLowerCase();
    out.push({
      id: el.id || '', label: label[0] ?? '(no content)', w: Math.round(b.width), h: Math.round(b.height),
      fill: area / (pw * ph), empty: Math.round(ph - extent), top: Math.round(b.top + scrollY), hint,
    });
  }
  return out;
};
const plantControl = () => {
  const root = document.createElement('div');
  root.id = '__fill_probe_root';
  root.style.cssText = 'position:absolute;top:0;left:0;z-index:-1';
  const base = 'position:absolute;left:0;width:300px;height:200px;box-sizing:border-box;padding:0;margin:0;overflow:hidden;border:1px solid rgb(250,10,10);border-radius:8px;background:rgb(30,30,90);color:#fff;font:14px/1 sans-serif;';
  const one = document.createElement('div');
  one.id = '__fill_one'; one.style.cssText = base + 'top:0'; one.textContent = 'word';
  const full = document.createElement('div');
  full.id = '__fill_full'; full.style.cssText = base + 'top:300px'; full.textContent = 'lorem ipsum dolor sit amet '.repeat(80);
  root.append(one, full);
  document.body.appendChild(root);
};
const sigOf = boxes => JSON.stringify(boxes.map(b => [b.label, b.w, b.h]).sort());

const browser = await chromium.launch();
const done = async (code, msg) => { await browser.close(); if (code) fail(code, msg); console.log(msg); process.exit(0); };
const findings = [];
const totals = {};

const scanRoutes = async (page, routes, arm, vp) => {
  for (const route of routes) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    for (let i = 0; i < 6 && (await page.locator('[role="dialog"]').count()); i += 1) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
    let prev = null; let result = null; let lastTwo = [];
    const deadline = Date.now() + 60000;
    for (let read = 0; read < 8 && Date.now() < deadline;) {
      if (await page.locator('.skeleton-shimmer').count()) { await page.waitForTimeout(1500); continue; }
      read += 1;
      const r = await page.evaluate(measure);
      const sig = sigOf(r);
      if (prev === sig && r.length) { result = r; break; }
      lastTwo = [prev, sig];
      prev = sig;
      await page.waitForTimeout(1500);
    }
    const key = `${arm === 'demo' ? 'demo ' : ''}${route} @${vp.width}`;
    if (!result) {
      const [a = [], b = []] = lastTwo.map(x => JSON.parse(x || '[]'));
      const diff = [];
      for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) diff.push(`${JSON.stringify(a[i])} -> ${JSON.stringify(b[i])}`);
      }
      await done(2, `UNSTABLE: ${key} never gave two agreeing reads. Last change: ${diff.slice(0, 3).join(' | ') || (lastTwo.length ? '(no boxes read)' : '(still a loading skeleton on every read)')}`);
    }
    await page.evaluate(plantControl);
    const planted = await page.evaluate(measure);
    await page.evaluate(() => document.getElementById('__fill_probe_root')?.remove());
    const one = planted.find(b => b.id === '__fill_one');
    const full = planted.find(b => b.id === '__fill_full');
    const reportable = b => b.fill < FILL_MAX && b.empty >= EMPTY_MIN;
    if (!one || !(one.fill < 0.1) || !reportable(one)) {
      await done(2, `CONTROL FAILED on ${key}: the planted one-word 300x200 box must read fill < 0.1 and be reportable; read ${JSON.stringify(one)}.`);
    }
    if (!full || !(full.fill >= 0.5) || reportable(full)) {
      await done(2, `CONTROL FAILED on ${key}: the planted full-of-text 300x200 box must read fill >= 0.5 and NOT be reportable; read ${JSON.stringify(full)}.`);
    }
    const hits = result.filter(reportable);
    totals[key] = { boxes: result.length, findings: hits.length };
    for (const h of hits) findings.push({ route: key, ...h });
  }
};

for (const vp of WIDTHS) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
  await page.evaluate(() => {
    localStorage.setItem('tre_cookie_consent', JSON.stringify({
      version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
    }));
  });
  await page.route(/\/rest\/v1\//, route => (['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort()));
  await scanRoutes(page, ROUTES, 'walk', vp);
  await ctx.close();

  const demoCtx = await browser.newContext({ viewport: vp });
  const demo = await demoCtx.newPage();
  await demo.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });
  await demo.waitForTimeout(4000);
  await demo.route(/\/rest\/v1\//, route => (['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort()));
  await scanRoutes(demo, DEMO_ROUTES, 'demo', vp);
  await demoCtx.close();
}

findings.sort((a, b) => b.empty - a.empty);
console.log(`BOXES with fill < ${FILL_MAX * 100}% and empty height >= ${EMPTY_MIN}px: ${findings.length}`);
for (const f of findings) {
  console.log(`  ${f.route}  "${f.label}"  ${f.w}x${f.h}  fill ${(f.fill * 100).toFixed(1)}%  empty ${f.empty}px  [${f.hint}]`);
}
console.log('PER-ROUTE TOTALS (boxes examined / reported):');
for (const [k, t] of Object.entries(totals)) console.log(`  ${k}: ${t.boxes} / ${t.findings}`);
const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0) writeFileSync(process.argv[jsonAt + 1], JSON.stringify({ findings, totals }, null, 1));
await done(0, `MEASURED: ${ROUTES.length} signed-in + ${DEMO_ROUTES.length} demo routes at ${WIDTHS.map(w => w.width).join(' and ')}; both planted controls behaved on every route.`);
