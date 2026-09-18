// check-placeholders.mjs - DOES THE PREVIEW TEXT FIT IN THE BOX ON A PHONE?
//
// Tre, 2026-09-18, with a screenshot: "have ada make sure the preview texts fit in the boxes on
// mobile. this one is he invite code". His shot shows PartnerLink's invite field rendering
// "Have an invite code? Pas" and stopping mid-word.
//
// ⚠️ THE ASK IS PLURAL - "preview textS in the boxES". He named the invite code as an EXAMPLE,
// not as the scope. This repo has twice had a complaint about one screen turn out to be worse on
// a screen he never mentioned, so this walks every route and every field it can reach.
//
// ⚠️ `scrollWidth <= clientWidth` IS THE OBVIOUS CRITERION AND IT IS BLIND. That was the
// acceptance test this slice was briefed with - by me, and I was wrong. A placeholder is not
// CONTENT: an empty input has nothing to overflow, so the browser reports scrollWidth ===
// clientWidth however long the placeholder is. A gate built on it returns a confident zero on
// the very field in Tre's screenshot. It is measured and printed per field below as `sw>cw` so
// nobody re-adopts it from memory - on the known defect it reads FALSE while the field is
// visibly clipped.
//
// WHAT IS ACTUALLY MEASURED: the placeholder string is laid out with the field's OWN computed
// font via canvas measureText, and compared against the field's content box - clientWidth minus
// its horizontal padding, minus any absolutely-positioned icon sitting over the text. That is
// the same arithmetic the browser does when it decides where to clip.
//
// ⚠️ LENGTH IS NOT THE TEST, which is why this renders rather than counting characters. A narrow
// column clips a short string and a full-width field does not, so the 45-character placeholder
// in a wide textarea is fine while a 21-character one in a half-width field is not. Sorting the
// source list by length would have aimed the fix at the wrong fields.
//
// ⚠️ TEXTAREAS ARE EXCLUDED BY CONSTRUCTION, and that is a cry-wolf guard rather than a
// convenience. A multi-line field WRAPS its placeholder, so a long one there is correct; a gate
// that flagged "Parts used, torque specs, what the shop said…" would be switched off in a week
// and would then be protecting nothing. Only single-line <input> is judged.
//
// ⚠️ SUBJECTS COME FROM THE DOM (`input[placeholder]`), NEVER FROM A SOURCE LIST. A grep of this
// repo finds 85 static placeholders against 95 bare `placeholder=` occurrences, so roughly ten
// are built at runtime and a source list is silently short - the hand-named-inventory failure
// this machine has now recorded five times in a week.
//
// POSITIVE CONTROL, and the run REFUSES without it: the field from Tre's screenshot must be
// found and must be judged. A walk that never reaches it cannot report anything about the app,
// and "0 clipped" from a page that mounted no inputs is indistinguishable from a clean one.
//
// WHAT IT DOES NOT COVER, stated rather than implied: placeholders inside modals, dialogs and
// drawers that need a click to open (the build/maintenance forms and most of Transactions live
// there); the onboarding wizard, which a signed-in reviewer account does not see; desktop
// widths; light mode; PREMIUM-ONLY FIELDS (the reviewer account is not premium, so PartnerLink's
// "Partner's email address" input never renders and has never been measured by this); and
// whether a placeholder that FITS is the right words. It measures
// 390x844, dark, signed in, on what a walk can reach without interacting.
//
// EXITS: 0 nothing clipped . 1 at least one field clips . 2 could not measure (which includes
// the positive control failing, because that is an instrument fault and not a finding).
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };

const env = readFileSync('.env.local', 'utf8');
let creds;
try { creds = readFileSync('.env.deck-walk.local', 'utf8'); }
catch { fail(2, '.env.deck-walk.local is missing.'); }
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

let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'no @playwright/test'); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('forgenta.theme.v1', 'dark'));
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));

