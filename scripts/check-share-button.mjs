#!/usr/bin/env node
/**
 * check:share-button - the Share button beside Payoff ETA on /debt, PRESSED in a real browser,
 * signed in as the walk account, at 390x844.
 *
 * Asserts CHANGES, not the absence of errors: there is exactly one button; no dialog exists
 * before the press; the press opens a preview whose image is really 1080x1350; Escape closes it;
 * "Share image" produces a PNG download (headless Chromium has no share target, so this is the
 * web fallback); the dialog closes afterwards; no page errors.
 * CONTROL: the Payoff ETA cell must render first, so "no button" cannot be a page that never
 * mounted. Exit 0 pass, 1 fail, 2 instrument.
 * Does NOT cover the native share sheet (needs a device) or navigator.share on a phone browser.
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
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
if (!session.access_token) fail(2, `sign-in returned ${res.status}.`);

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }


const browser = await chromium.launch();
const done = async (code, msg) => { await browser.close(); fail(code, msg); };
const outArg = process.argv.indexOf('--shot');
const SHOT = outArg > 0 ? process.argv[outArg + 1] : null;
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => {
  localStorage.setItem(k, JSON.stringify(s));
  localStorage.setItem('tre_cookie_consent', JSON.stringify({
    version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
  }));
}, [`sb-${ref}-auth-token`, session]);
await page.goto(`${BASE}/debt`, { waitUntil: 'domcontentloaded' });

// Settle on the ETA cell itself rather than a fixed sleep: an unmounted page and a page with no
// payoff date both show no button, and only the ETA label tells them apart.
const eta = page.getByText('Payoff ETA', { exact: true }).first();
try { await eta.waitFor({ timeout: 30000 }); }
catch { await done(2, 'CONTROL: the Payoff ETA cell never rendered on /debt - the instrument did not reach the screen.'); }
await page.waitForTimeout(1500);
const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';
for (let i = 0; i < 6 && (await page.locator(OVERLAY).count()); i += 1) {
  await page.locator(OVERLAY).first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(400);
}
console.log('control: Payoff ETA cell rendered');

const btn = page.locator('[data-testid="share-debt-free"]');
if ((await btn.count()) !== 1) {
  const cellText = await eta.locator('xpath=..').innerText().catch(() => '?');
  await done(1, `expected exactly 1 Share button beside Payoff ETA, found ${await btn.count()}. Cell reads: ${JSON.stringify(cellText)}`);
}
const dialog = page.locator('[role="dialog"][aria-label="Share your debt-free date"]');
if (await dialog.count()) await done(1, 'the share dialog is open before anyone pressed Share');

await btn.click();
const img = page.locator('[data-testid="share-card-preview"]');
await img.waitFor({ timeout: 10000 }).catch(() => {});
if (!(await dialog.count())) await done(1, 'pressing Share opened no preview dialog');
const size = await img.evaluate((el) => new Promise((r) => {
  const go = () => r({ w: el.naturalWidth, h: el.naturalHeight });
  if (el.complete) go(); else el.onload = go;
}));
if (size.w !== 1080 || size.h !== 1350) await done(1, `preview image is ${size.w}x${size.h}, expected 1080x1350`);
console.log(`PASS press Share -> preview dialog with a ${size.w}x${size.h} image`);
// GEOMETRY, because the first build passed every press above while the dialog was trapped inside
// the card (an ancestor's backdrop-filter captured `position: fixed`): it must cover the viewport,
// and the image it previews must be wholly on screen.
const box = await dialog.boundingBox();
const vp = page.viewportSize();
if (!box || Math.abs(box.x) > 1 || Math.abs(box.y) > 1 || Math.abs(box.width - vp.width) > 1 || Math.abs(box.height - vp.height) > 1) {
  await done(1, `dialog is not a viewport overlay: ${JSON.stringify(box)} vs ${vp.width}x${vp.height}`);
}
const ib = await img.boundingBox();
if (!ib || ib.y < 0 || ib.y + ib.height > vp.height) await done(1, `preview image is off screen: ${JSON.stringify(ib)}`);
console.log(`PASS dialog covers the ${vp.width}x${vp.height} viewport and the image is fully on screen`);
if (SHOT) { await page.screenshot({ path: SHOT }); console.log(`frame -> ${SHOT}`); }

// Escape closes it, and a second press opens it again.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
if (await dialog.count()) await done(1, 'Escape did not close the preview');
console.log('PASS Escape closes the preview');
await btn.click();
await img.waitFor({ timeout: 10000 });

// Confirm. Headless Chromium has no file share target, so the web path must DOWNLOAD a PNG.
const dl = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
await page.locator('[data-testid="share-card-confirm"]').click();
const download = await dl;
if (!download) await done(1, 'pressing "Share image" produced neither a share nor a download');
if (!/\.png$/.test(download.suggestedFilename())) await done(1, `download is ${download.suggestedFilename()}, not a PNG`);
await page.waitForTimeout(300);
if (await dialog.count()) await done(1, 'the dialog stayed open after a successful save');
console.log(`PASS "Share image" -> download ${download.suggestedFilename()}, dialog closed`);
if (errors.length) await done(1, `page errors: ${errors.join(' | ')}`);
await browser.close();
console.log('share button: all checks passed');
