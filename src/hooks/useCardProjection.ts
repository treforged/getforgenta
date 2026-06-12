import { useMemo } from 'react';
import {
  buildCardData, simulateVariablePayoff, projectCardVariable,
  CC_DEFAULT_CATEGORIES, CardData,
} from '@/lib/credit-card-engine';
import { PaymentPlan, getMonthlyPlanCashExpenses } from '@/lib/payment-plan-generator';
import {
  PayScheduleConfig, getRemainingTransactionIncomeByDay,
  getRemainingTransactionExpensesByDay, getMinSafeCash,
  mergeWithGeneratedTransactions, getNormalizedMonthNetIncome,
  getMonthNetIncome,
} from '@/lib/pay-schedule';
import { countRuleOccurrencesInMonth } from '@/lib/scheduling';
import { getTotalCarLoanMonthly } from '@/lib/vehicle-loan-engine';

export interface Month0Result {
  safeToPayTotal: number;
  maxCapacity: number;
  holdback: number;
  holdbackEvent: { eventName: string; monthLabel: string } | null;
  cyclingPayment: number;
  revolvingPayment: number;
  perCardAdjusted: { id: string; name: string; payment: number; maxPayment: number }[];
  m0SafeFloor: number;
}

export interface CardProjectionResult {
  data: any[];
  cards: { name: string; color: string }[];
  simCards: CardData[];
  debtPaymentTotals: number[];
  allPaymentTotals: number[];
  perCardPayments: { name: string; id: string; payments: number[] }[];
  perCardPaymentsScaled: { name: string; id: string; payments: number[] }[];
  monthlyRevolvingBalances: Map<string, number[]>;
  perCardMinPayments: Map<string, number[]>;
  m0Income: number;
  m0Expenses: number;
  m0SafeFloor: number;
  saveUpMonths: Set<number>;
  saveUpReason: Map<number, { eventName: string; monthLabel: string }>;
  month0: Month0Result;
}

export interface UseCardProjectionParams {
  accounts: any[];
  transactions: any[];
  rules: any[];
  debts: any[];
  goals: any[];
  carFunds: any[];
  profile: any;
  debtPayoffOptions: { cashFloor: number };
  payConfig: PayScheduleConfig;
  /** Pre-computed scheduled events from generateScheduledEvents(rules, accounts, 36) */
  scheduledEvents: any[];
  pauseSavings: boolean;
  syncCutoffDate?: string;
  forecastFundingAccountId: string | null;
  debtStrategy: 'avalanche' | 'snowball';
  persistedDebtFundingId: string | null;
  paymentPlans?: PaymentPlan[];
  assumptions: {
    incomeGrowthEnabled: boolean;
    incomeGrowth: number;
    raiseMonth: number;
    raiseMode?: string;
    expenseGrowth: number;
    bonusEnabled: boolean;
    bonusAmount: number;
    bonusMode: string;
    bonusMonth: number;
    bonusRecurring: boolean;
    taxReturnEnabled: boolean;
    taxReturnAmountOverride?: number;
    taxReturnMonth: number;
  };
}

