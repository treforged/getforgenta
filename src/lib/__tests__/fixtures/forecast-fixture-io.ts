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
   *  the golden test pins the clock to this instant to keep the projection horizon deterministic. */
  capturedAt: string;
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
  const capture: ForecastCapture = { capturedAt, inputs };
  return JSON.stringify(capture, forecastFixtureReplacer, 2);
}

/** Parse a golden-fixture JSON string back into a capture, rehydrating Maps and Sets. */
export function reviveForecastCapture(json: string): ForecastCapture {
  return JSON.parse(json, forecastFixtureReviver) as ForecastCapture;
}
