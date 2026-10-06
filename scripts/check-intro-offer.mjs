#!/usr/bin/env node
/**
 * check-intro-offer.mjs - the WEB paywall's first-year intro offer (ask a6375f1c), /premium at 390x844, signed in.
 *
 * The server decides eligibility (`create-checkout` with action:'offer'), so this gate ANSWERS that call in the
 * browser (route.fulfill) and asserts what the page shows and what it sends. user_subscriptions is answered as
 * empty, so the walk account reads as a free user whatever its real row says.
 * ASSERTS: offer on -> the price block shows $10.00 and "Then $89.99/yr" (Yearly), $1.00 and "Then $9.99/mo"
 * after pressing Monthly; no "SAVE 25%"; NO struck-through text anywhere (no "was" price, ask 599911a7);
 * pressing Get Monthly sends intro:true; a 409 shows the "not available" toast and the page drops the offer.
 * CONTROLS: offer off -> no offer block, "$89.99" and "SAVE 25%" show; a 400 (old deployed function) -> no offer.
 * DOES NOT COVER: the real server, Stripe's discount on the invoice, the native paywall, desktop widths.
 * USAGE: npm run check:intro-offer    EXITS: 0 pass . 1 the paywall is wrong . 2 could not test
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
const ctx = await browser.newContext({ viewport: VIEW });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => {
  localStorage.setItem('tre_cookie_consent', JSON.stringify({
    version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
  }));
});

const OFFER_ON = { status: 200, json: { eligible: true, monthly: true, yearly: true } };
const OFFER_OFF = { status: 200, json: { eligible: false, monthly: false, yearly: false } };
const OLD_FUNCTION = { status: 400, json: { error: 'Invalid plan' } };
let offerReply = OFFER_OFF;
let offerCalls = 0;
let dropAfter409 = false;
const checkouts = [];
let aborted = 0;
await page.route(/\/(rest|functions)\/v1\//, async route => {
  const req = route.request();
  const u = req.url();
  if (/\/rest\/v1\/user_subscriptions\b/.test(u) && req.method() === 'GET') {
    if ((req.headers().accept || '').includes('vnd.pgrst.object')) {
      return route.fulfill({ status: 406, contentType: 'application/json',
        body: JSON.stringify({ code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'no rows' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  }
  if (/\/rest\/v1\//.test(u)) {
    if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue();
    aborted += 1;
    return route.abort();
  }
  if (/\/functions\/v1\/create-checkout\b/.test(u) && req.method() === 'POST') {
    const body = req.postDataJSON() ?? {};
    if (body.action === 'offer') {
      offerCalls += 1;
      return route.fulfill({ status: offerReply.status, contentType: 'application/json', body: JSON.stringify(offerReply.json) });
    }
    checkouts.push(body);
    if (dropAfter409) offerReply = OFFER_OFF;
    return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'intro_not_available' }) });
  }
  if (req.method() === 'OPTIONS') return route.continue();
  aborted += 1;
  return route.abort();
});

const priceBlock = page.getByTestId('intro-offer-price');
const bodyText = () => page.locator('body').innerText();
const struck = () => page.evaluate(() => [...document.querySelectorAll('body *')].filter(e =>
  getComputedStyle(e).textDecorationLine.includes('line-through') && (e.textContent || '').trim()).length);
const load = async reply => {
  offerReply = reply;
  const before = offerCalls;
  await page.goto(`${BASE}/premium`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay').count()); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  try { await page.getByRole('button', { name: /^Get (Yearly|Monthly)/ }).first().waitFor({ state: 'visible', timeout: 15000 }); }
  catch { await done(2, 'CONTROL FAILED: the paywall Get button never rendered (premium account, or a broken page?).'); }
  for (let i = 0; i < 20 && offerCalls === before; i += 1) await page.waitForTimeout(250);
  if (offerCalls === before) await done(2, 'CONTROL FAILED: the page never asked create-checkout for the offer.');
  await page.waitForTimeout(800);
};

// -- B: CONTROL - no offer. The plain paywall must show its regular price and SAVE 25%.
await load(OFFER_OFF);
const plain = await bodyText();
console.log(`no offer: testid ${await priceBlock.count()}, $89.99 ${plain.includes('$89.99')}, SAVE 25% ${plain.includes('SAVE 25%')}`);
if (!plain.includes('SAVE 25%') || !plain.includes('$89.99')) await done(2, 'CONTROL FAILED: the plain paywall does not show $89.99 and SAVE 25%.');
if (await priceBlock.count()) await done(1, 'the offer block shows when the server said no offer.');

// -- C: an OLD deployed function (it refuses `action`) must read as no offer.
await load(OLD_FUNCTION);
const old = await bodyText();
console.log(`old function (400): testid ${await priceBlock.count()}, $89.99 ${old.includes('$89.99')}`);
if ((await priceBlock.count()) || !old.includes('$89.99')) await done(1, 'a 400 from an old create-checkout showed the offer.');

// -- A: offer on.
await load(OFFER_ON);
try { await priceBlock.waitFor({ state: 'visible', timeout: 10000 }); }
catch { await done(1, 'the server offered the intro price and the page did not show it.'); }
const yearly = await priceBlock.innerText();
console.log(`offer yearly: ${JSON.stringify(yearly)}`);
if (!yearly.includes('$10.00') || !yearly.includes('Then $89.99/yr')) await done(1, `yearly offer block reads ${JSON.stringify(yearly)}.`);
const offered = await bodyText();
const nStruck = await struck();
console.log(`offer: SAVE 25% ${offered.includes('SAVE 25%')}, struck-through elements ${nStruck}`);
if (offered.includes('SAVE 25%')) await done(1, '"SAVE 25%" still shows under the intro offer.');
if (nStruck) await done(1, `${nStruck} struck-through element(s) on the paywall - no "was" price allowed.`);
await page.getByRole('button', { name: 'Monthly', exact: true }).click();
await page.waitForTimeout(400);
const monthly = await priceBlock.innerText();
console.log(`offer monthly: ${JSON.stringify(monthly)}`);
if (!monthly.includes('$1.00') || !monthly.includes('Then $9.99/mo')) await done(1, `monthly offer block reads ${JSON.stringify(monthly)}.`);
await priceBlock.evaluate(e => e.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(300);
await page.screenshot({ path: 'test-results/intro-offer-390.png' });

dropAfter409 = true;
await page.getByRole('button', { name: /^Get Monthly/ }).click();
for (let i = 0; i < 20 && checkouts.length === 0; i += 1) await page.waitForTimeout(250);
console.log(`checkout bodies: ${JSON.stringify(checkouts)}`);
if (checkouts.length !== 1) await done(1, `pressing Get Monthly sent ${checkouts.length} checkout call(s), want 1.`);
if (checkouts[0].plan !== 'monthly' || checkouts[0].intro !== true) await done(1, `checkout sent ${JSON.stringify(checkouts[0])}, want plan monthly + intro true.`);
try { await page.getByText(/first-year offer is not available/i).first().waitFor({ state: 'visible', timeout: 5000 }); }
catch { await done(1, 'a 409 from checkout showed no "offer is not available" message.'); }
let gone = false;
for (let i = 0; i < 32 && !gone; i += 1) { gone = (await priceBlock.count()) === 0; if (!gone) await page.waitForTimeout(250); }
const after = await bodyText();
console.log(`after 409: testid gone ${gone}, $9.99 shown ${after.includes('$9.99')}, other writes aborted ${aborted}`);
if (!gone || !after.includes('$9.99')) await done(1, 'after a 409 the page kept the intro offer instead of the regular price.');
await done(0, 'PASS: the offer shows $10.00 / $1.00 with "Then" the regular price, no SAVE 25%, nothing struck through; Get sends intro:true; a 409 drops the offer with a message; no offer and an old function both show $89.99. Answered in-browser, nothing reached Stripe.');
