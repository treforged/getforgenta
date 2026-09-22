#!/usr/bin/env node
/**
 * measure-panel-whitespace.mjs - WHERE IS THE EMPTY SPACE INSIDE THE CARDS, and which strings do
 * not fit a full word on a line?
 *
 * Tre has raised this family THREE times (ask d391e98b), and every raise is about the BODY:
 *   "theres some empty spacing where I think it could just be just better in general"
 *   "theres a lot of empty space on the sides of some of these boxes"
 *   "fix the text so it actually shows like a full word in a line"
 *
 * ⚠️ THE INSTRUMENT ALREADY IN THE REPO CANNOT ANSWER THAT, which is why this one exists.
 * `inventory-top-right-space.mjs` measures the HEADER ZONE - the title row and what sits under
 * it. Measured for Plan on 2026-09-22: rightGap 14px on a phone. **Fourteen pixels is tight, not
 * wasteful.** So the header is not where the waste is, and a layout change justified by that
 * number would have been aimed at the wrong part of the screen.
 *
 * ── WHAT IT MEASURES, PER CARD ───────────────────────────────────────────────────────────────
 *   sideWaste  the card's inner width minus the widest thing actually PAINTED in it. This is
 *              "empty space on the sides of this box" as a number.
 *   orphans    text nodes that wrap and leave a last line holding a single short word. That is
 *              what "does not show a full word in a line" looks like once it is measurable.
 *   clipped    text whose scrollWidth exceeds its clientWidth - cut off rather than wrapped.
 *
 * ── IT IS AN INVENTORY, NOT A GATE ───────────────────────────────────────────────────────────
 * It exits 0 whatever it finds, because "how much whitespace is too much" is a design judgement
 * and a probe claiming to settle it would be the kind of instrument this repo keeps filing as a
 * lie. It exits 2 when it examined NOTHING, because a zero from a screen that never mounted and
 * a zero from a tidy screen are the same zero.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────────────────────
 * It does not judge beauty, colour or hierarchy. It does not know which whitespace is deliberate
 * breathing room - a dense money screen needs some. It reads ONE panel at ONE width. And a card
 * whose content is genuinely narrow (a single short value) will show large sideWaste correctly
 * and harmlessly, so the output is ranked to be read rather than thresholded.
 *
 * USAGE:  node scripts/measure-panel-whitespace.mjs [--route "/transactions?tab=budget"] [--width 390]
 */

import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const fail = (code, msg) => { console.error(`FAIL(${code}): ${msg}`); process.exit(code); };
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
};

const ROUTE = arg('--route', '/transactions?tab=budget');
const WIDTH = Number(arg('--width', '390'));

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
// The same refusal every browser gate here carries.
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to script a sign-in for "${email}".`);

const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}.`);

// Settle the first-run dialogs the same way the contrast probe does, and for the same reason:
// a modal intercepts everything below it. The PMF flag is DERIVED, because a hand-named list is
// blind to the modal nobody added to it - which is exactly how that probe silently stopped
// running for days.
const whatsNew = readFileSync('src/lib/whats-new.ts', 'utf8');
const releaseVersion = (whatsNew.match(/version:\s*'([^']+)'/) || [])[1];
const pmfSeenFlag = (readFileSync('src/lib/pmf-survey.ts', 'utf8')
  .match(/PMF_SEEN_FLAG\s*=\s*'([^']+)'/) || [])[1];
if (!releaseVersion || !pmfSeenFlag) fail(2, 'could not derive the dialog-suppression flags.');

