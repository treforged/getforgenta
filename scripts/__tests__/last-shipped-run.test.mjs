import { describe, it, expect } from 'vitest';
import { lastShippedRun } from '../last-shipped-run.mjs';

// Canned `gh` answers: runs newest first, as `gh run list` returns them.
const STEP = 'Deploy to Google Play (Production, staged 10%)';
function fakeGh(runs, jobsById) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'run' && args[1] === 'list') return runs;
    if (args[0] === 'run' && args[1] === 'view') return { jobs: jobsById[args[2]] ?? [] };
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  return { gh, calls };
}
const job = (conclusion, completedAt = '2026-10-04T14:15:29Z') =>
  [{ steps: [{ name: 'Build release AAB', conclusion: 'success' }, { name: STEP, conclusion, completedAt }] }];

describe('lastShippedRun - the last run whose store step succeeded, not the last green run', () => {
  it('skips a GREEN push run whose deploy step was skipped', () => {
    const { gh } = fakeGh(
      [{ databaseId: 3, headSha: 'push-green', status: 'completed' }, { databaseId: 2, headSha: 'shipped', status: 'completed' }],
      { 3: job('skipped'), 2: job('success', '2026-10-04T10:05:00Z') },
    );
    expect(lastShippedRun({ workflow: 'android-build.yml', step: STEP, gh }))
      .toEqual({ sha: 'shipped', completedAt: '2026-10-04T10:05:00Z', runId: 2 });
  });

  it('skips a run whose deploy step FAILED (Play quota) and finds the one before', () => {
    const { gh } = fakeGh(
      [{ databaseId: 5, headSha: 'quota-red', status: 'completed' }, { databaseId: 4, headSha: 'good', status: 'completed' }],
      { 5: job('failure'), 4: job('success') },
    );
    expect(lastShippedRun({ workflow: 'android-build.yml', step: STEP, gh })?.sha).toBe('good');
  });

  it('ignores a run still in progress', () => {
    const { gh, calls } = fakeGh(
      [{ databaseId: 7, headSha: 'running', status: 'in_progress' }, { databaseId: 6, headSha: 'done', status: 'completed' }],
      { 7: job('success'), 6: job('success') },
    );
    expect(lastShippedRun({ workflow: 'android-build.yml', step: STEP, gh })?.sha).toBe('done');
    expect(calls.some(a => a[1] === 'view' && a[2] === '7')).toBe(false);
  });

  it('returns null, never a guess, when no run in the window shipped', () => {
    const { gh } = fakeGh([{ databaseId: 1, headSha: 'x', status: 'completed' }], { 1: job('skipped') });
    expect(lastShippedRun({ workflow: 'android-build.yml', step: STEP, gh })).toBeNull();
  });

  it('matches the step by its exact name', () => {
    const { gh } = fakeGh([{ databaseId: 1, headSha: 'x', status: 'completed' }], { 1: job('success') });
    expect(lastShippedRun({ workflow: 'android-build.yml', step: 'Deploy to Google Play', gh })).toBeNull();
  });

  it('finds a run that shipped under the OLD step name when given both names (rename, 7ef43384)', () => {
    const NEW = 'Deploy to Google Play (Production)';
    const { gh } = fakeGh(
      [{ databaseId: 9, headSha: 'push-only', status: 'completed' }, { databaseId: 8, headSha: 'old-name-ship', status: 'completed' }],
      { 9: [{ steps: [{ name: NEW, conclusion: 'skipped' }] }], 8: job('success', '2026-10-05T11:40:00Z') },
    );
    expect(lastShippedRun({ workflow: 'android-build.yml', step: `${NEW}||${STEP}`, gh })?.sha).toBe('old-name-ship');
    expect(lastShippedRun({ workflow: 'android-build.yml', step: NEW, gh })).toBeNull();
  });
});
