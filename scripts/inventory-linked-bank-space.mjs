#!/usr/bin/env node
/**
 * inventory-linked-bank-space.mjs - an INVENTORY, not a pass/fail gate, of the horizontal blank
 * run inside every row on the Accounts tab's "Linked banks" segment, at 390x844, signed in.
 *
 * WHY IT EXISTS
 * Tre asked twice for the blank space on this screen to be closed (2026-09-16 16:51, and again
 * 2026-09-17 20:34 after installing iOS 937, which CARRIES both fixes - 89604ad4 and c4ec0b69 are
 * ancestors of 55a17bca, verified with git merge-base). So the fixes were delivered and the
 * complaint survived them. The reason nobody could see that is written in the closing evidence of
 * both asks: the gates were jsdom TEXT assertions, and 44062af7 states its own limit -- "jsdom has
 * no geometry, so this asserts TEXT not layout; how many lines are saved at 390px needs a
 * Playwright rendered frame". That stated limit was never closed. A stated limit is a to-do.
 *
 * WHAT IT MEASURES, per linked-bank row:
 *   BLANK RUN  the distance from the furthest right edge of any rendered TEXT INK to the left edge
 *              of the trailing control - the empty space Tre is pointing at
 *   box vs ink per text line, so a gap caused by a SHORT STRING is told apart from one caused by a
 *              container that refuses to grow
 *
 * POSITIVE CONTROLS (a zero from a broken selector and a zero from a tidy screen are one zero):
 *   - the Linked banks segment was actually reached: aria-selected moved to it;
 *   - at least one row was found, carrying both text and a trailing control.
 * Exit 2 on either, never 0 - an instrument that examined nothing must not read as clean.
 *
 * WHAT IT DOES NOT COVER: colour, vertical rhythm, the Balances segment, desktop widths, and
 * whether the strings themselves are right. It reports; it does not judge.
 */
import { readFileSync, mkdirSync } from 'node:fs';

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
catch (err) { fail(2, `${BASE} is not serving (${err.message}).`); }

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
if (await page.locator(OVERLAY).count()) { await browser.close(); fail(2, 'a modal overlay is still up.'); }

// -- reach the Linked banks segment and prove the PANEL CHANGED --------------------------------
// ⚠️ THE SEGMENT IS NOT A `role="tab"` AND ITS LABEL IS NOT "Linked Banks" AT PHONE WIDTH.
// `Accounts.tsx` renders `<span class="sm:hidden">Banks</span>` beside a `hidden sm:inline`
// "Linked Banks", so a 390px viewport shows the word "Banks" alone. A probe looking for the
// desktop string finds nothing and reports a clean screen. Match the SHORT label.
const segs = page.locator('button.seg-item');
// ⚠️ WAIT FOR THE SEGMENTS, DO NOT TIME OUT AND READ ZERO. A fixed 8s settle found them on one
// run and not the next, and "no segments" is indistinguishable from a page that had not finished
// mounting. A probe that reads a number off a page it did not wait for is measuring the machine.
// The page renders TWO `.seg-item` bars - the outer Overview/Goals/Accounts pill and, inside the
// Accounts panel, the Balances/Banks one. Waiting for the FIRST segment returns as soon as the
// outer bar mounts, which is how a run read "3 segments, none of them Banks" and reported the
// inner bar missing when it simply had not rendered yet. Wait for the segment being looked for.
await page.locator('button.seg-item', { hasText: /banks/i }).first()
  .waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
const segCount = await segs.count();
if (segCount === 0) { await browser.close(); fail(2, 'no .seg-item segments on the Accounts tab.'); }
let banksIdx = -1;
for (let i = 0; i < segCount; i += 1) {
  const label = ((await segs.nth(i).textContent()) || '').toLowerCase();
  if (label.includes('bank')) { banksIdx = i; break; }
}
if (banksIdx < 0) { await browser.close(); fail(2, `no Banks segment among ${segCount} .seg-item buttons.`); }
// Positive control on the SWITCH, not on the click: count rows before and after. Asserting only
// that the active class moved would pass over a panel that never rendered.
const rowSel = 'div.flex.items-center.justify-between';
const before = await page.locator(rowSel).count();
await segs.nth(banksIdx).click();
await page.waitForTimeout(1500);
const active = await segs.nth(banksIdx).getAttribute('class');
if (!/seg-item-active/.test(active || '')) {
  await browser.close();
  fail(2, 'pressing the Banks segment did not make it the active segment - everything below would '
    + 'have been measured on whichever panel was still showing.');
}
const after = await page.locator(rowSel).count();
if (after === before) {
  await browser.close();
  fail(2, `the row count did not move when the panel did (${before} before, ${after} after). A `
    + 'segment that throws nothing and changes nothing passes every smoke test ever written.');
}