const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
const prof = await fetch(`${url}/rest/v1/profiles?select=tour_flags&user_id=eq.${session.user.id}`, { headers: rest });
if (!prof.ok) fail(2, `reading the walk account's profile returned ${prof.status}.`);
const flags = (await prof.json())[0]?.tour_flags ?? {};
const patch = await fetch(`${url}/rest/v1/profiles?user_id=eq.${session.user.id}`, {
  method: 'PATCH',
  headers: { ...rest, Prefer: 'return=representation' },
  body: JSON.stringify({
    founder_note_seen: true,
    tour_flags: { ...flags, new_user_done: true, premium_done: true, [`whats_new_${releaseVersion}`]: true, [pmfSeenFlag]: true },
  }),
});
if (!patch.ok) fail(2, `settling the first-run dialogs returned HTTP ${patch.status}.`);

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: npm run dev`); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));

const read = () => page.evaluate(() => {
  const cards = [...document.querySelectorAll('.card-forged')].filter((c) => {
    const b = c.getBoundingClientRect();
    return b.width > 40 && b.height > 20;
  });

  const out = [];
  for (const card of cards) {
    const cb = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const inner = cb.width - padL - padR;

    // The widest thing actually PAINTED. A block child fills the card by definition, so measuring
    // child boxes would report zero waste everywhere - it is the TEXT and the non-stretching
    // controls that show where the content really ends.
    let widest = 0;
    const orphans = [];
    const clipped = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent || '').trim();
      if (!text) continue;
      const el = n.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;

      const range = document.createRange();
      range.selectNodeContents(n);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) continue;
      for (const r of rects) widest = Math.max(widest, r.right - cb.left - padL);

      // A last line holding ONE short word is the "does not show a full word in a line" shape.
      if (rects.length > 1) {
        const last = rects[rects.length - 1];
        const words = text.split(/\s+/);
        if (last.width < (cb.width - padL - padR) * 0.25 && words.length > 1) {
          orphans.push({ text: text.slice(0, 44), lines: rects.length, lastPx: Math.round(last.width) });
        }
      }
      if (el.scrollWidth > el.clientWidth + 1 && st.overflow !== 'visible') {
        clipped.push({ text: text.slice(0, 44), overPx: el.scrollWidth - el.clientWidth });
      }
    }

    // Controls that do not stretch also mark where content ends.
    for (const el of card.querySelectorAll('button, input, select, svg')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) widest = Math.max(widest, r.right - cb.left - padL);
    }

    const label = (card.querySelector('h1,h2,h3,h4')?.textContent || '').trim().slice(0, 30)
      || (card.textContent || '').trim().slice(0, 30);
    out.push({
      label,
      cardPx: Math.round(cb.width),
      innerPx: Math.round(inner),
      contentPx: Math.round(widest),
      sideWaste: Math.round(inner - widest),
      heightPx: Math.round(cb.height),
      orphans,
      clipped,
    });
  }
  return out;
});

await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

// SETTLE, and refuse rather than average. Two agreeing reads of a page that has not mounted agree
// perfectly, so the count must also clear a floor - a lesson this repo paid for twice today.
let r = await read();
let settled = false;
const counts = [r.length];
for (let i = 0; i < 5; i += 1) {
  await page.waitForTimeout(2000);
  const again = await read();
  counts.push(again.length);
  if (again.length === r.length) { r = again; settled = true; break; }
  r = again;
}
await browser.close();

if (!settled) fail(2, `UNSTABLE: card counts ${counts.join(' -> ')}. Not averaging them.`);
if (r.length === 0) {
  fail(2, `examined ZERO cards on ${ROUTE} - the panel never mounted, so any finding here would `
    + 'be a fact about the probe rather than about the app.');
}

console.log(`\n${ROUTE} at ${WIDTH}px - ${r.length} cards (settled after ${counts.length} reads)\n`);
console.log('  waste  card  content  height  card');
console.log('  ' + '-'.repeat(68));
for (const c of [...r].sort((a, b) => b.sideWaste - a.sideWaste)) {
  console.log(`  ${String(c.sideWaste).padStart(5)}  ${String(c.cardPx).padStart(4)}  `
    + `${String(c.contentPx).padStart(7)}  ${String(c.heightPx).padStart(6)}  ${c.label}`);
}

const allOrphans = r.flatMap((c) => c.orphans.map((o) => ({ ...o, card: c.label })));
const allClipped = r.flatMap((c) => c.clipped.map((o) => ({ ...o, card: c.label })));

console.log(`\nORPHANED LAST LINES - a wrapped string whose last line holds one short word: ${allOrphans.length}`);
for (const o of allOrphans.slice(0, 15)) {
  console.log(`  ${String(o.lines)} lines, last ${String(o.lastPx).padStart(3)}px  ${JSON.stringify(o.text)}  [${o.card}]`);
}
console.log(`\nCLIPPED TEXT - cut off rather than wrapped: ${allClipped.length}`);
for (const o of allClipped.slice(0, 15)) {
  console.log(`  over by ${String(o.overPx).padStart(4)}px  ${JSON.stringify(o.text)}  [${o.card}]`);
}

const totalWaste = r.reduce((s, c) => s + Math.max(0, c.sideWaste), 0);
console.log(`\ntotal side waste across ${r.length} cards: ${totalWaste}px `
  + `(mean ${Math.round(totalWaste / r.length)}px per card)`);
console.log('\nThis is an INVENTORY, not a gate: how much whitespace is too much is a design');
console.log('judgement, and a probe claiming to settle it would be measuring nothing.');
