// The guard on the fix for the $799 phantom divergence (see `captureClock`'s own comment).
//
// A golden capture freezes arrays that are indexed from the CAPTURING machine's local current
// month. Replaying it at the raw `capturedAt` instant puts month 0 in a different month whenever
// the runner's offset straddles the capture's midnight — which is how `TZ=UTC npx vitest run`
// produced five money-engine failures against a suite that was green in EDT.
//
// These assertions are deliberately CLOCK ARITHMETIC ONLY: they hold in every timezone the suite
// can run in, so they fail on the machine of whoever breaks the property rather than only in CI.
// The end-to-end proof that this keeps the two cash chains agreeing lives in
// `monthEndCash.invariant.test.ts`; run it under several TZ values with `npm run test:tz`.

import { describe, it, expect } from 'vitest';
import { captureClock, serializeForecastCapture, reviveForecastCapture, type ForecastCapture } from './forecast-fixture-io';
import type { ForecastInputs } from '@/lib/forecast-engine';

const AT = '2026-09-01T00:20:11.665Z'; // 1 Sep in UTC, 31 Aug 20:20 in EDT — the real capture.

const capture = (over: Partial<ForecastCapture> = {}): ForecastCapture => ({
  capturedAt: AT,
  inputs: {} as ForecastInputs,
  ...over,
});

describe('captureClock', () => {
  it('reproduces the capture wall clock, whatever timezone the runner is in', () => {
    const c = captureClock(capture({ capturedTzOffsetMinutes: 240 }));
    // 240 minutes west of UTC => the capture happened at 20:20:11.665 on 31 August, locally.
    expect([c.getFullYear(), c.getMonth(), c.getDate()]).toEqual([2026, 7, 31]);
    expect([c.getHours(), c.getMinutes(), c.getSeconds(), c.getMilliseconds()])
      .toEqual([20, 20, 11, 665]);
  });

  it('puts month 0 in the capture month — the property the frozen arrays are indexed by', () => {
    const c = captureClock(capture({ capturedTzOffsetMinutes: 240 }));
    const key = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}`;
    expect(key, 'month 0 must be the capture\'s own month in every timezone').toBe('2026-08');
  });

  it('falls back to the capture timezone when the offset was not recorded', () => {
    // Every fixture in the repo predates `capturedTzOffsetMinutes`; the fallback is what keeps
    // them replayable. America/New_York was on EDT (UTC−4) at this instant.
    expect(captureClock(capture()).getTime())
      .toBe(captureClock(capture({ capturedTzOffsetMinutes: 240 })).getTime());
  });

  it('honours a positive-offset capture too (a capture taken east of UTC)', () => {
    // Tokyo is 540 minutes EAST, i.e. getTimezoneOffset() === -540.
    const c = captureClock(capture({ capturedTzOffsetMinutes: -540 }));
    expect([c.getFullYear(), c.getMonth(), c.getDate(), c.getHours()]).toEqual([2026, 8, 1, 9]);
  });

  it('round-trips: a capture written here replays at the wall clock it was written at', () => {
    const json = serializeForecastCapture({} as ForecastInputs, AT);
    const revived = reviveForecastCapture(json);
    expect(revived.capturedTzOffsetMinutes).toBe(new Date(AT).getTimezoneOffset());
    const local = new Date(AT);
    expect([revived.clock.getFullYear(), revived.clock.getMonth(), revived.clock.getDate()])
      .toEqual([local.getFullYear(), local.getMonth(), local.getDate()]);
  });
});
