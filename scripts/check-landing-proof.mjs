// check:landing-proof (ask 4f473837) - the landing page's social proof and download counting,
// in a real browser at 390x844 and 1440x900, signed OUT, against the dev server (localhost:8080).
//  1. The live App Store rating renders beside the badges, read from Apple (control: the same
//     lookup fetched here must agree with the number on screen).
//  2. PRESSING each badge sends one tap_store insert with the right store. Inserts are ANSWERED
//     in-browser (route.fulfill, 201), so nothing reaches the database; new tabs are closed.
//  3. landing_viewed is sent once on load.
// Frames: test-results/landing-proof/<width>.png. Exit 0 pass, 1 finding, 2 instrument fault.
// Does NOT cover: testimonials (none approved yet; SocialProof.test.tsx owns them), the native apps,
// or whether the section moves conversion (read signup_funnel_events env='prod' for that).
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const OUT = 'test-results/landing-proof';
fs.mkdirSync(OUT, { recursive: true });

const lookup = await (await fetch('https://itunes.apple.com/lookup?id=6762540239&country=us')).json();
const live = lookup?.results?.[0];
if (typeof live?.averageUserRating !== 'number') { console.log('INSTRUMENT: Apple lookup unreadable'); process.exit(2); }
const expectAvg = live.averageUserRating.toFixed(1);
const expectCount = live.userRatingCount;

let failures = 0;
const fail = (m) => { failures++; console.log('FAIL', m); };
const browser = await chromium.launch();
for (const [w, h] of [[390, 844], [1440, 900]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  ctx.on('page', (p) => { if (p !== page) p.close().catch(() => {}); });
  const inserts = [];
  await ctx.route('**/rest/v1/signup_funnel_events*', async (route) => {
    if (route.request().method() === 'POST') {
      try { inserts.push(JSON.parse(route.request().postData() || '{}')); } catch { inserts.push({}); }
      return route.fulfill({ status: 201, body: '' });
    }
    return route.continue();
  });
  // Store pages open in a new tab; never let them load.
  await ctx.route(/apps\.apple\.com|play\.google\.com\/store/, (r) => r.abort());
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const rating = page.getByTestId('store-rating');
  try { await rating.waitFor({ timeout: 15000 }); } catch { fail(`${w}: rating never rendered`); }
  const text = (await rating.textContent().catch(() => '')) || '';
  if (!text.includes(expectAvg) || !text.includes(`${expectCount} rating`)) fail(`${w}: rating text "${text}" != live ${expectAvg} / ${expectCount}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${w}.png` });
  const views = inserts.filter((r) => r.step === 'landing_viewed').length;
  if (views !== 1) fail(`${w}: landing_viewed sent ${views} times`);
  for (const [label, store] of [[/App Store/i, 'app_store'], [/Google Play/i, 'play_store']]) {
    const before = inserts.filter((r) => r.step === 'tap_store' && r.detail === store).length;
    await page.getByRole('link', { name: label }).first().click({ modifiers: [] }).catch((e) => fail(`${w}: press ${store}: ${e.message}`));
    await page.waitForTimeout(600);
    const after = inserts.filter((r) => r.step === 'tap_store' && r.detail === store).length;
    if (after !== before + 1) fail(`${w}: pressing ${store} sent ${after - before} tap_store rows`);
  }
  console.log(`${w}: rating "${text.trim()}", landing_viewed ${views}, tap_store ${inserts.filter((r) => r.step === 'tap_store').map((r) => r.detail).join(',')}`);
  await ctx.close();
}
await browser.close();
console.log(failures ? `FAIL ${failures}` : 'PASS');
process.exit(failures ? 1 : 0);
