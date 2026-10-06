#!/usr/bin/env node
/**
 * PLAN TOOK GARAGE'S BOTTOM-BAR SLOT (Tre, 2026-10-06, decision c5e29d9e, ask 6cdc485c).
 *
 * At 390x844 (phone bar) and 1440x900 (desktop rail), signed in on the walk account:
 *   1. control: the "Home" nav link is found, so a missing "Plan" is a finding, not a selector fault;
 *   2. the nav has a "Plan" link and NO "Garage" link;
 *   3. PRESSING Plan lands on /budget with the "Plan" heading, and the nav marks it current;
 *   4. Transactions' panel row no longer carries a "Plan" pill;
 *   5. an old /transactions?tab=budget link lands on /budget;
 *   6. Garage is still reachable: PRESSING Account's "Garage" link lands on /vehicles.
 * Every table write (POST/PATCH/PUT/DELETE outside /rpc/) is ABORTED. rpc calls pass: some are reads.
 * Frames: test-results/plan-tab/. Does NOT judge the icon, spacing or colour.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:8080';
const OUT = 'test-results/plan-tab';
const VIEWS = [{ width: 390, height: 844 }, { width: 1440, height: 900 }];
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
catch { fail(2, 'playwright is not installed.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch { fail(2, `dev server not reachable at ${BASE} - run npm run dev.`); }
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const checks = [];
const check = (name, pass, detail) => checks.push([name, pass, detail]);
const path = (page) => new URL(page.url()).pathname;
const waitPath = (page, p) => page.waitForURL((u) => new URL(u).pathname === p, { timeout: 10000 }).then(() => true).catch(() => false);

try {
  for (const vp of VIEWS) {
    const tag = vp.width;
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
    await ctx.route(`${url}/rest/v1/**`, (route) => {
      // rpc reads ride on POST; aborting them starves the page and raises the offline banner.
      const m = route.request().method();
      const isRpc = new URL(route.request().url()).pathname.includes('/rest/v1/rpc/');
      return m === 'GET' || m === 'HEAD' || (m === 'POST' && isRpc) ? route.continue() : route.abort();
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    // The cookie banner covers the phone bar; a real user dismisses it first.
    const banner = page.getByRole('region', { name: 'Cookie consent' });
    if (await banner.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) {
      await banner.getByRole('button', { name: /reject/i }).first().click();
    }

    const nav = page.locator('nav').filter({ has: page.getByRole('link', { name: /^Home$|Home/ }) }).last();
    const homeFound = await nav.getByRole('link', { name: /Home/ }).first().waitFor({ state: 'attached', timeout: 15000 }).then(() => true).catch(() => false);
    check(`${tag}: control - the nav's Home link is found`, homeFound, `found=${homeFound}`);
    const planLinks = await nav.getByRole('link', { name: /Plan/ }).count();
    const garageLinks = await nav.getByRole('link', { name: /Garage/ }).count();
    check(`${tag}: nav has Plan and no Garage`, planLinks >= 1 && garageLinks === 0, `plan=${planLinks} garage=${garageLinks}`);
    await page.screenshot({ path: join(OUT, `${tag}-dashboard.png`) });

    if (planLinks >= 1) {
      // The desktop rail is a 72px strip until hovered; hovering first is what a mouse user does.
      if (vp.width >= 1024) await nav.hover().catch(() => {});
      await nav.getByRole('link', { name: /Plan/ }).first().click();
      const onBudget = await waitPath(page, '/budget');
      const heading = await page.getByRole('heading', { name: /^Plan$/ }).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
      const current = await nav.getByRole('link', { name: /Plan/ }).first().getAttribute('aria-current').catch(() => null);
      check(`${tag}: pressing Plan lands on /budget with the Plan heading`, onBudget && heading, `path=${path(page)} heading=${heading}`);
      check(`${tag}: the nav marks Plan current`, current === 'page', `aria-current=${current}`);
      await page.mouse.move(vp.width - 10, vp.height / 2);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      // The heading is the wrapper's; the BODY is BudgetControl. A heading over a blank page passes
      // every check above, so require Plan's own content to render.
      const body = await page.getByText(/planned|Income/i).first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
      check(`${tag}: Plan's body renders under the heading`, body, `visible=${body}`);
      await page.screenshot({ path: join(OUT, `${tag}-plan.png`) });
    }

    await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
    const txTab = await page.getByRole('tab', { name: /^Transactions/ }).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    const planPill = await page.getByRole('tab', { name: /^Plan$/ }).count();
    check(`${tag}: Transactions row has no Plan pill (control: its Transactions pill is found)`, txTab && planPill === 0, `transactionsPill=${txTab} planPill=${planPill}`);

    await page.goto(`${BASE}/transactions?tab=budget`, { waitUntil: 'domcontentloaded' });
    const oldLink = await waitPath(page, '/budget');
    check(`${tag}: an old ?tab=budget link lands on /budget`, oldLink, `path=${path(page)}`);

    await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
    const garage = page.getByRole('link', { name: /Garage/ }).first();
    const garageShown = await garage.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    await page.screenshot({ path: join(OUT, `${tag}-account.png`) });
    if (garageShown) await garage.click();
    const onVehicles = garageShown && await waitPath(page, '/vehicles');
    check(`${tag}: Account's Garage link is visible and lands on /vehicles`, onVehicles, `shown=${garageShown} path=${path(page)}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}

let failed = 0;
for (const [name, pass, detail] of checks) {
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
}
const controlsOk = checks.filter(([n]) => n.includes('control - ')).every(([, p]) => p);
console.log(`\nchecks: ${checks.length}  failed: ${failed}   frames: ${OUT}`);
if (!controlsOk) fail(2, 'a control failed - the instrument, not the app, is in doubt.');
if (failed) fail(1, `${failed} check(s) failed.`);
console.log('PASS - Plan is a bottom-bar destination, Garage is reached from Account, and old Plan links still land.');
