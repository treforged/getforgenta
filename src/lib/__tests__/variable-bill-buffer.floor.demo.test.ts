// @vitest-environment jsdom
//
// THE VARIABLE-BILL BUFFER, WIRED - proven on the committed demo fixture (Tre, 2026-09-05;
// docs/dynamic-cash-floor.md s.3). Never on a live account: this moves every payoff date.
//
// What is asserted, and why each one:
//   1. THE CONTROL: the amount matcher CANNOT see a $190 charge against a $120 plan. That is the
//      reason the history comes from the user's own links and not from `matchCharge`; if this ever
//      goes green the other way, the design note in variable-bill-history.ts is out of date.
//   2. THE NO-OP: too little history leaves the rules array IDENTICAL, and the sim and engine output
//      byte-identical. A feature that moves every user's floor on day one cannot ship.
//   3. THE MOVE: a buffered Rent raises the engine's pre-paycheck bills by exactly the buffer in
//      every month, and the sim and the engine take the SAME amount out of month-0 debt capacity.
//      Measured before the assertions were written (2026-09-30, NOW below).
import { describe, it, expect } from 'vitest';
import { runDemoCardProjection, demoForecastInputs } from './fixtures/demo-forecast-harness';
import { calculateForecast } from '../forecast-engine';
import { demoRecurringRules } from '../demo-data';
import { matchCharge } from '../transaction-matching';
import { buildVariableBillBuffers, applyFloorBuffers, type HistoryRule } from '../variable-bill-history';
import type { RuleRow } from '@/hooks/useSupabaseData';

const NOW = new Date('2026-09-10T12:00:00');
const BASE = demoRecurringRules as unknown as RuleRow[];

/** Rent (r2, planned 1,385, due the 1st, so always inside the pre-paycheck window). */
function rentHistory(amounts: number[]) {
  const months = ['2026-05', '2026-06', '2026-07', '2026-08'].slice(0, amounts.length);
  const charges = amounts.map((amount, i) => ({ id: `c${i}`, amount, date: `${months[i]}-01` }));
  const links = charges.map((c, i) => ({
    status: 'linked_rule', rule_id: 'r2', synced_transaction_id: c.id,
    occurrence_month: months[i], occurrence_date: null,
  }));
  return buildVariableBillBuffers(BASE as unknown as HistoryRule[], links, charges);
}

function run(rules: RuleRow[]) {
  const sim = runDemoCardProjection(NOW, { rules } as never);
  const forecast = calculateForecast(demoForecastInputs({ now: NOW, cardProjection: sim, rules }));
  return { sim, forecast };
}

/** Everything a user can read off the result, as one string - Maps flattened so they compare. */
function fingerprint({ sim, forecast }: ReturnType<typeof run>): string {
  return JSON.stringify({ sim, forecast }, (_k, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v));
}

describe('variable-bill buffer on the demo fixture', () => {
  it('control: the amount matcher cannot attribute a $190 charge to a $120 bill', () => {
    const charge = { id: 't1', account_id: 'd1', amount: 190, date: '2026-09-05', pending: false };
    expect(matchCharge({ accountId: 'd1', amount: 120, dueDate: '2026-09-01' }, [charge])).toBeNull();
    // ...and it does see the same charge when the plan is right, so the null above is the gate, not
    // a broken call.
    expect(matchCharge({ accountId: 'd1', amount: 190, dueDate: '2026-09-01' }, [charge])).not.toBeNull();
  });

  it('no-op: under 3 payments the rules are the same array and the output is byte-identical', () => {
    const short = rentHistory([1200, 1700]);
    expect(short.byRuleId.get('r2')?.reason).toBe('not-enough-history');
    const rules = applyFloorBuffers(BASE, short) as RuleRow[];
    expect(rules).toBe(BASE);
    expect(fingerprint(run(rules))).toBe(fingerprint(run(BASE)));
  });

  it('a buffered Rent moves the floor by exactly its buffer, in the sim and the engine alike', () => {
    const buffers = rentHistory([1200, 1385, 1600, 1700]);
    const entry = buffers.byRuleId.get('r2')!;
    expect(entry).toMatchObject({ p90: 1670, buffer: 285, reserve: 1670, reason: 'from-history', sampleCount: 4 });

    const before = run(BASE);
    const after = run(applyFloorBuffers(BASE, buffers) as RuleRow[]);

    // Engine: every month's pre-paycheck bills include next month's Rent, so each rises by 285.
    expect(before.forecast.data.slice(0, 4).map(m => m.prePaycheckBillsTotal)).toEqual([1385, 1602, 1432, 1385]);
    expect(after.forecast.data.slice(0, 4).map(m => m.prePaycheckBillsTotal)).toEqual([1670, 1887, 1717, 1670]);
    expect(after.forecast.data[0].floorItems).toEqual([{ name: 'Rent', amount: 1670, dueDay: 1 }]);

    // The displayed floor: the demo's manual 1,500 floor was binding before (1,385 < 1,500), so the
    // visible number rises 170, not 285 - the floor is max(manual, bills), and that is correct.
    expect(before.sim.m0SafeFloor).toBe(1500);
    expect(after.sim.m0SafeFloor).toBe(1670);

    // Month-0 debt capacity: 285 less, and the sim and the engine agree to the cent.
    expect(before.sim.maxDebtPaymentByMonth[0]).toBeCloseTo(4059.88, 2);
    expect(after.sim.maxDebtPaymentByMonth[0]).toBeCloseTo(3774.88, 2);
    expect(after.forecast.maxDebtPaymentByMonth[0]).toBeCloseTo(after.sim.maxDebtPaymentByMonth[0], 2);
    expect(before.sim.month0?.safeToPayTotal).toBe(4060);
    expect(after.sim.month0?.safeToPayTotal).toBe(3775);

    // The payoff month does not move on this fixture (Nov 2026 either way) - stated, not implied.
    expect(after.sim.simRevolvingPayoffMonth).toBe(before.sim.simRevolvingPayoffMonth);
  });
});
