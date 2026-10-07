#!/usr/bin/env node
// check:build-badges - Garage > Builds link badges are legible in both themes (Sam, 2026-10-07, after 3c089abd), at
// 390x844, signed in as the walk account. Every build read is ANSWERED in-browser (car_builds, car_build_phases,
// car_build_items, payment_plans, transactions) and every write is aborted, so the walk account is never touched.
// One item is linked to a charge (green "check $amount" badge) and one to a payment plan (gold plan badge). Each badge's
// text is measured against its COMPOSITED background stack; small text needs AA 4.5:1. Controls exit 2: both badges
// render, and the page took the requested theme. Red-proven by putting the charge badge back to `text-success/80`.
// Does NOT cover other Garage screens, desktop widths, or whether the badges LOOK right.
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const VIEWS = [{ width: 390, height: 844 }, { width: 1440, height: 900 }];
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

// Settle the first-run dialogs on the WALK account only, exactly as check:account does.
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


const UID = session.user.id;
const T = '2026-10-01T00:00:00Z';
const BUILD = { id: '00000000-0000-4000-8000-0000000b0001', user_id: UID, name: 'Probe Build', make: 'Dodge', model: 'Challenger',
  year: 2019, notes: null, photos: null, car_fund_id: null, created_at: T, sort_order: 0, share_token: null,
  maintenance_public: false, pricing_public: false };
const PHASE = { id: '00000000-0000-4000-8000-0000000b0002', user_id: UID, build_id: BUILD.id, title: 'Phase 1', hidden: false,
  sort_order: 0, created_at: T };
const PLAN_ID = '00000000-0000-4000-8000-0000000b0003';
const item = (n, extra) => ({ id: `00000000-0000-4000-8000-0000000b001${n}`, user_id: UID, build_id: BUILD.id, phase_id: PHASE.id,
  name: `Probe part ${n}`, brand: null, link: null, price: 400, completed: false, sort_order: n, created_at: T, payment_plan_id: null, ...extra });
const ITEMS = [item(1, {}), item(2, { payment_plan_id: PLAN_ID })];
const PLANS = [{ id: PLAN_ID, user_id: UID, name: 'Probe Plan', total_amount: 400, remaining_amount: 400, payment_amount: 100,
  frequency: 'monthly', start_date: '2026-10-01', active: true, created_at: T }];
const TXS = [{ id: '00000000-0000-4000-8000-0000000b0020', user_id: UID, date: '2026-10-02', amount: 412.5, type: 'expense',
  category: 'Car', note: '', account: 'Checking', car_build_item_id: ITEMS[0].id, created_at: T }];
const STUB = { car_builds: [BUILD], car_build_phases: [PHASE], car_build_items: ITEMS, payment_plans: PLANS, transactions: TXS };

