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
let fail = 0;

// CONTROL: consent is UNDECIDED in this fresh context, so the banner shows on an ordinary page.
// Without this, a context where consent was already decided would pass the reach check below
// for the wrong reason.
await page.goto(`${BASE}/privacy`, { waitUntil: 'networkidle' });
await wait(1200);
const bannerOnPrivacy = await page.getByRole('region', { name: 'Cookie consent' }).count();
console.log(`${bannerOnPrivacy ? 'PASS' : 'FAIL'} control: cookie banner is showing on /privacy (${bannerOnPrivacy})`);
if (!bannerOnPrivacy) fail++;

await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle' });
await wait(1500);
const reject = page.getByRole('button', { name: /reject/i });
if (await reject.count()) { /* leave the banner up: an undecided visitor is the case that counts */ }

await page.getByRole('button', { name: 'Start Free' }).click();
await wait(800);

// REACH (ask 791b4b03): with NO scrolling, each OAuth button is inside the viewport and is the
// top-most element at its own centre. The cookie banner used to sit over both at 390x844.
const reach = await page.evaluate(() => ['Continue with Google', 'Continue with Apple'].map((n) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === n);
  if (!b) return { n, found: false };
  const r = b.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { n, found: true, inView: r.top >= 0 && r.bottom <= window.innerHeight, onTop: !!top && b.contains(top),
    cover: top && !b.contains(top) ? (top.closest('[aria-label]')?.getAttribute('aria-label') || top.tagName) : '' };
}));
for (const r of reach) {
  const ok = r.found && r.inView && r.onTop;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} reach "${r.n}": found=${r.found} inView=${r.inView} onTop=${r.onTop}${r.cover ? ` covered by ${r.cover}` : ''}`);
}
// ONE PASSWORD FIELD, AND A TOGGLE THAT SHOWS IT (ask 075107d6). The press must CHANGE the input's
// type and the toggle's pressed state, both ways - a toggle that does nothing passes an absence check.
{
  const confirmCount = await page.getByLabel('Confirm password').count();
  const pw = page.getByLabel('Password', { exact: true });
  await pw.fill('walkpass123');
  const t0 = await pw.getAttribute('type');
  const toggle = page.getByRole('button', { name: /show password|hide password/i });
  const hasToggle = await toggle.count();
  let t1 = 'n/a'; let p1 = 'n/a'; let t2 = 'n/a';
  if (hasToggle) {
    await toggle.click(); t1 = await pw.getAttribute('type'); p1 = await toggle.getAttribute('aria-pressed');
    await toggle.click(); t2 = await pw.getAttribute('type');
  }
  const ok = confirmCount === 0 && hasToggle === 1 && t0 === 'password' && t1 === 'text' && p1 === 'true' && t2 === 'password';
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} one password field + toggle: confirm fields=${confirmCount} toggle=${hasToggle} type ${t0} -> ${t1} (pressed=${p1}) -> ${t2}`);
}
// A value HTML accepts and the schema refuses, so the validation branch fires.
await page.getByLabel('Display name').fill(NAME);
await page.getByLabel('Email').fill('a@b');
await page.getByLabel('Password', { exact: true }).fill('walkpass123');
await page.getByRole('button', { name: 'Create Account' }).click({ force: true });
await wait(800);

const popupP = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
// NOT a forced click, so an element sitting over the button fails the press (see REACH above).
await page.getByRole('button', { name: 'Continue with Google' }).click({ timeout: 8000 });
const popup = await popupP;
if (popup) await popup.close();
await wait(1500);

await page.getByLabel('Email').fill(EMAIL);
// The Google tap leaves the form in "Processing…" until the popup poll (600 ms) sees it closed.
// Pressing before that raced it and dropped the last two steps on one run in three.
const createBtn = page.getByRole('button', { name: 'Create Account' });
await createBtn.waitFor({ state: 'visible', timeout: 10000 });
for (let i = 0; i < 20 && await createBtn.isDisabled(); i++) await wait(250);
await page.getByRole('button', { name: 'Create Account' }).click({ force: true });
await wait(2500);

await browser.close();

const EXPECT = ['app_opened', 'welcome_shown', 'signup_form_shown', 'tap_email', 'auth_error', 'tap_google', 'signup_completed', 'confirm_email_shown'];
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
