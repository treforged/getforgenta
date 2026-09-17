#!/usr/bin/env node
/**
 * check-accounts-groups.mjs - the RENDERED half of the group-chrome fix, at 390x844, signed in.
 *
 * WHY THIS EXISTS, AND WHY THE UNIT TEST IS NOT ENOUGH
 * `src/pages/__tests__/Accounts.soloGroupHeading.test.tsx` asserts the TEXT: a group of one loses
 * its heading and gains its institution on the row, a multi-row group keeps the heading and does
 * not repeat it. That is the half that proves no FACT was deleted. It runs in jsdom, which reports
 * zero for every size in this repo, so it says nothing about how the row LOOKS - and the risk this
 * change actually carries is a layout one.
 *
 * ⚠️ THE RISK IS THAT THE FIX MAKES A DIFFERENT, ALREADY-REPORTED DEFECT WORSE. This change ADDS
 * text to the meta line. That line already carries four 44px `shrink-0` action buttons, and Tre has
 * reported its width four separate times - most recently with a screenshot of "Alliant Credit
 * Union" rendering as Allia/nt/Cred/it/Unio/n, four characters per line, on iOS 876. Adding an
 * institution to exactly the rows that previously had none is the most direct way to bring that
 * back. A green jsdom suite would not notice, and neither would a human reading the diff.
 *
 * WHAT IT ASSERTS
 *   1. POSITIVE CONTROL FIRST: the page rendered account rows at all, and the signed-in walk
 *      account really has BOTH shapes - at least one group of one and at least one group of two
 *      or more. Without both, the pair below proves nothing and this exits 2 (instrument blind)
 *      rather than passing vacuously. "No solo group" and "solo groups render correctly" are the
 *      same observation otherwise.
 *   2. THE PAIR, rendered, and either half alone is a defect: a group of ONE renders NO heading
 *      AND carries an institution on its row; a group of TWO OR MORE renders a heading AND does
 *      not repeat it on any of its rows. Dropping the heading without moving the institution
 *      deletes a fact; moving it without dropping the heading prints it twice.
 *
 * ⚠️ GROUPS ARE READ FROM THE DOM STRUCTURE, AND THE FIRST VERSION OF THIS GATE GOT THAT WRONG.
 * It classified "a row whose text mentions no heading" as solo - which is ALSO exactly what a
 * correctly GROUPED row looks like, because a grouped row deliberately does not repeat its
 * institution. So it reported 9 solo groups where there are 5, counted an unrelated `h3` from the
 * bank-connection notice as a group heading, and printed an invented 171px saving. Same family as
 * selecting on a correctness marker: the property it keyed on was shared by the thing it was
 * looking for and the thing it meant to exclude. It is now read off the group wrapper.
 *
 * MEASURED ON THE WALK ACCOUNT at 390x844: 9 rows in 7 groups, 2 keeping a heading and 5 carrying
 * their institution on the row, saving 110px of vertical chrome. Every meta line 242px wide with
 * zero overflow, so the added text did not squeeze anything.
 *   3. THE GEOMETRY, which is the part only a browser can answer: no row's meta line overflows
 *      its own box horizontally, and no visible text node in a solo row is narrower than a
 *      threshold that would mean it has been squeezed into a few characters per line.
 *   4. THE SAVING IS MEASURED, NOT CLAIMED: it reports groups, headings rendered, and the pixels
 *      those missing headings would have cost. A fix sold as "shorter" should say by how much.
 *
 * WHAT IT DOES NOT COVER
 *   Colour, contrast and THEME - this change adds no colour and removes a neutral heading, so the
 *   theme is not where its risk is; `check:glass` and the concentricity gate own that ground.
 *   Desktop widths. Any account shape the walk account does not have. And it asserts nothing about
 *   whether the institution is the RIGHT string - that is the unit test's job.
 *
 * USAGE:  node scripts/check-accounts-groups.mjs
 * EXITS:  0 pass . 1 a real defect . 2 could not test / instrument blind
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
// The same refusal every browser gate here carries: this scripts a password sign-in, so it must
// only ever be able to do so for the dedicated walk account.
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to script a sign-in for "${email}".`);

const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}: ${JSON.stringify(session).slice(0, 200)}`);

const whatsNew = readFileSync('src/lib/whats-new.ts', 'utf8');
const releaseVersion = (whatsNew.match(/version:\s*'([^']+)'/) || [])[1];
if (!releaseVersion) fail(2, 'could not read the current release version out of src/lib/whats-new.ts.');
const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
const prof = await fetch(`${url}/rest/v1/profiles?select=tour_flags&user_id=eq.${session.user.id}`, { headers: rest });
if (!prof.ok) fail(2, `reading the walk account's profile returned ${prof.status}.`);
const flags = (await prof.json())[0]?.tour_flags ?? {};
const patch = await fetch(`${url}/rest/v1/profiles?user_id=eq.${session.user.id}`, {
  method: 'PATCH',
  headers: { ...rest, Prefer: 'return=representation' },
  body: JSON.stringify({
    founder_note_seen: true,
    tour_flags: { ...flags, new_user_done: true, premium_done: true, [`whats_new_${releaseVersion}`]: true },
  }),
});
const patched = await patch.json().catch(() => []);
if (!patch.ok || !Array.isArray(patched) || patched.length === 0) {
  fail(2, `settling the first-run dialogs matched no profile row (HTTP ${patch.status}).`);
}

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));
await page.goto(`${BASE}/dashboard?tab=accounts`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);

const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';
for (let i = 0; i < 6 && (await page.locator(OVERLAY).count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const still = page.locator(OVERLAY);
  if (await still.count()) { await still.first().dispatchEvent('click'); await page.waitForTimeout(600); }
}
if (await page.locator(OVERLAY).count()) {
  await browser.close();
  fail(2, 'a modal overlay is still up; it would intercept the reads below.');
}

const report = await page.evaluate(() => {
  const isRow = (c) => {
    const ps = c.querySelectorAll('p');
    return ps.length >= 2 && c.querySelector('span.font-display');
  };
  // ⚠️ GROUPS ARE READ FROM THE DOM STRUCTURE, NEVER BY MATCHING HEADING TEXT AGAINST ROW TEXT.
  // The first version of this gate classified "a row that does not mention any heading" as solo -
  // but that is ALSO exactly what a correctly grouped row looks like, because a grouped row
  // deliberately does not repeat its institution. So it reported 9 solo groups where there are 4,
  // and an invented 171px saving. Same family as selecting on a correctness marker: the property
  // it keyed on is shared by the thing it was looking for and the thing it was excluding.
  // A group is the wrapper the page renders per group; its rows are the account cards inside it.
  const wrappers = [...document.querySelectorAll('div.space-y-3')].filter(w => {
    const rows = [...w.children].filter(el => el.classList?.contains('card-forged') && isRow(el));
    return rows.length > 0;
  });
  const groups = wrappers.map(w => {
    const rows = [...w.children].filter(el => el.classList?.contains('card-forged') && isRow(el));
    const h = w.querySelector(':scope > div > h3');
    return {
      heading: h ? (h.textContent || '').trim() : null,
      headingHeight: h ? Math.round(h.closest('div').getBoundingClientRect().height) : 0,
      rows: rows.map(c => {
        const meta = [...c.querySelectorAll('p')].find(p => p.className.includes('text-muted-foreground'));
        const mb = meta ? meta.getBoundingClientRect() : null;
        return {
          name: (c.querySelector('p')?.textContent || '').trim(),
          metaText: (meta?.textContent || '').trim(),
          metaOverflow: meta ? meta.scrollWidth - meta.clientWidth : 0,
          metaWidth: mb ? Math.round(mb.width) : 0,
          metaHeight: mb ? Math.round(mb.height) : 0,
        };
      }),
    };
  });
  return {
    groups,
    rowCount: groups.reduce((n, g) => n + g.rows.length, 0),
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

await browser.close();

// -- 1. POSITIVE CONTROLS ------------------------------------------------------------------
if (report.rowCount === 0) {
  fail(2, 'examined ZERO account rows - the probe never reached the Accounts tab, so nothing below '
    + 'would have been measured. A clean run and a blind one must not look the same.');
}

const solo = report.groups.filter(g => g.rows.length === 1);
const multi = report.groups.filter(g => g.rows.length > 1);

console.log(`examined ${report.rowCount} account rows in ${report.groups.length} groups `
  + `(${solo.length} of one, ${multi.length} of two or more)`);
for (const g of report.groups) {
  console.log(`  [${g.rows.length}] heading=${g.heading === null ? '(none)' : JSON.stringify(g.heading)}`);
  for (const r of g.rows) {
    console.log(`      "${r.name}" meta=${r.metaWidth}x${r.metaHeight} overflow=${r.metaOverflow}`
      + ` :: ${r.metaText.slice(0, 70)}`);
  }
}

if (solo.length === 0) {
  fail(2, 'the walk account has no group of ONE, so the behaviour under test never rendered. '
    + 'This is the instrument being blind, not the app being correct.');
}
if (multi.length === 0) {
  fail(2, 'the walk account has no group of TWO OR MORE, so there is nothing to prove the '
    + 'institution moves ONLY where the heading went. Without that pair this asserts nothing.');
}

// -- 2. THE PAIR, RENDERED -----------------------------------------------------------------
// Either half alone is a defect: dropping the heading without moving the institution deletes a
// fact, and moving it without dropping the heading prints it twice.
for (const g of solo) {
  if (g.heading !== null) {
    fail(1, `a group of ONE still renders a heading (${JSON.stringify(g.heading)}) - the chrome `
      + 'this fix removes is back.');
  }
  const meta = g.rows[0].metaText;
  // The institution is whatever sits before the first separator on the row's meta line.
  const lead = meta.split('·')[0].trim();
  if (!lead || meta.indexOf('·') === -1) {
    fail(1, `the solo row "${g.rows[0].name}" has no institution on its meta line (${JSON.stringify(meta)}). `
      + 'Dropping the heading without moving the institution DELETES the bank name from the page.');
  }
}
for (const g of multi) {
  if (g.heading === null) {
    fail(1, `a group of ${g.rows.length} renders NO heading - its institution now appears nowhere `
      + 'above its rows.');
  }
  const repeated = g.rows.filter(r => r.metaText.includes(g.heading));
  if (repeated.length) {
    fail(1, `the heading ${JSON.stringify(g.heading)} is ALSO repeated on ${repeated.length} of its own `
      + 'rows - the institution should move only where the heading went.');
  }
}

// -- 3. GEOMETRY - the half jsdom cannot see -----------------------------------------------
const allRows = report.groups.flatMap(g => g.rows);
const overflowing = allRows.filter(r => r.metaOverflow > 1);
if (overflowing.length) {
  fail(1, `${overflowing.length} row(s) have a meta line overflowing their own box: `
    + overflowing.map(r => `"${r.name}" by ${r.metaOverflow}px`).join(', ')
    + '. Adding the institution to a solo row is the most likely cause - this is the '
    + '"Allia/nt/Cred/it/Unio/n" defect Tre has reported four times.');
}
if (report.docOverflow > 1) {
  fail(1, `the page scrolls sideways by ${report.docOverflow}px at 390 - something got wider.`);
}
// The real shape of that defect is not overflow but a sliver: narrow AND tall.
const squeezed = solo.flatMap(g => g.rows).filter(r => r.metaWidth < 120 && r.metaHeight > 48);
if (squeezed.length) {
  fail(1, `${squeezed.length} solo row(s) have a narrow, tall meta line - the institution has been `
    + 'squeezed into a few characters per line: '
    + squeezed.map(r => `"${r.name}" ${r.metaWidth}x${r.metaHeight}`).join(', '));
}

// -- 4. THE SAVING, MEASURED ---------------------------------------------------------------
const headingPx = multi.length
  ? Math.round(multi.reduce((s, g) => s + g.headingHeight, 0) / multi.length)
  : 0;
console.log(`PASS: ${report.groups.length} groups - ${multi.length} keep a heading, `
  + `${solo.length} carry their institution on the row instead.`);
console.log(`      saved ${solo.length * headingPx}px of vertical chrome `
  + `(${solo.length} heading block(s) x ${headingPx}px), measured at 390x844.`);
process.exit(0);
