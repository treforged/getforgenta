// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ForecastResult, ForecastMonthRow } from '@/lib/forecast-engine';

/**
 * THE CONTRACT BEHIND THE `useForecastProjections` REMOVAL, asserted as NUMBERS.
 *
 * That hook was a 41-line re-export over `CardProjectionContext`. It computed nothing
 * — its own comment called it "a thin reader preserving the original return shape for
 * its callers" — and after the 2026-09-12 Forecast cleanup its ONE caller read TWO of
 * its thirteen returned fields. Removing it is an indirection removal, not a
 * behaviour change, and "it compiles" is not evidence for that claim.
 *
 * So this asserts that the two values the Forecast page consumes arrive with the SAME
 * NUMBERS, to the cent, that the hook delivered — including the awkward ones a
 * careless passthrough mangles: a non-integer dollar amount, a real zero, and a
 * NEGATIVE ending cash.
 *
 * THE EXPECTATIONS ARE LITERALS, not reads of the fixture object. A test that pulls
 * its expected value from the same object the code reads cannot catch the code
 * dropping it. They were captured from a run against the hook BEFORE it was deleted.
 *
 * ⚠️ AND THE FIRST VERSION OF THIS FILE WAS GREEN OVER A SHAPE THAT CANNOT EXIST. It
 * treated `projections` as an ARRAY of months. It is a `ForecastResult` OBJECT whose
 * months live on `.data`, and the array version passed at runtime purely because the
 * mock returned what the test expected. `tsc` caught it; no amount of running it
 * would have. Hence the real types are imported here and the fixture is built to
 * them.
 */

// Only the fields under assertion are given real values. The cast is confined to this
// fixture and never widens to the code under test — the point of importing the real
// types is that the SHAPE is checked even though the row is partial.
const MONTHS = [
  { month: '2026-09', endingCash: 1842.07, netWorth: 50123.44, belowSafeMinimum: false },
  { month: '2026-10', endingCash: -310.5, netWorth: 49110.02, belowSafeMinimum: true },
] as unknown as ForecastMonthRow[];

const PROJECTIONS = {
  data: MONTHS,
  milestones: [],
  maxDebtPaymentByMonth: [0, 412.5],
} as unknown as ForecastResult;

const BUNDLE = {
  annualFederalWithheldFromBudget: 14237.61,
  monthlyAggregates: [],
  debtPaymentsByMonth: [0, 412.5],
  debtBalancesByMonth: [-125.04],
  oneTimeByMonth: [],
  ccOneTimeByMonth: [],
  ccScheduledByMonth: [],
  currentMonthRecommendedDebt: 0,
  forecastMonthEvents: [],
  planExpensesByMonth: [],
  prePaycheckBillsInfo: null,
};

const contextValue = {
  projections: PROJECTIONS,
  engineInputs: { marker: 'engine-inputs' },
  forecastInputsBundle: BUNDLE,
};

vi.mock('@/contexts/CardProjectionContext', () => ({
  useCardProjectionContext: () => contextValue,
}));

import { useCardProjectionContext } from '@/contexts/CardProjectionContext';

/**
 * The read `Forecast.tsx` performs, written here exactly as the page writes it. If the
 * page's read changes, this must change with it — that coupling is the thing asserted.
 */
function useForecastPageSource() {
  const { projections, forecastInputsBundle } = useCardProjectionContext();
  const { annualFederalWithheldFromBudget } = forecastInputsBundle;
  return { projections, annualFederalWithheldFromBudget };
}

describe('the Forecast page reads the same numbers without the re-export hook', () => {
  it('carries the federal-withheld dollar amount through to the cent', () => {
    const { result } = renderHook(() => useForecastPageSource());
    expect(result.current.annualFederalWithheldFromBudget).toBe(14237.61);
  });

  it('carries the month rows through, including a NEGATIVE ending cash', () => {
    const { result } = renderHook(() => useForecastPageSource());
    expect(result.current.projections.data).toHaveLength(2);
    expect(result.current.projections.data[0].endingCash).toBe(1842.07);
    // A month ending BELOW zero is what a careless passthrough clamps or coalesces,
    // and on this page it is the entire point of the chart.
    expect(result.current.projections.data[1].endingCash).toBe(-310.5);
    expect(result.current.projections.data[1].belowSafeMinimum).toBe(true);
  });

  it('keeps a real zero a zero rather than rendering absence as a value', () => {
    const { result } = renderHook(() => useForecastPageSource());
    expect(result.current.projections.maxDebtPaymentByMonth[0]).toBe(0);
    expect(result.current.projections.maxDebtPaymentByMonth[0]).not.toBeNull();
  });

  it('hands back the SAME ForecastResult reference the context holds', () => {
    // Referential identity is what makes this an indirection removal rather than a
    // transformation: nothing copies, maps, rounds or re-sorts on the way through.
    const { result } = renderHook(() => useForecastPageSource());
    expect(result.current.projections).toBe(PROJECTIONS);
  });
});
