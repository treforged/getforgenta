import { useMemo } from 'react';
import { useCardProjectionContext } from '@/contexts/CardProjectionContext';
import type { ConfirmedOccurrences } from '@/lib/confirmed-capture';
import { FUNDING_ACCOUNT_TYPES } from '@/lib/funding-account';
import { getNextPaycheckDate } from '@/lib/pay-schedule';
import { resolvePaycheckRuleIds } from '@/lib/paycheck-rule-ids';
import { toLocalDateStr } from '@/lib/scheduling';
import { getActiveCarLoanPayments } from '@/lib/vehicle-loan-engine';
import { buildNextMonthTerms, nextMonthStart, type NextMonthTerm } from '@/lib/safe-to-spend-next-month';
import {
  assembleSafeToSpendInput, computeSafeToSpend,
  type SafeToSpendInput, type SafeToSpendResult,
} from '@/lib/safe-to-spend';

/**
 * Safe to spend until payday, from the SAME engine inputs the Dashboard's month-0 figures use
 * (CardProjectionContext): its scheduled events, sync cutoff, rules, accounts and month-0 chain.
 * See `src/lib/safe-to-spend.ts` for the definition and what it reserves conservatively.
 *
 * `confirmed` is the page's own `useMatchedOccurrences` set, the one its other month-0 sums use.
 * `floor` is `resolveCashFloor(profile)`, which is already 0 in automatic mode - the automatic floor
 * IS the committed outflows, and those are in the walk, so subtracting it again would reserve twice.
 */
export function useSafeToSpend(args: {
  profile: { weekly_gross_income?: number | string | null; paycheck_rule_id?: string | null } | null | undefined;
  confirmed: ConfirmedOccurrences;
  floor: number;
}): { result: SafeToSpendResult | null; input: SafeToSpendInput | null } {
  const { cardProjection, scheduledEvents, syncCutoffDate, rules, accounts, pauseSavings, payConfig, carFunds } = useCardProjectionContext();
  const { profile, confirmed, floor } = args;

  return useMemo(() => {
    const m0 = cardProjection?.month0;
    // No engine month 0 = the empty state, before reading anything else the engine would have used.
    if (!m0 || !cardProjection) return { result: computeSafeToSpend(null), input: null };
    const today = toLocalDateStr(new Date());
    const cutoffDate = syncCutoffDate || today;
    const active = accounts.filter(a => a.active);
    const liquidAccountIds = new Set(active.filter(a => FUNDING_ACCOUNT_TYPES.includes(a.account_type)).map(a => a.id));
    const creditCardIds = new Set(active.filter(a => a.account_type === 'credit_card').map(a => a.id));
    // `getNextPaycheckDate` falls back to TODAY when the schedule yields no paycheck, so it is only
    // a payday when a salary is set. Otherwise the assembly infers one from the income rules.
    const salaried = Number(payConfig.weeklyGross) > 0;
    const next = salaried ? toLocalDateStr(getNextPaycheckDate(payConfig)) : null;
    const profilePayday = next && next > cutoffDate ? next : null;
    const cardMinimumReserve = cardProjection.simCards.reduce((s, c) => {
      const rev = cardProjection.monthlyRevolvingBalances.get(c.id)?.[0] ?? 0;
      return rev > 0 ? s + (cardProjection.perCardMinPayments.get(c.id)?.[0] ?? 0) : s;
    }, 0);

    // Next month's chain terms, for a payday that falls in it (Sam's ruling 938fb5db). Goal, other-debt
    // and plan totals reuse month 0's monthly figure: the projection exposes no month-1 chain, and these
    // are steady monthly amounts. Card payments read the simulation's month-1 entries, like month 0's.
    const monthStart = nextMonthStart(cutoffDate);
    const monthKey = monthStart.slice(0, 7);
    const monthDate = new Date(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7)) - 1, 1);
    const nextMonthTerms: NextMonthTerm[] = buildNextMonthTerms({
      monthStart,
      transferRules: rules
        .filter(r => r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment'))
        .map(r => ({ name: r.name, amount: r.amount, frequency: r.frequency, due_day: r.due_day ?? null,
          start_date: r.start_date ?? null, end_date: r.end_date ?? null, payment_source: r.payment_source ?? null })),
      cashSourceIds: liquidAccountIds,
      goalContributions: m0.chain.goalContributions,
      otherDebtPayment: m0.chain.otherDebtPayment,
      planExpenses: m0.chain.planExpenses,
      carLoans: getActiveCarLoanPayments(carFunds, monthDate).map(l => ({
        label: `${l.vehicleName} loan`, amount: l.payment,
        paymentStartDate: carFunds.find(cf => cf.id === l.carFundId)?.payment_start_date ?? null,
      })),
      carInsurance: carFunds
        .filter(cf => cf.phase === 'loan' && cf.loan_start_date && Number(cf.monthly_insurance) > 0
          && (cf.insurance_start_date ?? cf.loan_start_date!).slice(0, 7) <= monthKey)
        .map(cf => ({
          label: `${cf.vehicle_name ?? 'Car'} insurance`, amount: Number(cf.monthly_insurance),
          anchorDate: cf.insurance_start_date ?? cf.payment_start_date ?? cf.loan_start_date ?? null,
        })),
      cards: cardProjection.simCards.map(c => {
        const rev = cardProjection.monthlyRevolvingBalances.get(c.id)?.[1] ?? 0;
        const amount = rev > 0
          ? (cardProjection.perCardMinPayments.get(c.id)?.[1] ?? 0)
          : (cardProjection.monthlyMandatoryCyclingPayment.get(c.id)?.[1] ?? 0);
        return { label: `${c.name} payment`, amount, dueDay: c.dueDay ?? null };
      }),
    });

    const input = assembleSafeToSpendInput({
      month0: { ...m0.chain, cyclingPayment: m0.cyclingPayment },
      fundingAccountId: cardProjection.debtFundingAccountId ?? null,
      liquidAccountIds,
      creditCardIds,
      paycheckRuleIds: resolvePaycheckRuleIds(rules, profile, liquidAccountIds),
      cardMinimumReserve,
      rules,
      scheduledEvents,
      confirmed,
      pauseSavings,
      cutoffDate,
      profilePayday,
      floor,
      nextMonthTerms,
    });
    return { result: computeSafeToSpend(input), input };
  }, [cardProjection, scheduledEvents, syncCutoffDate, rules, accounts, pauseSavings, payConfig, carFunds, profile, confirmed, floor]);
}
