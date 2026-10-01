import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COVER_HIDDEN_EVENT } from '@/lib/unlock-timing-report';

// 98cbf494 - PROXY GATE on the Swift source (no simulator here). unlock-timing-report.ts measures
// Face ID -> cover gone by finding COVER_HIDDEN in the shared debug log. If the Swift string drifts,
// or the log moves out of the fade's completion (where the cover is actually gone), every row reads
// faceid->cover_hidden=n/a and nothing goes red. Only a device proves the timing; this pins the pair.
const SRC = readFileSync(join(__dirname, '..', '..', '..', 'ios', 'App', 'App', 'AppDelegate.swift'), 'utf8');

function body(name: string): string {
  const start = SRC.indexOf(`private func ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = SRC.indexOf('\n    private func ', start + 1);
  return SRC.slice(start, next === -1 ? undefined : next);
}

describe('unlock timing <-> AppDelegate (98cbf494)', () => {
  it('hideNativeCover logs the parser\'s event AFTER the cover is removed', () => {
    const hide = body('hideNativeCover');
    const log = hide.indexOf(`debugLog("${COVER_HIDDEN_EVENT}")`);
    const removed = hide.indexOf('cover.removeFromSuperview()');
    expect(removed).toBeGreaterThan(-1);
    expect(log, 'COVER_HIDDEN must be logged inside hideNativeCover').toBeGreaterThan(-1);
    expect(log, 'and only once the view is gone, not when the fade starts').toBeGreaterThan(removed);
  });

  it('the brief branch logs the delay it actually schedules', () => {
    const m = SRC.match(/COVER_BRANCH:brief → schedule ([\d.]+)s"\)\s*\n\s*scheduleNativeCoverDismiss\(after: ([\d.]+)\)/);
    expect(m, 'brief branch log + schedule pair not found').not.toBeNull();
    expect(m![1]).toBe(m![2]);
  });
});