export function useCardProjection(params: UseCardProjectionParams): CardProjectionResult | null {
  const {
    accounts, transactions, rules, debts, goals, carFunds, profile,
    debtPayoffOptions, payConfig, scheduledEvents, pauseSavings,
    forecastFundingAccountId, debtStrategy, persistedDebtFundingId, assumptions,
    syncCutoffDate, paymentPlans,
  } = params;

  return useMemo(() => {
    try {
      const cards = buildCardData(accounts, transactions, rules, debts);
      if (cards.length === 0) return null;

      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      const accountMap = new Map<string, any>(accounts.map((a: any) => [a.id, a]));

      // ── Funding account resolution (mirrors cardProjectionData) ──────────────
      const liquidTypes = ['checking', 'business_checking', 'cash'];
      const liquidCash = accounts
        .filter((a: any) => a.active && liquidTypes.includes(a.account_type))
        .reduce((s: number, a: any) => s + Number(a.balance), 0);
      const resolvedDebtFundingId = persistedDebtFundingId || forecastFundingAccountId;
      const debtFundingAccount = accounts.find((a: any) => a.active && a.id === resolvedDebtFundingId);
      const debtFundingBalance = debtFundingAccount ? Number(debtFundingAccount.balance) : liquidCash;
      const debtFundingSources = resolvedDebtFundingId
        ? new Set([resolvedDebtFundingId, `account:${resolvedDebtFundingId}`])
        : new Set<string>();

      // ── Scalar fallbacks ──────────────────────────────────────────────────────
      const monthlyTakeHome = getNormalizedMonthNetIncome(payConfig);
      const ccSourceIdsForScalar = new Set(cards.flatMap(c => [c.id, `account:${c.id}`]));
      const planCashExpensesEarly = Array.from({ length: 36 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        return getMonthlyPlanCashExpenses(paymentPlans ?? [], d.getFullYear(), d.getMonth(), ccSourceIdsForScalar);
      });
      const monthlyExpenses = rules.filter((r: any) => {
        if (!r.active || r.rule_type !== 'expense') return false;
        if (r.payment_source && ccSourceIdsForScalar.has(r.payment_source)) return false;
        if (!r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category)) return false;
        if (pauseSavings && (r.category === 'Savings' || r.category === 'Investing')) return false;
        return true;
      }).reduce((s: number, r: any) => {
        return s + Number(r.amount) * countRuleOccurrencesInMonth(r, now.getFullYear(), now.getMonth());
      }, 0) + (planCashExpensesEarly[0] ?? 0);

      // ── Per-card CC purchase map ──────────────────────────────────────────────
      const highestAprCardId = cards.length > 0
        ? [...cards].sort((a, b) => b.apr - a.apr)[0].id : null;
      const ccDefaultRuleIds = new Set<string>(
        rules.filter((r: any) =>
          r.active && r.rule_type === 'expense' &&
          !r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category),
        ).map((r: any) => r.id),
      );
      const cardRuleIdMap = new Map<string, Set<string>>(
        cards.map(c => {
          const cKey = `account:${c.id}`;
          const ids = new Set<string>(
            rules.filter((r: any) =>
              r.active && r.rule_type === 'expense' &&
              (r.payment_source === c.id || r.payment_source === cKey),
            ).map((r: any) => r.id),
          );
          if (c.id === highestAprCardId) ccDefaultRuleIds.forEach(id => ids.add(id));
          return [c.id, ids];
        }),
      );

      const cardPurchasesPerMonth: { [cardId: string]: number }[] = [];
      for (let i = 0; i < 36; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const eventsInMonth = scheduledEvents.filter(e =>
          e.date.startsWith(monthKey) && (i > 0 || e.date >= todayStr),
        );
        const cardPurchases: { [cardId: string]: number } = {};
        if (i > 0) {
          for (const card of cards) {
            const ruleIds = cardRuleIdMap.get(card.id) ?? new Set<string>();
            const scheduledAmt = eventsInMonth
              .filter(e => e.type === 'expense' && e.ruleId && ruleIds.has(e.ruleId))
              .reduce((s, e) => s + e.amount, 0);
            const oneTimeCCAmt = (transactions as any[])
              .filter((t: any) =>
                !(t as any).isGenerated &&
                t.date?.startsWith(monthKey) &&
                t.type === 'expense' &&
                (t.payment_source === card.id || t.payment_source === `account:${card.id}`),
              )
              .reduce((s: number, t: any) => s + Number(t.amount), 0);
            cardPurchases[card.id] = scheduledAmt + oneTimeCCAmt;
          }
        }
        cardPurchasesPerMonth.push(cardPurchases);
      }

      // ── One-time DB transactions per future month ─────────────────────────────
      const ccSourceIds = new Set(cards.flatMap(c => [c.id, `account:${c.id}`]));
      const oneTimeArr: { income: number; expenses: number }[] = [{ income: 0, expenses: 0 }];
      for (let oi = 1; oi < 36; oi++) {
        const od = new Date(now.getFullYear(), now.getMonth() + oi, 1);
        const omk = `${od.getFullYear()}-${String(od.getMonth() + 1).padStart(2, '0')}`;
        const txns = (transactions as any[]).filter((t: any) =>
          t.date && t.date.startsWith(omk) && !(t as any).isGenerated,
        );
        const inc = txns
          .filter((t: any) => t.type === 'income' && t.category !== 'Balance Adjustment')
          .reduce((s: number, t: any) => s + Number(t.amount), 0);
        const exp = txns
          .filter((t: any) => {
            if (t.type !== 'expense') return false;
            if (t.category === 'Debt Payments' || t.category === 'Balance Adjustment') return false;
            if (t.payment_source && ccSourceIds.has(t.payment_source)) return false;
            return true;
          })
          .reduce((s: number, t: any) => s + Number(t.amount), 0);
        oneTimeArr.push({ income: inc, expenses: exp });
      }

      // ── Month 0 income / expenses / floor ─────────────────────────────────────
      const allTxnsForM0 = mergeWithGeneratedTransactions(transactions, rules, accounts);
      const m0Income = getRemainingTransactionIncomeByDay(allTxnsForM0, 31, syncCutoffDate);
      const m0Expenses = getRemainingTransactionExpensesByDay(allTxnsForM0, 31, true, debtFundingSources, CC_DEFAULT_CATEGORIES, syncCutoffDate);
      const m0SafeFloor = getMinSafeCash(rules, payConfig, debtPayoffOptions.cashFloor, resolvedDebtFundingId, now);
      const cashFloorByMonth = Array.from({ length: 36 }, (_, m) => {
        const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
        return getMinSafeCash(rules, payConfig, debtPayoffOptions.cashFloor, resolvedDebtFundingId, d);
      });

      // ── forecastMonthEvents (mirrors Forecast.tsx useMemo exactly) ────────────
      const liquidAccountIds = new Set<string>(
        accounts.filter((a: any) => a.active && liquidTypes.includes(a.account_type)).map((a: any) => a.id),
      );
      const incomeToLiquidRuleIds = new Set<string>(
        rules.filter((r: any) =>
          r.active && r.rule_type === 'income' &&
          (!r.deposit_account || liquidAccountIds.has(r.deposit_account)),
        ).map((r: any) => r.id),
      );
      const explicitPaycheckRuleId = (profile as any)?.paycheck_rule_id as string | undefined;
      const paycheckRuleIds = new Set<string>();
      if (explicitPaycheckRuleId) {
        paycheckRuleIds.add(explicitPaycheckRuleId);
      } else {
        rules.filter((r: any) =>
          r.active && r.rule_type === 'income' &&
          ['weekly', 'biweekly', 'semi_monthly'].includes(r.frequency) &&
          (!r.deposit_account || liquidAccountIds.has(r.deposit_account)),
        ).forEach((r: any) => paycheckRuleIds.add(r.id));
      }
      const ccPaymentSources = new Set<string>(
        accounts.filter((a: any) => a.active && a.account_type === 'credit_card')
          .flatMap((a: any) => [a.id, `account:${a.id}`]),
      );
      const ccExplicitRuleIds = new Set<string>(
        rules.filter((r: any) =>
          r.active && r.rule_type === 'expense' &&
          r.payment_source && ccPaymentSources.has(r.payment_source),
        ).map((r: any) => r.id),
      );
      const allCcRuleIds = new Set<string>([...ccExplicitRuleIds, ...ccDefaultRuleIds]);
      const savingsRuleIds = new Set<string>(
        rules.filter((r: any) =>
          r.active && r.rule_type === 'expense' &&
          (r.category === 'Savings' || r.category === 'Investing'),
        ).map((r: any) => r.id),
      );
      const ruleTaxRateMap = new Map<string, number>(
        rules.filter((r: any) => r.rule_type === 'income' && r.tax_rate != null)
          .map((r: any) => [r.id, Number(r.tax_rate)]),
      );
      const forecastMonthEvents = Array.from({ length: 36 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const eventsInMonth = scheduledEvents.filter(e =>
          e.date.startsWith(monthKey) && (i > 0 || e.date >= todayStr),
        );
        const income = eventsInMonth
          .filter(e => e.type === 'income' && e.ruleId && incomeToLiquidRuleIds.has(e.ruleId))
          .reduce((s, e) => s + e.amount, 0);
        const nonPaycheckIncome = eventsInMonth
          .filter(e => e.type === 'income' && e.ruleId && incomeToLiquidRuleIds.has(e.ruleId) && !paycheckRuleIds.has(e.ruleId))
          .reduce((s, e) => {
            const tr = e.ruleId ? (ruleTaxRateMap.get(e.ruleId) ?? 0) : 0;
            return s + e.amount * (1 - tr / 100);
          }, 0);
        const expenses = eventsInMonth
          .filter(e =>
            e.type === 'expense' &&
            !(e.ruleId && allCcRuleIds.has(e.ruleId)) &&
            !(pauseSavings && e.ruleId && savingsRuleIds.has(e.ruleId)),
          )
          .reduce((s, e) => s + e.amount, 0);
        return { income, nonPaycheckIncome, expenses };
      });

      // ── simulationMonthEvents (mirrors cardProjectionData exactly) ────────────
      const simRetireIds = new Set<string>(
        (accounts as any[]).filter((a: any) => a.active && ['401k', 'roth_ira', 'ira', 'hsa'].includes(a.account_type)).map((a: any) => a.id),
      );
      const simTransferRules = (rules as any[]).filter((r: any) => r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment'));
      const monthlyExpGrowthRate = Math.pow(1 + assumptions.expenseGrowth / 100, 1 / 12) - 1;
      let simIncMult = 1;
      const simFirstBonusIdx = (!assumptions.bonusRecurring && assumptions.bonusEnabled && assumptions.bonusAmount > 0)
        ? (() => {
            for (let k = 1; k < 36; k++) {
              const kd = new Date(now.getFullYear(), now.getMonth() + k, 1);
              if (kd.getMonth() + 1 === assumptions.bonusMonth) return k;
            }
            return -1;
          })()
        : -1;

      const simulationMonthEvents = forecastMonthEvents.map((e, idx) => {
        if (idx === 0) return e;
        const d = new Date(now.getFullYear(), now.getMonth() + idx, 1);
        const simMonthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        if (assumptions.incomeGrowthEnabled && assumptions.incomeGrowth > 0 && d.getMonth() + 1 === assumptions.raiseMonth) {
          if ((assumptions as any).raiseMode === 'flat') {
            const currentAnnual = monthlyTakeHome * 12 * simIncMult;
            if (currentAnnual > 0) simIncMult *= (1 + assumptions.incomeGrowth / currentAnnual);
          } else {
            simIncMult *= (1 + assumptions.incomeGrowth / 100);
          }
        }
        const expMult = Math.pow(1 + monthlyExpGrowthRate, idx);
        let bonusTaxInc = 0;
        if (assumptions.bonusEnabled && assumptions.bonusAmount > 0 && d.getMonth() + 1 === assumptions.bonusMonth) {
          if (assumptions.bonusRecurring || idx === simFirstBonusIdx) {
            bonusTaxInc += assumptions.bonusMode === 'pct'
              ? monthlyTakeHome * 12 * simIncMult * (assumptions.bonusAmount / 100)
              : assumptions.bonusAmount;
          }
        }
        if (assumptions.taxReturnEnabled && (assumptions.taxReturnAmountOverride ?? 0) > 0 && d.getMonth() + 1 === assumptions.taxReturnMonth) {
          bonusTaxInc += assumptions.taxReturnAmountOverride ?? 0;
        }
        const simActiveTransferDests = new Set<string>();
        let monthTransfers = 0;
        for (const tr of simTransferRules) {
          if (tr.start_date && new Date(tr.start_date + 'T00:00:00') > simMonthEnd) continue;
          if (tr.end_date && new Date(tr.end_date + 'T00:00:00') < d) continue;
          if (tr.deposit_account) simActiveTransferDests.add(tr.deposit_account);
          const amt = Number(tr.amount);
          monthTransfers += amt * countRuleOccurrencesInMonth(tr, d.getFullYear(), d.getMonth(), now);
        }
        const monthSavings = ((goals ?? []) as any[]).reduce((s: number, g: any) => {
          if (g.contribution_start_date && new Date(g.contribution_start_date + 'T00:00:00') > d) return s;
          if (g.linked_account && simRetireIds.has(g.linked_account)) return s;
          if (g.linked_account && simActiveTransferDests.has(g.linked_account)) return s;
          return s + Number(g.monthly_contribution);
        }, 0);
        const carLoanThisMonth = getTotalCarLoanMonthly((carFunds ?? []) as any[], d);
        const monthCarSaving = ((carFunds ?? []) as any[]).reduce((s: number, c: any) => {
          if (c.phase !== 'saving') return s;
          if (c.linked_account) return s; // savings already in linked account (current_saved is live balance)
          const rem = Math.max(0, Number(c.down_payment_goal) - Number(c.current_saved) - Number(c.gift_contribution || 0));
          if (rem <= 0) return s;
          let purchaseMonthIdx = 12;
          if (c.planned_purchase_date) {
            const parts = (c.planned_purchase_date as string).split('-').map(Number);
            const pd = new Date(parts[0], parts[1] - 1, parts[2]);
            purchaseMonthIdx = Math.max(1, (pd.getFullYear() - now.getFullYear()) * 12 + (pd.getMonth() - now.getMonth()));
          }
          return s + Math.min(rem / purchaseMonthIdx, rem);
        }, 0);
        const actualMonthPaycheck = getMonthNetIncome(payConfig, d.getFullYear(), d.getMonth());
        const rawIncome = e.income > e.nonPaycheckIncome ? e.income : actualMonthPaycheck + e.nonPaycheckIncome;
        return {
          ...e,
          income: rawIncome * simIncMult + bonusTaxInc,
          expenses: e.expenses * expMult + (pauseSavings ? 0 : monthSavings + monthCarSaving) + monthTransfers + carLoanThisMonth + (planCashExpensesEarly[idx] ?? 0),
        };
      });

      // ── CC minimum total ──────────────────────────────────────────────────────
      const ccMinTotal = cards
        .filter(c => !c.autopayFullBalance && c.balance > 0)
        .reduce((s, c) => s + c.minPayment, 0);

      // ── Car down-payment amounts per month (for combined look-ahead) ──────────
      // effectiveDP = what must still come from checking in the purchase month after monthly
      // savings have accumulated. When monthly savings cover all of `rem`, this is 0 — no
      // lump-sum shock in the purchase month and no save-up needed for that car event.
      const carDownPaymentByMonth = Array.from({ length: 36 }, (_, i) => {
        return (carFunds as any[]).reduce((s: number, c: any) => {
          if (c.phase !== 'saving') return s;
          const liveSaved = c.linked_account
            ? Number(accountMap.get(c.linked_account)?.balance ?? c.current_saved ?? 0)
            : Number(c.current_saved || 0);
          const rem = Math.max(0, Number(c.down_payment_goal || 0) - liveSaved - Number(c.gift_contribution || 0));
          if (rem <= 0) return s;
          let purchaseMonthIdx: number;
          if (c.planned_purchase_date) {
            const parts = (c.planned_purchase_date as string).split('-').map(Number);
            const pd = new Date(parts[0], parts[1] - 1, parts[2]);
            purchaseMonthIdx = Math.max(0, (pd.getFullYear() - now.getFullYear()) * 12 + (pd.getMonth() - now.getMonth()));
          } else {
            const contrib0 = rem > 0 ? Math.min(rem / 12, 500) : 0;
            purchaseMonthIdx = contrib0 > 0 ? Math.ceil(rem / contrib0) : 999;
          }
          // Linked-account funds: savings are in a separate account (current_saved is live balance).
          // No monthly checking deduction → full rem is the lump-sum obligation in the purchase month.
          // Non-linked: monthly contrib spread over purchaseMonthIdx months covers rem exactly → effectiveDP = 0.
          const contrib = c.linked_account ? 0
            : (rem > 0 && isFinite(purchaseMonthIdx) && purchaseMonthIdx > 0
              ? Math.min(rem / purchaseMonthIdx, rem)
              : 0);
          // effectiveDP = 0 for non-linked (monthly savings cover it); = rem for linked (lump sum from checking).
          const effectiveDP = Math.max(0, rem - contrib * purchaseMonthIdx);
          return s + (isFinite(purchaseMonthIdx) && i === purchaseMonthIdx ? effectiveDP : 0);
        }, 0);
      });

      // ── Cycling card statement excess per month ───────────────────────────────
      // Cycling cards (paymentPreference = statement/full, 0 revolving balance) pay the
      // previous month's purchases in the current month (1-billing-cycle delay). A one-time
      // purchase on such a card in month m creates an elevated cash outflow in month m+1.
      // Compute that excess so PASS 2 can save up in preceding months.
      const cyclingExcessByMonth = Array.from({ length: 36 }, (_, m) => {
        if (m === 0) return 0;
        const purchaseMonth = m - 1;
        return cards.reduce((s, c) => {
          if (c.balance > 0) return s;
          if (c.paymentPreference !== 'statement' && c.paymentPreference !== 'full' && !c.autopayFullBalance) return s;
          const purchased = cardPurchasesPerMonth[purchaseMonth]?.[c.id] ?? c.monthlyNewPurchases;
          return s + Math.max(0, purchased - c.monthlyNewPurchases);
        }, 0);
      });

      // ── Combined look-ahead: one-time DB expenses + car down payments + cycling excess ──
      const maxDebtPaymentByMonth: number[] = Array(36).fill(Infinity);
      const saveUpMonths = new Set<number>();
      const saveUpReason = new Map<number, { eventName: string; monthLabel: string }>();

      const hasLargeEvent = (i: number) =>
        carDownPaymentByMonth[i] > 0 || (oneTimeArr[i]?.expenses ?? 0) > 0 || cyclingExcessByMonth[i] > 0;

      if (ccMinTotal > 0 && Array.from({ length: 35 }, (_, i) => i + 1).some(i => hasLargeEvent(i))) {
        const simDebtPay: number[] = [];
        for (let m = 0; m < 36; m++) {
          const mInc = m === 0 ? m0Income : (simulationMonthEvents[m]?.income ?? monthlyTakeHome);
          const mExp = m === 0 ? m0Expenses : (simulationMonthEvents[m]?.expenses ?? monthlyExpenses);
          const mFloor = cashFloorByMonth[m];
          const startBal = m === 0 ? debtFundingBalance : mFloor;
          simDebtPay.push(Math.max(ccMinTotal, Math.max(0, startBal + mInc - mExp - mFloor - cyclingExcessByMonth[m])));
        }

        const recomputeSimCash = (): number[] => {
          let bal = debtFundingBalance;
          const cash: number[] = [];
          for (let m = 0; m < 36; m++) {
            const mInc = m === 0 ? m0Income : (simulationMonthEvents[m]?.income ?? monthlyTakeHome);
            const mExp = m === 0 ? m0Expenses : (simulationMonthEvents[m]?.expenses ?? monthlyExpenses);
            const mFloor = cashFloorByMonth[m];
            // Deduct cycling excess (elevated statement payment from prior month's one-time CC purchase)
            // so floor breaches in elevated-cycling months are visible to the iterative recovery loop.
            const availForDebt = Math.max(0, bal + mInc - mExp - mFloor - cyclingExcessByMonth[m]);
            const effectivePay = Math.min(simDebtPay[m], availForDebt + ccMinTotal);
            const oneTime = m === 0 ? { income: 0, expenses: 0 } : (oneTimeArr[m] ?? { income: 0, expenses: 0 });
            // Apply one-time items, car DP, and cycling excess before the floor clamp so floor
            // breaches caused by any of these are visible to the iterative recovery loop.
            bal += mInc - mExp - effectivePay + oneTime.income - oneTime.expenses
              - (m === 0 ? 0 : carDownPaymentByMonth[m])
              - (m === 0 ? 0 : cyclingExcessByMonth[m]);
            if (!saveUpMonths.has(m) && bal > mFloor) bal = mFloor;
            cash.push(bal);
          }
          return cash;
        };

        for (let pass = 0; pass < 20; pass++) {
          const simCash = recomputeSimCash();
          let anyFixed = false;
          for (let i = 0; i < 36; i++) {
            if (simCash[i] >= cashFloorByMonth[i]) continue;
            let toRecover = cashFloorByMonth[i] - simCash[i];
            for (let j = i; j >= 0 && toRecover > 0; j--) {
              const canReduce = Math.max(0, Math.min(simDebtPay[j] - ccMinTotal, toRecover));
              if (canReduce > 0) {
                simDebtPay[j] -= canReduce;
                toRecover -= canReduce;
                if (j <= i && hasLargeEvent(i)) {
                  saveUpMonths.add(j);
                  if (!saveUpReason.has(j)) {
                    const carD = new Date(now.getFullYear(), now.getMonth() + i, 1);
                    const monthLabel = carD.toLocaleString('en', { month: 'long', year: 'numeric' });
                    let eventName = 'upcoming expense';
                    if (carDownPaymentByMonth[i] > 0) {
                      const car = (carFunds as any[]).find((c: any) => {
                        if (c.phase !== 'saving') return false;
                        const dp = Math.max(0, Number(c.down_payment_goal || 0) - Number(c.gift_contribution || 0));
                        if (dp <= 0) return false;
                        let pmi: number;
                        if (c.planned_purchase_date) {
                          const parts = (c.planned_purchase_date as string).split('-').map(Number);
                          const pd = new Date(parts[0], parts[1] - 1, parts[2]);
                          pmi = Math.max(0, (pd.getFullYear() - now.getFullYear()) * 12 + (pd.getMonth() - now.getMonth()));
                        } else {
                          const rem = Math.max(0, Number(c.down_payment_goal || 0) - Number(c.current_saved || 0) - Number(c.gift_contribution || 0));
                          const contrib = rem > 0 ? Math.min(rem / 12, 500) : 0;
                          pmi = contrib > 0 ? Math.ceil(rem / contrib) : 999;
                        }
                        return isFinite(pmi) && pmi === i;
                      });
                      if (car) eventName = `${car.vehicle_name || 'vehicle'} down payment`;
                    } else if (cyclingExcessByMonth[i] > 0) {
                      eventName = 'large CC purchase statement payment';
                    }
                    saveUpReason.set(j, { eventName, monthLabel });
                  }
                }
                anyFixed = true;
              }
            }
            if (anyFixed) break;
          }
          if (!anyFixed) break;
        }

        for (const m of saveUpMonths) {
          maxDebtPaymentByMonth[m] = ccMinTotal;
        }
      }

      // Merge car DP into one-time expenses so simulateVariablePayoff deducts it from
      // currentCash in the DP month — without this the simulation overstates available
      // cash in every month after the purchase, causing floor breaches downstream.
      const oneTimeArrWithDP = oneTimeArr.map((ot, i) =>
        i === 0 || carDownPaymentByMonth[i] === 0
          ? ot
          : { income: ot.income, expenses: ot.expenses + carDownPaymentByMonth[i] },
      );

      // ── Run CC simulation ─────────────────────────────────────────────────────
      const sim = simulateVariablePayoff(
        cards,
        debtFundingBalance,
        debtPayoffOptions.cashFloor,
        debtStrategy,
        monthlyTakeHome,
        monthlyExpenses,
        36,
        simulationMonthEvents,
        undefined,
        cardPurchasesPerMonth,
        m0Income,
        m0Expenses,
        oneTimeArrWithDP,
        m0SafeFloor,
        maxDebtPaymentByMonth,
        cashFloorByMonth,
      );

      const projs = cards.map(c => {
        const pays = sim.monthlyPayments.get(c.id) || [];
        const revBals = sim.monthlyRevolvingBalances.get(c.id) || [];
        return projectCardVariable(c, pays, 36, true, undefined, revBals);
      });

      // ── Derived arrays ────────────────────────────────────────────────────────
      const totalLimit = cards.reduce((s, c) => s + c.creditLimit, 0);
      const data = Array.from({ length: 36 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const row: any = { month: d.toLocaleString('en', { month: 'short', year: 'numeric' }), totalCCBalance: 0, displayCCBalance: 0, totalInterest: 0 };
        for (const p of projs) {
          const m = p.months[i];
          if (m) {
            row[p.card.name] = Math.round(m.endBalance);
            row.totalInterest += m.interest;
          } else if (p.payoffMonth !== null && i >= p.payoffMonth) {
            if (p.card.paymentPreference === 'full' || p.card.paymentPreference === 'statement') {
              row[p.card.name] = Math.round(cardPurchasesPerMonth[i]?.[p.card.id] ?? p.card.monthlyNewPurchases);
            } else {
              row[p.card.name] = 0;
            }
          }
        }
        row.totalCCBalance = Math.round(Math.max(0,
          cards.reduce((s, c) => s + (sim.monthlyRevolvingBalances.get(c.id)?.[i] ?? 0), 0),
        ));
        let displayBal = 0;
        for (const card of cards) {
          const simBal = sim.monthlyBalances.get(card.id)?.[i] ?? 0;
          if (simBal > 0) displayBal += simBal;
          else if (card.paymentPreference === 'full' || card.paymentPreference === 'statement') displayBal += card.monthlyNewPurchases;
        }
        row.displayCCBalance = Math.round(Math.max(0, displayBal));
        row.totalInterest = Math.round(row.totalInterest);
        row.utilization = totalLimit > 0 ? Math.round((row.totalCCBalance / totalLimit) * 100) : 0;
        return row;
      });

      // Only count payments where the card is carrying actual revolving debt.
      // Cycling-mode rows (autopay cards, statement-pref cards after revolving clears) set
      // startBalance = payment as a display artifact — their revolving balance is 0.
      // Including them inflates simRevTotal in pass-3, making p3RevBal hit 0 too early,
      // which scales all subsequent revolving payments to 0.
      const debtPaymentTotals = Array.from({ length: 36 }, (_, i) =>
        projs.reduce((total, proj) => {
          const m = proj.months[i];
          if (!m || m.startBalance <= 0) return total;
          // Use START-of-month revolving balance so the month a revolving card clears its
          // balance still counts as revolving, not cycling. End balance = 0 on the clearing
          // month would misclassify the payoff payment as cycling, bypassing the floor in
          // Forecast PASS 3 (cyclingPayment is non-negotiable; it skips availableForRevolving).
          // For m=0 use end balance (live state — cycling cards already show end=0 here).
          // For m>0 use previous month's end = this month's start.
          const startRevBal = i === 0
            ? (sim.monthlyRevolvingBalances.get(proj.card.id)?.[0] ?? 0)
            : (sim.monthlyRevolvingBalances.get(proj.card.id)?.[i - 1] ?? 0);
          if (startRevBal <= 0) return total;
          return total + m.payment;
        }, 0),
      );

      const allPaymentTotals = Array.from({ length: 36 }, (_, i) =>
        cards.reduce((total, card) => {
          const pays = sim.monthlyPayments.get(card.id);
          return total + (pays?.[i] ?? 0);
        }, 0),
      );

      let perCardPayments = cards.map(c => ({
        name: c.name, id: c.id,
        payments: Array.from({ length: 36 }, (_, i) => {
          const pays = sim.monthlyPayments.get(c.id);
          return Math.round(pays?.[i] ?? 0);
        }),
      }));

      // ── monthlySavingsAndCar for month 0 (mirrors CreditCardEngine exactly) ───
      const retireIds = new Set<string>(
        accounts.filter((a: any) => a.active && ['401k', 'roth_ira', 'ira', 'hsa'].includes(a.account_type)).map((a: any) => a.id),
      );
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const activeTransferDests = new Set<string>(
        (rules as any[]).filter((r: any) =>
          r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment') && r.deposit_account &&
          !(r.start_date && new Date(r.start_date + 'T00:00:00') > monthEnd) &&
          !(r.end_date && new Date(r.end_date + 'T00:00:00') < now),
        ).map((r: any) => r.deposit_account),
      );
      const goalContrib = pauseSavings ? 0 : (goals as any[]).reduce((s: number, g: any) => {
        if (g.contribution_start_date && new Date(g.contribution_start_date + 'T00:00:00') > now) return s;
        if (g.linked_account && retireIds.has(g.linked_account)) return s;
        if (g.linked_account && activeTransferDests.has(g.linked_account)) return s;
        return s + Number(g.monthly_contribution);
      }, 0);
      const carReserve = pauseSavings ? 0 : (carFunds as any[]).reduce((s: number, c: any) => {
        if (c.phase === 'loan') return s;
        if (c.phase !== 'saving') return s;
        const giftAdjDownPmt = Math.max(0, Number(c.down_payment_goal) - Number(c.gift_contribution || 0));
        const rem = Math.max(0, giftAdjDownPmt - Number(c.current_saved));
        if (rem <= 0) return s;
        let monthsToGoal = 12;
        if (c.planned_purchase_date) {
          const parts = (c.planned_purchase_date as string).split('-').map(Number);
          const pd = new Date(parts[0], parts[1] - 1, parts[2]);
          monthsToGoal = Math.max(1, (pd.getFullYear() - now.getFullYear()) * 12 + (pd.getMonth() - now.getMonth()));
        }
        // Always use rem (remaining after current_saved) regardless of linked_account.
        // Using giftAdjDownPmt would ignore savings already accumulated, overstating the reserve.
        const reserve = Math.min(rem / monthsToGoal, rem);
        return s + reserve;
      }, 0);
      const carLoanTotal = getTotalCarLoanMonthly(carFunds as any[]);
      const monthlySavingsAndCar = goalContrib + carReserve + carLoanTotal;

      // ── PASS-3 equivalent: constrain per-card payments to cash-floor model ─────
      // Mirrors Forecast PASS 3 steps 2+3: tracks rolling cash and revolving balance,
      // clips revolving payments when cash would drop below the floor, redirects surplus.
      const p3RevBal0 = cards.reduce((s, c) => {
        if ((sim.monthlyRevolvingBalances.get(c.id)?.[0] ?? 1) === 0) return s;
        const acct = (accounts as any[]).find((a: any) => a.id === c.id);
        return s + (acct ? Number(acct.balance || 0) : 0);
      }, 0);

      const pass3RevTotals: number[] = [];
      let p3Cash = debtFundingBalance;
      let p3RevBal = p3RevBal0;

      for (let m = 0; m < 36; m++) {
        const mInc   = m === 0 ? m0Income    : (simulationMonthEvents[m]?.income   ?? monthlyTakeHome);
        const mExp   = m === 0 ? m0Expenses + monthlySavingsAndCar
          : (simulationMonthEvents[m]?.expenses ?? monthlyExpenses) + (carDownPaymentByMonth[m] ?? 0);
        const mFloor = cashFloorByMonth[m];
        const simRevTotal = debtPaymentTotals[m];
        const simCycTotal = Math.max(0, allPaymentTotals[m] - simRevTotal);

        const ccMinForM = p3RevBal > 0
          ? cards.reduce((s, c) => {
              if ((sim.monthlyRevolvingBalances.get(c.id)?.[m] ?? 0) <= 0) return s;
              return s + (sim.perCardMinPayments.get(c.id)?.[m] ?? c.minPayment);
            }, 0)
          : 0;

        const cashPreDebt = p3Cash + mInc - mExp;
        const availForRev = p3RevBal > 0
          ? Math.max(ccMinForM, Math.max(0, cashPreDebt - simCycTotal - mFloor))
          : 0;
        const revPay = Math.min(simRevTotal, availForRev);

        p3Cash = cashPreDebt - simCycTotal - revPay;
        p3RevBal = Math.max(0, p3RevBal - revPay);

        let surplus = 0;
        if (!saveUpMonths.has(m) && p3RevBal > 0 && p3Cash > mFloor) {
          surplus = Math.min(p3Cash - mFloor, p3RevBal);
          p3Cash -= surplus;
          p3RevBal = Math.max(0, p3RevBal - surplus);
        }

        pass3RevTotals.push(Math.round(revPay + surplus));
      }

      // If pass-3 constrains month 0 below what the raw sim allocated, re-run with a
      // capped max so perCardPayments[m >= 1] is sized against the same starting balance
      // that the chart uses. Without this cap the raw sim may clear Discover in month 1
      // with a large payment ($1,860) that assumed $2,051 was paid in month 0, but the
      // chart only applies $852 in month 0, leaving ~$1,169 still owed by month 2 while
      // the sim's cycling payments ($42) drop in — causing the "stops in August" bug.
      const simCycTotal0 = Math.max(0, allPaymentTotals[0] - debtPaymentTotals[0]);
      const m0TotalBudget = pass3RevTotals[0] + simCycTotal0;
      let activeSim = sim;
      if (m0TotalBudget < allPaymentTotals[0] - 1) {
        const cappedMaxDebt = [...maxDebtPaymentByMonth];
        cappedMaxDebt[0] = m0TotalBudget;
        const sim2 = simulateVariablePayoff(
          cards,
          debtFundingBalance,
          debtPayoffOptions.cashFloor,
          debtStrategy,
          monthlyTakeHome,
          monthlyExpenses,
          36,
          simulationMonthEvents,
          undefined,
          cardPurchasesPerMonth,
          m0Income,
          m0Expenses,
          oneTimeArrWithDP,
          m0SafeFloor,
          cappedMaxDebt,
          cashFloorByMonth,
        );
        perCardPayments = cards.map(c => ({
          name: c.name, id: c.id,
          payments: Array.from({ length: 36 }, (_, i) =>
            Math.round(sim2.monthlyPayments.get(c.id)?.[i] ?? 0),
          ),
        }));
        activeSim = sim2;

        // Update data[i].totalCCBalance from sim2 so Forecast PASS 2 recomputeSimCash pins
        // cash to floor in the correct months. PASS 2 uses b.ccDebtBalance > 0 to decide
        // whether to simulate PASS 3's surplus redirect; if sim1 shows debt cleared when sim2
        // doesn't, PASS 2 stops pinning too early and misses floor breaches — causing it to
        // never reduce cycling payments (e.g. Amex Gold statement balance) to maintain the floor.
        for (let i = 0; i < 36; i++) {
          data[i].totalCCBalance = Math.round(Math.max(0,
            cards.reduce((s, c) => s + (sim2.monthlyRevolvingBalances.get(c.id)?.[i] ?? 0), 0),
          ));
        }

        // Update allPaymentTotals and debtPaymentTotals in-place from sim2
        for (let i = 0; i < 36; i++) {
          allPaymentTotals[i] = cards.reduce((total, card) =>
            total + (sim2.monthlyPayments.get(card.id)?.[i] ?? 0), 0);
        }
        const projs2 = cards.map(c =>
          projectCardVariable(c, sim2.monthlyPayments.get(c.id) || [], 36, true, undefined, sim2.monthlyRevolvingBalances.get(c.id) || [])
        );
        for (let i = 0; i < 36; i++) {
          debtPaymentTotals[i] = projs2.reduce((total, proj) => {
            const mo = proj.months[i];
            if (!mo || mo.startBalance <= 0) return total;
            const startRevBal = i === 0
              ? (sim2.monthlyRevolvingBalances.get(proj.card.id)?.[0] ?? 0)
              : (sim2.monthlyRevolvingBalances.get(proj.card.id)?.[i - 1] ?? 0);
            if (startRevBal <= 0) return total;
            return total + mo.payment;
          }, 0);
        }

        // Re-run pass3RevTotals with sim2-corrected totals
        const p3RevBal0_2 = cards.reduce((s, c) => {
          if ((sim2.monthlyRevolvingBalances.get(c.id)?.[0] ?? 1) === 0) return s;
          const acct = (accounts as any[]).find((a: any) => a.id === c.id);
          return s + (acct ? Number(acct.balance || 0) : 0);
        }, 0);
        pass3RevTotals.length = 0;
        let p3Cash2 = debtFundingBalance;
        let p3RevBal2 = p3RevBal0_2;
        for (let m = 0; m < 36; m++) {
          const mInc2   = m === 0 ? m0Income    : (simulationMonthEvents[m]?.income   ?? monthlyTakeHome);
          const mExp2   = m === 0 ? m0Expenses + monthlySavingsAndCar
            : (simulationMonthEvents[m]?.expenses ?? monthlyExpenses) + (carDownPaymentByMonth[m] ?? 0);
          const mFloor2 = cashFloorByMonth[m];
          const simRevTotal2 = debtPaymentTotals[m];
          const simCycTotal2 = Math.max(0, allPaymentTotals[m] - simRevTotal2);
          const ccMinForM2 = p3RevBal2 > 0
            ? cards.reduce((s, c) => {
                if ((sim2.monthlyRevolvingBalances.get(c.id)?.[m] ?? 0) <= 0) return s;
                return s + (sim2.perCardMinPayments.get(c.id)?.[m] ?? c.minPayment);
              }, 0)
            : 0;
          const cashPreDebt2 = p3Cash2 + mInc2 - mExp2;
          const availForRev2 = p3RevBal2 > 0
            ? Math.max(ccMinForM2, Math.max(0, cashPreDebt2 - simCycTotal2 - mFloor2))
            : 0;
          const revPay2 = Math.min(simRevTotal2, availForRev2);
          p3Cash2 = cashPreDebt2 - simCycTotal2 - revPay2;
          p3RevBal2 = Math.max(0, p3RevBal2 - revPay2);
          let surplus2 = 0;
          if (!saveUpMonths.has(m) && p3RevBal2 > 0 && p3Cash2 > mFloor2) {
            surplus2 = Math.min(p3Cash2 - mFloor2, p3RevBal2);
            p3Cash2 -= surplus2;
            p3RevBal2 = Math.max(0, p3RevBal2 - surplus2);
          }
          pass3RevTotals.push(Math.round(revPay2 + surplus2));
        }
      }

      // For save-up months where revolving debt is already cleared, cap allPaymentTotals at
      // maxDebtPaymentByMonth so cycling card payments (e.g. Amex Gold statement balance)
      // are reduced — consistent with Forecast PASS 3's effectiveTotalPayments cap.
      // Without this, Debt Payoff shows full cycling payments in save-up months while
      // Forecast correctly shows reduced amounts.
      for (const m of saveUpMonths) {
        const cap = maxDebtPaymentByMonth[m];
        if (!isFinite(cap) || debtPaymentTotals[m] > 0) continue;
        if (allPaymentTotals[m] > cap) allPaymentTotals[m] = cap;
      }

      // Scale per-card: cycling cards keep full sim amount; revolving cards scale to pass-3 totals.
      // In save-up months with no revolving debt, scale cycling cards proportionally to the cap.
      // Uses activeSim (sim2 when triggered, sim1 otherwise) so revolving/cycling classification
      // and per-card amounts are consistent with the updated totals.
      const perCardPaymentsScaled = cards.map(c => ({
        name: c.name, id: c.id,
        payments: Array.from({ length: 36 }, (_, m) => {
          const simAmt = Math.round(activeSim.monthlyPayments.get(c.id)?.[m] ?? 0);
          if ((activeSim.monthlyRevolvingBalances.get(c.id)?.[m] ?? 0) === 0) {
            // Cycling card — in save-up months with no revolving debt, scale down proportionally
            if (saveUpMonths.has(m) && debtPaymentTotals[m] === 0) {
              const totalCycFull = cards.reduce((s, cc) => {
                if ((activeSim.monthlyRevolvingBalances.get(cc.id)?.[m] ?? 0) > 0) return s;
                return s + Math.round(activeSim.monthlyPayments.get(cc.id)?.[m] ?? 0);
              }, 0);
              const scale = totalCycFull > 0 ? Math.min(1, allPaymentTotals[m] / totalCycFull) : 1;
              return Math.round(simAmt * scale);
            }
            return simAmt;
          }
          const simRevTotal = debtPaymentTotals[m];
          const scale = simRevTotal > 0 ? Math.min(1, pass3RevTotals[m] / simRevTotal) : 1;
          return Math.round(simAmt * scale);
        }),
      }));

      // ── month0 computation ────────────────────────────────────────────────────
      const cyclingPayment = Math.max(0, allPaymentTotals[0] - debtPaymentTotals[0]);
      const simRevolvingTotal = debtPaymentTotals[0];

      const liveRevolvingBal = cards.reduce((s, c) => {
        const revBal0 = sim.monthlyRevolvingBalances.get(c.id)?.[0] ?? 1;
        if (revBal0 === 0) return s;
        const acct = (accounts as any[]).find((a: any) => a.id === c.id);
        return s + (acct ? Number(acct.balance || 0) : 0);
      }, 0);

      const ccMinTotalRevolving = cards
        .filter(c => {
          const revBal0 = sim.monthlyRevolvingBalances.get(c.id)?.[0] ?? 1;
          return revBal0 > 0;
        })
        .reduce((s, c) => s + c.minPayment, 0);

      const ccMinForMonth = liveRevolvingBal > 0 ? Math.min(ccMinTotalRevolving, simRevolvingTotal) : 0;
      const cashPreDebt = debtFundingBalance + m0Income - m0Expenses - monthlySavingsAndCar;
      const availableForRevolving = liveRevolvingBal > 0
        ? Math.max(ccMinForMonth, Math.max(0, cashPreDebt - m0SafeFloor - cyclingPayment))
        : 0;
      const revolvingPayment = liveRevolvingBal > 0 ? Math.min(simRevolvingTotal, availableForRevolving) : 0;
      const safeToPayTotal = cyclingPayment + revolvingPayment;

      // Max capacity: what you could pay if month 0 were NOT a save-up month (step 3 surplus)
      const isMonth0SaveUp = saveUpMonths.has(0);
      const surplusIfFree = (!isMonth0SaveUp && liveRevolvingBal > 0)
        ? Math.max(0, Math.min(cashPreDebt - cyclingPayment - revolvingPayment - m0SafeFloor, liveRevolvingBal))
        : 0;
      const maxCapacity = safeToPayTotal + surplusIfFree;
      const holdback = Math.max(0, maxCapacity - safeToPayTotal);
      const holdbackEvent = holdback > 0 && saveUpReason.has(0) ? (saveUpReason.get(0) ?? null) : null;

      // Per-card adjusted amounts (revolving cards scaled; cycling cards kept full).
      // Use activeSim (sim2 when triggered, sim1 otherwise) for both numerator and scale
      // denominator so the per-card revolving amounts sum exactly to revolvingPayment.
      // When sim2 is triggered it caps month-0 total, so using sim1 numerator with the
      // sim2-updated simRevolvingTotal denominator would over-allocate revolving cards.
      const scale = simRevolvingTotal > 0 ? Math.min(1, revolvingPayment / simRevolvingTotal) : 0;
      const perCardAdjusted = cards.map(c => {
        const revBal0 = activeSim.monthlyRevolvingBalances.get(c.id)?.[0] ?? 1;
        const isCycling = revBal0 === 0;
        const activeSimPay = Math.round(activeSim.monthlyPayments.get(c.id)?.[0] ?? 0);
        const perCardEntry = perCardPayments.find(p => p.id === c.id);
        const cyclingPay = perCardEntry?.payments[0] ?? activeSimPay;
        return {
          id: c.id,
          name: c.name,
          payment: isCycling ? cyclingPay : Math.round(activeSimPay * scale),
          maxPayment: activeSimPay,
        };
      });

      return {
        data,
        cards: projs.map(p => ({ name: p.card.name, color: p.card.color })),
        simCards: cards,
        debtPaymentTotals,
        allPaymentTotals,
        perCardPayments,
        perCardPaymentsScaled,
        monthlyRevolvingBalances: activeSim.monthlyRevolvingBalances,
        perCardMinPayments: activeSim.perCardMinPayments,
        m0Income,
        m0Expenses,
        m0SafeFloor,
        saveUpMonths,
        saveUpReason,
        month0: {
          safeToPayTotal: Math.round(safeToPayTotal),
          maxCapacity: Math.round(maxCapacity),
          holdback: Math.round(holdback),
          holdbackEvent,
          cyclingPayment: Math.round(cyclingPayment),
          revolvingPayment: Math.round(revolvingPayment),
          perCardAdjusted,
          m0SafeFloor: Math.round(m0SafeFloor),
        },
      };
    } catch (e) {
      console.error('[useCardProjection] projection failed:', e);
      return null;
    }
  }, [
    accounts, transactions, rules, debts, goals, carFunds, profile,
    debtPayoffOptions, payConfig, scheduledEvents, pauseSavings,
    forecastFundingAccountId, debtStrategy, persistedDebtFundingId, assumptions,
    syncCutoffDate, paymentPlans,
  ]);
}
