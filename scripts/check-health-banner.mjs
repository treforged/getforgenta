#!/usr/bin/env node
/**
 * check-health-banner.mjs - the network notice (BackendHealthBanner) at 320px, normal and 150% text.
 * The notice appears only when the app's own Supabase calls fail AND a provider status page reports
 * a problem, so this RAISES it on purpose, all in the browser (nothing reaches a real service):
 * the Cloudflare status page answers `major` with one incident, the other status pages `none`, and
 * one Supabase read (savings_goals) answers 503. Signed in as the walk account (@forgenta.test only);
 * every non-GET to the data plane is aborted.
 * Then it measures the notice: its text must not overlap "Try again" (or Dismiss) at either size,
 * and the Dismiss X must keep the top-right corner (beside the headline) at both sizes.
 * A control requires the notice to be on screen before anything is measured.
 * EXITS: 0 pass . 1 a finding . 2 could not test.
 */
import { readFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
// THEME=dark|light: set through the app's own stored choice (as check:dark-contrast), and each text's
// contrast against the card is measured as a number (AA 4.5).
const THEME = process.env.THEME || '';
if (THEME && THEME !== 'dark' && THEME !== 'light') fail(2, `THEME must be dark or light, got ${THEME}.`);
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };
const pick = (t, k) => (t.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
let env; let creds;
try { env = readFileSync('.env.local', 'utf8'); creds = readFileSync('.env.deck-walk.local', 'utf8'); }
catch { fail(2, '.env.local or .env.deck-walk.local is missing.'); }
const url = pick(env, 'VITE_SUPABASE_URL'); const anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
const email = pick(creds, 'REACH_TEST_EMAIL'); const password = pick(creds, 'REACH_TEST_PASSWORD');
if (!url || !anon || !email || !password) fail(2, 'missing supabase url/key or walk credentials.');
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to script a sign-in for "${email}".`);
const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}.`);

let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'Could not load @playwright/test.'); }
try { await fetch(BASE, { redirect: 'manual' }); } catch (err) { fail(2, `${BASE} is not serving (${err.message}).`); }
const browser = await chromium.launch();
const summary = (indicator, incidents = []) => JSON.stringify({ status: { indicator, description: indicator }, incidents });

