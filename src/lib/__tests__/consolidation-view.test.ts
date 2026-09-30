import { describe, test, expect } from 'vitest';
import { buildConsolidationView, UTILIZATION_TARGET_PCT } from '../consolidation-view';
import type {
  ConsolidationAccountRow,
  ConsolidationPlanRow,
} from '../consolidation-adapter';

const ASOF = '2026-08-20';

/** Shaped like a PostgREST row: numerics as strings, every optional column present and nullable. */
function account(
  over: Partial<ConsolidationAccountRow> & { id: string; name: string },
): ConsolidationAccountRow {
  return {
    account_type: 'credit_card',
    active: true,
    balance: 0,
    credit_limit: null,
    apr: null,
    min_payment: null,
    card_start_date: null,
    balance_tranches: null,
    ...over,
  };
}

function plan(
  over: Partial<ConsolidationPlanRow> & { id: string; name: string },
): ConsolidationPlanRow {
  return {
    active: true,
    plan_type: 'monthly_charge',
    frequency: 'monthly',
    start_date: '2026-09-01',
    payment_amount: 100,
    total_payments: 4,
    payment_source: null,
    ...over,
  };
}

const baseAccounts: ConsolidationAccountRow[] = [
  account({ id: 'a', name: 'A', balance: 6000, credit_limit: 10000, apr: 24 }),
  account({ id: 'b', name: 'B', balance: 1000, credit_limit: 5000, apr: 18 }),
];
const basePlan: ConsolidationPlanRow = plan({
  id: 'p1',
  name: 'P1',
  payment_source: 'a',
  payment_amount: 120,
  total_payments: 4,
});

const defaultOffer = {
  aprPct: 12,
  termMonths: 36,
  originationFeePct: 0,
  principal: null as number | null,
};

describe('buildConsolidationView', () => {
  test('1. no card debt returns empty view', () => {
    const noDebt = baseAccounts.map((c) => ({ ...c, balance: 0 }));
    const view = buildConsolidationView(noDebt, [basePlan], defaultOffer, ASOF);
    expect(view.hasCardDebt).toBe(false);
    expect(view.monthlyPayment).toBe(0);
    expect(view.interest.delta).toBeNull();
    expect(view.utilization.afterWorstPct).toBeNull();
    expect(view.notes).toEqual([]);
  });

  test('2. suggestedPrincipal respects rounding and bounds', () => {
    const view = buildConsolidationView(baseAccounts, [basePlan], defaultOffer, ASOF);
    const sp = view.suggestedPrincipal;
    expect(sp % 100).toBe(0);
    expect(sp).toBeGreaterThanOrEqual(3480);
    expect(sp).toBeLessThan(3580);
  });

  test('3. afterWorstPct respects target with suggested principal', () => {
    const view = buildConsolidationView(baseAccounts, [basePlan], defaultOffer, ASOF);
    expect(view.utilization.beforeWorstPct).toBeCloseTo(60, 2);
    expect(view.utilization.afterWorstPct!).toBeLessThanOrEqual(UTILIZATION_TARGET_PCT + 1e-6);
  });

  test('4. afterWorstPct exceeds target when principal set to 3000', () => {
    const offer = { ...defaultOffer, principal: 3000 };
    const view = buildConsolidationView(baseAccounts, [basePlan], offer, ASOF);
    expect(view.utilization.afterWorstPct!).toBeGreaterThan(UTILIZATION_TARGET_PCT);
  });

  test('5. principalUsed follows offer.principal precedence', () => {
    const view1 = buildConsolidationView(
      baseAccounts,
      [basePlan],
      { ...defaultOffer, principal: 5000 },
      ASOF,
    );
    expect(view1.principalUsed).toBe(5000);

    const view2 = buildConsolidationView(
      baseAccounts,
      [basePlan],
      { ...defaultOffer, principal: NaN as unknown as number },
      ASOF,
    );
    expect(view2.principalUsed).toBe(view2.suggestedPrincipal);

    const view3 = buildConsolidationView(baseAccounts, [basePlan], defaultOffer, ASOF);
    expect(view3.principalUsed).toBe(view3.suggestedPrincipal);
  });

  test('6. interest delta reflects apr comparison while utilization stays separate', () => {
    const highApr = buildConsolidationView(baseAccounts, [basePlan], { ...defaultOffer, aprPct: 30 }, ASOF);
    expect(highApr.interest.delta!).toBeGreaterThan(0);
    expect(highApr.utilization.afterWorstPct!).toBeLessThan(highApr.utilization.beforeWorstPct!);

    const lowApr = buildConsolidationView(baseAccounts, [basePlan], { ...defaultOffer, aprPct: 5 }, ASOF);
    expect(lowApr.interest.delta!).toBeLessThan(0);
  });

  test('7. committedPlanCharges matches total scheduled charges', () => {
    const view = buildConsolidationView(baseAccounts, [basePlan], defaultOffer, ASOF);
    expect(view.committedPlanCharges).toBeCloseTo(120 * 4, 2);
  });

  test('8. input arrays are not mutated', () => {
    const accountsCopy = JSON.parse(JSON.stringify(baseAccounts));
    const plansCopy = JSON.parse(JSON.stringify([basePlan]));
    buildConsolidationView(baseAccounts, [basePlan], defaultOffer, ASOF);
    expect(baseAccounts).toEqual(accountsCopy);
    expect([basePlan]).toEqual(plansCopy);
  });
});
