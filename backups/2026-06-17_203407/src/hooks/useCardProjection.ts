import { useMemo } from 'react';
import { formatCurrency } from '@/lib/calculations';
import {
  buildCardData, simulateVariablePayoff, projectCardVariable,
  CC_DEFAULT_CATEGORIES, CardData,
} from '@/lib/credit-card-engine';
import { PaymentPlan, getMonthlyPlanCashExpenses, getPaymentDates } from '@/lib/payment-plan-generator';
import {
  PayScheduleConfig, getMinSafeCash, getAugmentedMinSafeCash,
  getNormalizedMonthNetIncome, getMonthNetIncome,
} from '@/lib/pay-schedule';
import { countRuleOccurrencesInMonth } from '@/lib/scheduling';
import { getTotalCarLoanMonthly, calculateScheduledPayment } from '@/lib/vehicle-loan-engine';
import { computeFloorProtection } from '@/lib/floor-protection';

export interface Month0Result {
  safeToPayTotal: number;
  maxCapacity: number;
  holdback: number;
  holdbackEvent: { eventName: string; monthLabel: string } | null;
  cyclingPayment: number;
  revolvingPayment: number;
  perCardAdjusted: { id: string; name: string; payment: number; maxPayment: number }[];
  m0SafeFloor: number;
  /** Cash being set aside this month toward a saving-phase vehicle's down payment. Still the
   * user's own cash (hasn't left any account) — excluded from debt-payment capacity above, but
   * should be shown as cash on hand with this note, not subtracted as if it were a real expense. */
  carReserve: number;
  carReserveEvent: { vehicleName: string } | null;
  /** Subtracted from cashPreDebt above — surface these so any UI deriving "available to deploy"
   * from visible line items (Dashboard) can show them, instead of having them only affect the
   * total invisibly. */
  vehicleInsurance: number;
  mortgagePayment: number;
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
  monthlyBalances: Map<string, number[]>;
  perCardMinPayments: Map<string, number[]>;
  m0Income: number;
  m0Expenses: number;
  m0SafeFloor: number;
  saveUpMonths: Set<number>;
  /** Strictly-before-the-breach months only (never the event's own month) — see the
   * strictSaveUpMonths comment near its definition. Forecast.tsx uses this (not saveUpMonths)
   * to gate its own surplus-redirect step, since the event's own month should still be eligible
   * for redirecting any genuine surplus left over once its own protection is already in place. */
  strictSaveUpMonths: Set<number>;
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

