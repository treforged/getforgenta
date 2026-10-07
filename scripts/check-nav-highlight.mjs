#!/usr/bin/env node
/**
 * check-nav-highlight.mjs - the HIGHLIGHTED (not current) nav item's label must be legible in
 * BOTH themes, on the phone bar (390x844) and the desktop rail (1440x900, hovered open). be864a14.
 *
 * WHY ITS OWN PROBE. `check-dark-contrast.mjs` skips every text colour whose alpha is under 0.95,
 * because a translucent colour needs compositing. The old highlight was `text-primary/75` and
 * `/80`, so that probe passed the defect in both themes and at both widths (measured 2026-10-07).
 * This one composites the label's own colour over the PIXELS under it, with the text hidden.
 *
 * It also asserts the highlighted label is NOT painted like the current page's label: the reason
 * for the faded gold was that full gold reads as "you are here". A fix that makes it legible by
 * making it identical to the active item is the other defect, and it fails here too.
 *
 * Positive controls: the highlight dot is found (so the highlighted item exists for this account),
 * the item is not the current page, and the current page's label is found for the comparison.
 *
 * USAGE:  node scripts/check-nav-highlight.mjs     (dev server on :8080, .env.deck-walk.local)
 * EXITS:  0 legible and distinct everywhere . 1 a finding . 2 could not measure
 * DOES NOT COVER: the icon's 3:1 non-text contrast, other routes, hover/focus states, or widths
 * between 390 and 1440.
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const fail = (code, msg) => { console.error(`FAIL(${code}): ${msg}`); process.exit(code); };

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
if (!session.access_token) fail(2, `sign-in returned ${res.status}`);

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}).`); }

const browser = await chromium.launch();
const findings = [];
let measured = 0;

/** Text hidden, then: the label's colour resolved to sRGB through a canvas (Chrome reports
 *  opacity colours as oklab), and the median background pixel under the label's text box. */
async function measure(page, labelSel, shotPath) {
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
  const color = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = getComputedStyle(el).color; c.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255, css: getComputedStyle(el).color };
  }, labelSel);
  const rect = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const range = document.createRange(); range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    el.style.setProperty('color', 'transparent', 'important');
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, labelSel);
  if (!rect.w || !rect.h) return null;
  const png = (await page.screenshot({ clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h } })).toString('base64');
  await page.evaluate((sel) => document.querySelector(sel).style.removeProperty('color'), labelSel);
  if (shotPath) await page.screenshot({ path: shotPath, clip: { x: Math.max(0, rect.x - 30), y: Math.max(0, rect.y - 34), width: rect.w + 60, height: rect.h + 44 } });
  const bg = await page.evaluate(async (data) => {
    const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    const px = [];
    for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
    const lum = ([r, gg, b]) => 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    px.sort((p, q) => lum(p) - lum(q));
    return px[Math.floor(px.length / 2)];
  }, png);
  const comp = ['r', 'g', 'b'].map((k, i) => color[k] * color.a + bg[i] * (1 - color.a));
  const L = (rgb) => rgb.map((v) => { const n = v / 255; return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const [hi, lo] = [L(comp), L(bg)].sort((p, q) => q - p);
  return { ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100, color: color.css, bg };
}

for (const theme of ['dark', 'light']) {
  for (const width of [390, 1440]) {
    const tag = `${theme} ${width}`;
    const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(([k, s, th]) => {
      localStorage.setItem(k, JSON.stringify(s));
      localStorage.setItem('forgenta.theme.v1', th);
      localStorage.setItem('tre_cookie_consent', JSON.stringify({ version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false }));
    }, [`sb-${ref}-auth-token`, session, theme]);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    const dotId = width === 390 ? 'nav-highlight-dot' : 'rail-highlight-dot';
    try { await page.locator(`[data-testid="${dotId}"]`).first().waitFor({ state: 'attached', timeout: 20000 }); }
    catch { findings.push(`${tag}: CONTROL FAILED - no ${dotId}, so there is no highlighted item to measure.`); await ctx.close(); continue; }
    if (width === 1440) { await page.locator('aside').first().hover(); await page.waitForTimeout(600); }
    const ok = await page.evaluate(([dot, themeWanted]) => {
      const a = document.querySelector(`[data-testid="${dot}"]`).closest('a');
      const scope = a.closest('nav, aside') || document;
      const active = scope.querySelector('a[aria-current="page"]');
      const labelOf = (link) => [...link.querySelectorAll('span')].find((s) => s.children.length === 0 && s.textContent.trim() && !s.dataset.testid);
      const hl = labelOf(a); const ac = active && labelOf(active);
      if (hl) hl.setAttribute('data-probe', 'hl');
      if (ac) ac.setAttribute('data-probe', 'active');
      return { current: a.getAttribute('aria-current'), hl: hl?.textContent.trim(), ac: ac?.textContent.trim(),
        theme: document.documentElement.classList.contains(themeWanted) };
    }, [dotId, theme]);
    if (!ok.theme) { findings.push(`${tag}: CONTROL FAILED - document is not in ${theme}.`); await ctx.close(); continue; }
    if (!ok.hl || !ok.ac || ok.current === 'page') {
      findings.push(`${tag}: CONTROL FAILED - highlighted label "${ok.hl}", current label "${ok.ac}", highlighted aria-current=${ok.current}.`);
      await ctx.close(); continue;
    }
    const hl = await measure(page, '[data-probe="hl"]', `test-results/nav-highlight-${theme}-${width}.png`);
    const ac = await measure(page, '[data-probe="active"]');
    if (!hl || !ac) { findings.push(`${tag}: CONTROL FAILED - a label has no box (rail not open?).`); await ctx.close(); continue; }
    measured += 1;
    console.log(`${tag}: highlighted "${ok.hl}" ${hl.ratio}:1 (${hl.color}) | current "${ok.ac}" ${ac.color}`);
    if (hl.ratio < 4.5) findings.push(`${tag}: highlighted label "${ok.hl}" reads ${hl.ratio}:1, below AA 4.5.`);
    if (hl.color === ac.color) findings.push(`${tag}: highlighted label is painted exactly like the current page (${hl.color}).`);
    await ctx.close();
  }
}
await browser.close();

for (const f of findings) console.log(`  - ${f}`);
if (findings.some((f) => f.includes('CONTROL FAILED')) || measured === 0) fail(2, `measured ${measured} of 4.`);
if (findings.length) { console.log(`exit 1: ${findings.length} finding(s)`); process.exit(1); }
console.log(`exit 0: ${measured} of 4 legible and distinct from the current page`);
