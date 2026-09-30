import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// e7d28de3 - PROXY GATE on the Swift source (no simulator here). Once the page reports ready, the
// cover's reload deadline must be cancelled BEFORE the paint wait, or a slow cold start is reloaded
// after it already rendered (two CI rows, branch=first_launch, 2026-09-29). Only a device or the
// simulator workflow proves the behaviour; this proves the order of the two calls.
const SRC = readFileSync(join(__dirname, '..', '..', '..', 'ios', 'App', 'App', 'AppDelegate.swift'), 'utf8');

function body(name: string): string {
  const start = SRC.indexOf(`private func ${name}(`);
  const next = SRC.indexOf('private func ', start + 1);
  return start < 0 ? '' : SRC.slice(start, next < 0 ? undefined : next);
}

describe('cover deadline vs a ready dashboard (PROXY)', () => {
  it('finds the poll and its ready branch (positive control)', () => {
    const poll = body('pollDashboardReady');
    expect(poll).toContain('DASHBOARD_READY flag=true');
    expect(poll).toContain('waitForPaintThenDismiss(webView)');
  });

  it('cancels the deadline before the paint wait in the ready branch', () => {
    const poll = body('pollDashboardReady');
    const ready = poll.slice(poll.indexOf('DASHBOARD_READY flag=true'));
    const cancel = ready.indexOf('cancelCoverDeadline()');
    const paint = ready.indexOf('waitForPaintThenDismiss(webView)');
    expect(cancel).toBeGreaterThan(-1);
    expect(cancel).toBeLessThan(paint);
  });
});
