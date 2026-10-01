import { useMemo } from 'react';
import { useCardProjectionContext } from '@/contexts/CardProjectionContext';
import type { ConfirmedOccurrences } from '@/lib/confirmed-capture';
import { FUNDING_ACCOUNT_TYPES } from '@/lib/funding-account';
import { getNextPaycheckDate, getPaychecksInMonth } from '@/lib/pay-schedule';
import { hasActiveCashIncomeRule } from '@/lib/month0-profile-paychecks';
import { resolvePaycheckRuleIds } from '@/lib/paycheck-rule-ids';
import { toLocalDateStr } from '@/lib/scheduling';
import { getActiveCarLoanPayments } from '@/lib/vehicle-loan-engine';
import { linkedLoanAccountIds } from '@/lib/vehicle-loan-link';
import type { DebtServiceAccountInput, LiabilityDebtInput } from '@/lib/non-cc-liabilities';
import { usePaymentPlans } from '@/hooks/useSupabaseData';
import {
  buildNextMonthTerms, nextMonthStart, nextMonthOtherDebts, nextMonthPlanPayments, cardTermsFor, type NextMonthTerm,
} from '@/lib/safe-to-spend-next-month';
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
  const { cardProjection, scheduledEvents, syncCutoffDate, rules, accounts, pauseSavings, payConfig, carFunds, debts } = useCardProjectionContext();
  const { data: paymentPlans } = usePaymentPlans();
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

    // Next month's chain terms, for a payday that falls in it (Sam's ruling 938fb5db). The goal total
    // reuses month 0's monthly figure (no month-1 chain is exposed). Other debts and plans are dated
    // per item (66279032), with the same selection the engine uses. Card payments read the sim's month 1.
    // The month after the ENGINE's month 0 (today's month), never after the sync cutoff's.
    const creditCardSources = new Set([...creditCardIds].flatMap(id => [id, `account:${id}`]));
    const transferRules = rules
      .filter(r => r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment'))
      .map(r => ({ name: r.name, amount: r.amount, frequency: r.frequency, due_day: r.due_day ?? null,
        start_date: r.start_date ?? null, end_date: r.end_date ?? null, payment_source: r.payment_source ?? null }));
    const liabilityParams = {
      accounts: accounts as unknown as DebtServiceAccountInput[],
      debts: debts as unknown as LiabilityDebtInput[],
      rules,
      excludedAccountIds: linkedLoanAccountIds(carFunds, accounts),
    };
    // Per-item terms for month `idx` (0 = the engine's month 0, today's month; 1 = the next). The same
    // selections the engine uses: liability accounts paired with `debts` rows, car-linked loans out, a
    // debt paid by a same-named expense rule left to that rule, plans not charged to a card.
    const termsFor = (idx: 0 | 1): NextMonthTerm[] => {
      const monthStart = idx === 0 ? `${today.slice(0, 7)}-01` : nextMonthStart(today);
      const monthKey = monthStart.slice(0, 7);
      const monthDate = new Date(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7)) - 1, 1);
      return buildNextMonthTerms({
        monthStart,
        transferRules,
        cashSourceIds: liquidAccountIds,
        // Goals have no due date: month 0's stay in the undated reserve; next month's reuse month 0's figure.
        goalContributions: idx === 0 ? 0 : m0.chain.goalContributions,
        otherDebts: nextMonthOtherDebts(liabilityParams, idx),
        planPayments: nextMonthPlanPayments(paymentPlans ?? [], monthKey, creditCardSources),
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
        cards: cardTermsFor(cardProjection, idx),
      });
    };
    const nextMonthTerms = termsFor(1);
    // Month 0: the engine counts transfers and plan payments only AFTER the sync cutoff (earlier ones are
    // in the balance), so drop those items here too, or their sum cannot match the engine's total.
    const cutoffDay = cutoffDate.slice(0, 7) === today.slice(0, 7) ? Number(cutoffDate.slice(8, 10)) : 0;
    const monthZeroTerms = termsFor(0).filter(t =>
      !((t.kind === 'transfer' || t.kind === 'plan') && t.dueDay !== null && t.dueDay <= cutoffDay));

    // Profile-salary paychecks for the walk past payday, only when no income rule carries the pay -
    // the same guard `month0ProfilePaycheckIncome` uses, so pay is never counted twice.
    const now = new Date();
    const profilePaychecks = salaried && !hasActiveCashIncomeRule(rules, liquidAccountIds)
      ? getPaychecksInMonth(payConfig, now.getFullYear(), now.getMonth())
        .map(p => ({ date: toLocalDateStr(p.date), net: p.net }))
        .filter(p => p.date > cutoffDate && Number.isFinite(p.net) && p.net > 0)
      : [];

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
      monthZeroDate: today,
      monthZeroTerms,
      profilePaychecks,
    });
    return { result: computeSafeToSpend(input), input };
  }, [cardProjection, scheduledEvents, syncCutoffDate, rules, accounts, pauseSavings, payConfig, carFunds, debts, paymentPlans, profile, confirmed, floor]);
}
