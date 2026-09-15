#!/usr/bin/env node
/**
 * check-pmf-survey.mjs - prove the Sean Ellis survey RECORDS AN ANSWER, not just that it renders.
 *
 * WHY THE DATABASE READ IS THE WHOLE POINT. The first live run of this modal rendered the
 * question, accepted the press, advanced to the follow-up step and wrote NOTHING - the table's
 * UPDATE privilege had been revoked, an upsert is INSERT ... ON CONFLICT DO UPDATE, PostgREST
 * refused it, and the component swallowed the error. THE SCREEN WAS IDENTICAL BEFORE AND AFTER
 * THE FIX. Six jsdom tests passed throughout, because a mock resolves `{ error: null }`. A check
 * that presses the button and reads the screen would have passed over a survey that recorded
 * nothing and then produced a confident proportion from whichever writes happened to succeed.
 *
 * THE FIXTURE IS BUILT AS THE WALK USER, through PostgREST, with no service key - there is none on
 * this machine and this check does not need one. It only ever touches the walk account.
 *
 * CONTROLS
 *   - The account must hold ZERO answers before the press, asserted after clearing. Otherwise a
 *     leftover row satisfies the read-back whatever the press did.
 *   - The backdate is READ BACK before the browser opens. A fixture that silently does nothing is
 *     this portfolio's most-repeated defect.
 *
 * WHAT IT DOES NOT COVER: the free-text write, the non-disappointed path, the wording, and
 * anything about real users - it exercises one test account on /dashboard.
 *
 * EXITS: 0 pass . 1 the survey does not record an answer . 2 could not test
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
// `.test` can never be a real mailbox - see walk-deck-undo.mjs for why that is what
// makes scripting this sign-in legitimate. Remove this and the dev-signin rule returns.
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to script a sign-in for "${email}".`);

const ref = new URL(url).hostname.split('.')[0];

const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}: ${JSON.stringify(session).slice(0, 200)}`);

// Settle the one-time dialogs in the ACCOUNT, not by racing their backdrops in the
// browser - see check-collapsed-rail.mjs for why that race is unwinnable.
const whatsNew = readFileSync('src/lib/whats-new.ts', 'utf8');
const releaseVersion = (whatsNew.match(/version:\s*'([^']+)'/) || [])[1];
if (!releaseVersion) fail(2, "could not read the current release version out of src/lib/whats-new.ts.");
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


// ─── FIXTURE, as the walk user ────────────────────────────────────────────────
const asUser = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
const uid = session.user.id;
const backdated = new Date(Date.now() - 30 * 86_400_000).toISOString();

// ⚠️ THE PRE-STATE IS A SENTINEL, NOT AN EMPTY TABLE, and the schema is why: there is no DELETE
// policy and no DELETE grant on `pmf_responses` - an answer is evidence, and evidence a client can
// erase is not evidence. A first draft of this gate tried to clear the row and was correctly
// refused. Seeding the OPPOSITE answer is the stronger check anyway: the assertion becomes "the
// press CHANGED the recorded sentiment", not "a row exists", so a press that writes nothing fails
// even on a second run when a row is already there.
const SENTINEL = 'not_disappointed';
const existing = await (await fetch(`${url}/rest/v1/pmf_responses?select=sentiment&user_id=eq.${uid}`, { headers: asUser })).json();
if (!Array.isArray(existing)) fail(2, `could not read this account's answers (${JSON.stringify(existing).slice(0, 200)}).`);

if (existing.length === 0) {
  const seed = await fetch(`${url}/rest/v1/pmf_responses`, {
    method: 'POST', headers: { ...asUser, Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: uid, survey_version: 'v1', sentiment: SENTINEL }),
  });
  if (!seed.ok) fail(2, `could not seed the sentinel answer (HTTP ${seed.status}).`);
} else {
  const seed = await fetch(`${url}/rest/v1/pmf_responses?user_id=eq.${uid}`, {
    method: 'PATCH', headers: { ...asUser, Prefer: 'return=representation' },
    body: JSON.stringify({ sentiment: SENTINEL, would_miss: null }),
  });
  if (!seed.ok) fail(2, `could not reset the existing answer to the sentinel (HTTP ${seed.status}).`);
}

// READ THE SENTINEL BACK. If it did not land, everything after this measures nothing.
const seeded = await (await fetch(`${url}/rest/v1/pmf_responses?select=sentiment&user_id=eq.${uid}`, { headers: asUser })).json();
if (!Array.isArray(seeded) || seeded.length !== 1 || seeded[0].sentiment !== SENTINEL) {
  fail(2, `the sentinel did not land: read back ${JSON.stringify(seeded)}. Without it the read-back below cannot tell a working press from a dead one.`);
}
console.log(`control: pre-state sentiment is "${SENTINEL}", so the press must CHANGE it`);

// CAPTURE WHAT WILL BE CHANGED, BEFORE CHANGING IT. The restore at the end puts these back, and
// it is read back afterwards rather than assumed.
const priorRow = await (await fetch(`${url}/rest/v1/profiles?select=tour_flags,created_at,onboarding_completed&user_id=eq.${uid}`, { headers: asUser })).json();
if (!Array.isArray(priorRow) || priorRow.length !== 1) {
  fail(2, `could not read the walk account's profile before changing it (got ${JSON.stringify(priorRow).slice(0, 200)}).`);
}
const ORIGINAL_CREATED_AT = priorRow[0].created_at;
const ORIGINAL_ONBOARDING = priorRow[0].onboarding_completed;
const priorFlags = priorRow[0].tour_flags ?? {};
const { pmf_survey_v1: _drop, ...flagsWithoutPmf } = priorFlags;

const fix = await fetch(`${url}/rest/v1/profiles?user_id=eq.${uid}`, {
  method: 'PATCH',
  headers: { ...asUser, Prefer: 'return=representation' },
  body: JSON.stringify({ created_at: backdated, onboarding_completed: true, tour_flags: flagsWithoutPmf }),
});
const fixed = await fix.json().catch(() => []);
// READ THE FIXTURE BACK. A reset is verified by what the database returns, never by the write.
if (!fix.ok || !Array.isArray(fixed) || fixed.length !== 1) {
  fail(2, `backdating the walk account returned HTTP ${fix.status} and matched ${Array.isArray(fixed) ? fixed.length : 0} rows.`);
}
const ageDays = (Date.now() - new Date(fixed[0].created_at).getTime()) / 86_400_000;
if (!(ageDays >= 7)) fail(2, `the backdate did not land: the account reads ${ageDays.toFixed(2)} days old, under the 7-day bar.`);
console.log(`fixture: walk account reads ${ageDays.toFixed(1)} days old, onboarded, pmf flag cleared`);

const restore = async () => {
  await fetch(`${url}/rest/v1/profiles?user_id=eq.${uid}`, {
    method: 'PATCH', headers: asUser,
    body: JSON.stringify({ created_at: ORIGINAL_CREATED_AT, onboarding_completed: ORIGINAL_ONBOARDING, tour_flags: priorFlags }),
  });
};

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

const browser = await chromium.launch();
// A phone viewport: the glass chrome under test (MobileNav, MobileTopBar) is `lg:hidden`
// and does not exist at desktop width, where this check would pass by absence.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);

await page.waitForTimeout(6000);

const QUESTION = 'How would you feel if you could no longer use Forgenta?';
const FOLLOW_UP = 'What would you miss most?';

const seen = await page.evaluate((q) => ({
  present: [...document.querySelectorAll('h2,p,div')].some((e) => e.textContent?.trim() === q),
  radios: [...document.querySelectorAll('[role="radio"]')].map((b) => b.textContent.trim()),
}), QUESTION);

console.log(`survey on screen: ${seen.present} . options: ${JSON.stringify(seen.radios)}`);
if (!seen.present) { await restore(); await browser.close(); fail(1, 'the survey did not render for an eligible account.'); }
if (seen.radios.length !== 3) { await restore(); await browser.close(); fail(1, `${seen.radios.length} options rendered, expected the 3 canonical answers.`); }

await page.evaluate(() => {
  [...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent.trim() === 'Very disappointed').click();
});
await page.waitForTimeout(2500);

// THE PRESS MUST CHANGE THE VIEW - not merely fail to throw.
const after = await page.evaluate(([q, f]) => {
  const txt = document.body.innerText;
  return {
    questionGone: !txt.includes(q),
    followUpShown: txt.includes(f),
    hasSend: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Send'),
  };
}, [QUESTION, FOLLOW_UP]);
console.log(`after the press: ${JSON.stringify(after)}`);

// AND THE ROW MUST EXIST. This is the assertion the screen cannot make.
const rows = await (await fetch(`${url}/rest/v1/pmf_responses?select=sentiment,survey_version&user_id=eq.${uid}`, { headers: asUser })).json();
console.log(`rows recorded for the walk account: ${Array.isArray(rows) ? rows.length : 'unreadable'} ${JSON.stringify(rows)}`);

await restore();
const restored = await (await fetch(`${url}/rest/v1/profiles?select=created_at&user_id=eq.${uid}`, { headers: asUser })).json();
const restoredOk = restored?.[0]?.created_at === ORIGINAL_CREATED_AT;
console.log(`restored created_at: ${restored?.[0]?.created_at} (matches original: ${restoredOk})`);
await browser.close();

if (!after.followUpShown || !after.questionGone || !after.hasSend) {
  fail(1, 'pressing "Very disappointed" did not change the view to the follow-up step.');
}
if (!Array.isArray(rows) || rows.length !== 1 || rows[0].sentiment !== 'very_disappointed') {
  fail(1, `the view advanced but the answer was NOT recorded - the row still reads ${JSON.stringify(rows)} against a "${SENTINEL}" pre-state. This is the exact defect this check exists for: the screen is identical either way.`);
}
console.log('PASS - the survey rendered for an eligible account, the press changed the view, AND the answer is in the database.');
