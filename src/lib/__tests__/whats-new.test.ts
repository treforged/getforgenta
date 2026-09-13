/**
 * The what's-new popup — Tre, 2026-09-13: "start adding a popup for already logged in users to
 * describe what changed. keep it consumer friendly. they dont need detailed explanations."
 *
 * ⚠️ THE TESTS THAT MATTER HERE ARE THE ONES ASSERTING SILENCE. A popup that shows is easy; a
 * popup that knows when NOT to show is the whole feature. Two ways it must stay quiet — never on
 * first run, never twice for the same release — and both have a case below.
 */
import { describe, it, expect } from 'vitest';
import { shouldShowWhatsNew, RELEASES, CURRENT_RELEASE, type Release } from '../whats-new';

const release = (version: string, lines: string[] = ['Something visible changed.']): Release =>
  ({ version, lines });

describe('shouldShowWhatsNew — when to speak', () => {
  it('shows a returning user a release they have not seen', () => {
    expect(shouldShowWhatsNew('2026-09-01', true, release('2026-09-13'))).toBe(true);
  });

  it('⚠️ NEVER ON FIRST RUN, even for a release they have never seen', () => {
    // 22 of 31 users only ever saw first run. A "what changed" card there is noise at the one
    // moment that decides whether somebody stays.
    expect(shouldShowWhatsNew(null, false, release('2026-09-13'))).toBe(false);
    expect(shouldShowWhatsNew('2026-09-01', false, release('2026-09-13'))).toBe(false);
  });

  it('⚠️ NEVER TWICE for the same release', () => {
    // The failure people actually hate. `seenVersion` comes from a durable store, so this holds
    // across reloads and devices rather than for the lifetime of a component.
    expect(shouldShowWhatsNew('2026-09-13', true, release('2026-09-13'))).toBe(false);
  });

  it('an ABSENT seenVersion still shows, provided they have onboarded', () => {
    // Someone using the app before this feature existed has no recorded version. They are exactly
    // who Tre meant by "already logged in users".
    expect(shouldShowWhatsNew(null, true, release('2026-09-13'))).toBe(true);
    expect(shouldShowWhatsNew(undefined, true, release('2026-09-13'))).toBe(true);
  });

  it('a release with NOTHING VISIBLE says nothing, rather than padding', () => {
    // Padding is the fastest way to teach people to dismiss this unread.
    expect(shouldShowWhatsNew('2026-09-01', true, release('2026-09-13', []))).toBe(false);
  });

  it('compares versions for INEQUALITY, not order — a rollback still announces', () => {
    // String ordering on a version is a trap the moment the scheme changes. A user whose last
    // seen version is NEWER than the current one is looking at different content and should see it.
    expect(shouldShowWhatsNew('2026-10-01', true, release('2026-09-13'))).toBe(true);
  });
});

describe('the content itself', () => {
  it('CURRENT_RELEASE is the first entry, so the list is newest-first', () => {
    expect(CURRENT_RELEASE).toBe(RELEASES[0]);
  });

  it('every shipped line is consumer language — no engineering words', () => {
    // The rule Tre gave, made mechanical. If one of these appears, the line is describing the
    // CAUSE rather than what it does for the person reading it.
    const forbidden = /\b(upsert|grant|RLS|column|migration|hook|mutation|API|endpoint|null|cache|schema|commit|refactor)\b/i;
    for (const r of RELEASES) {
      for (const line of r.lines) {
        expect(line, `"${line}" reads like a changelog`).not.toMatch(forbidden);
      }
    }
  });

  it('lines are short enough to scan, and each is a whole sentence', () => {
    for (const r of RELEASES) {
      for (const line of r.lines) {
        expect(line.length).toBeLessThanOrEqual(90);
        expect(line.trim().endsWith('.')).toBe(true);
      }
    }
  });

  it('no release is empty, and none is a wall', () => {
    for (const r of RELEASES) {
      expect(r.lines.length).toBeGreaterThan(0);
      expect(r.lines.length).toBeLessThanOrEqual(6);
    }
  });

  it('versions are unique — two entries sharing one would show once and hide the other', () => {
    const versions = RELEASES.map(r => r.version);
    expect(new Set(versions).size).toBe(versions.length);
  });
});
