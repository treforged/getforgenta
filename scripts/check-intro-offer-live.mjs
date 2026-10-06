#!/usr/bin/env node
/**
 * check-intro-offer-live.mjs - the intro offer against the DEPLOYED create-checkout, on the walk account.
 *
 * WHY IT EXISTS (2026-10-06): check:intro-offer ANSWERS the offer call in the browser, so it could never
 * see the server bug that hid the offer from every free user whose row carried the column-default
 * purchase_provider = 'stripe' (6 real users; fixed 394158ee, deployed v78). This gate lets the offer
 * call reach the real function.
 *
 * THE ACCOUNT IS THE INSTRUMENT. deck-walk@forgenta.test has the bug-shaped row: plan free, the
 * default provider 'stripe', a Stripe customer, no subscription id. CONTROL: the script reads that row
 * with the account's own JWT first and exits 2 if it no longer has that shape, because then a green
 * would prove nothing about the bug.
 *
 * ASSERTS: (A) the deployed function, called directly, answers eligible/monthly/yearly = true;
 * (B) /premium at 390x844 shows the intro price block ($9.99, "Then $89.99/yr") with the offer call
 * passed through to the real server. Every other write is ABORTED, and any create-checkout call that
 * is not action:'offer' is aborted, so no Stripe session is ever created.
 * RED PROOF (2026-10-06): set the walk row's purchase_provider to 'apple' (a real past-purchase
 * value) -> exit 1; restored to 'stripe'.
 * DOES NOT COVER: Stripe applying the coupon on the invoice, the native paywall, desktop widths.
 * USAGE: npm run check:intro-offer-live    EXITS: 0 pass . 1 the offer is wrong . 2 could not test
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
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
if (!session.access_token) fail(2, `sign-in returned ${res.status}`);
const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };

// -- CONTROL: the account still carries the bug-shaped row.
const rowRes = await fetch(
  `${url}/rest/v1/user_subscriptions?select=plan,subscription_status,purchase_provider,stripe_subscription_id,apple_original_transaction_id&user_id=eq.${session.user.id}`,
  { headers: rest },
);
if (!rowRes.ok) fail(2, `reading the walk account's subscription row returned ${rowRes.status}.`);
const row = (await rowRes.json())[0];
const shapeOk = row && row.plan === 'free' && !row.stripe_subscription_id && !row.apple_original_transaction_id;
if (!shapeOk) fail(2, `CONTROL FAILED: the walk row is not a plain free row (${JSON.stringify(row)}); this account cannot exercise the offer.`);
console.log(`control: walk row plan=${row.plan} provider=${row.purchase_provider} sub=none`);

// -- A: the deployed function, called directly.
const offerRes = await fetch(`${url}/functions/v1/create-checkout`, {
  method: 'POST',
  headers: { ...rest, Origin: 'https://getforgenta.com' },
  body: JSON.stringify({ action: 'offer' }),
});
const offer = await offerRes.json().catch(() => ({}));
console.log(`A: deployed offer -> ${offerRes.status} ${JSON.stringify(offer)}`);
if (offerRes.status !== 200) fail(2, `the offer call returned ${offerRes.status}.`);
if (!(offer.eligible === true && offer.monthly === true && offer.yearly === true)) {
  fail(1, `the deployed function refuses the offer to a free account with provider=${row.purchase_provider}.`);
}

// -- B: the paywall, with the offer call reaching the real server.
let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}).`); }

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

let liveOfferCalls = 0;
let blocked = 0;
await page.route(/\/(rest|functions)\/v1\//, async route => {
  const req = route.request();
  const u = req.url();
  if (req.method() === 'OPTIONS') return route.continue();
  if (/\/functions\/v1\/create-checkout\b/.test(u) && req.method() === 'POST') {
    const body = req.postDataJSON() ?? {};
    if (body.action === 'offer') { liveOfferCalls += 1; return route.continue(); }
    blocked += 1;
    return route.abort();
  }
  if (/\/rest\/v1\//.test(u) && (req.method() === 'GET' || req.method() === 'HEAD')) return route.continue();
  blocked += 1;
  return route.abort();
});

await page.goto(`${BASE}/premium`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay').count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}
try { await page.getByRole('button', { name: /^Get (Yearly|Monthly)/ }).first().waitFor({ state: 'visible', timeout: 15000 }); }
catch { await done(2, 'CONTROL FAILED: the paywall Get button never rendered.'); }
for (let i = 0; i < 40 && liveOfferCalls === 0; i += 1) await page.waitForTimeout(250);
if (liveOfferCalls === 0) await done(2, 'CONTROL FAILED: the page never asked the server for the offer.');
const block = page.getByTestId('intro-offer-price');
try { await block.waitFor({ state: 'visible', timeout: 10000 }); }
catch {
  await page.screenshot({ path: 'test-results/intro-offer-live-fail.png' });
  await done(1, 'the paywall did not show the intro offer with the real server answering (frame: test-results/intro-offer-live-fail.png).');
}
const text = (await block.innerText()).replace(/\s+/g, ' ');
if (!text.includes('$9.99') || !text.includes('Then $89.99/yr')) await done(1, `intro block reads "${text}", expected $9.99 and "Then $89.99/yr".`);
await page.screenshot({ path: 'test-results/intro-offer-live.png' });
await done(0, `PASS - live offer eligible; paywall shows "${text}" (live offer calls ${liveOfferCalls}, other writes blocked ${blocked}).`);
