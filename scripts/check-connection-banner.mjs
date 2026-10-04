#!/usr/bin/env node
/**
 * check-connection-banner.mjs - when Forgenta cannot reach its back end, the banner NAMES the cause
 * (ask e618b2f0, after the 2026-10-04 Supabase API Gateway hang).
 *
 * HOW A REQUEST IS PRODUCED: an EXPIRED placeholder session is put in localStorage, so the app's
 * own auth restore sends a real POST /auth/v1/token as it boots. No sign-in, no credentials, and
 * nothing reaches the database: every request to <project>.supabase.co is answered or held in
 * the browser by page.route. The four status pages are answered in-browser too (route.fulfill),
 * so each arm controls exactly what the providers "report".
 *
 * ARMS, each at 390x844 AND 1440x900, each in a fresh context, each asserting the banner TEXT:
 *   1 control   supabase answers (token 400 = reachable)        -> NO banner, after the hang window
 *   2 offline   context.setOffline(true)                         -> "You're offline"
 *   3 supabase  supabase hangs + Supabase incident               -> names Supabase + the incident
 *   4 unknown   supabase hangs + every provider 'none'           -> "Forgenta can't reach its servers right now."
 *   5 cloudflare supabase hangs + Cloudflare major incident      -> names Cloudflare + the incident
 *   6 vercel    supabase hangs + Vercel major incident           -> names Vercel + the incident
 *   7 recovery  arm 4's page, supabase answers again, PRESS "Try again" -> banner gone (a press that
 *               changes nothing fails)
 *   8 plaid     a /functions/v1/plaid-sync 502 + Plaid incident  -> "Bank sync is delayed: Plaid reports ..."
 *   8b          the same 502 with Plaid 'none'                   -> NO banner (Plaid alone never claims
 *               Forgenta is unreachable, and a healthy Plaid page names nothing)
 *   9 dismiss   arm 8's banner, PRESS Dismiss                    -> banner gone
 * POSITIVE CONTROL: every arm requires the route to have SEEN a Supabase request. A "no banner"
 * from an app that never asked anything would be a zero from a broken instrument.
 *
 * ⚠️ ARM 8 DRIVES ITS REQUEST WITH page.evaluate(fetch), not a UI press: the bank-sync buttons need
 * a signed-in account with a linked bank. The request goes through the same patched window.fetch
 * the app's PlaidLinkButton uses, so the wrapper and the banner are real; the button is not.
 *
 * DOES NOT COVER: a real device, realtime websockets (not fetch, so not observed), production's
 * CSP (the dev server sends none - backend-health.test.ts checks vercel.json), light/dark contrast.
 * BASE_URL overrides the dev server (default http://localhost:8080).
 * EXITS: 0 pass . 1 a finding . 2 could not test
 */
import { readFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const OUT = 'test-results/connection-banner';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };

let env;
try { env = readFileSync('.env.local', 'utf8'); } catch { fail(2, 'no .env.local - cannot learn the Supabase host.'); }
const pick = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const sbUrl = pick('VITE_SUPABASE_URL');
if (!sbUrl) fail(2, 'VITE_SUPABASE_URL missing from .env.local.');
const SB = new URL(sbUrl).origin;
const ref = new URL(sbUrl).hostname.split('.')[0];

let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'could not load @playwright/test.'); }
try { await fetch(BASE, { redirect: 'manual' }); } catch { fail(2, `${BASE} is not serving.`); }

const STATUS = {
  supabase: 'https://status.supabase.com/api/v2/summary.json',
  cloudflare: 'https://www.cloudflarestatus.com/api/v2/summary.json',
  vercel: 'https://www.vercel-status.com/api/v2/summary.json',
  plaid: 'https://status.plaid.com/api/v2/summary.json',
};
const NONE = { status: { indicator: 'none', description: 'All Systems Operational' }, incidents: [], components: [] };
const incident = (indicator, name) => ({
  status: { indicator, description: 'Degraded' }, components: [],
  incidents: [{ name, status: 'identified', impact: indicator, components: [{ name: 'API Gateway' }] }],
});

