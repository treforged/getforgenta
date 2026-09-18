#!/usr/bin/env node
/**
 * check-account-sections.mjs - press every segment of the Account tab's section bar on a
 * phone viewport and assert the section actually CHANGED.
 *
 * WHY THIS EXISTS
 * Tre, 2026-09-15: the Leaderboard should come out of the Account tab body and become its
 * own SECTION, reached by a top bar that switches sections within the tab - "the pattern
 * the app already uses". It does: `PanelBar` owns that track on seven other surfaces, so
 * Account becomes a CALLER of it rather than an eighth implementation.
 *
 * ⚠️ AND THE FAILURE THIS GUARDS AGAINST HAS SHIPPED IN THIS PORTFOLIO BEFORE. forged-glass
 * shipped a Conversation tab whose two handlers set the SAME view: it threw nothing, so
 * "press every button" passed it every single time, and the pane was unreachable for every
 * user on every machine. A press that throws nothing and does nothing passes every smoke
 * test ever written. So this does not assert "the click did not error" - it asserts the
 * rendered content is DIFFERENT afterwards, and that each section shows its own heading
 * and not the other's.
 *
 * WHAT IT ASSERTS
 *   1. The bar exists, has at least two segments, and they are found BY ROLE - never by
 *      a hand-written list of labels, which would be blind to a third section nobody
 *      added to it.
 *   2. Pressing each segment moves `aria-selected` to it.
 *   3. The panel body TEXT CHANGES between segments, and each segment's own marker is
 *      present while the other's is absent. Both halves matter: identical-but-nonempty
 *      bodies are the dead-tab defect, and a body that merely changed could still be
 *      showing the wrong thing.
 *   4. The track carries a backdrop-filter - the glass Tre asked for on this bar.
 *      ⚠️ STATED HONESTLY: that is a COMPUTED-STYLE claim, not a measurement that the
 *      effect is real. `npm run check:glass` is what measures real translucency, and it
 *      can only do so for PINNED chrome, because an in-flow bar scrolls with the content
 *      behind it and nothing new ever passes under it.
 *
 * WHAT IT DOES NOT COVER
 *   Layout, contrast, the desktop width, and anything inside either section's body beyond
 *   the heading it is identified by.
 *
 * USAGE:  node scripts/check-account-sections.mjs
 * EXITS:  0 pass . 1 a section did not change . 2 could not test
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));
// Start on the section the page defaults to, not on one a previous run left behind.
await page.evaluate(() => localStorage.removeItem('account-section'));
await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);

const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';
for (let i = 0; i < 6 && (await page.locator(OVERLAY).count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const still = page.locator(OVERLAY);
  if (await still.count()) { await still.first().dispatchEvent('click'); await page.waitForTimeout(600); }
}
if (await page.locator(OVERLAY).count()) {
  await browser.close();
  fail(2, 'a modal overlay is still up; it would intercept every press below.');
}

if (!page.url().includes('/account')) {
  await browser.close();
  fail(2, `landed on ${page.url()} rather than /account - the account is not past first run, so there was no section bar to press.`);
}

const tabs = page.getByRole('tab');
const count = await tabs.count();
console.log(`section bar: ${count} segment(s) found by role`);
if (count < 2) {
  await browser.close();
  fail(1, `the Account tab shows ${count} section segment(s). Tre asked for the leaderboard to be its own section reached by a top bar; with fewer than two there is nothing to switch between.`);
}

/** The panel body is everything on the page that is not the bar itself. */
async function bodyText() {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true);
    for (const t of clone.querySelectorAll('[role="tablist"], nav, header')) t.remove();
    return (clone.innerText || '').replace(/\s+/g, ' ').trim();
  });
}

const seen = [];
for (let i = 0; i < count; i += 1) {
  const tab = tabs.nth(i);
  // ⚠️ THE ACCESSIBLE NAME, NOT THE VISIBLE TEXT - and this gate FAILED CORRECTLY when the bar
  // went icon-only on 2026-09-18, because every segment's innerText became "". That failure was
  // right: a control with no name is unusable to a screen reader, and the fix is that each
  // segment now carries an `aria-label`. So the gate follows the name to where it now lives
  // rather than being loosened - and it asserts the name is NON-EMPTY below, which is the
  // accessibility property that actually matters once the text is gone.
  //
  // Visible text FIRST so a labelled-and-captioned control is still identified by what a sighted
  // user reads; aria-label is the fallback, not the override.
  const label = (
    (await tab.innerText()).trim() || (await tab.getAttribute('aria-label')) || ''
  ).trim().replace(/\s+/g, ' ');
  if (!label) {
    fail(1, 'a segment has NO accessible name - no text and no aria-label. Icon-only controls are '
      + 'unreadable to a screen reader and unlabelled on hover, and a screenshot cannot show it.');
  }
  await tab.click();
  await page.waitForTimeout(1200);
  const selected = await tab.getAttribute('aria-selected');
  const body = await bodyText();
  await page.screenshot({ path: `account-section-${i}.png` });
  console.log(`  pressed ${JSON.stringify(label)} . aria-selected=${selected} . body ${body.length} chars`);
  if (selected !== 'true') {
    await browser.close();
    fail(1, `pressing ${JSON.stringify(label)} left aria-selected=${selected}. The control does not report itself as chosen, so a screen reader and a keyboard user are both told nothing happened.`);
  }
  if (body.length < 40) {
    await browser.close();
    fail(1, `section ${JSON.stringify(label)} rendered ${body.length} characters - effectively empty.`);
  }
  seen.push({ label, body });
}

