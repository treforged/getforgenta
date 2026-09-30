/**
 * check:share-badge - the Share control on an EARNED badge in the Trophy Case (/account >
 * Achievements), PRESSED in a real browser, signed in as the walk account, at 390x844.
 * Sam 2026-09-30: invite at a moment of value, user-started, with a working link.
 *
 * Asserts CHANGES: no dialog before the press; the press opens a viewport dialog whose preview is
 * really 1080x1350; nothing is shared until "Share image"; then the share sheet receives exactly one
 * non-empty PNG and a getforgenta.com link tagged share_card / app / badge.
 * The share sheet is stood in for (headless Chromium has none) - what is asserted is what the APP
 * HANDS TO IT. CONTROL: an earned badge row ("Earned <date>") must render first.
 * Exit 0 pass, 1 fail, 2 instrument.
 * Does NOT cover the native iOS/Android sheet (needs a device) or whether the image looks right.
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


const outArg = process.argv.indexOf('--shot');
const SHOT = outArg > 0 ? process.argv[outArg + 1] : null;
const browser = await chromium.launch();
const done = async (code, msg) => { await browser.close(); fail(code, msg); };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
// The share SHEET is the thing asserted. Headless Chromium has none, so stand in for it and record
// exactly what the app hands to it: the files, the title, and the text that carries the link.
await ctx.addInitScript(() => {
  window.__shared = [];
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: async (d) => { window.__shared.push({ title: d.title, text: d.text, files: (d.files || []).map((f) => `${f.name}:${f.type}:${f.size}`) }); },
  });
});
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
await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
const tab = page.getByRole('tab', { name: 'Achievements' });
try { await tab.waitFor({ timeout: 30000 }); }
catch { await done(2, 'CONTROL: the Achievements tab never rendered on /account - the instrument did not reach the screen.'); }
await tab.click();

// CONTROL: an earned badge row must render first, so "no Share button" cannot be a list that
// never mounted. It is found by its "Earned <date>" line, which every earned row carries whether
// or not it has a Share button.
const earned = page.getByText(/^Earned [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
try { await earned.first().waitFor({ timeout: 30000 }); }
catch { await done(2, 'CONTROL: no earned badge row rendered - the walk account needs at least one badge.'); }
const rows = await earned.count();
const btns = page.locator('[data-testid^="share-badge-"]');
const n = await btns.count();
console.log(`control: ${rows} earned badge row(s) rendered; ${n} share button(s)`);
if (n < 1) await done(1, `${rows} earned badges and no Share button on any of them`);
if (n > rows) await done(1, `${n} share buttons for ${rows} earned badges`);

const btn = btns.first();
const label = await btn.getAttribute('aria-label');
const dialog = page.locator(`[role="dialog"][aria-label="${label}"]`);
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
const box = await dialog.boundingBox();
const vp = page.viewportSize();
if (!box || Math.abs(box.width - vp.width) > 1 || Math.abs(box.height - vp.height) > 1) {
  await done(1, `dialog is not a viewport overlay: ${JSON.stringify(box)} vs ${vp.width}x${vp.height}`);
}
console.log(`PASS press "${label}" -> viewport dialog with a ${size.w}x${size.h} preview`);
if (SHOT) { await page.screenshot({ path: SHOT }); console.log(`frame -> ${SHOT}`); }
if ((await page.evaluate(() => window.__shared.length)) !== 0) await done(1, 'something was shared before "Share image" was pressed');

await page.locator('[data-testid="share-card-confirm"]').click();
await page.waitForTimeout(500);
const shared = await page.evaluate(() => window.__shared);
if (shared.length !== 1) await done(1, `expected exactly 1 share after the press, got ${shared.length}`);
const s = shared[0];
if (s.files.length !== 1 || !/\.png:image\/png:\d+$/.test(s.files[0]) || /:0$/.test(s.files[0])) await done(1, `share carried ${JSON.stringify(s.files)}, not one non-empty PNG`);
const m = String(s.text || '').match(/https:\/\/\S+/);
if (!m) await done(1, `share text carries no link: ${JSON.stringify(s.text)}`);
const link = new URL(m[0]);
const q = link.searchParams;
if (link.hostname !== 'getforgenta.com' || q.get('utm_source') !== 'share_card' || q.get('utm_medium') !== 'app' || q.get('utm_campaign') !== 'badge') {
  await done(1, `share link is not a tagged badge link: ${m[0]}`);
}
console.log(`PASS "Share image" -> share sheet got ${s.files[0]} and ${m[0]} (title ${JSON.stringify(s.title)})`);
if (await dialog.count()) await done(1, 'the dialog stayed open after a successful share');
console.log('PASS dialog closed after the share');
if (errors.length) await done(1, `page errors: ${errors.join(' | ')}`);
await browser.close();
console.log('share badge: all checks passed');
