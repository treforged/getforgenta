// check:time-bombs - runs the whole suite with the REAL clock moved to future dates, to find tests
// (and code) that only pass because of what today is. Tests that pin the clock are unaffected.
// Written 2026-09-30 after test:tz went red when Tokyo reached October 1 (ask 6642c809).
//
// First run, 2026-09-30: 2026-11-01 -> 5474 passed; 2027-01-01 -> 1 failed, DateScrollPicker
// "displays the date it was given" (the year list does not include last year). That failure is also
// the POSITIVE CONTROL: it proves the shifted clock reaches the test workers.
//
// Usage: npm run check:time-bombs [-- 2027-03-01T12:00:00 ...]   (defaults below)
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const DATES = process.argv.slice(2).length ? process.argv.slice(2)
  : ['2026-11-01T12:00:00', '2027-01-01T12:00:00', '2027-03-01T12:00:00'];
const preload = pathToFileURL(resolve('scripts/shift-clock.mjs')).href;
const failed = [];
for (const FAKE_NOW of DATES) {
  process.stdout.write(`\n=== clock at ${FAKE_NOW} ===\n`);
  const r = spawnSync('npx', ['vitest', 'run'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, FAKE_NOW, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${preload}`.trim() },
  });
  if (r.status !== 0) failed.push(FAKE_NOW);
}
if (failed.length) {
  process.stderr.write(`\nTIME BOMBS at: ${failed.join(', ')}\n`);
  process.exit(1);
}
process.stdout.write(`\nNo time bombs at ${DATES.length} future dates.\n`);
