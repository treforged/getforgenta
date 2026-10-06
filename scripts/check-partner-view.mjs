#!/usr/bin/env node
// check:partner-view - a PHONE can open the partner's budget (ask 07351a98). Until 2026-10-05 the
// only switch into partner view was the desktop sidebar (hidden below lg), so at 390px there were
// 0 ways in while the linked card told the user to "Use View partner in the menu". At 390x844,
// signed in as the walk account, the partner_links read is answered IN THE BROWSER with one ACTIVE
// link (the walk user accepted it); every other write is aborted - nothing is written.
// Control: /account shows "Linked with". Then "View their budget" must be visible, and PRESSING
// it must land on /dashboard with the PARTNER VIEW banner. Red on the pre-fix card (no button).
// Does NOT cover desktop (the sidebar switch), the partner's data, or unlinking.
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

const PARTNER = '00000000-0000-4000-8000-0000000000aa';
const link = [{
  id: '00000000-0000-4000-8000-0000000000ab', inviter_id: PARTNER, accepted_by: session.user.id,
  invitee_email: email, created_at: '2026-10-01T00:00:00Z', expires_at: '2026-10-08T00:00:00Z',
  accepted_at: '2026-10-02T00:00:00Z', revoked_at: null, revoked_by: null,
}];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.route('**/rest/v1/**', (route) => {
  const req = route.request();
  if (req.method() === 'GET' || req.method() === 'HEAD') {
    if (/\/rest\/v1\/partner_links\b/.test(req.url())) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(link) });
    }
    return route.continue();
  }
  if (req.method() === 'POST' && /\/rest\/v1\/rpc\//.test(req.url())) return route.continue();
  return route.abort();
});
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));
await page.goto(`${BASE}/account?section=profile`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay, [role="dialog"]').count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}
const linked = page.getByText(/Linked with/).first();
await linked.waitFor({ timeout: 20000 }).catch(() => {});
if (!(await linked.count())) { await browser.close(); fail(2, `CONTROL FAILED - no "Linked with" on ${page.url()}.`); }
await linked.scrollIntoViewIfNeeded();
const btn = page.getByRole('button', { name: 'View their budget' }).filter({ visible: true });
const n = await btn.count();
console.log(`390 /account: linked card shown, visible "View their budget" buttons = ${n}`);
if (n !== 1) { await page.screenshot({ path: 'test-results/partner-view-390.png' }); await browser.close(); fail(1, `expected 1 visible "View their budget" button at 390, found ${n}`); }
const bannerBefore = await page.getByText('Partner view', { exact: false }).filter({ visible: true }).count();
await btn.first().click();
await page.waitForTimeout(4000);
const path = new URL(page.url()).pathname;
const bannerAfter = await page.getByText('Partner view', { exact: false }).filter({ visible: true }).count();
await page.screenshot({ path: 'test-results/partner-view-390.png' });
console.log(`after press: path ${path}, partner-view banner ${bannerBefore} -> ${bannerAfter}`);
await browser.close();
if (path !== '/dashboard' || bannerAfter < 1 || bannerBefore !== 0) fail(1, `the press did not open partner view (path ${path}, banner ${bannerBefore} -> ${bannerAfter})`);
console.log('PASS - a phone can open the partner view from the linked card.');
