import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error - a plain .mjs build script, deliberately not typed
import { violations, releasedVersions } from '../../../scripts/lib/next-version.mjs';

/**
 * A RELEASED VERSION MUST NEVER BE SUBMITTED TWICE.
 *
 * Tre, on releasing build 974: "note also that i am releasing 974. v 6.7 to apple today. next
 * build will need to be 6.8". Apple refuses a submission that reuses a released version - and it
 * refuses it LATE, at UPLOAD, after a full build has been spent and a TestFlight slot consumed.
 * This makes the refusal happen at the START of a build instead, inside `read-version.mjs`,
 * which is already the one place a build learns what version it is.
 *
 * ⚠️ IT CANNOT KNOW ABOUT A RELEASE NOBODY WROTE DOWN, and that limit is the honest part.
 * Nothing in this repo can read App Store Connect - it is a console only Tre can see. So the
 * record is maintained by hand in `released-versions.json`. What this buys is that a KNOWN
 * collision is impossible to ship, and it fails LOUD: a build that refuses to start is not a
 * defect that hides.
 *
 * ⚠️ AND A VERSION AWAITING REVIEW HAS NOT CONSUMED ITS NUMBER. On 2026-09-19 VERSION was
 * deliberately reverted to 6.7.0 so that day's fixes could ride a submission already in review
 * rather than the next one. Recording a SUBMISSION as released would have blocked that and cost
 * a release, which is why the record's own header says to add a line the day a version goes
 * LIVE, never when it is submitted.
 */

const REPO = join(__dirname, '..', '..', '..');
const RECORD = JSON.parse(readFileSync(join(REPO, 'released-versions.json'), 'utf8'));
const VERSION = readFileSync(join(REPO, 'VERSION'), 'utf8').trim();

describe('released versions - positive controls', () => {
  /**
   * An empty record makes every assertion below vacuous - "collides with none of the zero
   * versions we know about" is not a pass. This is the control on the instrument.
   */
  it('the record is populated and well formed', () => {
    expect(Array.isArray(RECORD.released)).toBe(true);
    expect(RECORD.released.length).toBeGreaterThan(0);
    for (const r of RECORD.released) {
      expect(r.version, 'every entry names a version').toMatch(/^\d+\.\d+(\.\d+)?$/);
      expect(r.released, 'every entry carries the date it went LIVE').toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.source, 'every entry says where the claim came from').toBeTruthy();
    }
  });

  it('the reader finds the record from the repo root', () => {
    expect(releasedVersions(REPO).length).toBe(RECORD.released.length);
  });

  /**
   * FAIL-OPEN ON AN UNREADABLE RECORD, DELIBERATELY. Refusing every build because a file could
   * not be read would strand a release for a reason unrelated to the version. A confident
   * negative refuses; a broken instrument warns and allows - the same call this machine makes
   * for the handoff-note check.
   */
  it('an unreadable record warns and allows rather than throwing', () => {
    expect(() => releasedVersions(join(REPO, 'no-such-directory'))).not.toThrow();
    expect(releasedVersions(join(REPO, 'no-such-directory'))).toEqual([]);
  });
});

describe('released versions - the refusal', () => {
  it('REFUSES a version that has already been released', () => {
    // Taken from the record rather than typed, so this cannot drift from what is actually known.
    const shipped = RECORD.released[0].version;
    const bad = violations(shipped, REPO);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.join(' ')).toMatch(/ALREADY RELEASED/);
  });

  it('allows a version that has not', () => {
    expect(violations('99.9.0', REPO)).toEqual([]);
  });

  /**
   * The check is NOT gated on `underScheme`. The cap rules only apply under the 6.x scheme, but
   * a collision is fatal at any scheme - Apple does not care which convention produced the
   * string. Asserted because the obvious placement (after the `underScheme` early return) would
   * have silently disabled it for anything outside the scheme.
   */
  it('refuses a released version even outside the 6.x scheme', () => {
    const shipped = RECORD.released[0].version;
    expect(violations(shipped, REPO).join(' ')).toMatch(/ALREADY RELEASED/);
  });

  it('does nothing when no root is passed - the check needs the tree', () => {
    // Documents the coupling rather than hiding it: a caller that forgets `root` gets the old
    // behaviour, which is why `read-version.mjs` threads it explicitly.
    expect(violations(RECORD.released[0].version)).toEqual([]);
  });
});

describe('released versions - the live tree', () => {
  it('the VERSION on disk is not one that has already shipped', () => {
    const bad = violations(VERSION, REPO);
    expect(bad, `VERSION is ${VERSION}`).toEqual([]);
  });

  it('VERSION is ahead of every released version', () => {
    const n = (v: string) => {
      const [a, b, c] = `${v}.0.0`.split('.').map(Number);
      return a * 1e6 + b * 1e3 + (c || 0);
    };
    for (const r of RECORD.released) {
      expect(n(VERSION), `VERSION ${VERSION} vs released ${r.version}`).toBeGreaterThan(n(r.version));
    }
  });
});