const report = await page.evaluate(() => {
  // A linked-bank row is found by SHAPE, never by a correctness marker: a flex row holding a text
  // block and a trailing <button>. That shape is true of the row both before and after any spacing
  // fix, so this can still find the row on the day the defect is real.
  const rows = [...document.querySelectorAll('div.flex.items-center.justify-between')].filter(r => {
    const btn = r.querySelector(':scope > button');
    const text = r.querySelector(':scope > div p');
    return !!btn && !!text && r.getBoundingClientRect().width > 200;
  });
  return {
    rows: rows.map(r => {
      const rb = r.getBoundingClientRect();
      const btn = r.querySelector(':scope > button').getBoundingClientRect();
      const lines = [...r.querySelectorAll(':scope > div p')].map(p => {
        const b = p.getBoundingClientRect();
        // The <p> is a block and stretches to its container; the INK is what the glyphs occupy,
        // and the gap Tre can see is measured from the ink, never from the box.
        const range = document.createRange();
        range.selectNodeContents(p);
        const ink = range.getBoundingClientRect();
        return {
          text: (p.textContent || '').trim(),
          boxW: Math.round(b.width),
          inkW: Math.round(ink.width),
          right: Math.round(ink.right),
        };
      });
      const furthestInk = lines.length ? Math.max(...lines.map(l => l.right)) : rb.left;
      return {
        name: lines[0]?.text ?? '(no text)',
        rowW: Math.round(rb.width),
        rowH: Math.round(rb.height),
        gap: Math.round(btn.left - furthestInk),
        btnW: Math.round(btn.width),
        lines,
      };
    }),
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

try { mkdirSync('scripts/.out', { recursive: true }); } catch { /* already there */ }
await page.screenshot({ path: 'scripts/.out/linked-banks-390.png', fullPage: true }).catch(() => {});

// -- the sibling surface. "at least on the accounts section" is where he happened to look, not
// the boundary of the defect, so the Balances list is measured in the same run rather than left
// to a second session that would have to re-seed everything to see it.
// By TEXT, not by index: `.seg-item` also matches the outer Overview/Goals/Accounts bar, so
// "the other index" would have pressed a different pill entirely and measured another panel.
await page.locator('button.seg-item', { hasText: /balances/i }).first().click();
await page.waitForTimeout(1500);
await page.screenshot({ path: 'scripts/.out/balances-390.png', fullPage: true }).catch(() => {});
const balances = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('div.card-forged')].filter(c => {
    const ps = c.querySelectorAll('p');
    return ps.length >= 2 && c.querySelector('span.font-display');
  });
  return cards.map(c => {
    const cb = c.getBoundingClientRect();
    const fig = c.querySelector('span.font-display').getBoundingClientRect();
    const ink = [...c.querySelectorAll('p')].map(p => {
      const r = document.createRange();
      r.selectNodeContents(p);
      const i = r.getBoundingClientRect();
      return { text: (p.textContent || '').trim(), inkW: Math.round(i.width), right: Math.round(i.right) };
    });
    const furthest = ink.length ? Math.max(...ink.map(l => l.right)) : cb.left;
    return {
      name: ink[0]?.text ?? '(none)',
      cardW: Math.round(cb.width),
      cardH: Math.round(cb.height),
      gapToFigure: Math.round(fig.left - furthest),
      ink,
    };
  });
});
await browser.close();

if (report.rows.length === 0) {
  fail(2, 'examined ZERO linked-bank rows. The walk account has a plaid item, so this is the probe '
    + 'being blind rather than the screen being empty - a clean run and a blind one must not look alike.');
}
console.log(`examined ${report.rows.length} linked-bank row(s) at 390x844, doc overflow ${report.docOverflow}px`);
for (const r of report.rows) {
  console.log(`  "${r.name}" row=${r.rowW}x${r.rowH} control=${r.btnW}px  BLANK RUN=${r.gap}px`);
  for (const l of r.lines) console.log(`      box=${l.boxW} ink=${l.inkW} :: ${l.text.slice(0, 64)}`);
}
const worst = Math.max(...report.rows.map(r => r.gap));
console.log(`widest blank run: ${worst}px of a ${report.rows[0].rowW}px row `
  + `(${Math.round((worst / report.rows[0].rowW) * 100)}%)`);

if (balances.length === 0) {
  fail(2, 'examined ZERO account cards on the Balances segment - the second half of this inventory '
    + 'measured nothing, and an unmeasured surface must not read as a clean one.');
}
console.log(`\nBalances segment: ${balances.length} account card(s)`);
for (const b of balances) {
  console.log(`  "${b.name}" card=${b.cardW}x${b.cardH}  BLANK RUN to figure=${b.gapToFigure}px`);
  for (const l of b.ink) console.log(`      ink=${l.inkW} :: ${l.text.slice(0, 60)}`);
}
