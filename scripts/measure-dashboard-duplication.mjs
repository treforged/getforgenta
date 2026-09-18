// probe-dashboard-duplication.mjs - AN INVENTORY, AND DELIBERATELY NOT A GATE.
//
// Tre, 2026-09-17, about the Overview dashboard: "there's kind of overload of how much
// information the user is getting on that page and some of it duplicated ... that top section
// seems to be the same as like maybe some stuff below". This answers WHAT repeats, so a
// reorganisation can be aimed instead of guessed.
//
// ⚠️ IT IS NOT WIRED INTO package.json AND MUST NOT BECOME A PASS/FAIL CHECK. A repeated
// FIGURE is not evidence of duplicated MEANING - two unrelated numbers are routinely equal, and
// "$25" appearing five times is as likely to be five real minimum payments as one fact shown
// five times. A gate on "no repeated strings" would cry wolf on every run and be switched off,
// which is how this repo loses gates. Read the output and judge it; do not automate the verdict.
//
// MEASURED 2026-09-18, 390x844, dark, signed in, reviewer account - 168 text nodes, 150 distinct
// strings, 8 repeating at heights more than 120px apart:
//   $4,200              y=700, 837, 4753, 5028      <- top section AND far below: his complaint
//   $25                 y=2620, 3100, 5324, 5407, 5485
//   Available           y=1496, 2079
//   $25.00              y=1518, 1977
//   Advanced Analytics  y=4070, 4477                <- a widget label appearing twice
//   Discover It         y=5028, 5381
//   min                 y=5380, 5568
//   Oct 2026            y=1028, 1187
//
// ⚠️ THE FIGURES DEPEND ON THE REVIEWER ACCOUNT'S DATA, so the y positions and the strings
// will differ on another account. What is reusable is the METHOD, not this table.
//
// ⚠️ `check:page-rhythm` IS STRUCTURALLY INCAPABLE OF FINDING THIS - /dashboard is that
// gate's own 1.0x reference. His complaint is about WHAT IS ON the page, not how it is spaced,
// so a green there is not evidence about this at all.
//
// It refuses (exit 2) when it reads too few text nodes, because a page that has not mounted
// reports no duplication - which would read as a clean dashboard.
// Tre: "some of it duplicated ... that top section seems to be the same as like maybe some
// stuff below". This answers WHAT, so a reorganisation is aimed rather than guessed.
import { readFileSync } from 'node:fs';
const BASE = 'http://localhost:8080';
const fail = (c, m) => { console.error(`FAIL: ${m}`); process.exit(c); };
const env = readFileSync('.env.local', 'utf8');
const creds = readFileSync('.env.deck-walk.local', 'utf8');
const pick = (s, k) => (s.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const url = pick(env, 'VITE_SUPABASE_URL'), anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
const email = pick(creds, 'REACH_TEST_EMAIL'), password = pick(creds, 'REACH_TEST_PASSWORD');
const ref = new URL(url).hostname.split('.')[0];
const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }) });
const session = await r.json();
if (!session.access_token) fail(2, 'sign-in failed');
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('forgenta.theme.v1', 'dark'));
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false })));
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });   // warm
await page.waitForTimeout(6000);

const out = await page.evaluate(() => {
  // Leaf text nodes only, with their vertical position, so we can say WHERE a repeat sits.
  const seen = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    const t = (n.textContent || '').trim();
    if (t.length < 2) continue;
    const el = n.parentElement;
    if (!el) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') continue;
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) continue;
    seen.push({ t, y: Math.round(b.top + window.scrollY) });
  }
  return seen;
});
await browser.close();

// A currency/percent figure or a multi-word label appearing at two well-separated heights is
// the shape Tre is describing. Ignore chrome words that are SUPPOSED to repeat.
const IGNORE = /^(view|see|all|more|edit|add|open|close|next|back|of|to|in|on|and|the|a|\$0|—|-)$/i;
const byText = new Map();
for (const { t, y } of out) {
  if (IGNORE.test(t)) continue;
  if (!byText.has(t)) byText.set(t, []);
  byText.get(t).push(y);
}
const repeats = [...byText.entries()]
  .map(([t, ys]) => [t, [...new Set(ys)].sort((a, b) => a - b)])
  .filter(([, ys]) => ys.length > 1 && (ys[ys.length - 1] - ys[0]) > 120)
  .sort((a, b) => (b[1][b[1].length - 1] - b[1][0]) - (a[1][a[1].length - 1] - a[1][0]));

console.log(`text nodes read: ${out.length}, distinct strings: ${byText.size}`);
if (out.length < 50) fail(2, 'too few text nodes - the page had not mounted, so this measured nothing.');
console.log(`\nSTRINGS APPEARING AT TWO OR MORE SEPARATED HEIGHTS (>120px apart):\n`);
for (const [t, ys] of repeats) {
  console.log(`  ${(t.length > 46 ? t.slice(0, 45) + '…' : t).padEnd(48)} y=${ys.join(', ')}`);
}
console.log(`\n${repeats.length} repeated string(s).`);
