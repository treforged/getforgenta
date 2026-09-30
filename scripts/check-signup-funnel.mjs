// check:signup-funnel - PRESSES every pre-signup step on a SIGNED-OUT session at 390x844 and prints
// the funnel rows it expects the page to have sent (ask 6dbd80d8).
//
// It reads nothing back itself: signup_funnel_events is INSERT-only for anon by design, so the read
// is a SQL query the desk runs afterwards (printed at the end, with this run's start time).
// What it asserts in the browser: every expected step produced a 2xx INSERT to
// /rest/v1/signup_funnel_events, and NOTHING in any insert body carries the typed email or name.
//
// SAFETY: the sign-up call (/auth/v1/signup) is answered in the browser with a fake "confirm your
// email" response, so no account is created and no email is sent. The Google tap opens the
// provider page in a popup that is closed unread. Nothing else is written.
//
// Usage: npm run check:signup-funnel   (dev server on BASE, default http://localhost:8080)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const EMAIL = 'funnel-walk@forgenta.test';
const NAME = 'Funnel Walk';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const sent = [];
const leaks = [];
ctx.on('request', (req) => {
  if (!req.url().includes('/rest/v1/signup_funnel_events') || req.method() !== 'POST') return;
  const body = req.postData() || '';
  if (body.includes(EMAIL) || body.includes('funnel') && body.includes('walk') || body.includes(NAME)) leaks.push(body);
});
ctx.on('response', async (res) => {
  const req = res.request();
  if (!req.url().includes('/rest/v1/signup_funnel_events') || req.method() !== 'POST') return;
  let step = '?';
  try { step = JSON.parse(req.postData() || '{}').step; } catch { /* reported below */ }
  sent.push({ step, body: req.postData(), status: res.status() });
});
await ctx.route('**/auth/v1/signup**', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000000', email: EMAIL, aud: 'authenticated', role: '', created_at: new Date().toISOString(), identities: [{}] }),
}));

const startedAt = new Date().toISOString();
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle' });
await wait(1500);
const reject = page.getByRole('button', { name: /reject/i });
if (await reject.count()) { /* leave the banner up: an undecided visitor is the case that counts */ }

await page.getByRole('button', { name: 'Start Free' }).click();
await wait(800);
// A value HTML accepts and the schema refuses, so the validation branch fires.
await page.getByLabel('Display name').fill(NAME);
await page.getByLabel('Email').fill('a@b');
await page.getByLabel('Password', { exact: true }).fill('walkpass123');
await page.getByLabel('Confirm password').fill('walkpass123');
await page.getByRole('button', { name: 'Create Account' }).click({ force: true });
await wait(800);

const popupP = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
// NOT a forced click: at 390x844 the cookie banner covers this button until it is dismissed or
// scrolled clear (measured 2026-09-30), and a forced click lands on the banner, not the button.
const google = page.getByRole('button', { name: 'Continue with Google' });
await page.evaluate(() => document.scrollingElement.scrollTo(0, document.scrollingElement.scrollHeight));
await google.click({ timeout: 8000 });
const popup = await popupP;
if (popup) await popup.close();
await wait(1500);

await page.getByLabel('Email').fill(EMAIL);
await page.getByRole('button', { name: 'Create Account' }).click({ force: true });
await wait(2500);

await browser.close();

const EXPECT = ['app_opened', 'welcome_shown', 'signup_form_shown', 'tap_email', 'auth_error', 'tap_google', 'signup_completed', 'confirm_email_shown'];
let fail = 0;
for (const step of EXPECT) {
  const hits = sent.filter((s) => s.step === step);
  const ok = hits.some((h) => h.status >= 200 && h.status < 300);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}: ${hits.map((h) => `${h.status} ${h.body}`).join(' | ') || 'not sent'}`);
}
if (sent.length === 0) { console.log('FAIL nothing was sent at all - instrument or app broken'); fail++; }
if (leaks.length) { console.log(`FAIL ${leaks.length} insert(s) carried the typed email or name:`, leaks); fail++; }
else console.log(`PASS no insert carried the typed email or name (${sent.length} inserts checked)`);
// The DATABASE clock stamps created_at, and this PC's clock ran ~45 s ahead of it on 2026-09-30,
// so a filter built from the local start time returned ZERO rows over 8 real inserts.
console.log(`\nRead back (DB clock; local start was ${startedAt}): select id, step, method, detail, platform, created_at from public.signup_funnel_events where created_at >= now() - interval '10 minutes' order by id;`);
process.exit(fail ? 1 : 0);
