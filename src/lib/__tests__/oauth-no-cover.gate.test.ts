import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 9b31cff4 - PROXY GATE on the Swift source (no simulator here). Tre, 2026-10-02: "dont display the
// cover on sign in with google or apple. it creates what seems like a long load". The person is
// signed out on /auth, so the cover protects nothing there. Only a device proves the feel; this
// proves no cover is raised for the sheet, and that a real background still gets one afterwards.
const SRC = readFileSync(join(__dirname, '..', '..', '..', 'ios', 'App', 'App', 'AppDelegate.swift'), 'utf8');

function fn(sig: string): string {
  const start = SRC.indexOf(sig);
  if (start < 0) return '';
  const next = SRC.indexOf('\n    func ', start + 1);
  const nextPriv = SRC.indexOf('\n    private func ', start + 1);
  const ends = [next, nextPriv].filter(i => i > 0);
  return SRC.slice(start, ends.length ? Math.min(...ends) : undefined);
}

describe('Google / Apple sign-in shows no native cover (PROXY)', () => {
  it('finds the functions it reads (positive control)', () => {
    expect(fn('func oAuthSessionWillStart(')).toContain('oAuthSessionPending = true');
    expect(fn('func applicationWillResignActive(')).toContain('showNativeCover()');
  });

  it('starting the sheet raises no cover', () => {
    const start = fn('func oAuthSessionWillStart(');
    expect(start).toContain('oAuthSheetOpen = true');
    expect(start).not.toContain('showNativeCover()');
  });

  it('a resign while the sheet is open returns before the cover', () => {
    const resign = fn('func applicationWillResignActive(');
    const skip = resign.indexOf('if oAuthSheetOpen');
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(resign.lastIndexOf('showNativeCover()'));
  });

  it('every completion clears the sheet flag, so a later background is covered again', () => {
    expect(fn('func oAuthSessionDidEnd(')).toContain('oAuthSheetOpen = false');
    const plugin = SRC.slice(SRC.indexOf('class AuthSessionPlugin'));
    const handler = plugin.slice(plugin.indexOf('{ callbackURL, error in'));
    // The clear runs before the first early return, so cancel and error paths clear it too.
    expect(handler.indexOf('oAuthSessionDidEnd(')).toBeGreaterThan(-1);
    expect(handler.indexOf('oAuthSessionDidEnd(')).toBeLessThan(handler.indexOf('return'));
  });
});
