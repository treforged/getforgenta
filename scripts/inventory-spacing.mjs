#!/usr/bin/env node
/**
 * inventory-spacing.mjs - an INVENTORY (not pass/fail) of empty space and spacing values, signed in, 390x844.
 * Tre, 2026-10-02 (f20e814d, 259f01ba): "a measured list of empty-space areas on every page" and "one spacing
 * system across ALL pages". Measured from the rendered page, never from class names.
 * READS, per route:
 *   EMPTY BANDS - inside each outermost card (.card-forged), the vertical stretches that no visible content
 *     covers (text, images, svg, inputs, buttons). A band over 16px is listed with the text above and below it.
 *   CARD PADDING - each card's computed padding (top/right/bottom/left), counted as distinct values.
 *   SECTION GAPS - from each card to the next card below it that overlaps it horizontally, as distinct values.
 * POSITIVE CONTROL: a planted card with a 120px empty band must read 120 +/- 6 on every route (a text box is the glyph box, a few px inside its line), or exit 2.
 * Each route is read until two consecutive reads agree, or it prints UNSTABLE and exits 2.
 * DOES NOT COVER: desktop widths, anything behind a press, empty space OUTSIDE a card, or whether a gap is
 * deliberate. A band beside a tall element in the same row is not empty, so it is not counted.
 * USAGE: node scripts/inventory-spacing.mjs [--json out.json]   EXITS: 0 measured . 2 could not measure
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const ROUTES = [
  '/dashboard', '/dashboard?tab=accounts', '/dashboard?tab=goals', '/budget', '/debt', '/debt?tab=use',
  '/forecast', '/net-worth', '/vehicles', '/account', '/settings',
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


const measure = () => {
  const visible = el => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  };
  const cards = [...document.querySelectorAll('.card-forged')].filter(visible);
  const out = { cards: [] };
  for (const card of cards) {
    if (card.parentElement?.closest('.card-forged')) continue; // outermost cards only
    const cb = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    const pad = ['Top', 'Right', 'Bottom', 'Left'].map(s => Math.round(parseFloat(cs['padding' + s])));
    const top = cb.top + pad[0];
    const bottom = cb.bottom - pad[2];
    const spans = [];
    const label = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      let r = null;
      let text = '';
      if (n.nodeType === 3) {
        if (!n.textContent.trim() || !n.parentElement || !visible(n.parentElement)) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        r = range.getBoundingClientRect();
        text = n.textContent.trim();
      } else if (n.matches('img, svg, input, select, textarea, button, canvas, [role="switch"], [role="progressbar"]') && visible(n)) {
        r = n.getBoundingClientRect();
        text = n.getAttribute('aria-label') || n.tagName.toLowerCase();
      }
      if (!r || r.height < 1) continue;
      spans.push([Math.max(r.top, top), Math.min(r.bottom, bottom)]);
      label.push({ top: r.top, bottom: r.bottom, text: text.slice(0, 40) });
    }
    spans.sort((a, b) => a[0] - b[0]);
    const bands = [];
    let cursor = top;
    for (const [a, b] of spans) {
      if (a - cursor > 16) bands.push([cursor, a]);
      cursor = Math.max(cursor, b);
    }
    if (bottom - cursor > 16) bands.push([cursor, bottom]);
    const near = (y, above) => {
      const c = label.filter(l => (above ? l.bottom <= y + 1 : l.top >= y - 1));
      c.sort((p, q) => (above ? q.bottom - p.bottom : p.top - q.top));
      return c[0]?.text ?? (above ? '(card top)' : '(card bottom)');
    };
    const title = (card.querySelector('h1,h2,h3,h4')?.textContent || card.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    out.cards.push({
      title, pad, left: Math.round(cb.left), right: Math.round(cb.right), top: Math.round(cb.top + scrollY), bottom: Math.round(cb.bottom + scrollY),
      bands: bands.map(([a, b]) => ({ px: Math.round(b - a), above: near(a, true), below: near(b, false) })),
    });
  }
  return out;
};
const plantControl = () => {
  const d = document.createElement('div');
  d.className = 'card-forged';
  d.id = '__spacing_control';
  d.style.cssText = 'position:absolute;top:0;left:0;width:200px;padding:12px';
  // margin 0 and line-height 1, so the text box IS the line box and the band is exactly the spacer.
  d.innerHTML = '<h3 style="margin:0;line-height:1">__control</h3><div style="height:120px"></div><p style="margin:0;line-height:1">after</p>';
  document.body.appendChild(d);
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

const report = {};
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
    if (await page.locator('.skeleton-shimmer').count()) { await page.waitForTimeout(1500); continue; }
    const r = await page.evaluate(measure);
    const sig = JSON.stringify(r.cards.map(c => [c.title, c.bands.map(b => b.px), c.bottom - c.top]));
    if (prev === sig && r.cards.length) { result = r; break; }
    prev = sig;
    await page.waitForTimeout(1500);
  }
  if (!result) await done(2, `UNSTABLE: ${route} never gave two agreeing reads.`);
  await page.evaluate(plantControl);
  const ctl = (await page.evaluate(measure)).cards.find(c => c.title === '__control');
  await page.evaluate(() => document.getElementById('__spacing_control')?.remove());
  if (!ctl?.bands.some(b => Math.abs(b.px - 120) <= 6)) {
    await done(2, `CONTROL FAILED on ${route}: the planted 120px band (+/- 6: a text box is the glyph box, not the line box) read ${JSON.stringify(ctl?.bands)}.`);
  }
  // Section gaps: each card to the next card below it that overlaps it horizontally.
  const cs = result.cards;
  const gaps = [];
  for (const c of cs) {
    const below = cs.filter(o => o !== c && o.top >= c.bottom - 1 && o.left < c.right && o.right > c.left).sort((a, b) => a.top - b.top)[0];
    if (below) gaps.push(below.top - c.bottom);
  }
  report[route] = { cards: cs, gaps };
}
await ctx.close();

const count = arr => Object.entries(arr.reduce((m, v) => ((m[v] = (m[v] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
const allPads = Object.values(report).flatMap(r => r.cards.map(c => c.pad.join('/')));
const allGaps = Object.values(report).flatMap(r => r.gaps);
const allBands = Object.entries(report).flatMap(([route, r]) => r.cards.flatMap(c => c.bands.map(b => ({ route, card: c.title, ...b }))));
allBands.sort((a, b) => b.px - a.px);
console.log(`CARD PADDING (top/right/bottom/left px): ${count(allPads).length} distinct over ${allPads.length} cards`);
for (const [v, n] of count(allPads)) console.log(`  ${v}  x${n}`);
console.log(`SECTION GAPS (px): ${count(allGaps).length} distinct over ${allGaps.length} gaps`);
for (const [v, n] of count(allGaps)) console.log(`  ${v}  x${n}`);
console.log(`EMPTY BANDS > 16px inside cards: ${allBands.length}`);
for (const b of allBands) console.log(`  ${String(b.px).padStart(4)}px  ${b.route}  [${b.card}]  between "${b.above}" and "${b.below}"`);
const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0) (await import('node:fs')).writeFileSync(process.argv[jsonAt + 1], JSON.stringify(report, null, 1));
await done(0, `MEASURED: ${ROUTES.length} routes at 390; the planted 120px band was found on every route.`);
