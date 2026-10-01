#!/usr/bin/env node
/**
 * check-one-banner.mjs - a NEW user's Dashboard shows ONE nudge banner at a time (Sam, 2026-10-01).
 *
 * walk:empty showed the "first bank connection is free" notice and the "no two-factor protection"
 * banner stacked, about 330px at 390 before a new user saw anything of their own. The rule now: the
 * bank notice first; the 2FA banner only once the bank notice is gone.
 *
 * AT 390x844, signed in as a throwaway @forgenta.test account with NO data and no MFA factor:
 *   1. the bank notice is on screen and the 2FA banner is NOT          (frame one-banner-1.png)
 *   2. PRESS the bank notice's Dismiss -> the bank notice is gone AND the 2FA banner appears
 *                                                                       (frame one-banner-2.png)
 *   3. PRESS the 2FA Dismiss -> it is gone too.
 * Each press must CHANGE the screen; a press that changes nothing is a failure.
 * POSITIVE CONTROL: step 2 is itself the control that the 2FA banner can render for this account -
 * without it, "no 2FA banner" in step 1 could mean the account simply never qualifies.
 *
 * ACCOUNT: EMPTY_WALK_EMAIL / EMPTY_WALK_PASSWORD, the same throwaway walk:empty uses; created in
 * SQL and deleted after. Only write: the shared first-run PATCH on that user.
 * DOES NOT COVER: desktop widths, demo, a user who already linked a bank (unit tests own those).
 * EXITS: 0 pass . 1 a finding . 2 could not test
 */
import { readFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };
const env = readFileSync('.env.local', 'utf8');
const pick = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const url = pick('VITE_SUPABASE_URL');
const anon = pick('VITE_SUPABASE_PUBLISHABLE_KEY');
const email = process.env.EMPTY_WALK_EMAIL;
const password = process.env.EMPTY_WALK_PASSWORD;
if (!url || !anon || !email || !password) fail(2, 'missing supabase url/key or walk credentials.');
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to script a sign-in for "${email}".`);

const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}.`);

const whatsNew = readFileSync('src/lib/whats-new.ts', 'utf8');
const releaseVersion = (whatsNew.match(/version:\s*'([^']+)'/) || [])[1];
if (!releaseVersion) fail(2, 'could not read the release version from src/lib/whats-new.ts.');
const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
const patch = await fetch(`${url}/rest/v1/profiles?user_id=eq.${session.user.id}`, {
  method: 'PATCH', headers: { ...rest, Prefer: 'return=representation' },
  body: JSON.stringify({ founder_note_seen: true, onboarding_completed: true,
    tour_flags: { new_user_done: true, premium_done: true, [`whats_new_${releaseVersion}`]: true } }),
});
if (!patch.ok || ((await patch.json().catch(() => [])).length ?? 0) === 0) fail(2, `settling first-run matched no profile (HTTP ${patch.status}).`);

let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'could not load @playwright/test.'); }
try { await fetch(BASE, { redirect: 'manual' }); } catch { fail(2, `${BASE} is not serving.`); }

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const done = async (code, msg) => { await browser.close(); if (code) fail(code, msg); console.log(msg); process.exit(0); };

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => {
  localStorage.clear();
  localStorage.setItem(k, JSON.stringify(s));
  localStorage.setItem('tre_cookie_consent', JSON.stringify({ version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false }));
}, [`sb-${ref}-auth-token`, session]);

const BANK = 'Your first bank connection is free';
const MFA = 'Your account has no two-factor protection';
const shown = (t) => page.getByText(t, { exact: true }).isVisible().catch(() => false);
const waitFor = async (pred, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await pred()) return true; await page.waitForTimeout(250); }
  return false;
};
const dismissOf = (t) => page.locator('div', { has: page.getByText(t, { exact: true }) })
  .getByRole('button', { name: 'Dismiss' }).last();

mkdirSync('test-results/one-banner', { recursive: true });
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });

if (!(await waitFor(() => shown(BANK)))) await done(2, 'the bank notice never appeared - is this account empty and undismissed?');
// Give the MFA check time to land: a 2FA banner that arrives late would also break the rule.
await page.waitForTimeout(3000);
const step1 = { bank: await shown(BANK), mfa: await shown(MFA) };
await page.screenshot({ path: 'test-results/one-banner/one-banner-1.png' });
console.log(`step 1  bank ${step1.bank}  2fa ${step1.mfa}`);
if (step1.mfa) await done(1, 'both banners are on screen at once.');

await dismissOf(BANK).click();
const step2ok = await waitFor(async () => !(await shown(BANK)) && (await shown(MFA)));
const step2 = { bank: await shown(BANK), mfa: await shown(MFA) };
await page.screenshot({ path: 'test-results/one-banner/one-banner-2.png' });
console.log(`step 2  bank ${step2.bank}  2fa ${step2.mfa}`);
if (!step2ok) await done(1, 'dismissing the bank notice did not bring up the 2FA banner (or the bank notice stayed).');

await dismissOf(MFA).click();
if (!(await waitFor(async () => !(await shown(MFA)), 5000))) await done(1, 'pressing the 2FA Dismiss changed nothing.');
console.log('step 3  2fa dismissed');
await done(0, 'PASS: one banner at a time - bank first, 2FA after it is dismissed, each press changed the screen. Frames test-results/one-banner/.');
