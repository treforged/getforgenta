#!/usr/bin/env node
// check-pay-more.mjs - Debt's Simple "Finish sooner" card (ask e1b0fffc), at 390x844, signed in.
//
// PRESSES "Show me" and requires the press to CHANGE the card: the button goes and either an options
// list or the honest "would not change" line comes. Each option must read "Debt-free <Mon YYYY>" and
// "<n> months sooner" (or no "sooner" when the base never pays off), and a bigger extra must never finish LATER than a smaller one. The view is forced
// to Simple by rewriting the profile READ in-browser; every write is answered 204 in-browser, so the walk
// account is never changed. Numbers are owned by pay-more-payoff.test.ts and its realData pin.
//
// EXITS: 0 pass . 1 a check failed . 2 could not test (env, sign-in, server, card never rendered)
// DOES NOT COVER: desktop widths, Advanced (the card is Simple-only), or whether the dates are RIGHT.
// check:goal-grid - the Dashboard's Goal Progress card at 390x844 AND 1440x900, signed in as the walk account.
// The walk account has NO goals, so the savings_goals read is answered IN THE BROWSER (route.fulfill)
// with 1, 2 and 3 goals in turn - nothing is written. For each count and width, EVERY ROW of tiles
// must span the card: the row's rightmost tile ends within 2px of the grid's right edge (rows are
// grouped by tile top, so a stacked phone layout is one tile per row and desktop is one row).
// A fixed md:grid-cols-3 put one goal in a third of a 1296px card (red, proven before the fix).
// Does NOT cover widths between 390 and 1440, colour, or the empty state.
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
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
try { ({ chromium } = await import("@playwright/test")); }
catch { fail(2, "Could not load @playwright/test - run npm i."); }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const idx = (label) => { const [m, y] = label.split(' '); return Number(y) * 12 + MONTHS.indexOf(m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
await ctx.route(`${url}/**`, async (route) => {
  const req = route.request();
  if (req.method() === 'GET' && /\/rest\/v1\/profiles/.test(req.url())) {
    try {
      const resp = await route.fetch();
      let body = await resp.text();
      try {
        const j = JSON.parse(body);
        const set = (o) => ({ ...o, view_mode: 'simple' });
        body = JSON.stringify(Array.isArray(j) ? j.map(set) : set(j));
      } catch { /* not JSON: pass through */ }
      return await route.fulfill({ response: resp, body });
    } catch { return route.abort().catch(() => {}); }
  }
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method()) || /\/auth\/v1\//.test(req.url())) return route.continue();
  return route.fulfill({ status: 204, body: '' });
});
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));
if (process.env.DEMO === '1') {
  // /demo has a debt-free date, so this arm exercises the rows; the walk account's forecast never
  // pays off. Demo is in-memory state, so /debt is reached by a client-side click, then Simple pressed.
  await page.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);
  for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay').count()); i += 1) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  }
  // Home's hero carries a "finish sooner" link in Simple ONLY (the card does not exist in Advanced).
  const heroLink = page.getByTestId('hero-finish-sooner');
  const viewTab = (name) => page.getByRole('tab', { name });
  await viewTab('Advanced').waitFor({ timeout: 30000 }).catch(() => {});
  if (await viewTab('Advanced').getAttribute('aria-selected') !== 'true') await viewTab('Advanced').click();
  await page.waitForTimeout(1500);
  const inAdvanced = await heroLink.count();
  await viewTab('Simple').click();
  const inSimple = await heroLink.first().waitFor({ timeout: 15000 }).then(() => 1).catch(() => 0);
  console.log(`hero link: Advanced ${inAdvanced}, Simple ${inSimple}`);
  if (inAdvanced !== 0) { await browser.close(); fail(1, 'the hero shows "finish sooner" in Advanced, where the card does not exist.'); }
  if (inSimple !== 1) { await browser.close(); fail(1, 'the hero has no "finish sooner" link in Simple.'); }
  await heroLink.first().click();
  const simpleTab = page.getByRole('tab', { name: 'Simple' });
  await simpleTab.waitFor({ timeout: 30000 }).catch(() => {});
  if (await simpleTab.getAttribute('aria-selected') !== 'true') await simpleTab.click();
} else {
  await page.goto(`${BASE}/debt`, { waitUntil: 'domcontentloaded' });
}
const card = page.getByTestId('pay-more-card');
const shown = await card.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
if (!shown) { await page.screenshot({ path: 'test-results/pay-more-missing.png' }); await browser.close(); fail(2, 'the Finish sooner card never rendered on /debt in Simple (control).'); }
const pageText = await page.locator('main').first().innerText().catch(() => '');
const headline = pageText.split(String.fromCharCode(10)).filter((l) => /[A-Z][a-z]{2} \d{4}/.test(l));
const pageMonths = new Set(headline.flatMap((l) => l.match(/[A-Z][a-z]{2} \d{4}/g) ?? []));
console.log(`page month labels: ${[...pageMonths].join(', ') || '(none)'}`);
await card.scrollIntoViewIfNeeded();
const run = card.getByTestId('pay-more-run');
if (!(await run.count())) { await browser.close(); fail(2, 'no "Show me" button on the card (control).'); }
await run.click();
const result = card.locator('[data-testid="pay-more-options"], [data-testid="pay-more-none"]');
const got = await result.first().waitFor({ timeout: 90000 }).then(() => true).catch(() => false);
await page.screenshot({ path: `test-results/pay-more-simple${process.env.DEMO === '1' ? '-demo' : ''}.png` });
const failures = [];
if (!got) failures.push('pressing "Show me" produced neither options nor the no-change line within 90 s');
if (await run.count()) failures.push('"Show me" is still on the card after the press');
const rows = await card.locator('[data-testid="pay-more-options"] li').allInnerTexts();
console.log(`rows: ${rows.length ? rows.map((r) => r.replace(/\s+/g, ' ')).join(' | ') : '(none) ' + (await card.innerText()).replace(/\s+/g, ' ')}`);
// With no base date the card says so, and rows carry no "sooner" (there is nothing to be sooner than).
const noBase = /not paid off within the forecast/.test(await card.innerText());
let prev = Infinity;
for (const r of rows) {
  const m = r.match(/Debt-free (\w{3} \d{4})/);
  if (!m || (!noBase && !/\d+ months? sooner/.test(r))) { failures.push(`row does not read "Debt-free <month>${noBase ? '' : ' ... sooner'}": ${r}`); continue; }
  if (noBase && /sooner/.test(r)) failures.push(`row claims "sooner" with no base date: ${r}`);
  const i = idx(m[1]);
  if (i > prev) failures.push(`a bigger extra finishes LATER: ${r}`);
  prev = i;
}
// The card's base (first row's month + its months sooner) must be the debt-free month the page shows,
// or the card and the page disagree about today's plan.
const first = rows[0]?.match(/Debt-free (\w{3} \d{4})\D*?(\d+) months? sooner/);
if (first) {
  const b = idx(first[1]) + Number(first[2]);
  const base = `${MONTHS[b % 12]} ${Math.floor(b / 12)}`;
  console.log(`card base: ${base}`);
  if (!pageMonths.has(base)) failures.push(`the card's base ${base} is not a month the page shows (${[...pageMonths].join(', ') || 'none'})`);
}
await browser.close();
for (const f of failures) console.log(`FAIL ${f}`);
console.log(failures.length ? `${failures.length} failure(s).` : 'PASS - the press changed the card and every option reads sooner, in order.');
process.exit(failures.length ? 1 : 0);