// ⚠️ ROUTES ARE DERIVED FROM `src/App.tsx`, NOT TYPED HERE. My first version hand-listed
// eight and one of them ('/savings') IS NOT A ROUTE - the app calls it '/goals'. It rendered
// nothing, contributed a silent zero, and inflated "across 8 routes" into a coverage claim the
// walk had not earned. That is the hand-named-inventory failure with the list length at eight,
// and a derived list is the only version of this that survives somebody renaming a route.
const APP_TSX = readFileSync('src/App.tsx', 'utf8');
const SKIP = ['/', '/auth-callback', '/oauth', '/akoya-oauth', '/premium/success',
              '/premium/cancel', '/__error-test'];
const ROUTES = [...new Set([...APP_TSX.matchAll(/path="([^"]+)"/g)].map(m => m[1]))]
  .filter(r => r.startsWith('/') && !r.includes(':') && !SKIP.includes(r))
  .sort();
if (ROUTES.length < 15) fail(2, `only derived ${ROUTES.length} routes from App.tsx - the parse is wrong.`);

// The dialog dismissal is COPIED FROM check-dark-contrast.mjs deliberately rather than
// reinvented: /forecast auto-opens a real "Forecast Assumptions" dialog that survives Escape,
// and a dialog's own fields are not the page's. Two copies of this would drift.
const dismiss = async () => {
  for (let i = 0; i < 3; i++) {
    const closed = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"], [role="alertdialog"]');
      if (!d) return true;
      const btn = d.querySelector('button[aria-label*="lose" i], button[aria-label*="ismiss" i]')
        || [...d.querySelectorAll('button')].find(b => /close|dismiss|got it|ok|done/i.test(b.textContent || ''));
      if (btn) { btn.click(); return false; }
      return false;
    });
    if (closed) return true;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  return page.evaluate(() => !document.querySelector('[role="dialog"], [role="alertdialog"]'));
};

const readFields = () => page.evaluate(() => {
  const canvas = document.createElement('canvas');
  const c2d = canvas.getContext('2d');
  const out = [];
  for (const el of document.querySelectorAll('input[placeholder]')) {
    const text = el.getAttribute('placeholder') || '';
    if (!text.trim()) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;   // a 0x0 wrapper is not a rendered field

    // The browser lays the placeholder out in the field's own font, so measure in that font.
    c2d.font = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} / ${st.lineHeight} ${st.fontFamily}`;
    const textPx = c2d.measureText(text).width;

    // clientWidth already excludes the border but INCLUDES padding, which the text cannot use.
    const padL = parseFloat(st.paddingLeft) || 0;
    const padR = parseFloat(st.paddingRight) || 0;
    let avail = el.clientWidth - padL - padR;

    // An icon absolutely positioned over the field eats width that padding does not describe.
    // Subtract any absolute sibling that overlaps the field's own box.
    const parent = el.parentElement;
    if (parent) {
      for (const sib of parent.children) {
        if (sib === el) continue;
        const ss = getComputedStyle(sib);
        if (ss.position !== 'absolute') continue;
        const sb = sib.getBoundingClientRect();
        if (sb.width < 1 || sb.right < box.left || sb.left > box.right) continue;
        avail -= Math.min(sb.width, box.width);
      }
    }

    out.push({
      text,
      textPx: Math.round(textPx),
      availPx: Math.round(avail),
      overflowPx: Math.round(textPx - avail),
      // Recorded ONLY to show it is blind here. Never gate on it.
      swGtCw: el.scrollWidth > el.clientWidth,
    });
  }
  return out;
});

const seen = new Map();          // placeholder text -> worst reading anywhere
let routesRead = 0;
const blank = [];                // routes with no app shell - their zero is NOT a clean read
const perRoute = new Map();      // route -> how many placeholder fields it rendered

// A discarded warm-up: the app cold-starts on its first navigation, and a route read before it
// mounts reports no fields at all - which here reads as "clean", the direction nobody checks.
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);

for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await dismiss();
  await page.waitForTimeout(400);

  // Read until two consecutive reads agree on the field COUNT, restarting whenever a later read
  // finds MORE - a page only grows as it mounts, so a stable-looking pair on a half-mounted page
  // is not agreement.
  let prev = -1, stable = 0, fields = [];
  for (let i = 0; i < 6 && stable < 2; i++) {
    fields = await readFields();
    if (fields.length > prev) { stable = 1; } else if (fields.length === prev) { stable++; } else { stable = 1; }
    prev = Math.max(prev, fields.length);
    if (stable < 2) await page.waitForTimeout(700);
  }
  const mounted = await page.evaluate(() =>
    !!document.querySelector('main, [data-app-shell], #root > div > div'));
  if (!mounted) blank.push(route);
  routesRead++;
  perRoute.set(route, fields.length);
  for (const f of fields) {
    const worst = seen.get(f.text);
    if (!worst || f.overflowPx > worst.overflowPx) seen.set(f.text, { ...f, route });
  }
  console.log(`${route.padEnd(14)} ${String(fields.length).padStart(2)} field(s)`);
}

await browser.close();

const all = [...seen.values()].sort((a, b) => b.overflowPx - a.overflowPx);
console.log(`\nexamined ${all.length} distinct placeholder(s) across ${routesRead} route(s).`);
if (blank.length) console.log(`⚠  ${blank.length} route(s) rendered no app shell, so their zero means NOT MEASURED: ${blank.join(', ')}`);

// ZERO EXAMINED IS "NOTHING WAS MEASURED", NEVER "CLEAN".
if (all.length === 0) fail(2, 'no placeholder fields were found at all - the walk measured nothing.');

// POSITIVE CONTROL - and my FIRST version of it was wrong in a way this repo has a name for.
//
// ⚠️ IT USED TO REQUIRE THE EXACT STRING FROM TRE'S SCREENSHOT, "Have an invite code? Paste
// it here". That is the DEFECT'S OWN TEXT, so the moment the defect was fixed the control could
// no longer find it and the run reported **exit 2, CONTROL FAILED** - an instrument fault - on
// a green app. A control keyed to the thing being removed cannot survive the removal, and exit 2
// is the diagnosis nobody chases: an exit-1 finding gets fixed, a tooling fault gets re-run and
// then switched off.
//
// SO IT ASSERTS REACHABILITY INSTEAD, which is what it was always for and which is true in BOTH
// the broken and the fixed state: /account is the screen that carries the invite field, and it
// must yield the fields it has. If the walk stops reaching it, every zero below is a fact about
// the walk rather than about the app.
const ACCOUNT_FIELDS_MIN = 2;
const accountFields = perRoute.get('/account') ?? 0;
if (accountFields < ACCOUNT_FIELDS_MIN) {
  fail(2, `CONTROL FAILED: /account yielded ${accountFields} placeholder field(s), expected at `
        + `least ${ACCOUNT_FIELDS_MIN}. That is the screen carrying the field Tre reported, so a `
        + `clean result would be a claim about this walk, not about the app.`);
}

const clipped = all.filter(f => f.overflowPx > 0);

console.log('\nplaceholder                                        route        text  avail  over  sw>cw');
for (const f of all) {
  const mark = f.overflowPx > 0 ? ' <-- CLIPPED' : '';
  console.log(
    `${(f.text.length > 48 ? f.text.slice(0, 47) + '…' : f.text).padEnd(50)}`
    + `${f.route.padEnd(12)} ${String(f.textPx).padStart(4)} ${String(f.availPx).padStart(6)} `
    + `${String(f.overflowPx).padStart(5)}  ${f.swGtCw ? 'yes' : 'no '}${mark}`);
}

// Say out loud that the briefed criterion could not have found these.
const swWouldCatch = clipped.filter(f => f.swGtCw).length;
console.log(`\nscrollWidth>clientWidth would have flagged ${swWouldCatch} of ${clipped.length} clipped `
  + `field(s) - which is why this gate does not use it.`);

if (clipped.length > 0) {
  console.error(`\nFAIL: ${clipped.length} placeholder(s) are cut off at 390px.`);
  console.error('A placeholder in a single-line input CANNOT wrap. Shorten it, or move the wording');
  console.error('to a label above the field and leave a short example inside.');
  process.exit(1);
}
console.log('\nPASS: every reachable placeholder fits its field at 390px.');
