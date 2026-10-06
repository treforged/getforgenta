#!/usr/bin/env node
/**
 * check-relink-prompt.mjs - a BROKEN bank link says so on the Accounts tab (Linked Banks), 390x844, signed in.
 *
 * When Plaid answers ITEM_LOGIN_REQUIRED, sync marks the connection reauth_required and stops syncing it.
 * The row used to show only "Synced 3 days ago". This answers the financial_connections read in-browser
 * with one Plaid row and reads the re-link strip.
 * ASSERTS: reauth_required -> the strip says "sign in again" and carries Re-link. CONTROL: active -> no such text.
 * DOES NOT COVER: the Dashboard (no banner there yet), Akoya, pressing Re-link (opens Plaid), desktop widths.
 * USAGE: npm run check:relink-prompt    EXITS: 0 pass . 1 the prompt is wrong . 2 could not test
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const VIEW = { width: 390, height: 844 };
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


const browser = await chromium.launch();
const done = async (code, msg) => { await browser.close(); if (code) fail(code, msg); console.log(msg); process.exit(0); };

const row = status => ({
  id: '00000000-0000-4000-8000-0000000000aa', provider: 'plaid', provider_item_id: 'item-relink-probe',
  institution_id: 'ins_probe', institution_name: 'Probe Bank', connection_status: status,
  last_synced_at: new Date(Date.now() - 3 * 86400_000).toISOString(), created_at: '2026-09-01T00:00:00Z',
  liabilities_consent_required: false,
});

const readPrompt = async status => {
  const ctx = await browser.newContext({ viewport: VIEW });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
  await page.evaluate(() => {
    localStorage.setItem('tre_cookie_consent', JSON.stringify({
      version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
    }));
  });
  let served = 0;
  await page.route(/\/(rest|functions)\/v1\//, async route => {
    const req = route.request();
    if (/\/rest\/v1\/financial_connections\b/.test(req.url()) && req.method() === 'GET') {
      served += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row(status)]) });
    }
    if (/\/rest\/v1\//.test(req.url()) && (req.method() === 'GET' || req.method() === 'HEAD')) return route.continue();
    if (/\/rest\/v1\/rpc\//.test(req.url())) return route.continue();
    return route.abort();
  });
  await page.goto(`${BASE}/dashboard?tab=accounts`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay').count()); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  const banks = page.getByRole('tab', { name: /Banks/ }).first();
  try { await banks.waitFor({ state: 'visible', timeout: 15000 }); }
  catch { await page.screenshot({ path: 'test-results/relink-control-fail.png' }); await ctx.close(); await done(2, 'CONTROL FAILED: the Accounts tab has no Linked Banks button (frame: test-results/relink-control-fail.png).'); }
  await banks.click();
  try { await page.getByText('Probe Bank').first().waitFor({ state: 'visible', timeout: 10000 }); }
  catch { await ctx.close(); await done(2, `CONTROL FAILED: the stubbed connection never rendered (served ${served}).`); }
  const strip = page.getByTestId('relink-prompt');
  const text = (await strip.count()) ? await strip.first().innerText() : '';
  if (status === 'reauth_required') {
    await page.getByText('Probe Bank').first().evaluate(e => e.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/relink-reauth-390.png' });
  }
  await ctx.close();
  return text;
};

const broken = await readPrompt('reauth_required');
console.log(`reauth_required: ${JSON.stringify(broken)}`);
const healthy = await readPrompt('active');
console.log(`active (control): ${JSON.stringify(healthy)}`);
if (/sign in again/i.test(healthy)) await done(1, 'a healthy connection says the bank needs a sign-in.');
if (!/sign in again/i.test(broken)) await done(1, 'a reauth_required connection shows no "sign in again" prompt.');
if (!/Re-link/.test(broken)) await done(1, 'the broken-link prompt has no Re-link button.');
await done(0, 'PASS: a reauth_required bank row says syncing stopped and offers Re-link; an active row does not. Reads answered in-browser, writes aborted.');
