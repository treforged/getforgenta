#!/usr/bin/env node
/**
 * check-username-change.mjs - IS THE CHANGE CONTROL REACHABLE, on the screen a person opens?
 *
 * WHY THIS EXISTS
 * Tre, 2026-09-15 (ask `23c07655`): "allowing users to edit their username twice every seven days."
 * The first finding was that there was NO WAY TO CHANGE ONE AT ALL - once `profile.username`
 * existed, `UsernameClaim` returned a read-only line. A rate limit on an action nobody could
 * perform would have been a gate in front of a wall.
 *
 * WHAT THIS ADDS OVER THE UNIT SUITE, because it must add something or it is theatre.
 * `UsernameClaim.change.test.tsx` proves the LOGIC - the control renders, the handle is sent, the
 * refusal names its unlock time. It renders the component directly, so it cannot tell you whether
 * that component is mounted on a surface a user can reach. This opens /account signed in and
 * presses the control. The forged-glass dead-tab defect is exactly this gap: a pane that worked
 * perfectly and was unreachable for every user on every machine.
 *
 * WHAT IT DOES NOT COVER, said rather than implied:
 *   - THE LIMIT ITSELF. That is a Postgres trigger and it is proven against the live database (see
 *     the migration headers). Exercising it here would need three real changes against a real
 *     account and would leave a week-long lockout behind on the walk account.
 *   - Colour, spacing, the mobile layout, and the Settings mount of the same card.
 *
 * IT SEEDS AND THEN CLEARS A HANDLE on the throwaway @forgenta.test walk account, through that
 * account's OWN RLS session - never a privileged key, and never a real person's row. The seed
 * asserts it landed (`return=representation`), because an RLS refusal and a wrong id both return
 * no error and are indistinguishable from a write that worked.
 *
 * EXITS: 0 pass . 1 the control is missing or wrong . 2 could not test
 */
import { readFileSync } from 'node:fs';
const BASE = 'http://localhost:8080';
const env = readFileSync('.env.local', 'utf8');
const creds = readFileSync('.env.deck-walk.local', 'utf8');
const pick = (s, k) => (s.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const url = pick(env, 'VITE_SUPABASE_URL'), anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
const email = pick(creds, 'REACH_TEST_EMAIL'), password = pick(creds, 'REACH_TEST_PASSWORD');
if (!/@forgenta\.test$/.test(email)) { console.error('refusing: not a .test account'); process.exit(2); }
const ref = new URL(url).hostname.split('.')[0];
const session = await (await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
})).json();
if (!session.access_token) { console.error('sign-in failed'); process.exit(2); }

// Give the walk account a handle so the "already have one" branch is the branch under test.
const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
const seed = await fetch(`${url}/rest/v1/profiles?user_id=eq.${session.user.id}`, {
  method: 'PATCH', headers: { ...rest, Prefer: 'return=representation' },
  body: JSON.stringify({ username: 'walkprobe' }),
});
const seeded = await seed.json().catch(() => []);
if (!seed.ok || !seeded.length) { console.error(`could not seed a handle (HTTP ${seed.status}) - nothing was tested`); process.exit(2); }

const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
/**
 * ⚠️ WAIT FOR THE CARD, NOT FOR A NUMBER OF MILLISECONDS. The first version slept 3.5s and
 * reported "the handle never rendered - nothing was tested" on one run and PASS on the next, with
 * no code change between them. A gate that is intermittently unable to see its subject is worse
 * than no gate: exit 2 reads as a broken instrument and gets re-run until it is green, which is
 * how a real finding gets dismissed. The profile load is the thing being waited on, so it is the
 * thing to wait on.
 */
await page.getByText(/Add friends to cheer each other on/i)
  .first().waitFor({ state: 'attached', timeout: 20000 })
  .catch(() => {});
await page.getByText('@walkprobe').first().waitFor({ state: 'attached', timeout: 20000 })
  .catch(() => {});

// Say WHERE we are before asserting what is on it: a bounce to /auth and a missing control are
// the same zero otherwise.
console.log(`landed on ${page.url()}`);
const friendsCard = await page.getByText(/Add friends to cheer each other on/i).count();
console.log(`Friends card on screen: ${friendsCard}`);
if (!friendsCard) {
  console.error('FAIL: the Friends card did not render, so UsernameClaim was never mounted - nothing was tested.');
  console.error(page.url().includes('/auth') ? 'CAUSE: bounced to /auth - the seeded session did not take.' : 'CAUSE: unknown; the page rendered something else.');
  await browser.close(); process.exit(2);
}
const handle = await page.getByText('@walkprobe').count();
const change = page.getByRole('button', { name: /^change$/i });
const changeCount = await change.count();
console.log(`handle on screen: ${handle}   Change control: ${changeCount}`);
if (!handle) { console.error('FAIL: the handle never rendered - nothing was tested'); await browser.close(); process.exit(2); }
if (!changeCount) { console.error('FAIL: no Change control - the handle is still read-only'); await browser.close(); process.exit(1); }

await change.first().click();
/**
 * ⚠️ REPORT THE FAILURE; DO NOT THROW IT. The first red run of this check exited 1 with an
 * unhandled Playwright TimeoutError and a stack trace, which reads as a broken instrument rather
 * than a finding - and a broken instrument gets re-run and then ignored. The failure path is the
 * one nobody exercises, and it is the path that runs on the worst day.
 */
const field = page.getByLabel('Choose a username');
const opened = await field.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
if (!opened) {
  console.error('FAIL: pressing Change did not open an edit field - the control is present but does nothing.');
  console.error('This is the dead-control shape: it throws no error, so every smoke test passes it.');
  await browser.close(); process.exit(1);
}
const seededValue = await field.inputValue();
const save = await page.getByRole('button', { name: /^save$/i }).count();
const cancel = await page.getByRole('button', { name: /^cancel$/i }).count();
console.log(`after pressing Change: field="${seededValue}"  Save:${save}  Cancel:${cancel}`);
if (seededValue !== 'walkprobe' || !save || !cancel) { console.error('FAIL: the edit state is not what the tests describe'); await browser.close(); process.exit(1); }

await browser.close();
// Leave the account as it was found.
await fetch(`${url}/rest/v1/profiles?user_id=eq.${session.user.id}`, {
  method: 'PATCH', headers: rest, body: JSON.stringify({ username: null }),
});
console.log('PASS - the Change control is reachable on /account and opens a seeded, cancellable edit.');
