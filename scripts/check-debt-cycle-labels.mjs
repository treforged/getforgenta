/**
 * EVERY RENDERED /debt ROW MUST ADD UP: End = Start + purchases + interest - Payment.
 *
 * ⚠️ RE-AIMED 2026-09-17, the day after it was written. It used to assert that a sentence
 * rendered on each cycling row explaining that the payment and the end balance "belong to
 * different billing cycles". That sentence was removed the same day because ITS PREMISE WAS
 * FALSE, so a gate asserting its presence was pinning a wrong explanation in place.
 *
 * The premise died to algebra. On a cycling row, with Start = S + B (this cycle's statement
 * plus carried backlog), Payment P = p_s + p_b, and next cycle's backlog
 * B' = B + (S - p_s) - p_b:
 *     End = purchases + B' = purchases + (S + B) - P = Start + purchases - P.
 * So the identity binds on a cycling row exactly as hard as on a revolving one - confirmed
 * across four sim shapes at residual 0.00 in credit-card-engine.rowReconciliation.test.ts.
 * Tre's row (start 262, +280 purchases, payment 542, end 280) therefore does not satisfy it
 * and is a DEFECT, not a presentational gap. The gate now checks the thing he actually
 * reported instead of the caption somebody put over it.
 *
 * WHY THIS IS A RENDERED CHECK AND NOT A SOURCE ONE. The numbers on this row come from three
 * different arrays joined at a call site, and a source scan cannot see arithmetic. The unit
 * gate covers the LOCAL sim path; this one covers what a person actually sees, which on /debt
 * can be fed by the CONVERGED forecast run that the unit gate never executes. That gap is
 * exactly where the reported defect is currently believed to live, so the two are not
 * redundant.
 *
 * IT CREATES THE STATE IT MEASURES, because the stock walk data cannot produce it: both walk
 * cards ship with `payment_preference = null`, so neither cycles and the branch is unreachable.
 * The gate sets ONE test-account card to 'full', reads that write back before trusting it,
 * measures, and restores the previous value in a `finally`. It refuses to run against anything
 * but an `@forgenta.test` account.
 *
 * EXIT CODES ARE LOAD-BEARING: 1 means a row does not reconcile (a finding), 2 means the probe
 * could not read any rows (an instrument fault). They must not be collapsed - an exit-1 defect
 * gets fixed, an exit-2 tooling fault gets re-run then ignored, so reporting one as the other
 * is how a real finding gets buried.
 *
 * ⚠️ MEASURED LIMIT, AND IT IS THE IMPORTANT ONE: as this actually runs today, the rows it
 * reaches are REVOLVING, not cycling. Setting `payment_preference` to 'full' is necessary for
 * a card to cycle but not sufficient - the walk card still carries a ~$4,200 balance, so it
 * revolves until that clears, and the observed rows are Sep/Oct with purchases 0. So this gate
 * currently asserts the identity on the branch that ALREADY had a guard, and does NOT yet
 * exercise the deferred branch Tre's defect sits on. Written down rather than left implied,
 * because a gate named for cycling rows that only ever sees revolving ones is exactly the kind
 * of green somebody later quotes as proof the reported bug is fixed. To close it, the fixture
 * needs a card with a ZERO balance and recurring purchases; until then the cycling branch is
 * covered only by the unit gate.
 *
 * DOES NOT COVER: colour, contrast, spacing, where anything sits in the row, whether the
 * PURCHASES or PAYMENT figures are themselves the right figures (only that they are mutually
 * consistent), the reviewer account's data resembling any real user's, or the converged path
 * on a card whose shape the walk fixture cannot produce.
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




// ── MAKE THE BRANCH REACHABLE, THEN MEASURE IT ───────────────────────────────
// ⚠️ BOTH WALK-ACCOUNT CARDS SHIP WITH `payment_preference = null`, i.e. neither CYCLES. The
// sentence under test renders only on a cycling card, so on the stock walk data this probe would
// be permanently red for a reason that is about the FIXTURE and not about the app - the mirror of
// a test that is green over a state the data can never produce. So the gate CREATES the state it
// needs on the test account, measures, and puts it back.
//
// It only ever touches an `@forgenta.test` account - asserted above before any sign-in - and it
// restores the previous value in a `finally`, so a crash mid-run cannot leave the walk account in
// a state the next gate would inherit.
const cardsRes = await fetch(
  `${url}/rest/v1/accounts?select=id,name,payment_preference&user_id=eq.${uid}&account_type=eq.credit_card`,
  { headers: rest },
);
const cards = await cardsRes.json().catch(() => []);
if (!Array.isArray(cards) || cards.length === 0) {
  fail(2, 'the walk account has no credit_card rows - nothing to measure, and a zero here would be about the fixture.');
}
const subject = cards[0];
const previousPreference = subject.payment_preference ?? null;

let exitCode = 0;
try {
  await fetch(`${url}/rest/v1/accounts?id=eq.${subject.id}`, {
    method: 'PATCH',
    headers: { ...rest, Prefer: 'return=minimal' },
    body: JSON.stringify({ payment_preference: 'full' }),
  });

  // Read it BACK. A PATCH that silently did nothing and a card that was already cycling look the
  // same from here, and this repo has measured a reset whose read-back ran before the app could
  // undo it. This read is the write's own evidence, not the app's.
  const verify = await fetch(
    `${url}/rest/v1/accounts?select=payment_preference&id=eq.${subject.id}`, { headers: rest },
  ).then(r => r.json()).catch(() => []);
  if (verify?.[0]?.payment_preference !== 'full') {
    fail(2, `could not make ${subject.name} a cycling card (read back ${JSON.stringify(verify?.[0])}) - the setup failed, so nothing below was measured.`);
  }

  await page.goto(`${BASE}/debt`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);

  // ⚠️ OPEN THE CARD ACCORDION BY ITS CARD NAME, NOT BY `aria-expanded`. None of the disclosures
  // on this page carries that attribute, so a generic "click everything collapsed" pass clicks
  // nothing and the table stays shut - which the control below correctly reported as an INSTRUMENT
  // failure rather than a missing sentence. The card's own button is the accordion.
  await page.evaluate((cardName) => {
    for (const b of [...document.querySelectorAll('button')]) {
      if ((b.innerText || '').trim().startsWith(cardName)) { b.click(); return; }
    }
  }, subject.name);
  await page.waitForTimeout(3000);
  // A second pass for anything nested inside the now-open accordion (the year tabs / month list).
  await page.evaluate(() => {
    for (const b of [...document.querySelectorAll('button,[role="button"]')]) {
      if (b.getAttribute('aria-expanded') === 'false') b.click();
    }
  });
  await page.waitForTimeout(2500);

  const btns = await page.evaluate(() => [...document.querySelectorAll('button,[role="button"]')]
    .map(b => ({ t: (b.innerText||'').trim().slice(0,45), ex: b.getAttribute('aria-expanded'), vis: b.getBoundingClientRect().height > 0 }))
    .filter(b => b.t));
  console.log('BUTTONS:', JSON.stringify(btns.slice(0, 30)));

  const found = await page.evaluate(() => {
    const NL = String.fromCharCode(10);
    // Read a dollar figure out of a line. Deliberately tolerant of a leading minus and of
    // thousands separators, and returns null rather than 0 when there is no figure at all -
    // a missing number and a zero are different facts and must not collapse.
    const num = (t) => {
      if (t == null) return null;
      const m = String(t).replace(/,/g, '').match(/-?\$\s*([0-9]+(?:\.[0-9]+)?)/);
      return m ? Number(m[1]) : null;
    };
    const MONTH_HEAD = /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4}$/;
    const rows = [];
    // The tightest element whose flattened text starts with a month label and contains the
    // "Start:" detail line is the row. Walking every div and keeping the SMALLEST match per
    // month avoids picking an ancestor that has swallowed several rows.
    for (const el of [...document.querySelectorAll('div')]) {
      const txt = (el.innerText || '').trim();
      if (!txt) continue;
      const lines = txt.split(NL).map(l => l.trim()).filter(Boolean);
      if (lines.length < 4 || lines.length > 16) continue;
      if (!MONTH_HEAD.test(lines[0])) continue;
      const startIdx = lines.findIndex(l => l.startsWith('Start:'));
      if (startIdx < 0) continue;
      // Everything between the month label and the detail block is the row's own right-hand
      // columns. The LAST two dollar figures there are Payment and End Balance, in that order.
      const headFigures = lines.slice(1, startIdx).map(num).filter(v => v !== null);
      const start = num(lines[startIdx]);
      const purchases = num(lines.find(l => l.includes('purchases'))) ?? 0;
      const interest = num(lines.find(l => l.includes('interest') && l.includes('$'))) ?? 0;
      const payment = headFigures.length >= 2 ? headFigures[headFigures.length - 2] : null;
      const endBalance = headFigures.length >= 1 ? headFigures[headFigures.length - 1] : null;
      rows.push({ month: lines[0], start, purchases, interest, payment, endBalance, lines: lines.length, headFigures });
    }
    // De-duplicate by month, keeping the tightest (fewest lines) container for each.
    const byMonth = new Map();
    for (const r of rows) {
      const prev = byMonth.get(r.month);
      if (!prev || r.lines < prev.lines) byMonth.set(r.month, r);
    }
    return {
      rows: [...byMonth.values()],
      totalDivsMatched: rows.length,
      tableOpen: /End Balance/i.test(document.body.innerText || ''),
    };
  });

  const failures = [];
  const TOLERANCE = 1; // same as the in-engine guard: clears whole-dollar rounding, catches real gaps

  const parsed = found.rows.filter(r =>
    r.start !== null && r.payment !== null && r.endBalance !== null);
  // COUNT AND NAME WHAT WAS DROPPED. A row the reader could not parse and a row that does not
  // exist look identical in a total, and the row most likely to defeat a parser is the odd one
  // - which is also the one most likely to carry the defect. Printing them means a silent drop
  // cannot masquerade as a clean sweep.
  const dropped = found.rows.filter(r => !parsed.includes(r));
  for (const d of dropped) {
    console.log(`  DROPPED ${d.month}: start=${d.start} pay=${d.payment} end=${d.endBalance} headFigures=${JSON.stringify(d.headFigures)} (not parseable into start/payment/end)`);
  }

  // ── CONTROLS ON THE INSTRUMENT, before any claim about the app ──────────────────────────
  // A zero from a probe that never opened the table, and a zero from an app with no defect,
  // are the same zero. These separate them, and they exit 2 (instrument fault) rather than 1
  // (finding) so a tooling break is never read as "the rows are fine" OR as a real defect.
  if (!found.tableOpen) {
    console.error(`CONTROL FAILED: the month-by-month table never opened (no "End Balance" header), so nothing was measured.`);
    exitCode = 2;
  } else if (parsed.length === 0) {
    console.error(`CONTROL FAILED: the table is open but NO row could be parsed into start/payment/end (${found.totalDivsMatched} candidate containers). The reader is broken, not the app.`);
    exitCode = 2;
  } else {
    // ── THE ASSERTION: every rendered row adds up ─────────────────────────────────────────
    // End = Start + purchases + interest - Payment. See the header for why this binds on a
    // cycling row as hard as on a revolving one.
    for (const r of parsed) {
      const residual = Math.round((r.endBalance - (r.start + r.purchases + r.interest - r.payment)) * 100) / 100;
      const mark = Math.abs(residual) > TOLERANCE ? '  <<< DOES NOT RECONCILE' : '';
      console.log(`  ${r.month} start=${r.start} purch=${r.purchases} int=${r.interest} pay=${r.payment} end=${r.endBalance} residual=${residual}${mark}`);
      if (Math.abs(residual) > TOLERANCE) {
        failures.push(`${r.month}: End ${r.endBalance} != Start ${r.start} + purchases ${r.purchases} + interest ${r.interest} - payment ${r.payment} (residual ${residual})`);
      }
    }
    console.log(`rows parsed=${parsed.length} of ${found.rows.length} month containers`);

    if (failures.length) {
      for (const f of failures) console.error('FAIL: ' + f);
      exitCode = 1;
    } else {
      console.log(`PASS: ${parsed.length} rendered row(s) reconcile within $${TOLERANCE}.`);
    }
  }
} finally {
  await fetch(`${url}/rest/v1/accounts?id=eq.${subject.id}`, {
    method: 'PATCH',
    headers: { ...rest, Prefer: 'return=minimal' },
    body: JSON.stringify({ payment_preference: previousPreference }),
  });
  const back = await fetch(
    `${url}/rest/v1/accounts?select=payment_preference&id=eq.${subject.id}`, { headers: rest },
  ).then(r => r.json()).catch(() => []);
  console.log(`restored ${subject.name}.payment_preference to ${JSON.stringify(back?.[0]?.payment_preference ?? null)} (was ${JSON.stringify(previousPreference)})`);
  await browser.close();
}
process.exit(exitCode);
