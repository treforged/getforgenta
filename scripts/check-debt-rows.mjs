/**
 * THE DEBT PAYMENT ROWS MUST STAY ON ONE LINE AT HIS TEXT SIZE.
 *
 * Tre, 2026-09-17 after iOS 876: "there's a lot of empty space on the sides of some of these
 * boxes". The first probe measured the gap to the CARD'S RIGHT EDGE, found 0-25px and reported
 * the complaint as NOT REPRODUCED. It was looking at the wrong edge. The hole is INTERIOR: the
 * payment column wraps onto its own line and sits alone there, leaving most of that line empty.
 *
 * ⚠️ IT ONLY HAPPENS AT 150% ROOT FONT - the size he actually uses - which is the same reason the
 * accounts-text defect survived three fixes. A gate that only checks the comfortable default size
 * passes with the defect present. MEASURED: pre-fix, the Discover row's left group is 290px on a
 * 316px row at 150%, so the payment column wraps; at the default size the same row fits.
 *
 * ⚠️ AND THE FIRST VERSION OF THIS INSTRUMENT MANUFACTURED THE DEFECT EVERYWHERE. It decided
 * "same line" by comparing the two boxes' TOPS - but `items-center` gives boxes of different
 * heights different tops on the same line, so it reported 4 of 6 rows wrapped, including rows
 * that were fine. Vertical OVERLAP is the honest test, and with it the pre/post difference is one
 * row at one text size rather than a page full of false findings.
 *
 * SELECTED BY SHAPE, NEVER BY THE CLASS THE FIX ADDS: a bordered muted row with exactly two flex
 * children. Both the broken and the fixed markup carry those classes, so being correct is
 * something this gate ASSERTS rather than a condition of finding anything to assert about.
 *
 * DOES NOT COVER: colour, the look of the badges, the chart, anything below 390px, and whether
 * the truncated reason text is the right text to lose.
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

const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
const uid = session.user.id;
const whatsNew = readFileSync('src/lib/whats-new.ts', 'utf8');
const releaseVersion = (whatsNew.match(/version:\s*'([^']+)'/) || [])[1];
if (!releaseVersion) fail(2, 'could not read the release version from src/lib/whats-new.ts.');
const prof = await fetch(`${url}/rest/v1/profiles?select=tour_flags&user_id=eq.${uid}`, { headers: rest });
const flags = (await prof.json())[0]?.tour_flags ?? {};
await fetch(`${url}/rest/v1/profiles?user_id=eq.${uid}`, {
  method: 'PATCH',
  headers: { ...rest, Prefer: 'return=representation' },
  body: JSON.stringify({
    founder_note_seen: true,
    tour_flags: { ...flags, new_user_done: true, premium_done: true, [`whats_new_${releaseVersion}`]: true },
  }),
});

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));



await page.goto(`${BASE}/debt`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);

async function measure(label) {
  return page.evaluate((lbl) => {
    const rows = [...document.querySelectorAll('div')].filter(d => {
      const c = typeof d.className === 'string' ? d.className : '';
      if (!c.includes('border-border') || !c.includes('bg-muted/10')) return false;
      const cs = getComputedStyle(d);
      if (cs.display !== 'flex' || cs.justifyContent !== 'space-between') return false;
      const kids = [...d.children];
      return kids.length === 2 && kids.every(k => getComputedStyle(k).display === 'flex');
    });
    return rows.map(d => {
      const a = d.children[0].getBoundingClientRect();
      const b = d.children[1].getBoundingClientRect();
      const box = d.getBoundingClientRect();
      // `items-center` gives two boxes of different heights different tops on the SAME line, so
      // tops cannot decide this. Vertical OVERLAP can.
      const sameLine = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
      return {
        label: lbl,
        rowW: Math.round(box.width),
        leftW: Math.round(a.width),
        rightW: Math.round(b.width),
        gap: sameLine ? Math.round(b.left - a.right) : null,
        wrapped: !sameLine,
        text: (d.innerText || '').split(String.fromCharCode(10)).join(' | ').slice(0, 70),
      };
    });
  }, label);
}

const atDefault = await measure('default');
await page.addStyleTag({ content: 'html { font-size: 150% !important; }' });
await page.waitForTimeout(1200);
const at150 = await measure('150%');
await browser.close();

const all = [...atDefault, ...at150];
if (atDefault.length === 0 || at150.length === 0) {
  fail(2, 'CONTROL FAILED: no debt payment rows found at one or both text sizes '
       + `(default ${atDefault.length}, 150% ${at150.length}). A zero from a broken selector and a `
       + 'zero from a clean app are the same zero - this is the instrument or an empty account, '
       + 'not a finding about spacing.');
}

const wrapped = all.filter(r => r.wrapped);
if (wrapped.length > 0) {
  const w = wrapped[0];
  fail(1, `${wrapped.length} of ${all.length} debt payment rows wrap their payment column onto its `
       + `own line, which is the empty space Tre reported.
`
       + `  [${w.label}] row ${w.rowW}px, left group ${w.leftW}px, payment column ${w.rightW}px
`
       + `  row: ${w.text}`);
}

// The other half of the same defect: a row that fits but leaves a hole between the two groups.
// The flex gap is 8px (`gap-2`), so anything much beyond it is slack the left group should have
// taken. 24px is that gap at 150% text plus a pixel of rounding, not a number chosen to pass.
const holed = all.filter(r => (r.gap ?? 0) > 24);
if (holed.length > 0) {
  const h = holed[0];
  fail(1, `${holed.length} of ${all.length} debt payment rows leave a hole between the description `
       + `and the payment column.
  [${h.label}] gap ${h.gap}px on a ${h.rowW}px row: ${h.text}`);
}

const widest = all.reduce((x, y) => ((x.gap ?? 0) > (y.gap ?? 0) ? x : y));
console.log(`  ${all.length} debt payment rows measured at 390px (${atDefault.length} at the default text size, ${at150.length} at 150%)`);
console.log(`  none wrapped; widest interior gap ${widest.gap}px [${widest.label}] ${widest.text}`);
console.log(`
PASS: every debt payment row keeps its payment column on the description's line.`);
process.exit(0);
