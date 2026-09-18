// check-destructive-contrast.mjs - the RENDERED half of the destructive-red split.
//
// `theme-contrast.test.ts` proves the TOKENS clear AA, and a build grep proves Tailwind emits
// `.text-destructive-text`. Neither proves the colour a user actually sees, because neither runs
// a browser: a class can be emitted and then lose to a more specific rule, and a token can be
// correct and be composited onto something unexpected. This measures the painted pixels.
//
// IT COMPOSITES THE WHOLE BACKGROUND STACK rather than reading one `backgroundColor`, so red text
// on a `bg-destructive/10` tint is accounted for instead of silently compared against the page.
//
// STABILITY IS LOAD-BEARING HERE, NOT A NICETY. The first version used a fixed 6s wait and read
// /dashboard as 0 elements on one run and 16 on the next, minutes apart, with no code change -
// the widgets had simply not mounted. A zero from an unsettled page is indistinguishable from a
// clean one, and it would have let this gate report a route it never actually looked at. So each
// route is read until TWO CONSECUTIVE reads agree, and a route that never settles prints
// UNSTABLE and exits 2 rather than contributing a number nobody measured.
//
// ⚠️ WHAT IT CANNOT SEE, and the first one is the sharp one:
//   - IT FINDS CANDIDATES BY THE FIXED COLOUR. Any red text that was never repointed to
//     --destructive-text is a different colour and is therefore INVISIBLE to it. It can tell you
//     the repointed sites are legible; it can NEVER tell you the sweep was complete.
//     `check-dark-contrast.mjs` is the colour-blind sweep, and it walks /budget only.
//   - ERROR STATES ARE NOT EXERCISED. Validation messages and delete confirmations need
//     interaction, so the most important destructive surface in the app is unmeasured here.
//     Measured: 0 of the elements it finds sit on a tinted surface.
//   - Dark mode only, 390x844 only, six routes only, and it says nothing about whether the
//     result LOOKS right.
//
// PROVEN RED with the REAL pre-fix value (0 73% 35%), not a contrived mutation: 26 of 26 below
// AA at 2.25:1, against 0 of 26 at 5.94:1 after. Same population both ways, which is what makes
// the green meaningful. EXITS: 0 clean . 1 something is below AA . 2 the probe could not measure.
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };

const env = readFileSync('.env.local', 'utf8');
let creds;
try { creds = readFileSync('.env.deck-walk.local', 'utf8'); }
catch { fail(2, '.env.deck-walk.local is missing.'); }
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

const whatsNew = readFileSync('src/lib/whats-new.ts', 'utf8');
const releaseVersion = (whatsNew.match(/version:\s*'([^']+)'/) || [])[1];
const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
const prof = await fetch(`${url}/rest/v1/profiles?select=tour_flags&user_id=eq.${session.user.id}`, { headers: rest });
const flags = (await prof.json())[0]?.tour_flags ?? {};
await fetch(`${url}/rest/v1/profiles?user_id=eq.${session.user.id}`, {
  method: 'PATCH',
  headers: { ...rest, Prefer: 'return=representation' },
  body: JSON.stringify({
    founder_note_seen: true,
    tour_flags: { ...flags, new_user_done: true, premium_done: true, [`whats_new_${releaseVersion}`]: true },
  }),
});

let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'no @playwright/test'); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('forgenta.theme.v1', 'dark'));
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));

const ROUTES = ['/dashboard', '/budget', '/debt', '/forecast', '/account', '/settings'];
const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';
const all = [];
let controlSeen = { tokenResolved: null, knownRatio: null };