const HEADLINE = {
  offline: "You're offline",
  supabase: 'Supabase, our database provider, is having an outage: Intermittent latency in Eastern US',
  unknown: "Forgenta can't reach its servers right now.",
  cloudflare: 'Cloudflare, our network provider, is having an outage: Global network degradation',
  vercel: 'Vercel, our hosting provider, is having an outage: Edge network outage',
  plaid: 'Bank sync is delayed: Plaid reports Delayed transactions for some institutions',
};

const browser = await chromium.launch();
const findings = [];
let couldNotTest = null;
mkdirSync(OUT, { recursive: true });

/** One fresh context. `sb.mode` is read per request, so an arm can flip hang -> answer mid-page. */
async function open(viewport, statuses) {
  const ctx = await browser.newContext({ viewport });
  const sb = { mode: 'answer', seen: 0, plaidStatus: 502 };
  for (const [id, url] of Object.entries(STATUS)) {
    await ctx.route(url, route => route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(statuses[id] ?? NONE),
    }));
  }
  await ctx.route(`${SB}/**`, async route => {
    const req = route.request();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    sb.seen++;
    const path = new URL(req.url()).pathname;
    if (sb.mode === 'hang') return; // never fulfilled: exactly what the 2026-10-04 gateway did
    if (path.startsWith('/functions/v1/plaid')) return route.fulfill({ status: sb.plaidStatus, headers: cors, contentType: 'application/json', body: '{"error":"upstream"}' });
    if (path === '/auth/v1/token') return route.fulfill({ status: 400, headers: cors, contentType: 'application/json', body: '{"error":"invalid_grant","error_description":"Invalid Refresh Token"}' });
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: path.startsWith('/rest/') ? '[]' : '{}' });
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k]) => {
    localStorage.clear();
    localStorage.setItem(k, JSON.stringify({ access_token: 'x.y.z', refresh_token: 'placeholder', token_type: 'bearer', expires_in: 3600, expires_at: 1, user: { id: '00000000-0000-0000-0000-000000000000', aud: 'authenticated' } }));
    localStorage.setItem('tre_cookie_consent', JSON.stringify({ version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false }));
  }, [`sb-${ref}-auth-token`]);
  return { ctx, page, sb };
}

const headline = (page) => page.getByTestId('backend-health-headline');
async function readHeadline(page) {
  return (await headline(page).isVisible().catch(() => false)) ? (await headline(page).innerText()).trim() : null;
}
/** Wait until the headline equals `want` (status reads land a moment after the failure). */
async function waitHeadline(page, want, ms) {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) {
    last = await readHeadline(page);
    if (last === want) return last;
    await page.waitForTimeout(250);
  }
  return last;
}
function check(arm, vp, got, want) {
  const ok = got === want;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${arm.padEnd(11)} ${vp}  ${JSON.stringify(got)}`);
  if (!ok) findings.push(`${arm} @${vp}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}