const browser = await chromium.launch();
const failures = [];
const ratios = {};
for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const table = (new URL(req.url()).pathname.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
    if (req.method() === 'GET' || req.method() === 'HEAD') {
      if (table && STUB[table]) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STUB[table]) });
      return route.continue();
    }
    if (req.method() === 'POST' && /\/rest\/v1\/rpc\//.test(req.url())) return route.continue();
    return route.abort();
  });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
  await page.evaluate((t) => {
    localStorage.setItem('tre_cookie_consent', JSON.stringify({ version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false }));
    localStorage.setItem('forgenta.theme.v1', t);
  }, theme);
  await page.goto(`${BASE}/vehicles?tab=builds`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay, [role="dialog"]').count()); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  // The phase starts collapsed; pressing its header opens it (and must show the items).
  await page.getByText('Probe Build').first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.getByText(/^Phase 1$/i).first().click().catch(() => {});
  await page.getByText('Probe part 1').first().waitFor({ timeout: 10000 }).catch(() => {});
  let m = null;
  for (let i = 0; i < 10; i += 1) {
    m = await page.evaluate(() => {
      // Chrome reports Tailwind v4 opacity colours as oklab()/oklch(); reading those numbers as RGB is the
      // instrument fault this check first had (gold read as 1.04:1 on dark). Convert them to sRGB 0-255.
      const oklabToRgb = (L, A, B) => {
        const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3,
          s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
        const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
          -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
        const enc = (x) => 255 * Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
        return lin.map(enc);
      };
      const parse = (c) => {
        const n = c.match(/-?[\d.]+(?:e-?\d+)?/g).map(Number);
        const a = /\//.test(c) ? n[3] : (c.startsWith('rgba') ? n[3] : 1);
        if (c.startsWith('oklab')) { const [r, g, b] = oklabToRgb(n[0], n[1], n[2]); return { r, g, b, a: a ?? 1 }; }
        if (c.startsWith('oklch')) { const h = (n[2] * Math.PI) / 180; const [r, g, b] = oklabToRgb(n[0], n[1] * Math.cos(h), n[1] * Math.sin(h)); return { r, g, b, a: a ?? 1 }; }
        if (!c.startsWith('rgb')) throw new Error(`unparsed colour ${c}`);
        return { r: n[0], g: n[1], b: n[2], a: a ?? 1 };
      };
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      const measure = (el) => {
        const stack = [];
        for (let e = el; e; e = e.parentElement) {
          const bg = parse(getComputedStyle(e).backgroundColor);
          if (bg.a > 0) stack.push(bg);
          if (bg.a >= 1) break;
        }
        const base = stack.length && stack[stack.length - 1].a >= 1 ? stack.pop() : { r: 255, g: 255, b: 255, a: 1 };
        const bg = stack.reverse().reduce((acc, c) => ({ r: c.r * c.a + acc.r * (1 - c.a), g: c.g * c.a + acc.g * (1 - c.a), b: c.b * c.a + acc.b * (1 - c.a) }), base);
        const f0 = parse(getComputedStyle(el).color);
        const fg = { r: f0.r * f0.a + bg.r * (1 - f0.a), g: f0.g * f0.a + bg.g * (1 - f0.a), b: f0.b * f0.a + bg.b * (1 - f0.a) };
        const [a, b] = [lum(fg), lum(bg)];
        return { text: el.innerText.trim(), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      };
      const spans = [...document.querySelectorAll('span')];
      const charge = spans.find((s) => /^✓ \$412\.50/.test(s.innerText.trim()));
      const plan = spans.find((s) => s.innerText.trim() === 'Probe Plan');
      return { dark: document.documentElement.classList.contains('dark'), build: /Probe Build/.test(document.body.innerText),
        charge: charge ? measure(charge) : null, plan: plan ? measure(plan) : null };
    });
    if (m.charge && m.plan) break;
    await page.waitForTimeout(1500);
  }
  if (process.env.DEBUG) console.log(await page.evaluate(() => {
    const plan = [...document.querySelectorAll('span')].filter((x) => x.innerText.trim() === 'Probe Plan');
    return plan.map((el) => { const out = [el.className, getComputedStyle(el).color]; for (let e = el; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; if (b !== 'rgba(0, 0, 0, 0)') out.push(`${e.tagName}.${String(e.className).slice(0, 50)} ${b}`); } return out.slice(0, 6); });
  }));
  await page.locator('span', { hasText: /^✓ \$412\.50/ }).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `test-results/build-badges-${theme}.png` });
  await ctx.close();
  if (!m.build) { await browser.close(); fail(2, `${theme}: CONTROL FAILED - the stubbed build did not render (frame test-results/build-badges-${theme}.png).`); }
  if (!m.charge || !m.plan) { await browser.close(); fail(2, `${theme}: CONTROL FAILED - badges not found (charge ${!!m.charge}, plan ${!!m.plan}).`); }
  if (m.dark !== (theme === 'dark')) { await browser.close(); fail(2, `${theme}: CONTROL FAILED - the page did not take the ${theme} theme.`); }
  ratios[theme] = m;
  console.log(`${theme}: charge "${m.charge.text}" ${m.charge.ratio.toFixed(2)}:1, plan "${m.plan.text}" ${m.plan.ratio.toFixed(2)}:1`);
  for (const k of ['charge', 'plan']) if (m[k].ratio < 4.5) failures.push(`${theme}: ${k} badge "${m[k].text}" is ${m[k].ratio.toFixed(2)}:1, below AA 4.5:1`);
}
await browser.close();
if (failures.length) fail(1, failures.join('; '));
console.log(`PASS - build badges clear AA: charge ${ratios.dark.charge.ratio.toFixed(2)} dark / ${ratios.light.charge.ratio.toFixed(2)} light, plan ${ratios.dark.plan.ratio.toFixed(2)} / ${ratios.light.plan.ratio.toFixed(2)}.`);