for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  for (let i = 0; i < 5 && (await page.locator(OVERLAY).count()); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
  }
  const read = () => page.evaluate(() => {
    const parse = (s) => {
      const m = (s || '').match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lin = (v) => { const n = v / 255; return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const over = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
    });
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    // The EFFECTIVE background: walk up compositing every translucent layer onto what is behind
    // it, so a bg-destructive/10 tint is accounted for rather than skipped.
    const effBg = (el) => {
      const stack = [];
      for (let n = el; n && n !== document.documentElement.parentNode; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
      }
      if (!stack.length) return { r: 5, g: 5, b: 5, a: 1 };
      let acc = stack[stack.length - 1];
      for (let i = stack.length - 2; i >= 0; i -= 1) acc = over(stack[i], acc);
      return acc;
    };
    const tokenRaw = getComputedStyle(document.documentElement).getPropertyValue('--destructive-text').trim();
    const probe = document.createElement('span');
    probe.style.color = 'hsl(var(--destructive-text))';
    document.body.appendChild(probe);
    const target = parse(getComputedStyle(probe).color);
    probe.remove();

    const near = (c) => target && Math.abs(c.r - target.r) < 6 && Math.abs(c.g - target.g) < 6 && Math.abs(c.b - target.b) < 6;
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const txt = (el.textContent || '').trim();
      if (!txt || el.children.length) continue;          // leaf text nodes only
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      const fg = parse(cs.color);
      if (!fg || !near(fg)) continue;
      const bg = effBg(el);
      const composited = fg.a < 1 ? over(fg, bg) : fg;
      out.push({
        text: txt.slice(0, 44),
        ratio: Number(ratio(composited, bg).toFixed(2)),
        fontPx: Number(parseFloat(cs.fontSize).toFixed(1)),
        bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
      });
    }
    return {
      tokenRaw,
      target: target ? `rgb(${target.r},${target.g},${target.b})` : null,
      knownRatio: Number(ratio({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }).toFixed(1)),
      found: out,
    };
  });
  // Read until two CONSECUTIVE reads agree. A count that is still moving is a page that has not
  // finished mounting, and its zero would read exactly like a clean one.
  let r = await read();
  let settled = false;
  const seen = [r.found.length];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.waitForTimeout(2500);
    const again = await read();
    seen.push(again.found.length);
    if (again.found.length === r.found.length) { r = again; settled = true; break; }
    r = again;
  }
  if (!settled) {
    await browser.close();
    fail(2, `UNSTABLE: ${route} never settled - counts ${seen.join(' -> ')}. Not averaging them.`);
  }
  controlSeen = { tokenResolved: r.tokenRaw, knownRatio: r.knownRatio, target: r.target };
  console.log(`${route.padEnd(12)} destructive-coloured text elements: ${r.found.length}  (settled after ${seen.length} reads)`);
  for (const f of r.found) all.push({ route, ...f });
}

await browser.close();

console.log('\n--- CONTROLS (a zero from a broken probe must not read as clean) ---');
console.log('  --destructive-text resolves to :', JSON.stringify(controlSeen.tokenResolved), '->', controlSeen.target);
console.log('  black-on-white known ratio     :', controlSeen.knownRatio, '(must be 21)');
if (controlSeen.knownRatio !== 21) fail(2, 'CONTROL FAILED: the ratio maths is wrong.');
if (!controlSeen.tokenResolved) fail(2, 'CONTROL FAILED: --destructive-text did not resolve in the browser.');

console.log(`\n--- ${all.length} destructive-coloured text elements measured ---`);
if (all.length === 0) fail(2, 'CONTROL FAILED: found none at all - the probe cannot see its subject.');
const sorted = [...all].sort((a, b) => a.ratio - b.ratio);
for (const f of sorted.slice(0, 12)) {
  console.log(`  ${String(f.ratio).padStart(6)}:1  ${f.fontPx}px  on ${f.bg.padEnd(16)} ${f.route.padEnd(11)} ${JSON.stringify(f.text)}`);
}
const below = all.filter((f) => f.ratio < 4.5);
console.log(`\nmin ${sorted[0].ratio}:1   max ${sorted[sorted.length - 1].ratio}:1   below AA: ${below.length} of ${all.length}`);
const tinted = all.filter((f) => f.bg !== 'rgb(5,5,5)' && f.bg !== 'rgb(18,18,18)');
console.log(`on a non-plain surface (the case the arithmetic did not cover): ${tinted.length}`);
process.exit(below.length ? 1 : 0);
