/**
 * A CYCLING CARD'S ROW MUST SAY WHICH CYCLE ITS COLUMNS BELONG TO.
 *
 * Tre, 2026-09-17: "September 2026 and balance 212, October 2026 purchases is 280 and then the
 * payment is 492 but somehow the end balance again in October 2026 is 280." Both figures were
 * already correct; the row simply never said that the payment settles the PREVIOUS cycle's
 * statement while the end balance is THIS month's purchases forming NEXT month's. His decision on
 * how to resolve it, the same day: "i say we should actually show where users money is going at
 * the right time accurately."
 *
 * WHY THIS IS A RENDERED CHECK AND NOT A SOURCE ONE. The sentence interpolates
 * `proj.months[idx +/- 1].label`, and the first version of it read `.month` - a NUMBER. That
 * TYPECHECKS inside a template literal and renders "undefined's statement" to a user. tsc was
 * clean on it. Only a browser sees that class of defect, so this asserts real month names and
 * explicitly fails on a leaked "undefined".
 *
 * IT CREATES THE STATE IT MEASURES, because the stock walk data cannot produce it: both walk cards
 * ship with `payment_preference = null`, so neither cycles and this branch is unreachable. The
 * gate sets ONE test-account card to 'full', reads that write back before trusting it, measures,
 * and restores the previous value in a `finally`. It refuses to run against anything but an
 * `@forgenta.test` account.
 *
 * DOES NOT COVER: whether the wording is the BEST wording, colour or contrast, where the line
 * sits within the row, revolving cards (which genuinely do reconcile and deliberately carry no
 * such line), or whether the month NAMES are the right months - only that real ones render.
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
    // ⚠️ THE MONTH SLOTS ARE VALIDATED, NOT JUST MATCHED. An earlier version of this regex used
    // `.+?` for them and PASSED a mutation that rendered "1's purchases" - the exact defect
    // that shipped for a moment when the sentence read `.month` (a number) instead of `.label`.
    // A wildcard where a month name belongs cannot tell a month from a row index, so the slots
    // must be a real short month name or one of the deliberate first/last-row fallbacks.
    const M = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|last month|this month|next month)";
    const RE = new RegExp(`Payment settles ${M}'s statement; the .+? end balance is ${M}'s purchases, billed ${M}`);
    // A looser pattern, so a sentence that is PRESENT but malformed is reported as malformed
    // rather than as absent - those are different defects and want different messages.
    const LOOSE = /Payment settles .+?'s statement; the .+? end balance is .+?'s purchases, billed /;
    const spans = [...document.querySelectorAll('span')].map(s => (s.innerText || '').trim()).filter(Boolean);
    const body = document.body.innerText || '';
    return {
      spans: spans.length,
      matches: spans.filter(t => RE.test(t)),
      loose: spans.filter(t => LOOSE.test(t)),
      tableOpen: /End Balance/i.test(body),
      undefinedLeak: /undefined's statement|billed undefined|is undefined's/i.test(body),
    };
  });

  const failures = [];

  // CONTROL ON THE INSTRUMENT, not on the app: if the month table never opened, "0 sentences" is
  // a fact about this probe's clicking and says nothing about the feature.
  if (!found.tableOpen) {
    failures.push(`CONTROL FAILED: the month-by-month table never opened (no "End Balance" header, ${found.spans} spans), so nothing below was measured.`);
  } else if (found.matches.length === 0 && found.loose.length > 0) {
    failures.push(`a cycle sentence rendered, but its month slots are not month names - got: ${JSON.stringify(found.loose.slice(0, 2))}`);
  } else if (found.matches.length === 0) {
    failures.push(`the month table is open but NO row states which cycle its columns belong to (${found.spans} spans examined).`);
  }

  // The defect that a source check cannot see: the sentence is built from `.label`, and reading
  // `.month` - a number - still typechecks inside a template and renders "undefined's statement".
  if (found.undefinedLeak) failures.push('a cycle sentence rendered "undefined" where a month name belongs.');

  for (const m of found.matches.slice(0, 3)) console.log('  ROW:', m);
  console.log(`spans=${found.spans} tableOpen=${found.tableOpen} cycleSentences=${found.matches.length}`);

  if (failures.length) {
    for (const f of failures) console.error('FAIL: ' + f);
    exitCode = 1;
  } else {
    console.log(`PASS: ${found.matches.length} cycling row(s) state which cycle each column belongs to.`);
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
