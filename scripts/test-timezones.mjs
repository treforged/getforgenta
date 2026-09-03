#!/usr/bin/env node
// Run the test suite in several timezones — the gate that would have caught the $799 phantom
// divergence on the day it was introduced instead of a month later.
//
// WHY THIS EXISTS. `monthEndCash.invariant.test.ts` was correct, present, and had NEVER BEEN
// EXECUTED anywhere it could fail: every run of it happened in US Eastern. A test that only ever
// runs in one timezone carries one timezone's worth of truth, and its presence is what made
// everyone confident. Three offsets — one negative, one zero, one positive — is what makes a
// date-handling claim mean something.
//
// ⛔ This is the OPPOSITE of pinning `TZ=America/New_York` in the runner. Pinning turns the badge
// green in one line and leaves every non-Eastern user unprotected. This runs MORE timezones, not
// fewer.
//
// Usage:  npm run test:tz            (all three zones, whole suite)
//         npm run test:tz -- <args>  (args are forwarded to vitest, e.g. a file path)

import { spawnSync } from 'node:child_process';

const ZONES = ['UTC', 'America/New_York', 'Asia/Tokyo'];
const args = process.argv.slice(2);
const failed = [];

for (const TZ of ZONES) {
  process.stdout.write(`\n=== TZ=${TZ} ===\n`);
  const r = spawnSync('npx', ['vitest', 'run', ...args], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, TZ },
  });
  if (r.status !== 0) failed.push(TZ);
}

if (failed.length > 0) {
  process.stderr.write(`\nFAILED in: ${failed.join(', ')}\n`);
  process.stderr.write('A suite that passes in one timezone and fails in another is not green.\n');
  process.exit(1);
}
process.stdout.write(`\nAll ${ZONES.length} timezones green.\n`);
