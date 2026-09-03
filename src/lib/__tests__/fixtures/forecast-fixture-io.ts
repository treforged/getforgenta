// Serialization helpers for the Forecast golden fixture.
//
// calculateForecast's inputs include Map and Set instances (from the credit-card simulation in
// `cardProjectionData` — monthlyRevolvingBalances, saveUpMonths, saveUpReason, …). Plain
// JSON.stringify silently drops those, so we tag them on the way out and rehydrate on the way
// in. The capture snippet run in the app (see docs/forecast-engine-plan.md, Stage 2) uses the
// same tagging; the Tier-A golden test uses the reviver to reconstruct the exact input object.

import type { ForecastInputs } from '@/lib/forecast-engine';

export interface ForecastCapture {
  /** ISO timestamp of when the snapshot was taken. The engine reads `new Date()` internally, so
   *  the golden tests pin the clock — via {@link captureClock}, NOT via this instant directly. */
  capturedAt: string;
  /** `Date.prototype.getTimezoneOffset()` on the capturing machine at `capturedAt` (minutes WEST
   *  of UTC, so EDT is 240). Optional because captures predate the field; see
   *  {@link CAPTURE_TIMEZONE} for what happens when it is missing. */
  capturedTzOffsetMinutes?: number;
  inputs: ForecastInputs;
}

export function forecastFixtureReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return { __t: 'Map', v: Array.from(value.entries()) };
  if (value instanceof Set) return { __t: 'Set', v: Array.from(value.values()) };
  return value;
}

export function forecastFixtureReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && '__t' in (value as Record<string, unknown>)) {
    const tagged = value as { __t: string; v: unknown };
    if (tagged.__t === 'Map') return new Map(tagged.v as [unknown, unknown][]);
    if (tagged.__t === 'Set') return new Set(tagged.v as unknown[]);
  }
  return value;
}

/** Serialize a live inputs snapshot (Map/Set-safe) into the golden-fixture JSON string. */
export function serializeForecastCapture(
  inputs: ForecastInputs,
  capturedAt: string = new Date().toISOString(),
): string {
  const capture: ForecastCapture = {
    capturedAt,
    // Recorded so the capture can be REPLAYED at the wall clock it was taken at, in any
    // timezone. See captureClock below for why this is the difference between a green suite
    // and a $799 phantom divergence.
    capturedTzOffsetMinutes: new Date(capturedAt).getTimezoneOffset(),
    inputs,
  };
  return JSON.stringify(capture, forecastFixtureReplacer, 2);
}

export interface RevivedForecastCapture extends ForecastCapture {
  /** The clock every replay of this capture must pin. See {@link captureClock} — pinning
   *  `new Date(capturedAt)` instead is what produced the $799 phantom divergence. */
  clock: Date;
}

/** Parse a golden-fixture JSON string back into a capture, rehydrating Maps and Sets. */
export function reviveForecastCapture(json: string): RevivedForecastCapture {
  const capture = JSON.parse(json, forecastFixtureReviver) as ForecastCapture;
  return { ...capture, clock: captureClock(capture) };
}

/**
 * Timezone assumed for captures taken before `capturedTzOffsetMinutes` existed.
 *
 * Every golden capture in this repo was taken on Tre's own machine, which runs US Eastern. The
 * constant is a documented assumption, not a guess about the runner: it describes where the DATA
 * came from, and it is only consulted when the capture itself does not say. New captures record
 * the offset, so this fallback retires on its own as fixtures are refreshed.
 */
export const CAPTURE_TIMEZONE = 'America/New_York';

/** Minutes west of UTC for `zone` at instant `at` — same sign convention as getTimezoneOffset(). */
function offsetMinutesForZone(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  // `hour` comes back as "24" for midnight under some ICU builds; `% 24` normalizes it.
  const asIfUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  return Math.round((at.getTime() - asIfUtc) / 60000);
}

/**
 * THE CLOCK A GOLDEN CAPTURE MUST BE REPLAYED AT. Pin this, never `new Date(capturedAt)`.
 *
 * WHY THIS EXISTS — the ~$799 phantom divergence, found 2026-09-02, understood 2026-09-03.
 * `TZ=UTC npx vitest run` failed five money-engine tests while the same suite was green in EDT,
 * and the invariant reported "Dashboard Month-End Cash $2393.09 vs Forecast End Cash $3192.00".
 *
 * The cause is NOT in the money math. A capture stores two KINDS of thing:
 *
 *  - **wall-clock-relative arrays** — `forecastMonthEvents`, `planExpensesByMonth`,
 *    `debtBalancesByMonth`, `cardProjectionData` — indexed 0..N from the capturing machine's
 *    LOCAL current month, frozen at capture time;
 *  - **raw rows** — transactions, rules, accounts — which the sim re-derives from `new Date()`.
 *
 * `2026-09-01T00:20:11.665Z` is 1 September in UTC and 31 August in EDT. Replayed at the raw
 * instant under `TZ=UTC`, the engine's month 0 became September while index 0 of every frozen
 * array still held August's leftovers (zero — the month was over). Month-0 income still fell back
 * to the month-KEYED `monthlyAggregates`, but month-0 expenses deliberately have no fallback
 * (`forecast-engine.ts` "never re-charge bills that have already cleared"), so September's income
 * was counted against August's empty expense slot: $199 base + $599.875 plan = **$798.875**,
 * exactly the gap, and in the cash-HIGH direction.
 *
 * That is a REPLAY artifact, not a user-facing bug: in the app, `useForecastEngineInputs` builds
 * those arrays from the same `new Date()` the engine and the sim read, so index 0 is always the
 * user's own current month whatever their offset. Verified by construction here — pinning the
 * capture's wall clock makes UTC, America/New_York, Asia/Tokyo and Pacific/Auckland produce a
 * BIT-IDENTICAL month-0 chain and `endCash === rawEndingCash` to the cent.
 *
 * ⛔ THE FIX IS NOT `TZ=America/New_York` IN THE RUNNER. That pins the whole suite to one offset
 * and would hide a genuine timezone bug anywhere else in the engine. This pins only the ONE thing
 * that is legitimately Eastern — the moment the data was captured — and leaves every other date
 * path exercised in whatever timezone the suite happens to run in.
 */
export function captureClock(capture: ForecastCapture): Date {
  const instant = new Date(capture.capturedAt);
  const offsetMin = capture.capturedTzOffsetMinutes
    ?? offsetMinutesForZone(CAPTURE_TIMEZONE, instant);
  // Shift by the capture's offset so the UTC fields of `wall` ARE the capture's local wall clock,
  // then re-read those fields as LOCAL ones — reproducing the same wall clock in any timezone.
  const wall = new Date(instant.getTime() - offsetMin * 60_000);
  return new Date(
    wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(),
    wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds(), wall.getUTCMilliseconds(),
  );
}