function needSeen(arm, vp, sb) {
  if (sb.seen === 0) couldNotTest ??= `${arm} @${vp}: no request to ${SB} was seen - the app never asked, so the arm proves nothing.`;
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  const vp = `${viewport.width}x${viewport.height}`;
  console.log(`== ${vp}`);

  // 1 control
  {
    const { ctx, page, sb } = await open(viewport, {});
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(13_000); // past the 10s hang window: a late false alarm would show by now
    needSeen('1 control', vp, sb);
    await page.screenshot({ path: `${OUT}/1-control-${viewport.width}.png` });
    check('1 control', vp, await readHeadline(page), null);

    // 2 offline - same healthy page, then the device drops off the network
    await ctx.setOffline(true);
    check('2 offline', vp, await waitHeadline(page, HEADLINE.offline, 5_000), HEADLINE.offline);
    await page.screenshot({ path: `${OUT}/2-offline-${viewport.width}.png` });
    await ctx.close();
  }

  // 3-6 the back end hangs; the providers say different things
  for (const [arm, statuses, want] of [
    ['3 supabase', { supabase: incident('minor', 'Intermittent latency in Eastern US') }, HEADLINE.supabase],
    ['4 unknown', {}, HEADLINE.unknown],
    ['5 cloudflare', { cloudflare: incident('major', 'Global network degradation') }, HEADLINE.cloudflare],
    ['6 vercel', { vercel: incident('major', 'Edge network outage') }, HEADLINE.vercel],
  ]) {
    const { ctx, page, sb } = await open(viewport, statuses);
    sb.mode = 'hang';
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    const got = await waitHeadline(page, want, 20_000);
    needSeen(arm, vp, sb);
    await page.screenshot({ path: `${OUT}/${arm.replace(' ', '-')}-${viewport.width}.png` });
    check(arm, vp, got, want);

    if (arm === '4 unknown') {
      // 7 recovery: the back end answers again; PRESS Try again and the banner must go.
      sb.mode = 'answer';
      const before = await readHeadline(page);
      if (before === null) {
        findings.push(`7 recovery @${vp}: no banner to recover from (arm 4 failed).`);
      } else {
        await page.getByRole('button', { name: 'Try again' }).click({ timeout: 10_000 });
        const end = Date.now() + 10_000;
        let after = before;
        while (Date.now() < end && after !== null) { await page.waitForTimeout(250); after = await readHeadline(page); }
        await page.screenshot({ path: `${OUT}/7-recovery-${viewport.width}.png` });
        check('7 recovery', vp, after, null);
      }
    }
    await ctx.close();
  }

  // 8 plaid: a bank-sync failure, with and without a Plaid incident
  for (const [arm, statuses, want] of [
    ['8 plaid', { plaid: incident('minor', 'Delayed transactions for some institutions') }, HEADLINE.plaid],
    ['8b plaid-ok', {}, null],
  ]) {
    const { ctx, page, sb } = await open(viewport, statuses);
    await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_000);
    const status = await page.evaluate(async (u) => (await fetch(`${u}/functions/v1/plaid-sync`, { method: 'POST', body: '{}' })).status, SB);
    if (status !== 502) couldNotTest ??= `${arm} @${vp}: the planted plaid-sync answered ${status}, not 502.`;
    const got = want ? await waitHeadline(page, want, 8_000) : (await page.waitForTimeout(4_000), await readHeadline(page));
    needSeen(arm, vp, sb);
    await page.screenshot({ path: `${OUT}/${arm.replace(' ', '-')}-${viewport.width}.png` });
    check(arm, vp, got, want);
    if (want && got === want) {
      // 9 dismiss: the notice floats over the header, so it must be dismissable - PRESS it.
      // Its tap target must be the app's 44px minimum: a 16px icon with p-1 shipped at 24px.
      const dismiss = page.getByRole('button', { name: 'Dismiss' });
      const box = await dismiss.boundingBox();
      if (!box || box.width < 44 || box.height < 44) {
        findings.push(`9 dismiss @${vp}: tap target ${box ? `${box.width}x${box.height}` : 'not found'}, want >= 44x44`);
      }
      await dismiss.click({ timeout: 5_000 });
      await page.waitForTimeout(500);
      check('9 dismiss', vp, await readHeadline(page), null);
    }
    await ctx.close();
  }
}

await browser.close();
if (findings.length) fail(1, `${findings.length} finding(s):\n  ${findings.join('\n  ')}`);
if (couldNotTest) fail(2, couldNotTest);
console.log(`PASS: every arm named the right cause at 390 and 1440, recovery cleared on a press, and the control stayed silent. Frames ${OUT}/.`);