// 4 - the track carries the glass. A COMPUTED-STYLE claim, and labelled as one.
const trackFilter = await page.evaluate(() => {
  const el = document.querySelector('[role="tablist"]');
  if (!el) return null;
  const st = getComputedStyle(el);
  return st.backdropFilter || st.webkitBackdropFilter || 'none';
});
console.log(`section bar backdrop-filter: ${trackFilter}`);

await browser.close();

// 3 - THE ASSERTION THAT MATTERS. Two segments showing the same body is the dead-tab
// defect: it throws nothing, renders something, and is unreachable.
const failures = [];
for (let i = 0; i < seen.length; i += 1) {
  for (let j = i + 1; j < seen.length; j += 1) {
    if (seen[i].body === seen[j].body) {
      failures.push(`${JSON.stringify(seen[i].label)} and ${JSON.stringify(seen[j].label)} render the IDENTICAL body. Both handlers point at the same view, so one of these sections is unreachable - and pressing it throws nothing, which is why no smoke test would ever catch it.`);
    }
  }
}
// Each section must show its own marker and not the other's.
// ⚠️ "Forgenta AI" is the <h1> AiAdvisor renders in every one of its branches - signed out,
// non-premium and premium - so this marker does not depend on the walk account's tier. The
// Suspense fallback in Account.tsx deliberately does NOT contain those words, so this assertion
// proves the lazy chunk MOUNTED rather than that the page is still loading it.
// The AI segment only exists where AI_ADVISOR_ENABLED is true (dev). In a production build the
// bar has two segments and this entry is simply never matched - which is correct, and is why the
// unknown-segment failure above must stay: a segment nobody listed must never pass unasserted.
// ⚠️ ADD A MARKER WHENEVER A SEGMENT IS ADDED. The loop below REFUSES an unknown segment
// rather than skipping it, which is what caught the Achievements section on 2026-09-17 - an
// unasserted segment and a working one look identical, and this gate exists because a tab
// whose handler does nothing throws nothing.
// `Achievements` is the trophy case's own <h2>, and it moved here from the Dashboard Overview
// widget stack on Tre's instruction the same day.
// Learn was added to the bar and NOT to this list, so it went unasserted until the gate said so
// on 2026-09-18 - the hand-named-inventory defect, caught by the gate having been written to
// FAIL on an unknown segment rather than skip it. That refusal is why the gap surfaced at all.
const markers = { Profile: 'Connections', Leaderboard: 'Leaderboard', Achievements: 'Achievements', Learn: 'Learn', 'Forgenta AI': 'Forgenta AI' };
for (const s of seen) {
  const key = Object.keys(markers).find((k) => s.label.includes(k));
  if (!key) { failures.push(`segment ${JSON.stringify(s.label)} is not one this check knows a marker for - add it here rather than letting it go unasserted.`); continue; }
  if (!s.body.includes(markers[key])) failures.push(`section ${JSON.stringify(s.label)} does not contain its own marker ${JSON.stringify(markers[key])}.`);
  for (const [other, marker] of Object.entries(markers)) {
    if (other !== key && s.body.includes(marker)) {
      failures.push(`section ${JSON.stringify(s.label)} is still showing ${JSON.stringify(marker)}, which belongs to ${other} - the sections are not actually separated.`);
    }
  }
}
if (!trackFilter || trackFilter === 'none') {
  failures.push('the section bar carries no backdrop-filter, so it is not the glass bar Tre asked for.');
}

if (failures.length) {
  for (const f of failures) console.error(`  ${f}`);
  fail(1, `${failures.length} problem(s) across ${seen.length} section(s).`);
}
console.log(`PASS - all ${seen.length} Account sections switch to a DIFFERENT body, each carries its own marker and not the other's, and the bar is glass.`);
