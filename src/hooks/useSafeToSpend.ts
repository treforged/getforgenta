import { useMemo } from 'react';
import { useCardProjectionContext } from '@/contexts/CardProjectionContext';
import type { ConfirmedOccurrences } from '@/lib/confirmed-capture';
import { FUNDING_ACCOUNT_TYPES } from '@/lib/funding-account';
import { getNextPaycheckDate } from '@/lib/pay-schedule';
import { resolvePaycheckRuleIds } from '@/lib/paycheck-rule-ids';
import { toLocalDateStr } from '@/lib/scheduling';
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
  const { cardProjection, scheduledEvents, syncCutoffDate, rules, accounts, pauseSavings, payConfig } = useCardProjectionContext();
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
    });
    return { result: computeSafeToSpend(input), input };
  }, [cardProjection, scheduledEvents, syncCutoffDate, rules, accounts, pauseSavings, payConfig, profile, confirmed, floor]);
}
