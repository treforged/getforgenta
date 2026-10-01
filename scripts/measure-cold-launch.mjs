#!/usr/bin/env node
/**
 * measure-cold-launch.mjs - how long a BRAND-NEW visitor waits before the sign-up screen works,
 * on the network a new phone actually has. Production by default, because the iOS and Android
 * shells load getforgenta.com (capacitor.config.ts server.url), so this IS the first-launch page.
 *
 * WHY (dbb19f07, 2026-10-01): 8 App Store installs in 30 days produced 0 signup submits and 0
 * Apple/Google starts. The live 6.8 shell holds a cover until the page reports ready, RELOADS the
 * WebView at 15 s, and drops the cover at 25 s whatever is behind it (AppDelegate coverReloadAfter
 * and coverHardCeiling at commit 83179596). A cold page slower than 15 s on cellular is reloaded
 * out from under itself and can loop to a dead screen. This measures where each network sits
 * against those two numbers.
 *
 * Per profile, a FRESH context (no cache, no session, cookie consent undecided), 390x844:
 *   ready     = ms until "Start Free" is visible (the welcome screen is usable)
 *   form      = after pressing "Start Free", the sign-up form shows an email field (a CHANGE)
 *   oauth     = "Continue with Google" and "Continue with Apple" are visible on that form
 *   bytes     = encoded bytes transferred until ready
 * Profiles use Chromium network emulation (CDP). Control: the unthrottled run must be the fastest,
 * or the throttling did nothing and the numbers mean nothing (exit 2).
 *
 * EXITS: 0 measured (it reports, it does not judge) . 2 could not measure.
 * DOES NOT COVER: WebKit's own engine speed (no throttling hook there), the native cover itself,
 * a device, DNS/TLS from a real cell tower, or what the user does after the form shows.
 * USAGE: node scripts/measure-cold-launch.mjs [baseUrl]
 */
// /auth, because the native shell routes a signed-out launch there (App.tsx MemoryRouter
// initialEntries ['/auth']). `/` is the web Landing page, which a phone never shows.
const BASE = process.argv[2] || 'https://getforgenta.com/auth';
const fail = (code, msg) => { console.error(`FAIL(${code}): ${msg}`); process.exit(code); };

let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'could not load @playwright/test.'); }

// Chrome DevTools' own presets; latency in ms, throughput in bytes/s.
const PROFILES = [
  { name: 'unthrottled', latency: 0, down: -1, up: -1 },
  { name: 'fast 4G', latency: 60, down: (9 * 1024 * 1024) / 8, up: (1.5 * 1024 * 1024) / 8 },
  { name: 'slow 4G', latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8 },
  { name: '3G', latency: 300, down: (750 * 1024) / 8, up: (250 * 1024) / 8 },
];
const LIMIT_MS = 60000;

const browser = await chromium.launch();
const rows = [];
for (const p of PROFILES) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: p.latency, downloadThroughput: p.down, uploadThroughput: p.up,
  });
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength || 0; });

  const t0 = Date.now();
  let ready = null;
  let form = false;
  let oauth = false;
  let err = '';
  try {
    await page.goto(BASE, { waitUntil: 'commit', timeout: LIMIT_MS });
    const start = page.getByRole('button', { name: 'Start Free' });
    await start.waitFor({ state: 'visible', timeout: LIMIT_MS - (Date.now() - t0) });
    ready = Date.now() - t0;
    const readyBytes = bytes;
    const banner = page.getByRole('region', { name: 'Cookie consent' });
    if (await banner.isVisible().catch(() => false)) await banner.getByRole('button', { name: /reject/i }).first().click();
    await start.click();
    form = await page.locator('input[type="email"]').first()
      .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    const g = await page.getByRole('button', { name: 'Continue with Google' }).isVisible().catch(() => false);
    const a = await page.getByRole('button', { name: 'Continue with Apple' }).isVisible().catch(() => false);
    oauth = g && a;
    bytes = readyBytes;
  } catch (e) {
    err = e.message.split('\n')[0];
  }
  rows.push({ ...p, ready, form, oauth, bytes, err, url: page.url() });
  await ctx.close();
}
await browser.close();

console.log(`cold first launch, ${BASE}, 390x844, fresh context, cache disabled`);
console.log('6.8 shell: reloads the WebView at 15 s, drops the cover at 25 s');
for (const r of rows) {
  const ready = r.ready === null ? `NOT READY in ${LIMIT_MS / 1000}s (${r.err})` : `${(r.ready / 1000).toFixed(1)} s`;
  const vs = r.ready === null ? '' : r.ready > 15000 ? '  <-- PAST the 15 s reload' : '';
  console.log(`  ${r.name.padEnd(12)} ready ${ready}${vs}  form=${r.form} oauth=${r.oauth}  ${(r.bytes / 1024).toFixed(0)} KB`);
}
const base = rows[0];
if (base.ready === null) fail(2, 'the unthrottled control never became ready; nothing below is a measurement.');
// The slowest profile must be clearly slower than the control. Comparing every profile strictly
// failed on a real run: fast 4G and unthrottled both read 1.0 s and the order was noise.
const last = rows[rows.length - 1];
if (last.ready !== null && last.ready < base.ready * 1.5) fail(2, `${last.name} (${last.ready} ms) is not clearly slower than the control (${base.ready} ms); throttling did not apply.`);
process.exit(0);
