#!/usr/bin/env node
// check:invite-resume - an invite code SURVIVES sign-in and onboarding (ask 4f623f93). Partner and
// friend invite emails link to /settings?partner_code=X and tell the reader to create an account
// first. Before 2026-10-05 the route guard's two bounces (signed out -> /auth, not onboarded ->
// /onboarding) dropped the query string, so a NEW partner never saw the code.
// Needs a THROWAWAY @forgenta.test account created in SQL, passed as INVITE_RESUME_EMAIL /
// INVITE_RESUME_PASSWORD, and DELETED after. Its only writes are to that account's own profile row.
// Arms, in one browser: (1) signed out, the invite URL lands on /auth; (2) signed in, not onboarded,
// /dashboard lands on /onboarding - the CONTROL that the account really is new; (3) the profile is
// marked onboarded (the wizard's own write) and /dashboard must land on /account?partner_code=X with
// the code field filled; (4) a second /dashboard visit stays on /dashboard (resumed once only).
// Red on the pre-fix guard: arm 3 lands on /dashboard. Does NOT cover the native app (an email link
// opens Safari, whose storage the app cannot read), OAuth sign-up, or accepting the invite.
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const CODE = 'resumeProbeCode0123456';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };
const env = readFileSync('.env.local', 'utf8');
const pick = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const url = pick('VITE_SUPABASE_URL');
const anon = pick('VITE_SUPABASE_PUBLISHABLE_KEY');
const email = process.env.INVITE_RESUME_EMAIL;
const password = process.env.INVITE_RESUME_PASSWORD;
if (!url || !anon || !email || !password) fail(2, 'set INVITE_RESUME_EMAIL and INVITE_RESUME_PASSWORD (a throwaway made in SQL).');
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to script a sign-in for "${email}".`);
const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}.`);
const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const setProfile = async (body) => {
  const r = await fetch(`${url}/rest/v1/profiles?user_id=eq.${session.user.id}`, { method: 'PATCH', headers: rest, body: JSON.stringify(body) });
  const rows = await r.json().catch(() => []);
  if (!r.ok || !rows.length) fail(2, `profile write matched no row (HTTP ${r.status}).`);
};
await setProfile({ onboarding_completed: false });

let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'Could not load @playwright/test.'); }
try { await fetch(BASE, { redirect: 'manual' }); } catch (err) { fail(2, `${BASE} is not serving (${err.message}).`); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const settle = async () => { await page.waitForTimeout(6000); };
const where = () => { const u = new URL(page.url()); return u.pathname + u.search; };
const failures = [];

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));
await page.goto(`${BASE}/settings?partner_code=${CODE}`, { waitUntil: 'domcontentloaded' });
await settle();
console.log(`arm 1 signed out: ${where()}`);
if (!where().startsWith('/auth')) failures.push(`arm 1: signed-out invite landed on ${where()}, expected /auth`);

await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await settle();
console.log(`arm 2 new account: ${where()}`);
if (!where().startsWith('/onboarding')) { await browser.close(); fail(2, `CONTROL FAILED - a not-onboarded account landed on ${where()}, not /onboarding.`); }

await setProfile({ onboarding_completed: true, founder_note_seen: true });
// The wizard's own exit is navigate('/dashboard'); a fresh load of /dashboard is the same guard pass.
// Logged first, because an open wizard can notice the completed profile and leave on its own.
await settle();
console.log(`         after the profile write, before reload: ${where()}`);
if (where().startsWith('/onboarding')) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await settle();
}
const filled = await page.locator('#partner-invite-code').inputValue().catch(() => '');
console.log(`arm 3 after onboarding: ${where()} | code field ${filled === CODE ? 'filled' : `"${filled}"`}`);
await page.screenshot({ path: 'test-results/invite-resume-390.png' });
if (where() !== `/account?partner_code=${CODE}`) failures.push(`arm 3: landed on ${where()}, expected /account?partner_code=${CODE}`);
else if (filled !== CODE) failures.push('arm 3: the code field is not filled');

await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await settle();
console.log(`arm 4 next visit: ${where()}`);
if (!where().startsWith('/dashboard')) failures.push(`arm 4: a second visit went to ${where()} - the invite resumed more than once`);
await browser.close();
if (failures.length) fail(1, failures.join('; '));
console.log('PASS - an invite code survives sign-in and onboarding, and resumes once.');
