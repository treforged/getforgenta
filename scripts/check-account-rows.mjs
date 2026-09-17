/**
 * Do the account rows show WHOLE WORDS, at the text size Tre actually uses?
 *
 * Tre, 2026-09-17, testing iOS 876: "there's a lot of empty space on the sides of some of these
 * boxes ... Can we fix the text so it actually shows like a full word in a line ... there may be
 * like times where we have too much information that the user doesn't really need."
 * His screenshot shows "Alliant Credit Union" rendered as Allia/nt/Cred/it/Unio/n - four
 * characters per line.
 *
 * FOURTH REPORT OF THIS FAMILY, so it gets a measured gate rather than another careful look. The
 * previous two fixes changed how the text WRAPS (a clamp, then break-words). Neither could work,
 * because the defect is WIDTH: four 44px shrink-0 buttons share the row and take their space
 * first.
 *
 * ── THE INSTRUMENT, AND WHY IT IS EXACT RATHER THAN A PROXY ────────────────
 * `overflow-wrap: break-word` splits a word ONLY when that word cannot fit its container. So
 * "no word is ever broken" is exactly "the container is at least as wide as its widest word",
 * which is measurable with the element's own computed font. No screenshot reading, no guessing
 * at line boxes, and it cannot be satisfied by text that merely happens to be short today.
 *
 * ⚠️ RUN AT 150% ROOT FONT, because the defect does not exist at the default size. A gate that
 * only checks the comfortable case would have passed on every one of the three previous reports.
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

await page.goto(`${BASE}/accounts`, { waitUntil: 'domcontentloaded' });

// His accessibility setting, not the comfortable default.
await page.addStyleTag({ content: 'html { font-size: 150% !important; }' });

let rows = 0;
for (let i = 0; i < 25 && rows === 0; i += 1) {
  await page.waitForTimeout(700);
  rows = await page.locator('[data-account-row]').count().catch(() => 0);
  if (!rows) {
    // The row has no test hook; fall back to the meta paragraph's own shape.
    rows = await page.evaluate(() => document.querySelectorAll('p.text-xs.text-muted-foreground').length);
  }
}

const report = await page.evaluate(() => {
  // Every meta line that carries an account's type/APR/limit detail. Found by SHAPE - the classes
  // that make it the meta line - never by a marker only the CORRECT version would carry.
  const metas = [...document.querySelectorAll('p')].filter(p => {
    const c = p.className || '';
    // SELECTED ON A PROPERTY THAT IS TRUE IN BOTH THE BROKEN AND THE FIXED STATE. An earlier
    // draft of this gate matched `basis-[11rem]` - the class the FIX adds - which means that on
    // the day the defect is real it would have found nothing and exited 2 "CONTROL FAILED",
    // reporting a broken instrument instead of a broken app. An exit-1 finding gets fixed; an
    // exit-2 tooling fault gets re-run, then ignored. These three classes are on the meta line
    // in every version of it, so correctness is something this gate ASSERTS rather than a
    // condition of finding anything to assert about.
    return typeof c === 'string'
      && c.includes('text-muted-foreground')
      && c.includes('break-words')
      && c.includes('min-w-0');
  });

  const canvas = document.createElement('canvas');
  const ctx2d = canvas.getContext('2d');

  const measured = metas.map(p => {
    const cs = getComputedStyle(p);
    ctx2d.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = (p.innerText || '').trim();
    const words = text.split(/\s+/).filter(Boolean);
    let widest = 0, widestWord = '';
    for (const w of words) {
      const m = ctx2d.measureText(w).width;
      if (m > widest) { widest = m; widestWord = w; }
    }
    return {
      text,
      width: p.clientWidth,
      widest: Math.ceil(widest),
      widestWord,
      fits: p.clientWidth >= Math.ceil(widest),
    };
  });

  // Headings, so the duplication check has something to compare against.
  const headings = [...document.querySelectorAll('h3')].map(h => (h.innerText || '').trim()).filter(Boolean);

  return { measured, headings };
});

if (report.measured.length === 0) {
  fail(2, 'CONTROL FAILED: found no account meta lines to measure. Either /accounts did not '
        + 'render for the walk account, or the selector no longer matches - both are the '
        + 'instrument, not the app.');
}

const broken = report.measured.filter(m => !m.fits);
if (broken.length > 0) {
  const worst = broken[0];
  fail(1, `${broken.length} of ${report.measured.length} account meta lines are NARROWER than `
        + `their own widest word, so that word is being split mid-word at 150% text.\n`
        + `  widest word: "${worst.widestWord}" needs ${worst.widest}px, column is ${worst.width}px\n`
        + `  line: ${worst.text.replace(/\n/g, ' / ')}`);
}

// The condensing half: the provider name is the GROUP HEADING, so a row under it must not repeat
// it. This is the assertion that keeps the longest string on the line from coming back.
const dupes = report.measured.filter(m =>
  report.headings.some(h => h && h !== 'Added by hand' && m.text.toLowerCase().includes(h.toLowerCase())));
if (dupes.length > 0) {
  fail(1, `${dupes.length} account row(s) repeat their own group heading in the meta line, which `
        + `is the longest string there and adds no information:\n  ${dupes[0].text}`);
}

await browser.close();

const tightest = report.measured.reduce((a, b) => (a.width - a.widest < b.width - b.widest ? a : b));
console.log(`  measured ${report.measured.length} account meta lines at 150% root font, 390px wide`);
console.log(`  tightest: "${tightest.widestWord}" needs ${tightest.widest}px, has ${tightest.width}px`);
console.log(`  no group heading repeated in any row`);
console.log(`\nPASS: every account meta line is wide enough for its own longest word.`);
process.exit(0);
