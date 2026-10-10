#!/usr/bin/env node
/**
 * check:fast-setup - the one-screen fast start (2026-10-09, docs/onboarding-audit-2026-10-09.md).
 *
 * DEMO arm (default, no credentials): /demo, then /onboarding.
 *   - the fast screen is what opens (not "Welcome to Forgenta"), with a "Connect your bank" option above the
 *     manual inputs, and the optional card behind one link;
 *   - "See my Safe to Spend" is DISABLED until pay is entered, enabled after;
 *   - at 375x667 the button is on screen with the estimate line showing; at 320 nothing sits outside the form;
 *   - "Set up step by step" opens the full wizard on Welcome with the pay answer kept (read on Income);
 *   - /onboarding?full=1 opens Welcome directly (the five older walks use it).
 * SIGNED_IN=1 arm (walk account, .env.local + .env.deck-walk.local, @forgenta.test only): every REST
 *   write is ANSWERED in-browser (204/201, nothing reaches the database) and captured. Pressing save must
 *   send ONE profile PATCH with onboarding_completed true, onboarding_completed_via 'wizard',
 *   weekly_gross_income, paycheck_day and paycheck_start_date (every 2 weeks), insert a checking account
 *   and a credit_card ACCOUNT, and land on /dashboard. The walk profile's onboarding flags are reset before
 *   and restored on every exit (the only real writes, as check:save-timeouts does).
 * EXITS: 0 pass . 1 a finding . 2 could not test.
 * ENV: SIGNED_IN=1, BASE_URL (http://localhost:8080), PW_CHROMIUM (an executable path).
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const SIGNED_IN = process.env.SIGNED_IN === '1';
const fail = (code, msg) => { console.error(`FAIL(${code}): ${msg}`); process.exit(code); };
let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'could not load @playwright/test.'); }
try { await fetch(BASE, { redirect: 'manual' }); } catch (err) { fail(2, `${BASE} is not serving (${err.message}).`); }
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const findings = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) findings.push(what); };
const CONSENT = JSON.stringify({ version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false });

async function openDemoOnboarding(width, height, path = '/onboarding') {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((c) => {
    localStorage.setItem('tre_cookie_consent', c);
    for (const k of Object.keys(localStorage)) if (k.includes('onboarding')) localStorage.removeItem(k);
  }, CONSENT);
  await page.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 30 && !page.url().includes('dashboard'); i++) await page.waitForTimeout(500);
  await page.waitForTimeout(1500);
  // Client-side navigation keeps the in-memory demo flag; a full load would drop it.
  await page.evaluate((u) => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')); }, path);
  await page.waitForTimeout(2500);
  return { ctx, page };
}

if (!SIGNED_IN) {
  // ── 375x667: the screen, the gate on pay, the fold, the step-by-step door ──
  {
    const { ctx, page } = await openDemoOnboarding(375, 667);
    const quick = page.getByTestId('onboarding-quick');
    // CONTROL = the onboarding page rendered at all (fast screen OR the old Welcome). The old Welcome
    // showing instead is a FINDING (exit 1), not "could not test": an exit 2 gets re-run and ignored.
    const welcome = await page.getByText('Welcome to Forgenta').count();
    if (!(await quick.count()) && !welcome) { await browser.close(); fail(2, 'no onboarding screen rendered on /onboarding (control).'); }
    if (!(await quick.count())) { await browser.close(); fail(1, 'a plain /onboarding opened the old Welcome, not the fast screen.'); }
    check(!welcome, 'a plain /onboarding opens the fast screen, not Welcome');
    // The bank option (2026-10-10, Tre: "part of premium is linking accounts"): visible, and ABOVE the
    // manual fields, i.e. equal weight rather than a link at the bottom.
    const bankBtn = page.getByTestId('quick-bank').getByRole('button', { name: /Connect your bank/ });
    check(await bankBtn.isVisible().catch(() => false), 'a "Connect your bank" button is on the fast screen');
    const bankTop = await page.getByTestId('quick-bank').evaluate((e) => e.getBoundingClientRect().top).catch(() => 1e9);
    const payTop = await page.getByLabel('Pay per check, before tax ($)').evaluate((e) => e.getBoundingClientRect().top);
    check(bankTop < payTop, `the bank option sits above the manual fields (bank ${Math.round(bankTop)}px, pay ${Math.round(payTop)}px)`);
    for (const label of ['Pay per check, before tax ($)', 'Money in checking right now ($)', 'Next payday']) {
      check((await page.getByLabel(label).count()) > 0, `input present: ${label}`);
    }
    const save = page.getByTestId('quick-save');
    check(await save.isDisabled(), 'save is disabled before pay is entered');
    let taps = 0;
    await page.getByRole('button', { name: 'Weekly' }).click(); taps++;
    await page.getByLabel('Pay per check, before tax ($)').click(); taps++; await page.keyboard.type('1200');
    await page.getByLabel('Money in checking right now ($)').click(); taps++; await page.keyboard.type('950');
    await page.getByLabel('Next payday').fill('2026-10-16'); taps += 2;
    check(await save.isEnabled(), 'save is enabled once pay is entered');
    taps += 1;
    check(taps <= 6, `taps to save <= 6 (measured ${taps}; the old shortest path was 10)`);
    const bottom = await save.evaluate((e) => Math.round(e.getBoundingClientRect().bottom));
    check(bottom <= 667, `save button on the first screen at 375x667 (bottom ${bottom}px)`);
    // Measured above in the default state (card folded). The optional card is behind one link; opening it
    // shows both fields (a user who adds a card scrolls a little, by choice).
    await page.getByTestId('quick-add-card').click();
    for (const label of ['Card balance ($)', 'Card APR (%)']) {
      check((await page.getByLabel(label).count()) > 0, `input present after "Add your biggest credit card": ${label}`);
    }
    await page.getByTestId('quick-full').click();
    await page.waitForTimeout(800);
    check((await page.getByText('Welcome to Forgenta').count()) > 0, '"Set up step by step" opens the full wizard on Welcome');
    await page.getByRole('button', { name: /^Continue/ }).click(); await page.waitForTimeout(600);
    await page.getByRole('button', { name: /skip|later|without/i }).first().click(); await page.waitForTimeout(600);
    const kept = await page.getByLabel('Gross per paycheck ($)').inputValue().catch(() => '');
    check(kept === '1200', `the pay answer carries into the wizard (Income reads "${kept}")`);
    await ctx.close();
  }
  // ── 320x568: nothing outside the form ──
  {
    const { ctx, page } = await openDemoOnboarding(320, 568);
    const out = await page.getByTestId('onboarding-quick').evaluate((root) => {
      const r = root.getBoundingClientRect(); const bad = [];
      for (const el of root.querySelectorAll('*')) {
        const b = el.getBoundingClientRect();
        if (b.width && (b.right > r.right + 1 || b.left < r.left - 1)) bad.push(`${el.tagName} ${(el.textContent || '').trim().slice(0, 30)}`);
      }
      return { bad, docOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    check(out.bad.length === 0 && !out.docOverflow, `320x568: nothing outside the form${out.bad.length ? ` (${out.bad.join('; ')})` : ''}`);
    await ctx.close();
  }
  // ── ?full=1 ──
  {
    const { ctx, page } = await openDemoOnboarding(390, 844, '/onboarding?full=1');
    check((await page.getByText('Welcome to Forgenta').count()) > 0 && !(await page.getByTestId('onboarding-quick').count()),
      '/onboarding?full=1 opens the full wizard on Welcome');
    await ctx.close();
  }
} else {
  const pick = (s, k) => (s.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
  let env, creds;
  try { env = readFileSync('.env.local', 'utf8'); } catch { fail(2, '.env.local is missing.'); }
  try { creds = readFileSync('.env.deck-walk.local', 'utf8'); } catch { fail(2, '.env.deck-walk.local is missing.'); }
  const url = pick(env, 'VITE_SUPABASE_URL'); const anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
  const email = pick(creds, 'REACH_TEST_EMAIL'); const password = pick(creds, 'REACH_TEST_PASSWORD');
  if (!url || !anon || !email || !password) fail(2, 'missing Supabase URL/key or walk credentials.');
  if (!/@forgenta[.]test$/.test(email)) fail(2, 'refusing: this script only signs in @forgenta.test accounts.');
  const ref = new URL(url).hostname.split('.')[0];
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const session = await res.json().catch(() => ({}));
  if (!session.access_token) fail(2, `sign-in returned ${res.status}.`);
  const uid = session.user.id;
  const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const COLS = 'onboarding_completed,onboarding_completed_via,onboarding_step,onboarding_furthest_step';
  const readProfile = async () => (await (await fetch(`${url}/rest/v1/profiles?select=${COLS}&user_id=eq.${uid}`, { headers: rest })).json())[0];
  const writeProfile = async (patch) => fetch(`${url}/rest/v1/profiles?user_id=eq.${uid}`, { method: 'PATCH', headers: rest, body: JSON.stringify(patch) });
  const original = await readProfile();
  if (!original) fail(2, 'walk profile not found.');
  const restore = async () => {
    await writeProfile(original);
    const back = await readProfile();
    console.log(`restore: ${back.onboarding_completed === original.onboarding_completed && back.onboarding_furthest_step === original.onboarding_furthest_step ? 'OK' : 'MISMATCH'}`);
  };
  try {
    await writeProfile({ onboarding_completed: false, onboarding_step: null, onboarding_furthest_step: null });
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
    const writes = [];
    await ctx.route(`${url}/rest/v1/**`, (route) => {
      const req = route.request();
      if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue();
      const path = new URL(req.url()).pathname.replace('/rest/v1/', '');
      writes.push({ method: req.method(), path, body: req.postData() || '' });
      return route.fulfill({ status: req.method() === 'POST' ? 201 : 204, body: '' });
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(([k, s, c]) => {
      localStorage.setItem(k, JSON.stringify(s)); localStorage.setItem('tre_cookie_consent', c);
      for (const key of Object.keys(localStorage)) if (key.includes('onboarding')) localStorage.removeItem(key);
    }, [`sb-${ref}-auth-token`, session, CONSENT]);
    await page.goto(`${BASE}/onboarding`, { waitUntil: 'domcontentloaded' });
    const quick = page.getByTestId('onboarding-quick');
    await quick.waitFor({ timeout: 20000 }).catch(() => {});
    if (!(await quick.count())) fail(2, 'the fast screen did not render for the walk account (control).');
    await page.getByLabel('Pay per check, before tax ($)').fill('1850');
    await page.getByLabel('Money in checking right now ($)').fill('1240');
    await page.getByLabel('Next payday').fill('2026-10-16');
    await page.getByTestId('quick-add-card').click().catch(() => {});
    await page.getByLabel('Card balance ($)').fill('3200');
    await page.getByLabel('Card APR (%)').fill('24.9');
    await page.getByTestId('quick-save').click();
    await page.waitForURL((u) => new URL(u).pathname === '/dashboard', { timeout: 15000 }).catch(() => {});
    check(new URL(page.url()).pathname === '/dashboard', `lands on /dashboard (at ${new URL(page.url()).pathname})`);
    const prof = writes.find((w) => w.method === 'PATCH' && w.path.startsWith('profiles') && w.body.includes('"onboarding_completed":true'));
    check(!!prof, 'one profile PATCH completes onboarding');
    if (prof) {
      const b = JSON.parse(prof.body);
      check(b.onboarding_completed_via === 'wizard', `completion attributed to 'wizard' (got ${b.onboarding_completed_via})`);
      check(b.weekly_gross_income === 1850, `weekly_gross_income 1850 (got ${b.weekly_gross_income})`);
      check(b.paycheck_day === 5 && b.paycheck_start_date === '2026-10-16', `payday columns: day ${b.paycheck_day}, anchor ${b.paycheck_start_date} (want 5, 2026-10-16)`);
    }
    const accts = writes.filter((w) => w.method === 'POST' && w.path.startsWith('accounts')).map((w) => w.body);
    check(accts.some((b) => b.includes('"account_type":"checking"') && b.includes('1240')), 'a checking account is inserted with 1240');
    check(accts.some((b) => b.includes('"account_type":"credit_card"') && b.includes('3200')), 'a credit_card ACCOUNT is inserted with 3200 (what the payoff engine reads)');
    await ctx.close();
  } finally {
    await restore();
  }
}

await browser.close();
if (findings.length) { console.error(`FINDINGS (${findings.length}):\n- ${findings.join('\n- ')}`); process.exit(1); }
console.log(`PASS: fast setup ${SIGNED_IN ? 'saves the right rows (signed in)' : 'screen, gate, fold and doors (demo)'}.`);
