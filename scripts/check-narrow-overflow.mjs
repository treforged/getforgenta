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
 * Does NOT cover: vertical clipping, dialogs or menus, signed-in-only data, or whether a wrap looks right.
 */
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const WIDTH = Number(process.env.WIDTH || 320);
const ROUTES = ['/dashboard', '/budget', '/transactions', '/debt', '/forecast', '/goals', '/vehicles', '/net-worth', '/account'];
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };
let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'Could not load @playwright/test.'); }
try { await fetch(BASE, { redirect: 'manual' }); } catch (err) { fail(2, `${BASE} is not serving (${err.message}).`); }

const browser = await chromium.launch();
const done = async (code, msg) => { await browser.close(); (code ? console.error : console.log)(msg); process.exit(code); };
const page = await (await browser.newContext({ viewport: { width: WIDTH, height: 568 }, deviceScaleFactor: 2 })).newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false })));
await page.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });
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

async function settledRead() {
  let prev = null;
  for (let i = 0; i < 8; i += 1) {
    for (let j = 0; j < 4 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay').count()); j += 1) {
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    }
    await page.waitForTimeout(1500);
    if (await page.locator('.skeleton-shimmer').count()) continue;
    const cur = await page.evaluate(findCut);
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

mkdirSync('test-results/narrow-overflow', { recursive: true });
let findings = 0; let unstable = 0;
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  if (new URL(page.url()).pathname.startsWith('/auth')) await done(2, `${route} bounced to /auth: demo mode did not hold.`);
  const cut = await settledRead();
  if (cut === null) { unstable += 1; console.log(`${route}: UNSTABLE`); continue; }
  console.log(`${route}: ${cut.length} cut`);
  for (const l of cut) console.log(`   ${l}`);
  findings += cut.length;
  await page.screenshot({ path: `test-results/narrow-overflow/${route.slice(1)}-${WIDTH}.png`, fullPage: true });
}
if (unstable) await done(2, `${unstable} route(s) never settled.`);
await done(findings ? 1 : 0, findings ? `FAIL: ${findings} cut text run(s) at ${WIDTH}px.` : `PASS: 0 cut text runs on ${ROUTES.length} routes at ${WIDTH}px.`);
