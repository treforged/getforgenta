import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Every GitHub Action from outside `actions/*` and `github/*` must be pinned to a full commit SHA
// (security review 8b75ecb8, 2026-10-07). A tag like `@v1` can be moved by the action's owner, and the
// Play upload step runs with the Play service-account key, the iOS steps with the App Store keys. A
// moved tag would run new, unread code with those secrets. Pins carry the release in a comment.
const WF = path.resolve(__dirname, '../../../.github/workflows');
const USES = /^\s*-?\s*uses:\s*([^\s#]+)/;
const FIRST_PARTY = /^(actions|github)\//;
const PINNED = /@[0-9a-f]{40}$/;

function usesLines(): { where: string; ref: string }[] {
  return readdirSync(WF).filter((f) => /\.ya?ml$/.test(f)).flatMap((f) =>
    readFileSync(path.join(WF, f), 'utf-8').split(/\r?\n/).flatMap((line, i) => {
      const m = line.match(USES);
      return m ? [{ where: `${f}:${i + 1}`, ref: m[1] }] : [];
    }));
}

describe('third-party GitHub Actions are pinned to a commit SHA', () => {
  const all = usesLines();

  it('the scan sees the workflows (positive control)', () => {
    expect(all.length).toBeGreaterThan(20);
    expect(all.some((u) => u.ref.startsWith('r0adkll/upload-google-play@'))).toBe(true);
    expect(all.some((u) => u.ref.startsWith('maxim-lobanov/setup-xcode@'))).toBe(true);
  });

  it('the rule tells a tag from a pin', () => {
    expect(PINNED.test('r0adkll/upload-google-play@v1')).toBe(false);
    expect(PINNED.test('r0adkll/upload-google-play@e738b9dd8f2476ea806d921b64aacd24f34515a5')).toBe(true);
  });

  it('no third-party action is referenced by a movable tag or branch', () => {
    const unpinned = all.filter((u) => !u.ref.startsWith('./') && !FIRST_PARTY.test(u.ref) && !PINNED.test(u.ref));
    expect(unpinned.map((u) => `${u.where} ${u.ref}`)).toEqual([]);
  });
});