async function measure(scale) {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 2 });
  if (scale !== 100) await ctx.addInitScript((pct) => {
    const set = () => { document.documentElement.style.fontSize = `${pct}%`; };
    if (document.documentElement) set(); document.addEventListener('DOMContentLoaded', set);
  }, scale);
  await ctx.route(/status\.supabase\.com|vercel-status\.com|status\.plaid\.com/, (r) => r.fulfill({ contentType: 'application/json', body: summary('none') }));
  await ctx.route(/cloudflarestatus\.com/, (r) => r.fulfill({ contentType: 'application/json',
    body: summary('major', [{ name: 'Planted outage', impact: 'major', components: [{ name: 'CDN' }] }]) }));
  await ctx.route(/supabase\.co\/(rest|functions|storage)\//, (r) => {
    const m = r.request().method();
    if (/\/rest\/v1\/savings_goals/.test(r.request().url()) && m === 'GET') return r.fulfill({ status: 503, body: '{}' });
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS' || /\/rest\/v1\/rpc\//.test(r.request().url())) return r.fallback();
    return r.abort();
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, v, th]) => {
    localStorage.setItem(k, JSON.stringify(v));
    if (th) localStorage.setItem('forgenta.theme.v1', th);
    localStorage.setItem('tre_cookie_consent', JSON.stringify({ version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false }));
  }, [`sb-${ref}-auth-token`, session, THEME]);
  await page.goto(`${BASE}/goals`, { waitUntil: 'domcontentloaded' });
  const head = page.getByTestId('backend-health-headline');
  try { await head.waitFor({ state: 'visible', timeout: 30000 }); } catch {
    await ctx.close(); return { error: 'CONTROL FAILED: the notice never appeared, so nothing was measured.' };
  }
  // Re-measure until the card has width: one dark run read the card mid-render (0px wide, every ratio 1:1).
  let m;
  for (let tries = 0; tries < 8; tries += 1) {
  await page.waitForTimeout(800);
  m = await head.evaluate((h) => {
    const card = h.closest('div.pointer-events-auto');
    const text = h.parentElement.getBoundingClientRect();
    // The X is measured by its DRAWN icon: its 44px tap area uses a negative margin on purpose.
    const btns = [...card.querySelectorAll('button')].map((b) => ({ name: b.textContent.trim() || b.getAttribute('aria-label'),
      r: (b.getAttribute('aria-label') === 'Dismiss' ? (b.querySelector('svg') ?? b) : b).getBoundingClientRect() }));
    const lap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    // Characters, not the box: a Range over the headline and detail.
    // The headline and detail paragraphs only - the Try again label is a button, not message text.
    const glyphs = [h, h.nextElementSibling].filter(Boolean).flatMap((p) => { const rg = document.createRange(); rg.selectNodeContents(p); return [...rg.getClientRects()]; }).filter((q) => q.width > 1);
    return {
      overlaps: btns.filter((b) => glyphs.some((g) => lap(g, b.r))).map((b) => b.name),
      xTopRight: (() => { const x = btns.find((b) => b.name === 'Dismiss'); const hr = h.getBoundingClientRect(); return !!x && x.r.left >= hr.right - 1 && x.r.top < hr.bottom; })(),
      contrast: (() => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
        const rgb = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
        const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]));
        const bg = rgb(getComputedStyle(card).backgroundColor);
        if (bg[3] < 0.95) return { error: `card background is translucent (alpha ${bg[3]})` };
        const ratio = (el, under) => { const fg = over(rgb(getComputedStyle(el).color), under); const a = lum(fg); const b = lum(under); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; };
        const tryBtn = btns.find((b) => b.name === 'Try again');
        const tryEl = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Try again');
        const tryBg = tryEl ? over(rgb(getComputedStyle(tryEl).backgroundColor), bg) : bg;
        return { headline: ratio(h, bg), detail: ratio(h.nextElementSibling, bg), tryAgain: tryEl ? ratio(tryEl, tryBg) : null, theme: ['dark', 'light'].find((c) => document.documentElement.classList.contains(c)) ?? 'unset' };
      })(),
      textW: Math.round(text.width), btns: btns.map((b) => `${b.name}@${Math.round(b.r.left)},${Math.round(b.r.top)}`),
    };
  });
  if (m.textW > 0) break;
  }
  if (!(m.textW > 0)) { await ctx.close(); return { error: 'the notice never laid out (0px wide) after 8 reads.' }; }
  mkdirSync('test-results/health-banner', { recursive: true });
  await page.screenshot({ path: `test-results/health-banner/320-${scale}${THEME ? `-${THEME}` : ''}.png` });
  await ctx.close();
  return m;
}

let findings = 0;
for (const scale of [100, 150]) {
  const m = await measure(scale);
  if (m.error) { await browser.close(); fail(2, `${scale}%: ${m.error}`); }
  console.log(`320 @ ${scale}%: text ${m.textW}px wide . buttons ${m.btns.join(' ')} . X top-right ${m.xTopRight} . overlaps [${m.overlaps.join(', ')}]`);
  if (m.overlaps.length) { findings += 1; console.log(`   FINDING: notice text runs under ${m.overlaps.join(', ')}`); }
  if (m.contrast.error) { findings += 1; console.log(`   FINDING: ${m.contrast.error}`); }
  else {
    console.log(`   contrast (${m.contrast.theme}): headline ${m.contrast.headline} . detail ${m.contrast.detail} . Try again ${m.contrast.tryAgain}`);
    if (THEME && m.contrast.theme !== THEME) { await browser.close(); fail(2, `CONTROL FAILED: asked for ${THEME}, the page is ${m.contrast.theme}.`); }
    for (const [k, v] of Object.entries(m.contrast)) if (typeof v === 'number' && v < 4.5) { findings += 1; console.log(`   FINDING: ${k} at ${v}:1, below AA 4.5`); }
  }
  if (!m.xTopRight) { findings += 1; console.log('   FINDING: the Dismiss X left the top-right corner'); }
}
await browser.close();
if (findings) fail(1, `${findings} finding(s). Frames in test-results/health-banner/.`);
console.log('PASS: no overlap and the X top-right, at 100% and 150%. Frames in test-results/health-banner/.');