      // ── Scalar fallbacks ──────────────────────────────────────────────────────
      const monthlyTakeHome = getNormalizedMonthNetIncome(payConfig);
      const ccSourceIdsForScalar = new Set(cards.flatMap(c => [c.id, `account:${c.id}`]));
      // Month 0: only count plan payments after syncCutoffDate — earlier ones are already
      // reflected in the current bank balance. Months 1+: all payments in that month.
      const planCashExpensesEarly = Array.from({ length: 36 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        return getMonthlyPlanCashExpenses(
          paymentPlans ?? [], d.getFullYear(), d.getMonth(), ccSourceIdsForScalar,
          i === 0 ? syncCutoffDate : undefined,
        );
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

      // ── CC-sourced payment plan charges per future month ──────────────────────
      // Plans paid via CC increase the card balance each month — inject as new
      // purchases so the payoff simulation sees the recurring balance growth.
      if (paymentPlans && paymentPlans.length > 0) {
        const sourceToCardId = new Map<string, string>(
          cards.flatMap(c => [[c.id, c.id], [`account:${c.id}`, c.id]]),
        );
        for (const plan of paymentPlans) {
          if (!plan.active || !plan.payment_source) continue;
          const cardId = sourceToCardId.get(plan.payment_source);
          if (!cardId) continue;
          const planDates = getPaymentDates(plan.start_date, plan.frequency, plan.total_payments);
          for (const date of planDates) {
            // Month 0: skip payments already reflected in the live CC balance
            if (date <= (syncCutoffDate ?? todayStr)) continue;
            const pd = new Date(date + 'T00:00:00');
            for (let mi = 0; mi < 36; mi++) {
              const md = new Date(now.getFullYear(), now.getMonth() + mi, 1);
              if (pd.getFullYear() === md.getFullYear() && pd.getMonth() === md.getMonth()) {
                cardPurchasesPerMonth[mi][cardId] = (cardPurchasesPerMonth[mi][cardId] ?? 0) + plan.payment_amount;
                break;
              }
            }
          }
        }
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

      // ── Month 0 floor ──────────────────────────────────────────────────────────
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
        // Cutoff matches Forecast.tsx's own forecastMonthEvents exactly (syncCutoffDate, strict
        // >) — this previously used today's date with >=, which could include or exclude an
        // extra day's events vs Forecast.tsx depending on how today and the last Plaid sync line up.
        const eventsInMonth = scheduledEvents.filter(e =>
          e.date.startsWith(monthKey) && (i > 0 || e.date > (syncCutoffDate ?? todayStr)),
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

      // Month-0 income/expenses — sourced from forecastMonthEvents[0] (the array immediately
      // above), the same scheduled-events-based figure Forecast.tsx's own baseExpenses/netIncome
      // use for month 0. Previously sourced from getRemainingTransactionIncomeByDay/
      // getRemainingTransactionExpensesByDay (a transaction-merge engine independent of
      // forecastMonthEvents), which could disagree with Forecast.tsx by the value of whatever
      // scheduled bills/income fell in the gap between the two engines' definitions of "remaining
      // this month" — confirmed ~$20 apart for a real test account, enough to make Forecast's
      // displayed line items not sum to its own Ending Cash.
      const m0Income = forecastMonthEvents[0].income;
      const m0Expenses = forecastMonthEvents[0].expenses;

      // ── simulationMonthEvents (mirrors cardProjectionData exactly) ────────────
      const simRetireIds = new Set<string>(
        (accounts as any[]).filter((a: any) => a.active && ['401k', 'roth_ira', 'ira', 'hsa'].includes(a.account_type)).map((a: any) => a.id),
      );
      const simTransferRules = (rules as any[]).filter((r: any) => r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment'));
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
          expenses: e.expenses + (pauseSavings ? 0 : monthSavings + monthCarSaving) + monthTransfers + carLoanThisMonth + (planCashExpensesEarly[idx] ?? 0),
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

      // Vehicle insurance + projected car loan for ANY month (mirrors Forecast.tsx's
      // vehicleProjections / getMonthVehicleInsurance / getMonthProjLoan) and mortgage payment
      // (mirrors Forecast.tsx's mortgageMonthlyPayment). Relocated here (before the combined
      // look-ahead) so the look-ahead's floor-breach loop below can use the same comprehensive
      // per-month outflow figure Forecast.tsx uses, instead of a narrower one.
      const vehicleForecastByMonth = (carFunds as any[])
        .filter((c: any) => c.phase === 'saving')
        .map((c: any) => {
          let purchaseMonthIdx = 0;
          if (c.planned_purchase_date) {
            const parts = (c.planned_purchase_date as string).split('-').map(Number);
            const pd = new Date(parts[0], parts[1] - 1, parts[2]);
            purchaseMonthIdx = Math.max(0, (pd.getFullYear() - now.getFullYear()) * 12 + (pd.getMonth() - now.getMonth()));
          }
          const loanPrincipal = Math.max(0, Number(c.target_price) + Number(c.tax_fees) - Number(c.down_payment_goal));
          const projPayment = Number(c.expected_apr) > 0 && Number(c.loan_term_months) > 0 && loanPrincipal > 0
            ? calculateScheduledPayment(loanPrincipal, Number(c.expected_apr), Number(c.loan_term_months))
            : 0;
          return {
            purchaseMonthIdx, projPayment, termMonths: Number(c.loan_term_months) || 0, insurance: Number(c.monthly_insurance || 0),
            // Extra payments the user plans to make once this saving-phase car is financed —
            // mirrors Forecast.tsx's getMonthProjLumpSum. Missing this was the root cause of a
            // real discrepancy: Forecast's own model (which already included these) showed a
            // genuine multi-month floor breach that this hook's look-ahead never saw coming,
            // since it had no idea this $/month was leaving every month in that window.
            lumpSumPayments: (c.lump_sum_payments ?? []) as { date: string; amount: number }[],
          };
        });
      const getVehicleExtrasForMonth = (m: number) => {
        const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
        const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        return vehicleForecastByMonth.reduce((s, v) => {
          const insurance = m >= v.purchaseMonthIdx ? v.insurance : 0;
          const inLoanWindow = m > v.purchaseMonthIdx && m <= v.purchaseMonthIdx + v.termMonths;
          const projLoan = inLoanWindow ? v.projPayment : 0;
          const lumpSum = inLoanWindow
            ? v.lumpSumPayments.filter(ls => ls.date.substring(0, 7) === mk).reduce((s2, ls) => s2 + Number(ls.amount), 0)
            : 0;
          return s + insurance + projLoan + lumpSum;
        }, 0);
      };
      const mortgageAccountNames = new Set(
        (accounts as any[]).filter((a: any) => a.account_type === 'mortgage' && a.active !== false)
          .map((a: any) => (a.name as string).toLowerCase()),
      );
      const monthlyMortgagePayment = (debts as any[]).filter((d: any) => mortgageAccountNames.has((d.name as string).toLowerCase()))
        .reduce((s: number, d: any) => s + Number(d.target_payment || d.min_payment || 0), 0);

      // ── Lump-sum goal transfers per month (mirrors Forecast.tsx's lumpTransferByMonth, the
      // .total figure only — per-account categorization is a display concern handled elsewhere).
      const lumpTransferByMonth = Array.from({ length: 36 }, (_, i) => {
        const md = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const mk = `${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, '0')}`;
        let total = 0;
        for (const g of (goals as any[])) {
          const lumps: any[] = Array.isArray(g.lump_sum_payments) ? g.lump_sum_payments : [];
          total += lumps.filter((ls: any) => ls.date.substring(0, 7) === mk).reduce((s: number, ls: any) => s + Number(ls.amount), 0);
        }
        return total;
      });

      // ── Lump-sum payments on phase='loan' car funds per month (mirrors the lump-sum portion
      // of Forecast.tsx's activeCarLoanByMonth — getTotalCarLoanMonthly covers only the regular
      // payment, lump_sum_payments on loan-phase cars are separate).
      const carLoanLumpByMonth = Array.from({ length: 36 }, (_, i) => {
        const md = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const mk = `${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, '0')}`;
        return (carFunds as any[])
          .filter((cf: any) => cf.phase === 'loan')
          .flatMap((cf: any) => (cf.lump_sum_payments ?? []).filter((ls: any) => ls.date.substring(0, 7) === mk))
          .reduce((s: number, ls: any) => s + ls.amount, 0);
      });

      // ── Combined look-ahead: one-time DB expenses + car down payments + cycling excess ──
      // Comprehensive per-month expense figure for the look-ahead — mirrors Forecast.tsx's own
      // totalOut (baseExpenses + savings/car contributions + vehicle insurance + projected car
      // loan + mortgage + lump-sum transfers), minus the REVOLVING debt payment itself (tracked
      // separately by computeFloorProtection — cycling-card statement payments are mandatory and
      // non-negotiable, so they belong here as an expense, not as part of the reducible revolving
      // allocation; this mirrors Forecast.tsx's own rawDebtPayment, which already includes cycling
      // via allPaymentTotals). For m>0, simulationMonthEvents[m].expenses already folds in goal/
      // car-fund monthly contributions and the active car loan's regular payment, so only the
      // categories that engine doesn't know about need to be added here. Month 0 intentionally
      // stays m0Expenses-only — its own minimum-protection path (cashPreDebt, further below)
      // already accounts for monthlySavingsAndCar/vehicle/mortgage/cycling precisely; duplicating
      // that here would only affect maxDebtPaymentByMonth[0]'s cap, not the displayed recommendation.
      const comprehensiveMExp = (m: number, cyclingPaymentByMonth: number[]): number =>
        m === 0
          ? m0Expenses
          : (simulationMonthEvents[m]?.expenses ?? monthlyExpenses)
            + getVehicleExtrasForMonth(m) + monthlyMortgagePayment + lumpTransferByMonth[m] + carLoanLumpByMonth[m]
            + cyclingPaymentByMonth[m];

      // No longer gated behind a flagged "large event" — every month's floor breach must be
      // protected, not just ones traceable to a recorded one-time expense, car down payment, or
      // cycling-card statement spike. The previous event-gated version left maxDebtPaymentByMonth
      // at Infinity for any breach caused purely by ongoing cash-flow accumulation (e.g. heavy
      // mortgage/insurance/regular bills with no single flagged event), which is exactly the case
      // that regressed when Forecast.tsx's own general-purpose PASS-2 was removed in its place.
      //
      // The actual reserve calculation lives in src/lib/floor-protection.ts, shared with
      // Forecast.tsx's own independent call to the same function (each builds its own per-month
      // arrays from its own model) — see that file for why sharing the algorithm but not the
      // data matters here. Takes the per-month floor and per-month cycling payment as parameters
      // (rather than closing over fixed arrays) because both depend on the simulation's own
      // per-card state (getAugmentedMinSafeCash needs minimum payments/revolving balances; the
      // cycling payment needs monthlyPayments) — see the iterative refinement below this
      // function for why it has to be callable more than once, each time against a fresher
      // simulation.
      const runLookAhead = (floorByMonth: number[], cyclingPaymentByMonth: number[], dynCyclingExcess: number[] = cyclingExcessByMonth) =>
        computeFloorProtection({
          incomeByMonth: Array.from({ length: 36 }, (_, m) => m === 0 ? m0Income : (simulationMonthEvents[m]?.income ?? monthlyTakeHome)),
          expenseByMonth: Array.from({ length: 36 }, (_, m) => comprehensiveMExp(m, cyclingPaymentByMonth)),
          oneTimeNetByMonth: Array.from({ length: 36 }, (_, m) => {
            if (m === 0) return 0;
            const ot = oneTimeArr[m] ?? { income: 0, expenses: 0 };
            return ot.income - ot.expenses;
          }),
          carDownPaymentByMonth: Array.from({ length: 36 }, (_, m) => m === 0 ? 0 : carDownPaymentByMonth[m]),
          floorByMonth,
          startingBalance: debtFundingBalance,
          ccMinTotal,
          cyclingExcessByMonth: dynCyclingExcess,
          carFunds, transactions, ccSourceIds, now, formatCurrency,
        });

      // Merge car DP into one-time expenses so simulateVariablePayoff deducts it from
      // currentCash in the DP month — without this the simulation overstates available
      // cash in every month after the purchase, causing floor breaches downstream.
      const oneTimeArrWithDP = oneTimeArr.map((ot, i) =>
        i === 0 || carDownPaymentByMonth[i] === 0
          ? ot
          : { income: ot.income, expenses: ot.expenses + carDownPaymentByMonth[i] },
      );

      // getAugmentedMinSafeCash needs a card-minimum-payment trajectory (which cards still have a
      // revolving balance, and what their minimum is, per month) — that only exists once a
      // simulation has actually run. Compute it fresh against whichever sim is passed in so each
      // outer-pass iteration below uses an up-to-date floor as cards pay off / drop out.
      const computeAugmentedFloor = (simResult: { monthlyRevolvingBalances: Map<string, number[]>; perCardMinPayments: Map<string, number[]> }): number[] =>
        Array.from({ length: 36 }, (_, m) => {
          const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
          return getAugmentedMinSafeCash(
            rules, payConfig, debtPayoffOptions.cashFloor, resolvedDebtFundingId, d,
            carFunds, { simCards: cards, monthlyRevolvingBalances: simResult.monthlyRevolvingBalances, perCardMinPayments: simResult.perCardMinPayments }, m,
          ).monthMinSafe;
        });

      // Full cycling-card statement payment per month (not just the excess over baseline) —
      // mirrors Forecast.tsx's rawDebtPayment, which already includes this via allPaymentTotals,
      // and this hook's own month-0 cyclingPayment (allPaymentTotals[0] - debtPaymentTotals[0]),
      // generalized to any month and any simulation pass. Without this, the look-ahead's cash
      // model never accounted for a cycling card's routine statement payment at all — only the
      // unusual excess — making it think more cash was available than Forecast's own model did.
      //
      // A currently-revolving card (c.balance > 0) only gets counted here once trustSimTiming
      // is true — i.e. once simResult comes from an already-CAPPED pass (outer >= 1 below), never
      // the uncapped bootstrap. The bootstrap throws all available cash at debt with no regard
      // for future months, so it pays off small/medium revolving balances far faster than a
      // properly-capped run ever would. Trusting that timing would misclassify the card's ongoing
      // purchases as a "mandatory cycling payment" instead of its real, reducible minimum-payment
      // allocation — inflating the apparent shortfall and triggering far more save-up than
      // actually needed, for every card the bootstrap happened to rush, not just the one we're
      // trying to fix. Once a capped pass exists, its payoff timing reflects the same save-up-aware
      // trajectory the rest of the system already trusts, so the card's eventual transition to
      // cycling mode (and the statement payment that comes with it) can be trusted too.
      const computeCyclingPaymentByMonth = (
        simResult: { monthlyPayments: Map<string, number[]>; monthlyRevolvingBalances: Map<string, number[]> },
        trustSimTiming: boolean,
      ): number[] =>
        Array.from({ length: 36 }, (_, m) =>
          cards.reduce((s, c) => {
            if (c.balance <= 0) {
              return s + (simResult.monthlyPayments.get(c.id)?.[m] ?? 0);
            }
            if (!trustSimTiming) return s;
            if (c.paymentPreference === null && !c.autopayFullBalance) return s;
            const revBals = simResult.monthlyRevolvingBalances.get(c.id);
            if ((revBals?.[m] ?? 1) > 0) return s;
            // Exclude the transition month itself: revBal[m]=0 but still revolving in m-1 means
            // this month's payment is the revolving payoff, already accounted for elsewhere.
            if (m > 0 && (revBals?.[m - 1] ?? 1) > 0) return s;
            if (m === 0) return s;
            return s + Math.max(cardPurchasesPerMonth[m - 1]?.[c.id] ?? 0, c.monthlyNewPurchases);
          }, 0),
        );

      // Dynamic cycling excess (for save-up reason labeling) — same cycling detection and same
      // trustSimTiming gate as computeCyclingPaymentByMonth, but only the excess above baseline
      // new purchases.
      const computeCyclingExcessByMonth = (
        simResult: { monthlyRevolvingBalances: Map<string, number[]> },
        trustSimTiming: boolean,
      ): number[] =>
        Array.from({ length: 36 }, (_, m) => {
          if (m === 0) return 0;
          const purchaseMonth = m - 1;
          return cards.reduce((s, c) => {
            if (c.paymentPreference !== 'statement' && c.paymentPreference !== 'full' && !c.autopayFullBalance) return s;
            if (c.balance > 0) {
              if (!trustSimTiming) return s;
              const revBals = simResult.monthlyRevolvingBalances.get(c.id);
              if ((revBals?.[purchaseMonth] ?? 1) > 0) return s;
              if (purchaseMonth > 0 && (revBals?.[purchaseMonth - 1] ?? 1) > 0) return s;
            }
            const purchased = cardPurchasesPerMonth[purchaseMonth]?.[c.id] ?? c.monthlyNewPurchases;
            return s + Math.max(0, purchased - c.monthlyNewPurchases);
          }, 0);
        });

      // ── Run CC simulation ─────────────────────────────────────────────────────
      // Bootstrap pass: uncapped, bare floor — just to get an initial card-minimum-payment /
      // revolving-balance trajectory so the augmented floor below has something to work from.
      let sim = simulateVariablePayoff(
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
        m0Expenses + (planCashExpensesEarly[0] ?? 0),
        oneTimeArrWithDP,
        m0SafeFloor,
        undefined,
        cashFloorByMonth,
      );

      // Outer refinement: each pass computes the augmented floor (the same getAugmentedMinSafeCash
      // floor Forecast's PASS-2 and pass3RevTotals use, which needs a card-minimum-payment
      // trajectory — i.e. needs a sim to already exist) from the previous pass's sim, re-runs the
      // look-ahead against that floor, then re-runs the simulation with the resulting caps. Three
      // passes converge quickly in practice — a card's minimum-due/payoff-month transitions are
      // coarse and rarely shift between passes — and bring this look-ahead's breach detection to
      // parity with Forecast's own floor instead of the narrower bare one.
      let augmentedCashFloorByMonth = cashFloorByMonth;
      let lookAhead = runLookAhead(cashFloorByMonth, Array(36).fill(0));
      for (let outer = 0; outer < 3; outer++) {
        augmentedCashFloorByMonth = computeAugmentedFloor(sim);
        // sim is the bootstrap (uncapped) on outer===0 and a properly-capped pass on outer>=1 —
        // only trust its per-month revolving-balance trajectory for future-cycling detection
        // once it's capped (see computeCyclingPaymentByMonth's comment for why).
        const trustSimTiming = outer > 0;
        const cyclingPaymentByMonth = computeCyclingPaymentByMonth(sim, trustSimTiming);
        const dynCyclingExcess = computeCyclingExcessByMonth(sim, trustSimTiming);
        lookAhead = runLookAhead(augmentedCashFloorByMonth, cyclingPaymentByMonth, dynCyclingExcess);
        sim = simulateVariablePayoff(
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
          m0Expenses + (planCashExpensesEarly[0] ?? 0),
          oneTimeArrWithDP,
          m0SafeFloor,
          lookAhead.maxDebtPaymentByMonth,
          augmentedCashFloorByMonth,
        );
      }
      const { maxDebtPaymentByMonth, saveUpMonths, strictSaveUpMonths, saveUpReason } = lookAhead;

      // Only count payments where the card is carrying actual revolving debt.
      // Cycling cards (autopay cards, statement-pref cards after revolving clears) have
      // monthlyRevolvingBalances === 0 — their mandatory payment is tracked separately via
      // allPaymentTotals/cyclingPayment, not here. Including them would inflate simRevTotal
      // in pass-3, making p3RevBal hit 0 too early, which scales all subsequent revolving
      // payments to 0.
      // Computed directly from a sim's own outputs (not via a projectCardVariable replay) so
      // this never depends on the balance/cycling display table (`data`) — that table is
      // built later, from perCardPaymentsScaled, and must not be a prerequisite for it.
      const computeDebtPaymentTotals = (
        simResult: { monthlyPayments: Map<string, number[]>; monthlyRevolvingBalances: Map<string, number[]> },
      ): number[] =>
        Array.from({ length: 36 }, (_, i) =>
          cards.reduce((total, c) => {
            // Use START-of-month revolving balance so the month a revolving card clears its
            // balance still counts as revolving, not cycling. End balance = 0 on the clearing
            // month would misclassify the payoff payment as cycling, bypassing the floor in
            // Forecast PASS 3 (cyclingPayment is non-negotiable; it skips availableForRevolving).
            // For m=0 use end balance (live state — cycling cards already show end=0 here).
            // For m>0 use previous month's end = this month's start.
            const startRevBal = i === 0
              ? (simResult.monthlyRevolvingBalances.get(c.id)?.[0] ?? 0)
              : (simResult.monthlyRevolvingBalances.get(c.id)?.[i - 1] ?? 0);
            if (startRevBal <= 0) return total;
            return total + (simResult.monthlyPayments.get(c.id)?.[i] ?? 0);
          }, 0),
        );
      let debtPaymentTotals = computeDebtPaymentTotals(sim);

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
      // Mirrors Forecast.tsx's vehicleProjections.contrib formula exactly (purchaseMonthIdx-based
      // denominator, linked_rule_id-gated skip) so the two pipelines never drift apart again.
      // linked_account is ignored when it equals the funding account itself — that balance is
      // already counted as available cash elsewhere, so treating it as "already saved" would
      // double-count the same dollars instead of protecting them for the upcoming purchase.
      const carReserve = pauseSavings ? 0 : (carFunds as any[]).reduce((s: number, c: any) => {
        if (c.phase !== 'saving') return s;
        const linkedAcct = c.linked_account && c.linked_account !== resolvedDebtFundingId
          ? accountMap.get(c.linked_account) : null;
        const effectiveSaved = linkedAcct ? Number(linkedAcct.balance) : Number(c.current_saved || 0);
        const giftAdjDownPmt = Math.max(0, Number(c.down_payment_goal) - Number(c.gift_contribution || 0));
        const rem = Math.max(0, giftAdjDownPmt - effectiveSaved);
        let purchaseMonthIdx: number;
        if (c.planned_purchase_date) {
          const parts = (c.planned_purchase_date as string).split('-').map(Number);
          const pd = new Date(parts[0], parts[1] - 1, parts[2]);
          purchaseMonthIdx = Math.max(0, (pd.getFullYear() - now.getFullYear()) * 12 + (pd.getMonth() - now.getMonth()));
        } else if (rem > 0) {
          const bootstrapContrib = Math.min(rem / 12, 500);
          purchaseMonthIdx = bootstrapContrib > 0 ? Math.ceil(rem / bootstrapContrib) : Infinity;
        } else {
          purchaseMonthIdx = 0;
        }
        const contrib = (c.linked_account && c.linked_rule_id) ? 0
          : (rem > 0 && isFinite(purchaseMonthIdx) ? Math.min(rem / (purchaseMonthIdx + 1), rem) : 0);
        return s + contrib;
      }, 0);
      const carReserveEvent = pauseSavings ? null : (carFunds as any[]).find((c: any) => {
        if (c.phase !== 'saving') return false;
        const linkedAcct = c.linked_account && c.linked_account !== resolvedDebtFundingId
          ? accountMap.get(c.linked_account) : null;
        const effectiveSaved = linkedAcct ? Number(linkedAcct.balance) : Number(c.current_saved || 0);
        const rem = Math.max(0, Number(c.down_payment_goal) - Number(c.gift_contribution || 0) - effectiveSaved);
        return rem > 0 && !(c.linked_account && c.linked_rule_id);
      });
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
        const mOneTimeNet = m === 0 ? 0 : (oneTimeArr[m]?.expenses ?? 0) - (oneTimeArr[m]?.income ?? 0);
        const mExp   = (m === 0 ? m0Expenses + monthlySavingsAndCar
          : (simulationMonthEvents[m]?.expenses ?? monthlyExpenses) + (carDownPaymentByMonth[m] ?? 0))
          + getVehicleExtrasForMonth(m) + monthlyMortgagePayment + lumpTransferByMonth[m] + carLoanLumpByMonth[m] + mOneTimeNet;
        // Augmented (not bare cashFloorByMonth) so this matches the floor Forecast.tsx uses for
        // the same month — otherwise pass3RevTotals (which scales the displayed per-card amounts
        // for months 1+) and Forecast's own Ending Cash walk cap debt payments differently.
        const mFloor = getAugmentedMinSafeCash(
          rules, payConfig, debtPayoffOptions.cashFloor, resolvedDebtFundingId,
          new Date(now.getFullYear(), now.getMonth() + m, 1),
          carFunds, { simCards: cards, monthlyRevolvingBalances: sim.monthlyRevolvingBalances, perCardMinPayments: sim.perCardMinPayments }, m,
        ).monthMinSafe;
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
        if (!strictSaveUpMonths.has(m) && p3RevBal > 0 && p3Cash > mFloor) {
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
          augmentedCashFloorByMonth,
        );
        perCardPayments = cards.map(c => ({
          name: c.name, id: c.id,
          payments: Array.from({ length: 36 }, (_, i) =>
            Math.round(sim2.monthlyPayments.get(c.id)?.[i] ?? 0),
          ),
        }));
        activeSim = sim2;

        // allPaymentTotals and debtPaymentTotals must reflect sim2 from here on — pass3RevTotals
        // below and every later PASS-3-driven scaling step needs the capped-retry's numbers,
        // not the original uncapped sim's. The balance/cycling display table (`data`) doesn't
        // exist yet at this point (built later from activeSim + perCardPaymentsScaled), so it
        // needs no patching here.
        for (let i = 0; i < 36; i++) {
          allPaymentTotals[i] = cards.reduce((total, card) =>
            total + (sim2.monthlyPayments.get(card.id)?.[i] ?? 0), 0);
        }
        debtPaymentTotals = computeDebtPaymentTotals(sim2);

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
          const mOneTimeNet2 = m === 0 ? 0 : (oneTimeArr[m]?.expenses ?? 0) - (oneTimeArr[m]?.income ?? 0);
          const mExp2   = (m === 0 ? m0Expenses + monthlySavingsAndCar
            : (simulationMonthEvents[m]?.expenses ?? monthlyExpenses) + (carDownPaymentByMonth[m] ?? 0))
            + getVehicleExtrasForMonth(m) + monthlyMortgagePayment + mOneTimeNet2;
          const mFloor2 = getAugmentedMinSafeCash(
            rules, payConfig, debtPayoffOptions.cashFloor, resolvedDebtFundingId,
            new Date(now.getFullYear(), now.getMonth() + m, 1),
            carFunds, { simCards: cards, monthlyRevolvingBalances: sim2.monthlyRevolvingBalances, perCardMinPayments: sim2.perCardMinPayments }, m,
          ).monthMinSafe;
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
          if (!strictSaveUpMonths.has(m) && p3RevBal2 > 0 && p3Cash2 > mFloor2) {
            surplus2 = Math.min(p3Cash2 - mFloor2, p3RevBal2);
            p3Cash2 -= surplus2;
            p3RevBal2 = Math.max(0, p3RevBal2 - surplus2);
          }
          pass3RevTotals.push(Math.round(revPay2 + surplus2));
        }
      }

      // ── PASS-3 single source of truth ───────────────────────────────────────────
      // pass3RevTotals is the per-month, floor-protected, revolving-only target. Re-run the
      // engine once more with that target as its actual cap (maxDebtPaymentByMonth) instead of
      // treating it as a separate post-hoc scale factor applied after the fact — the same
      // mechanism the m0TotalBudget retry above already uses for month 0, extended to every
      // month. The engine's own minimum-then-cascade logic (Step 5a/5b) redistributes the
      // tightened total across cards correctly — accounting for interest, new purchases, and the
      // statement-preference cap — instead of a separate reconciliation layer approximating it.
      // This makes the cycling/revolving ground-truth signal (monthlyRevolvingBalances) and the
      // displayed/applied payment (monthlyPayments) the SAME map: a card can no longer be
      // declared "cleared" by one number while being paid a different one.
      //
      // lastRevPayMonth: last month where pass-3 made a live revolving payment. After this month,
      // pass3RevTotals[m] = 0 because the live revolving pool is exhausted — NOT because cash is
      // constrained. In those months the ground-truth sim may still show revolving activity (new
      // purchases re-inflating a balance pass-3's pooled tracker never re-seeds), so the cap must
      // fall back to the ground-truth number past this point instead of hard-capping at 0.
      const lastRevPayMonth = pass3RevTotals.reduce((last, t, i) => t > 0 ? i : last, -1);
      const sim3Cap = pass3RevTotals.map((v, m) => (m <= lastRevPayMonth ? v : debtPaymentTotals[m]));
      const sim3 = simulateVariablePayoff(
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
        m0Expenses + (planCashExpensesEarly[0] ?? 0),
        oneTimeArrWithDP,
        m0SafeFloor,
        sim3Cap,
        augmentedCashFloorByMonth,
      );
      activeSim = sim3;
      perCardPayments = cards.map(c => ({
        name: c.name, id: c.id,
        payments: Array.from({ length: 36 }, (_, i) => Math.round(sim3.monthlyPayments.get(c.id)?.[i] ?? 0)),
      }));
      for (let i = 0; i < 36; i++) {
        allPaymentTotals[i] = cards.reduce((total, card) => total + (sim3.monthlyPayments.get(card.id)?.[i] ?? 0), 0);
      }
      debtPaymentTotals = computeDebtPaymentTotals(sim3);

      // sim3's own cascade already redistributed pass3RevTotals across cards correctly — no
      // separate scaling/reconciliation pass needed; activeSim.monthlyPayments IS the
      // recommended per-card payment.
      const perCardPaymentsScaled = perCardPayments;

      // ── Derived display arrays ──────────────────────────────────────────────────
      // Built from perCardPaymentsScaled (the final, cash-floor-protected recommended
      // payment) and activeSim — NOT a raw sim's payments — so the balance/cycling table
      // Forecast's popup and the Debt Payoff chart read never assumes a bigger payment was
      // made than what's actually recommended everywhere else in the UI. Must run after
      // perCardPaymentsScaled/activeSim are both final; debtPaymentTotals above was
      // deliberately decoupled from this table so it could be computed earlier without
      // circularity.
      const projs = cards.map(c => {
        const pays = perCardPaymentsScaled.find(p => p.id === c.id)?.payments || [];
        const revBals = activeSim.monthlyRevolvingBalances.get(c.id) || [];
        // Real per-month purchases for this card (one-time transactions + payment plans +
        // scheduled rules), not the undefined default that made projectCardVariable fall back
        // to card.monthlyNewPurchases — a static average baseline. That fallback made a cycling
        // card's displayed end balance (data[i][card.name], what Forecast's popup shows) ignore
        // real one-time purchases and payment-plan charges entirely once the card had no
        // revolving balance, even though the simulation/Debt Payoff tab already paid them
        // correctly on the normal 1-cycle delay.
        const purchases = cardPurchasesPerMonth.map(monthMap => monthMap[c.id] ?? 0);
        return projectCardVariable(c, pays, 36, true, purchases, revBals);
      });

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
          cards.reduce((s, c) => s + (activeSim.monthlyRevolvingBalances.get(c.id)?.[i] ?? 0), 0),
        ));
        let displayBal = 0;
        for (const card of cards) {
          const simBal = activeSim.monthlyBalances.get(card.id)?.[i] ?? 0;
          if (simBal > 0) displayBal += simBal;
          else if (card.paymentPreference === 'full' || card.paymentPreference === 'statement') displayBal += card.monthlyNewPurchases;
        }
        row.displayCCBalance = Math.round(Math.max(0, displayBal));
        row.totalInterest = Math.round(row.totalInterest);
        row.utilization = totalLimit > 0 ? Math.round((row.totalCCBalance / totalLimit) * 100) : 0;
        return row;
      });

      // ── month0 computation ────────────────────────────────────────────────────
      const cyclingPayment = Math.max(0, allPaymentTotals[0] - debtPaymentTotals[0]);
      const simRevolvingTotal = debtPaymentTotals[0];

      // activeSim (not sim) — this is what the hook actually returns/Dashboard and Forecast
      // display (monthlyRevolvingBalances/perCardMinPayments below are activeSim's). When the
      // capped-retry (sim2) triggers, sim and activeSim can disagree on which cards are still
      // revolving at month 0; using sim here would cap cashPreDebt against a floor that doesn't
      // match what's displayed, reopening the exact mismatch the floor unification fixed.
      const liveRevolvingBal = cards.reduce((s, c) => {
        const revBal0 = activeSim.monthlyRevolvingBalances.get(c.id)?.[0] ?? 1;
        if (revBal0 === 0) return s;
        const acct = (accounts as any[]).find((a: any) => a.id === c.id);
        return s + (acct ? Number(acct.balance || 0) : 0);
      }, 0);

      const ccMinTotalRevolving = cards
        .filter(c => {
          const revBal0 = activeSim.monthlyRevolvingBalances.get(c.id)?.[0] ?? 1;
          return revBal0 > 0;
        })
        .reduce((s, c) => s + c.minPayment, 0);

      // Floor used to cap month-0 payment capacity — augmented with active car-loan payments
      // and CC minimums (same function Dashboard/Forecast use to display "Cash floor") so the
      // cap here always matches what the user sees, instead of the bare pre-paycheck-bills floor.
      const m0FloorAugmented = getAugmentedMinSafeCash(
        rules, payConfig, debtPayoffOptions.cashFloor, resolvedDebtFundingId, now,
        carFunds, { simCards: cards, monthlyRevolvingBalances: activeSim.monthlyRevolvingBalances, perCardMinPayments: activeSim.perCardMinPayments }, 0,
      ).monthMinSafe;

      // Vehicle insurance/projected loan and mortgage for month 0 — reuses the per-month
      // helpers defined above (which pass3RevTotals also uses) so month 0 and every later
      // month are computed identically.
      const m0VehicleInsurance = getVehicleExtrasForMonth(0);
      const m0MortgagePayment = monthlyMortgagePayment;

      const ccMinForMonth = liveRevolvingBal > 0 ? Math.min(ccMinTotalRevolving, simRevolvingTotal) : 0;
      const cashPreDebt = debtFundingBalance + m0Income - m0Expenses - monthlySavingsAndCar - m0VehicleInsurance - m0MortgagePayment;
      const availableForRevolving = liveRevolvingBal > 0
        ? Math.max(ccMinForMonth, Math.max(0, cashPreDebt - m0FloorAugmented - cyclingPayment))
        : 0;
      const revolvingPayment = liveRevolvingBal > 0 ? Math.min(simRevolvingTotal, availableForRevolving) : 0;
      const safeToPayTotal = cyclingPayment + revolvingPayment;

      // Max capacity: cash headroom above safeToPayTotal that's being held back this month
      // (e.g. for a save-up event). Must be computed even when month 0 IS a save-up month —
      // that's exactly when revolvingPayment is capped below available cash and a holdback exists.
      const surplusIfFree = liveRevolvingBal > 0
        ? Math.max(0, Math.min(cashPreDebt - cyclingPayment - revolvingPayment - m0FloorAugmented, liveRevolvingBal))
        : 0;
      const maxCapacity = safeToPayTotal + surplusIfFree;
      const holdback = Math.max(0, maxCapacity - safeToPayTotal);
      const holdbackEvent = holdback > 0 && saveUpReason.has(0) ? (saveUpReason.get(0) ?? null) : null;

      // Per-card adjusted amounts (revolving cards scaled; cycling cards kept full).
      // Use activeSim (sim2 when triggered, sim1 otherwise) for both numerator and scale
      // denominator so the per-card revolving amounts sum exactly to revolvingPayment.
      // When sim2 is triggered it caps month-0 total, so using sim1 numerator with the
      // sim2-updated simRevolvingTotal denominator would over-allocate revolving cards.
      // Scaling the combined revolvingPayment down uniformly across cards (a flat percentage)
      // can push an individual card below its own minimum even though the combined total still
      // covers every card's minimum in aggregate — e.g. Discover's natural payment is already
      // close to its minimum, so any uniform scale-down sends it under. Protect each revolving
      // card's own minimum first, then distribute only the leftover ("discretionary") pool
      // proportionally across each card's natural payment above its own minimum.
      const ccMinSumActive = cards.reduce((s, c) => {
        const revBal0 = activeSim.monthlyRevolvingBalances.get(c.id)?.[0] ?? 1;
        return revBal0 > 0 ? s + c.minPayment : s;
      }, 0);
      const discretionaryPool = Math.max(0, revolvingPayment - ccMinSumActive);
      const naturalExtraTotal = cards.reduce((s, c) => {
        const revBal0 = activeSim.monthlyRevolvingBalances.get(c.id)?.[0] ?? 1;
        if (revBal0 === 0) return s;
        const activeSimPay = Math.round(activeSim.monthlyPayments.get(c.id)?.[0] ?? 0);
        return s + Math.max(0, activeSimPay - c.minPayment);
      }, 0);
      const perCardAdjusted = cards.map(c => {
        const revBal0 = activeSim.monthlyRevolvingBalances.get(c.id)?.[0] ?? 1;
        const isCycling = revBal0 === 0;
        const activeSimPay = Math.round(activeSim.monthlyPayments.get(c.id)?.[0] ?? 0);
        const perCardEntry = perCardPayments.find(p => p.id === c.id);
        const cyclingPay = perCardEntry?.payments[0] ?? activeSimPay;
        let payment: number;
        if (isCycling) {
          payment = cyclingPay;
        } else {
          const extra = Math.max(0, activeSimPay - c.minPayment);
          const extraShare = naturalExtraTotal > 0 ? discretionaryPool * (extra / naturalExtraTotal) : 0;
          payment = Math.round(Math.min(activeSimPay, c.minPayment + extraShare));
        }
        return {
          id: c.id,
          name: c.name,
          payment,
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
        monthlyBalances: activeSim.monthlyBalances,
        perCardMinPayments: activeSim.perCardMinPayments,
        m0Income,
        m0Expenses,
        m0SafeFloor,
        saveUpMonths,
        strictSaveUpMonths,
        saveUpReason,
        month0: {
          safeToPayTotal: Math.round(safeToPayTotal),
          maxCapacity: Math.round(maxCapacity),
          holdback: Math.round(holdback),
          holdbackEvent,
          cyclingPayment: Math.round(cyclingPayment),
          revolvingPayment: Math.round(revolvingPayment),
          perCardAdjusted,
          m0SafeFloor: Math.round(m0FloorAugmented),
          carReserve: Math.round(carReserve),
          carReserveEvent: carReserveEvent ? { vehicleName: carReserveEvent.vehicle_name as string } : null,
          vehicleInsurance: Math.round(m0VehicleInsurance),
          mortgagePayment: Math.round(m0MortgagePayment),
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
