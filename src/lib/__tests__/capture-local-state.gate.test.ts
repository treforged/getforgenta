// @vitest-environment jsdom
//
// THE CAPTURE RECORDS EVERY BROWSER-LOCAL FORECAST INPUT, AND THE LIST IS DERIVED, NOT TYPED.
//
// WHY THIS EXISTS. Measured 2026-09-17 on Tre's own 31-Aug rows, clock pinned, Eastern: the three
// `usePersistedState` values in `CardProjectionProvider` move the debt-free month he is SHOWN by
// up to five months (`pause-savings` 29 -> 24; funding account 29 -> 27), while `safeToPayTotal`
// holds at 229.89 across all twelve configurations. A raw Supabase dump carries database tables
// only, so a fixture recaptured from one silently takes the defaults - and the golden capture's
// stored payoff of 26 is reproduced by NO configuration of the code that produced it.
//
// ⚠️ THE FAILURE THIS GATE IS SHAPED AGAINST IS A HAND-NAMED LIST. This repo has been bitten by
// one repeatedly - a dependency list naming three files, an inventory defined by exclusion, a
// stale `$expectedStages` maximum - and the shape is always the same: the list is right on the day
// it is written and blind to the entry nobody adds to it. So this does NOT check three names it
// was told about. It PARSES `CardProjectionContext.tsx` for every `usePersistedState` call and
// requires the set to equal `PROJECTION_LOCAL_KEYS` exactly. A fourth persisted input added later
// fails here rather than escaping the capture in silence.
//
// WHAT IT DOES NOT COVER, stated because a derived gate invites more trust than it has earned:
// persisted state read anywhere OTHER than this provider (the forecast's inputs are the scope),
// values held in `sessionStorage`, IndexedDB or a cookie, and whether a recorded value is CORRECT
// - only that it is recorded. It also cannot see a key built at runtime by string concatenation,
// which is why the positive control below asserts the matcher finds the real three.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECTION_LOCAL_KEYS } from '@/lib/projection-local-keys';
import {
  assertComparablePayoff,
  readProjectionLocalState,
  applyProjectionLocalState,
  serializeForecastCapture,
  type ForecastCapture,
} from './fixtures/forecast-fixture-io';
import type { ForecastInputs } from '@/lib/forecast-engine';

const SOURCE = join(__dirname, '..', '..', 'contexts', 'CardProjectionContext.tsx');

/** Every literal key handed to `usePersistedState` in the provider, read from the file itself. */
function persistedKeysInSource(): string[] {
  const src = readFileSync(SOURCE, 'utf8');
  const out: string[] = [];
  // Matches both a bare literal and a member of the shared constant, so the gate keeps working
  // whichever form the provider uses - and keeps DETECTING a bare literal somebody adds later.
  for (const m of src.matchAll(/usePersistedState<[^>]*>\(\s*(?:'([^']+)'|PROJECTION_LOCAL_KEYS\.(\w+))/g)) {
    out.push(m[1] ?? PROJECTION_LOCAL_KEYS[m[2] as keyof typeof PROJECTION_LOCAL_KEYS]);
  }
  return out;
}

describe('the capture records every browser-local forecast input', () => {
  it('POSITIVE CONTROL: the matcher finds the provider\'s persisted calls at all', () => {
    // Without this, a regex that matches NOTHING reports a perfectly empty set as agreeing with a
    // perfectly empty expectation, and the gate passes over a provider it cannot read.
    const found = persistedKeysInSource();
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(new Set(found).size).toBe(found.length);
  });

  it('the derived set equals PROJECTION_LOCAL_KEYS exactly - neither more nor fewer', () => {
    const found = [...new Set(persistedKeysInSource())].sort();
    const declared = [...new Set(Object.values(PROJECTION_LOCAL_KEYS))].sort();
    // Equality in BOTH directions on purpose. A subset check would pass a provider that gained a
    // fourth persisted input, which is the exact regression this gate exists for.
    expect(found).toEqual(declared);
  });

  it('a capture round-trips the local state through the shared keys', () => {
    applyProjectionLocalState({ pauseSavings: 'true', debtStrategy: '"snowball"', debtFundingAccount: null });
    const read = readProjectionLocalState();
    expect(read.pauseSavings).toBe('true');
    expect(read.debtStrategy).toBe('"snowball"');
    // NULL rather than undefined: "set to nothing" is a real state and must not read as
    // "never recorded", which is what the whole-object-absent case means.
    expect(read.debtFundingAccount).toBeNull();

    const json = serializeForecastCapture({} as ForecastInputs, '2026-09-01T00:20:11.665Z');
    const parsed = JSON.parse(json) as ForecastCapture;
    expect(parsed.capturedLocalState?.pauseSavings).toBe('true');
    expect(parsed.capturedTzOffsetMinutes).toBe(new Date('2026-09-01T00:20:11.665Z').getTimezoneOffset());
  });

  it('REFUSES a payoff comparison against a capture that records no local state', () => {
    // The pre-fix fixtures are exactly this shape, so an old file cannot go on producing invalid
    // comparisons after this ships. It throws rather than warns: a warning on a real financial
    // figure is a line in a log with no route to an exit code.
    expect(() => assertComparablePayoff({
      capturedAt: '2026-09-01T00:20:11.665Z', inputs: {} as ForecastInputs,
    }, 'the 31-Aug golden capture')).toThrow(/capturedLocalState/);
  });

  it('ACCEPTS one that does - the positive half, without which "throws" is satisfied by always throwing', () => {
    expect(() => assertComparablePayoff({
      capturedAt: '2026-09-01T00:20:11.665Z',
      capturedLocalState: { pauseSavings: null, debtStrategy: null, debtFundingAccount: null },
      inputs: {} as ForecastInputs,
    })).not.toThrow();
  });
});
