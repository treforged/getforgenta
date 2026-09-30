// check:time-bombs - runs the whole suite with the REAL clock moved to future dates, to find tests
// (and code) that only pass because of what today is. Tests that pin the clock are unaffected.
// Written 2026-09-30 after test:tz went red when Tokyo reached October 1 (ask 6642c809).
//
// ⚠️ vitest is run through THIS node binary, never through npx and a shell. The first version used
// `npx vitest` with a shell; under `npm run` on this PC the cmd shell could not find vitest, every
// date "failed", and that was read as a reproduction when NOTHING had run. So a run whose output
// has no test summary is exit 2 - no result - never a pass or a fail.
//
// First real finding (direct run, 2026-09-30): at 2027-01-01 the DateScrollPicker year list had no
// year before the current one (ask ecf65fde, fixed and pinned in its own test).
//
// Usage: npm run check:time-bombs [-- 2027-03-01T12:00:00 ...]   (defaults below)
// Exit: 0 no time bombs, 1 a test failed at some date, 2 the instrument did not run.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const DATES = process.argv.slice(2).length ? process.argv.slice(2)
  : ['2026-11-01T12:00:00', '2027-01-01T12:00:00', '2027-03-01T12:00:00'];
const preload = pathToFileURL(resolve('scripts/shift-clock.mjs')).href;
const vitestBin = resolve('node_modules/vitest/vitest.mjs');
const SUMMARY = /^\s*Tests\s+\d.*$/m;

const failed = [];
const broken = [];
for (const FAKE_NOW of DATES) {
  process.stdout.write(`\n=== clock at ${FAKE_NOW} ===\n`);
  const r = spawnSync(process.execPath, [vitestBin, 'run'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, FAKE_NOW, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${preload}`.trim() },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const summary = out.match(SUMMARY)?.[0]?.trim();
  if (!summary) {
    broken.push(FAKE_NOW);
    process.stdout.write(`NO TEST SUMMARY - nothing was measured. Last output:\n${out.slice(-800)}\n`);
    continue;
  }
  process.stdout.write(`${summary}\n`);
  for (const line of out.split('\n').filter((l) => l.startsWith(' FAIL '))) process.stdout.write(`${line}\n`);
  if (r.status !== 0) failed.push(FAKE_NOW);
}

if (broken.length) {
  process.stderr.write(`\nINSTRUMENT BROKEN at: ${broken.join(', ')} - no result, not a pass or a fail\n`);
  process.exit(2);
}
if (failed.length) {
  process.stderr.write(`\nTIME BOMBS at: ${failed.join(', ')}\n`);
  process.exit(1);
}
process.stdout.write(`\nNo time bombs at ${DATES.length} future dates.\n`);
