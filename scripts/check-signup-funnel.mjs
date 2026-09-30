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
// A gmail-shaped address so the confirm screen offers 'Open Gmail'. Nothing is ever sent to it:
// the sign-up and resend calls are both answered in the browser below.
const EMAIL = 'forgenta.funnel.walk.check@gmail.com';
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
let resendCalls = 0;
await ctx.route('**/auth/v1/resend**', (route) => { resendCalls++; return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
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
// A controllable clock, so the 60 s resend cooldown can be crossed without a 60 s wait.
await page.clock.install();
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

// CONFIRM SCREEN (ask ee8a0b89): an Open-inbox button for a known provider that opens that inbox,
// and a resend that is refused during the cooldown and works after it. Each press asserts a change.
{
  const openBtn = page.getByRole('button', { name: 'Open Gmail' });
  const hasOpen = await openBtn.count();
  let openedUrl = '';
  if (hasOpen) {
    const pop = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
    await openBtn.click();
    const tab = await pop;
    if (tab) { openedUrl = tab.url(); await tab.close(); }
  }
  // A signed-out browser is redirected to Google sign-in, carrying the inbox as its continue= target.
  const okOpen = hasOpen === 1 && (openedUrl.startsWith('https://mail.google.com/')
    || /^https:\/\/accounts\.google\.com\/.*continue=https:\/\/mail\.google\.com\//.test(openedUrl));
  if (!okOpen) fail++;
  console.log(`${okOpen ? 'PASS' : 'FAIL'} open inbox: button=${hasOpen} opened=${openedUrl || 'nothing'}`);

  const resend = page.getByRole('button', { name: /resend email/i });
  const hasResend = await resend.count();
  const label0 = hasResend ? (await resend.textContent()).trim() : '';
  const disabled0 = hasResend ? await resend.isDisabled() : false;
  await page.clock.fastForward(61_000);
  await page.waitForTimeout(500);
  const label1 = hasResend ? (await resend.textContent()).trim() : '';
  const before = resendCalls;
  if (hasResend && !(await resend.isDisabled())) await resend.click();
  await page.waitForTimeout(1200);
  const label2 = hasResend ? (await resend.textContent()).trim() : '';
  const okResend = hasResend === 1 && disabled0 && /in \d+s/.test(label0) && label1 === 'Resend email'
    && resendCalls === before + 1 && /in \d+s/.test(label2);
  if (!okResend) fail++;
  console.log(`${okResend ? 'PASS' : 'FAIL'} resend: "${label0}" disabled=${disabled0} -> +61s "${label1}" -> press sent ${resendCalls - before} -> "${label2}"`);
}

// TRY IT FIRST (ask 4180a9dd), in a FRESH page so the per-launch dedupe starts clean: the welcome
// button must open the demo, and the demo must offer the way back to sign-up. Both halves: a demo
// with no way out is a dead end, which is worse than no demo.
{
  const p2 = await ctx.newPage();
  await p2.goto(`${BASE}/auth`, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(1200);
  const tryBtn = p2.getByRole('button', { name: /try it first/i });
  if (await tryBtn.count()) await tryBtn.click();
  await p2.waitForURL('**/dashboard', { timeout: 15000 }).catch(() => {});
  await p2.waitForTimeout(2500);
  const onDemo = p2.url().endsWith('/dashboard') && await p2.getByText('Demo', { exact: true }).count() > 0;
  const back = p2.getByRole('link', { name: /sign up free/i }).first();
  const hasBack = await back.count();
  let returned = false;
  if (hasBack) {
    await back.click();
    await p2.waitForTimeout(2000);
    returned = p2.url().endsWith('/auth') && await p2.getByRole('button', { name: 'Start Free' }).count() > 0;
  }
  const ok = onDemo && hasBack > 0 && returned;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} try it first: demo opened=${onDemo} sign-up link=${hasBack > 0} back on welcome=${returned}`);
  await p2.close();
}

await browser.close();

const EXPECT = ['app_opened', 'welcome_shown', 'signup_form_shown', 'tap_email', 'auth_error', 'tap_google', 'signup_completed', 'confirm_email_shown', 'try_demo'];
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
