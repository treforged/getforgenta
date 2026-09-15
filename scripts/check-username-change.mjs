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

/**
 * THE WALK ACCOUNT KEEPS ITS HANDLE, AND THAT IS THE WHOLE TEARDOWN STORY.
 *
 * ⚠️ THE FIRST VERSION SEEDED A HANDLE AND CLEARED IT AFTERWARDS, AND ITS CLEANUP WAS DEFEATED
 * BY THE VERY FEATURE IT TESTS. `username_changes` has no DELETE policy - deliberately, because a
 * user who can delete their own history can defeat the limit - so the teardown's DELETE silently
 * affected zero rows through the account's own session. The reset-to-null was then REFUSED as a
 * third change, so the handle stayed too. Residue accumulated across runs until the walk account
 * had spent its two changes and this gate would have started failing for a reason that has
 * nothing to do with the code under test.
 *
 * So the gate no longer changes anything. It needs the account to HAVE a handle - that is the
 * branch under test - and a handle it already has is just as good as one it seeded. The only
 * write left is the FIRST claim on an account that has never had one, which the trigger gives
 * away free, exactly once, for ever.
 */
const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
const profRes = await fetch(`${url}/rest/v1/profiles?select=username&user_id=eq.${session.user.id}`, { headers: rest });
if (!profRes.ok) { console.error(`reading the walk account's profile returned ${profRes.status} - nothing was tested`); process.exit(2); }
let handleText = (await profRes.json())[0]?.username ?? null;
if (!handleText) {
  const claim = await fetch(`${url}/rest/v1/profiles?user_id=eq.${session.user.id}`, {
    method: 'PATCH', headers: { ...rest, Prefer: 'return=representation' },
    body: JSON.stringify({ username: 'walkprobe' }),
  });
  const claimed = await claim.json().catch(() => []);
  // ASSERT THE WRITE LANDED. An RLS refusal and a wrong id both return no error, and are
  // indistinguishable from a write that worked.
  if (!claim.ok || !claimed.length) { console.error(`could not claim a handle (HTTP ${claim.status}) - nothing was tested`); process.exit(2); }
  handleText = 'walkprobe';
  console.log('walk account had no handle; claimed one (free first claim, once ever)');
}
console.log(`walk account handle: @${handleText}`);

/**
 * A single exit helper, so every failure closes the browser and SAYS WHY.
 *
 * ⚠️ THERE IS NOTHING TO UNDO, AND THE VERSION THAT DID HAVE A TEARDOWN WAS DEFEATED BY THE
 * FEATURE IT TESTS. It seeded a handle and cleared it afterwards; `username_changes` has no DELETE
 * policy - deliberately, since a user who can delete their own history can defeat the limit - so
 * the cleanup's DELETE silently affected zero rows, and the reset-to-null was then REFUSED as a
 * third change. Residue accumulated across runs until the walk account had spent its two changes,
 * at which point this gate would have failed for a reason unrelated to the code under test. See
 * the header above: the gate now writes nothing after the one free first claim.
 *
 * ⚠️ AND REPORT THE FAILURE RATHER THAN THROWING IT. An earlier red run exited 1 with an
 * unhandled Playwright TimeoutError and a stack trace, which reads as a broken instrument rather
 * than a finding - and a broken instrument gets re-run and then ignored.
 */
const done = async (code, msg) => {
  if (msg) console.error(msg);
  try { await browser?.close(); } catch { /* ignore */ }
  process.exit(code);
};

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
await page.getByText(`@${handleText}`).first().waitFor({ state: 'attached', timeout: 20000 })
  .catch(() => {});

// Say WHERE we are before asserting what is on it: a bounce to /auth and a missing control are
// the same zero otherwise.
console.log(`landed on ${page.url()}`);
const friendsCard = await page.getByText(/Add friends to cheer each other on/i).count();
console.log(`Friends card on screen: ${friendsCard}`);
if (!friendsCard) {
  console.error(page.url().includes('/auth') ? 'CAUSE: bounced to /auth - the seeded session did not take.' : 'CAUSE: unknown; the page rendered something else.');
  await done(2, 'FAIL: the Friends card did not render, so UsernameClaim was never mounted - nothing was tested.');
}
const handle = await page.getByText(`@${handleText}`).count();
const change = page.getByRole('button', { name: /^change$/i });
const changeCount = await change.count();
console.log(`handle on screen: ${handle}   Change control: ${changeCount}`);
if (!handle) await done(2, 'FAIL: the handle never rendered - nothing was tested');
if (!changeCount) await done(1, 'FAIL: no Change control - the handle is still read-only');

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
  console.error('This is the dead-control shape: it throws no error, so every smoke test passes it.');
  await done(1, 'FAIL: pressing Change did not open an edit field - the control is present but does nothing.');
}
const seededValue = await field.inputValue();
const save = await page.getByRole('button', { name: /^save$/i }).count();
const cancel = await page.getByRole('button', { name: /^cancel$/i }).count();
console.log(`after pressing Change: field="${seededValue}" (must equal @${handleText} - seeded from the CURRENT handle, never from an email)  Save:${save}  Cancel:${cancel}`);
if (seededValue !== handleText || !save || !cancel) await done(1, 'FAIL: the edit state is not what the tests describe');

console.log('PASS - the Change control is reachable on /account and opens a seeded, cancellable edit.');
await done(0);
