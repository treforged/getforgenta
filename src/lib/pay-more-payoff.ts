// "Pay $X more, done by <date>" for Debt's Simple view (ask e1b0fffc, docs/simple-view/PROPOSAL.md).
// The lever is $X more coming in every month from next month; the engine sends surplus to the cards
// itself, so no payment is invented. Drafted by the free tier (ollama qwen3:14b), reviewed by Ada.
import type { ForecastInputs, ForecastResult } from '@/lib/forecast-engine';
import { monthIndex, payoffMonth } from '@/lib/breach-levers';

export const PAY_MORE_AMOUNTS = [100, 250, 500] as const;
/** `monthsSooner` is null when the base run never pays the cards off: there is nothing to be sooner than. */
export interface PayMoreOption { extraMonthly: number; payoffMonth: string; monthsSooner: number | null }
export interface PayMoreReport { basePayoff: string | undefined; options: PayMoreOption[] }

/**
 * Returns a new inputs object with extraMonthly added to nonPaycheckIncome for future months.
 */
export function withExtraMonthly(inputs: ForecastInputs, extraMonthly: number): ForecastInputs {
  if (extraMonthly <= 0) return inputs;
  const newEvents = inputs.forecastMonthEvents.map((event, idx) => {
    if (idx === 0) return event;
    return {
      ...event,
      nonPaycheckIncome: event.nonPaycheckIncome + extraMonthly
    };
  });
  return {
    ...inputs,
    forecastMonthEvents: newEvents
  };
}

/**
 * Generates a report showing how extra payments reduce payoff time.
 */
export function payMoreReport(inputs: ForecastInputs, run: (i: ForecastInputs) => ForecastResult, amounts: readonly number[] = PAY_MORE_AMOUNTS): PayMoreReport {
  const base = run(inputs);
  const basePayoff = payoffMonth(base);
  // A base that never pays off is the case this helps most: $X more may CREATE a debt-free month.
  const baseIdx = basePayoff ? monthIndex(basePayoff) : NaN;
  const hasBase = !isNaN(baseIdx);
  const result: PayMoreOption[] = [];
  for (const amount of amounts) {
    const modified = withExtraMonthly(inputs, amount);
    const after = run(modified);
    const m = payoffMonth(after);
    if (!m || isNaN(monthIndex(m))) continue;
    if (!hasBase) {
      result.push({ extraMonthly: amount, payoffMonth: m, monthsSooner: null });
      continue;
    }
    const monthsSooner = baseIdx - monthIndex(m);
    if (monthsSooner >= 1) {
      result.push({ extraMonthly: amount, payoffMonth: m, monthsSooner });
    }
  }
  return { basePayoff: hasBase ? basePayoff : undefined, options: result };
}
