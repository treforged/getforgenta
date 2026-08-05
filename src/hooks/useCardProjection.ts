import { useMemo } from 'react';
import { formatCurrency } from '@/lib/calculations';
import { attachSimDebug } from '@/lib/simDebug';
import {
  buildCardData, simulateVariablePayoff, projectCardVariable, buildPaymentLedger,
  CC_DEFAULT_CATEGORIES, CardData, PROJECTION_MONTHS, revolvingMinDue, m0MinDueSettled,
} from '@/lib/credit-card-engine';
import { buildResimOverrides } from './cardProjectionResim';
import type { PaymentLedgerEntry } from '@/lib/credit-card-engine';
import { PaymentPlan, getMonthlyPlanCashExpenses, getPaymentDates, deriveUpfrontPlanFields } from '@/lib/payment-plan-generator';
import {
  PayScheduleConfig, getMinSafeCash, getAugmentedMinSafeCash,
  getNormalizedMonthNetIncome, getMonthNetIncome,
} from '@/lib/pay-schedule';
import { countRuleOccurrencesInMonth } from '@/lib/scheduling';
import { computeBonusAndTax, computeAnnualFederalWithheld } from '@/lib/income-model';
import type { FilingStatus } from '@/lib/tax-estimator';
import { getTotalCarLoanMonthly, calculateScheduledPayment, getLoanPrincipal, monthsBetween, buildAmortizationSchedule, getCarFundEarmark } from '@/lib/vehicle-loan-engine';
import { isCapturedInBalance, dueDateInMonth } from '@/lib/sync-cutoff';
import { computeFloorProtection } from '@/lib/floor-protection';
import { FUNDING_ACCOUNT_TYPES, resolveFundingAccountId } from '@/lib/funding-account';
import { firstRevolvingPayoffMonth, REVOLVING_DUST_DOLLARS } from '@/lib/revolving-payoff';
import type { Tables } from '@/integrations/supabase/types';
import type { AccountRow, RuleRow, DebtRow } from '@/hooks/useSupabaseData';
import type { EnrichedTransaction } from '@/lib/pay-schedule';
import type { ScheduledEvent } from '@/lib/scheduling';
import type { CarFund } from '@/lib/types';
// Moved to a shared lib module (Stage 1, .claude/plan/unify-cycling-model.md) so pure lib code
// can reference these shapes without importing from a hook. Re-exported here unchanged so
// existing `from '@/hooks/useCardProjection'` imports keep working.
import type { Month0Result, Month0CashChain, ProjectionDataRow, CardProjectionResult } from '@/lib/debt-model-types';
export type { Month0Result, Month0CashChain, ProjectionDataRow, CardProjectionResult };

export interface UseCardProjectionParams {
  accounts: AccountRow[];
  transactions: EnrichedTransaction[];
  rules: RuleRow[];
  debts: DebtRow[];
  goals: Partial<Tables<'savings_goals'>>[];
  carFunds: CarFund[];
  profile: Partial<Tables<'profiles'>>;
  debtPayoffOptions: { cashFloor: number };
  payConfig: PayScheduleConfig;
  /** Pre-computed scheduled events from generateScheduledEvents(rules, accounts, PROJECTION_MONTHS) */
  scheduledEvents: ScheduledEvent[];
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
    // Tax-estimator identity inputs — mirror the engine so the sim runs the same estimator
    // (omitting these made the sim skip the tax-return injection entirely). Optional: default to
    // DEFAULT_ASSUMPTIONS values inside computeBonusAndTax when a caller doesn't supply them.
    taxReturnFilingStatus?: FilingStatus;
    taxReturnDependents?: number;
    taxReturnState?: string;
    taxReturnFederalWithheld?: number;
    promotions?: { id: string; effectiveDate: string; newAnnualSalary: number }[];
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
      const rawCards = buildCardData(accounts, transactions, rules, debts);
      if (rawCards.length === 0) return null;

      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      // ── Plan-derived installment fields (upfront plans override manual Accounts tab fields) ──
      // Shared derivation (deriveUpfrontPlanFields) — the SAME function CreditCardEngine.tsx's
      // internal sim uses, so both tabs model card-charged upfront plans identically. Installment
      // due dates are anchored to the card's due date one full statement cycle after the purchase
      // (purchased Jun 23, due day 7 → first installment Aug 7), NOT the purchase date — anchoring
      // at start_date counted installments as paid before they were ever due, which understated
      // the 0% carve-out and leaked plan principal into the revolving balance at the card's full
      // APR (the avalanche then flooded that phantom high-APR debt with surplus while real
      // interest-accruing cards sat at their minimums).
      // payment_source values in payment_plans are stored as 'account:UUID' (from
      // paymentSourceOptions); deriveUpfrontPlanFields normalizes both forms internally.
      const sourceToCardId = new Map<string, string>(
        rawCards.flatMap(c => [[c.id, c.id], [`account:${c.id}`, c.id]]),
      );
      const { installmentByCard, upfrontPayByMonth } = deriveUpfrontPlanFields(
        rawCards, paymentPlans ?? [], PROJECTION_MONTHS, now, syncCutoffDate,
      );
      const cards = rawCards.map(card => {
        const derived = installmentByCard.get(card.id);
        return {
          ...card,
          // Q11: a card whose current-month due date is already inside the sync cutoff has paid
          // this cycle's minimum (the live balance reflects it) — month 0 must not force it again.
          m0MinSettled: m0MinDueSettled(card.dueDay, syncCutoffDate, now),
          ...(derived ? {
            installmentBalance: derived.balance,
            installmentMonthlyPayment: derived.monthlyPayment,
          } : {}),
        };
      });

      const accountMap = new Map<string, AccountRow>(accounts.map(a => [a.id, a]));

      // ── Funding account resolution (mirrors cardProjectionData) ──────────────
      const liquidCash = accounts
        .filter(a => a.active && FUNDING_ACCOUNT_TYPES.includes(a.account_type))
        .reduce((s, a) => s + Number(a.balance), 0);
      // Finding §2.8: `persistedDebtFundingId` is localStorage, so it can name an account that no
      // longer exists (deleted/disconnected) or, in demo mode, a real account's UUID. Taking it on
      // faith made every cash expense rule look "paid from another account" — month-0 expenses read
      // $0 and the cash floor collapsed to its base. Resolve against the real account list and fall
      // through to the profile default; `null` (no exclusion) is the safe end state. See
      // `src/lib/funding-account.ts`.
      const resolvedDebtFundingId = resolveFundingAccountId(
        accounts, persistedDebtFundingId, forecastFundingAccountId,
      );
      const debtFundingAccount = accounts.find(a => a.active && a.id === resolvedDebtFundingId);
      // Already-saved/gifted down-payment money sitting in this same account is still "available
      // cash" by default — earmark it out so it isn't offered up for CC paydown while it's spoken
      // for. Disappears on its own once a car fund's phase flips to 'loan' (see getCarFundEarmark).
      const debtFundingBalance = Math.max(0, (debtFundingAccount ? Number(debtFundingAccount.balance) : liquidCash)
        - getCarFundEarmark(carFunds, resolvedDebtFundingId));

      // ── Scalar fallbacks ──────────────────────────────────────────────────────
      const monthlyTakeHome = getNormalizedMonthNetIncome(payConfig);
      const ccSourceIdsForScalar = new Set(cards.flatMap(c => [c.id, `account:${c.id}`]));
      // Month 0: only count plan payments after syncCutoffDate — earlier ones are already
      // reflected in the current bank balance. Months 1+: all payments in that month.
      const planCashExpensesEarly = Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        return getMonthlyPlanCashExpenses(
          paymentPlans ?? [], d.getFullYear(), d.getMonth(), ccSourceIdsForScalar,
          i === 0 ? syncCutoffDate : undefined,
        );
      });

      // ── BNPL installment charges per card per month (monthly_charge plans) ───────────────
      // These charges are already included in cardPurchasesPerMonth via generatePaymentPlanTransactions.
      // The engine needs this separately to reserve a mandatory payment and exclude the charge
      // from the revolving cascade target (so it isn't double-counted as revolving debt).
      const installmentChargeByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
        const charges: { [cardId: string]: number } = {};
        for (const plan of paymentPlans ?? []) {
          if (!plan.active || plan.plan_type !== 'monthly_charge' || !plan.payment_source) continue;
          const cardId = sourceToCardId.get(plan.payment_source);
          if (!cardId) continue;
          const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
          const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          const dates = getPaymentDates(plan.start_date, plan.frequency, plan.total_payments);
          const chargesInMonth = dates.filter(date => date.startsWith(monthStr)).length;
          if (chargesInMonth > 0) {
            charges[cardId] = (charges[cardId] ?? 0) + chargesInMonth * plan.payment_amount;
          }
        }
        return charges;
      });
      const monthlyExpenses = rules.filter(r => {
        if (!r.active || r.rule_type !== 'expense') return false;
        if (r.payment_source && ccSourceIdsForScalar.has(r.payment_source)) return false;
        if (!r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category)) return false;
        // Paid from a different bank account entirely (not a CC, not the funding account) — that
        // money never touches the funding account, so it must not reduce its modeled cash either.
        if (r.payment_source && !ccSourceIdsForScalar.has(r.payment_source)) {
          const srcId = (r.payment_source as string).replace(/^account:/, '');
          if (resolvedDebtFundingId && srcId !== resolvedDebtFundingId) return false;
        }
        if (pauseSavings && (r.category === 'Savings' || r.category === 'Investing')) return false;
        return true;
      }).reduce((s, r) => {
        return s + Number(r.amount) * countRuleOccurrencesInMonth(r, now.getFullYear(), now.getMonth());
      }, 0) + (planCashExpensesEarly[0] ?? 0);

      // ── Per-card CC purchase map ──────────────────────────────────────────────
      const highestAprCardId = cards.length > 0
        ? [...cards].sort((a, b) => b.apr - a.apr)[0].id : null;
      const ccDefaultRuleIds = new Set<string>(
        rules.filter(r =>
          r.active && r.rule_type === 'expense' &&
          !r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category),
        ).map(r => r.id),
      );
      const cardRuleIdMap = new Map<string, Set<string>>(
        cards.map(c => {
          const cKey = `account:${c.id}`;
          const ids = new Set<string>(
            rules.filter(r =>
              r.active && r.rule_type === 'expense' &&
              (r.payment_source === c.id || r.payment_source === cKey),
            ).map(r => r.id),
          );
          if (c.id === highestAprCardId) ccDefaultRuleIds.forEach(id => ids.add(id));
          return [c.id, ids];
        }),
      );

      const cardPurchasesPerMonth: { [cardId: string]: number }[] = [];
      for (let i = 0; i < PROJECTION_MONTHS; i++) {
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
            const oneTimeCCAmt = transactions
              .filter(t =>
                !t.isGenerated &&
                t.date?.startsWith(monthKey) &&
                t.type === 'expense' &&
                (t.payment_source === card.id || t.payment_source === `account:${card.id}`),
              )
              .reduce((s, t) => s + Number(t.amount), 0);
            cardPurchases[card.id] = scheduledAmt + oneTimeCCAmt;
          }
        }
        cardPurchasesPerMonth.push(cardPurchases);
      }

      // ── CC-sourced payment plan charges per future month ──────────────────────
      // Plans paid via CC increase the card balance each month — inject as new
      // purchases so the payoff simulation sees the recurring balance growth.
      if (paymentPlans && paymentPlans.length > 0) {
        for (const plan of paymentPlans) {
          if (!plan.active || !plan.payment_source || plan.plan_type !== 'monthly_charge') continue;
          const cardId = sourceToCardId.get(plan.payment_source);
          if (!cardId) continue;
          const planDates = getPaymentDates(plan.start_date, plan.frequency, plan.total_payments);
          for (const date of planDates) {
            // Month 0: skip payments already reflected in the live CC balance
            if (date <= (syncCutoffDate ?? todayStr)) continue;
            const pd = new Date(date + 'T00:00:00');
            for (let mi = 0; mi < PROJECTION_MONTHS; mi++) {
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
      for (let oi = 1; oi < PROJECTION_MONTHS; oi++) {
        const od = new Date(now.getFullYear(), now.getMonth() + oi, 1);
        const omk = `${od.getFullYear()}-${String(od.getMonth() + 1).padStart(2, '0')}`;
        const txns = transactions.filter(t =>
          t.date && t.date.startsWith(omk) && !t.isGenerated,
        );
        const inc = txns
          .filter(t => t.type === 'income' && t.category !== 'Balance Adjustment')
          .reduce((s, t) => s + Number(t.amount), 0);
        const exp = txns
          .filter(t => {
            if (t.type !== 'expense') return false;
            if (t.category === 'Debt Payments' || t.category === 'Balance Adjustment') return false;
            if (t.payment_source && ccSourceIds.has(t.payment_source)) return false;
            return true;
          })
          .reduce((s, t) => s + Number(t.amount), 0);
        oneTimeArr.push({ income: inc, expenses: exp });
      }

      // ── Month 0 floor ──────────────────────────────────────────────────────────
      const m0SafeFloor = getMinSafeCash(rules, payConfig, debtPayoffOptions.cashFloor, resolvedDebtFundingId, now);
      const cashFloorByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, m) => {
        const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
        return getMinSafeCash(rules, payConfig, debtPayoffOptions.cashFloor, resolvedDebtFundingId, d);
      });

      // ── forecastMonthEvents (mirrors Forecast.tsx useMemo exactly) ────────────
      const liquidAccountIds = new Set<string>(
        accounts.filter(a => a.active && FUNDING_ACCOUNT_TYPES.includes(a.account_type)).map(a => a.id),
      );
      const incomeToLiquidRuleIds = new Set<string>(
        rules.filter(r =>
          r.active && r.rule_type === 'income' &&
          (!r.deposit_account || liquidAccountIds.has(r.deposit_account)),
        ).map(r => r.id),
      );
      const explicitPaycheckRuleId = profile?.paycheck_rule_id ?? undefined;
      const paycheckRuleIds = new Set<string>();
      if (explicitPaycheckRuleId) {
        paycheckRuleIds.add(explicitPaycheckRuleId);
      } else {
        rules.filter(r =>
          r.active && r.rule_type === 'income' &&
          ['weekly', 'biweekly', 'semi_monthly'].includes(r.frequency) &&
          (!r.deposit_account || liquidAccountIds.has(r.deposit_account)),
        ).forEach(r => paycheckRuleIds.add(r.id));
      }
      const ccPaymentSources = new Set<string>(
        accounts.filter(a => a.active && a.account_type === 'credit_card')
          .flatMap(a => [a.id, `account:${a.id}`]),
      );
      const ccExplicitRuleIds = new Set<string>(
        rules.filter(r =>
          r.active && r.rule_type === 'expense' &&
          r.payment_source && ccPaymentSources.has(r.payment_source),
        ).map(r => r.id),
      );
      const allCcRuleIds = new Set<string>([...ccExplicitRuleIds, ...ccDefaultRuleIds]);
      // Expense rules paid from a bank account other than the funding account (not a CC, already
      // excluded above) — that money never touches the funding account, so it must not reduce its
      // modeled cash flow. Mirrors Forecast.tsx's identical Set exactly (same logic, see its own
      // forecastMonthEvents) — keep the two in lockstep if this changes.
      const otherAccountRuleIds = new Set<string>(
        rules.filter(r => {
          if (!r.active || r.rule_type !== 'expense' || !r.payment_source) return false;
          if (ccPaymentSources.has(r.payment_source)) return false;
          if (!resolvedDebtFundingId) return false;
          const srcId = (r.payment_source as string).replace(/^account:/, '');
          return srcId !== resolvedDebtFundingId;
        }).map(r => r.id),
      );
      const savingsRuleIds = new Set<string>(
        rules.filter(r =>
          r.active && r.rule_type === 'expense' &&
          (r.category === 'Savings' || r.category === 'Investing'),
        ).map(r => r.id),
      );
      const ruleTaxRateMap = new Map<string, number>(
        rules.filter(r => r.rule_type === 'income' && r.tax_rate != null)
          .map(r => [r.id, Number(r.tax_rate)]),
      );
      const forecastMonthEvents = Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
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
            !(e.ruleId && otherAccountRuleIds.has(e.ruleId)) &&
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

      // Vehicle insurance + projected car loan for ANY month (mirrors Forecast.tsx's
      // vehicleProjections / getMonthVehicleInsurance / getMonthProjLoan). Moved here, before
      // simulationMonthEvents, so simulationMonthEvents' own .expenses (the array that actually
      // drives the real cash simulation, not just the secondary look-ahead cap) can include a
      // saving-phase car's projected future payment/insurance directly — previously only
      // comprehensiveMExp saw this, so the real simulation had no idea the cost was coming until
      // the literal month phase flipped to 'loan', producing an activation-time step-change in
      // recommended CC payments even when nothing about the car's numbers changed.
      const vehicleForecastByMonth = carFunds
        .filter(c => c.phase === 'saving')
        .map(c => {
          let purchaseMonthIdx = 0;
          if (c.planned_purchase_date) {
            const parts = (c.planned_purchase_date as string).split('-').map(Number);
            const pd = new Date(parts[0], parts[1] - 1, parts[2]);
            purchaseMonthIdx = Math.max(0, (pd.getFullYear() - now.getFullYear()) * 12 + (pd.getMonth() - now.getMonth()));
          }
          // getLoanPrincipal — same formula Forecast.tsx uses, and the same one loan-phase falls
          // back to via cf.loan_amount once activated. Keeping this in one place is what
          // guarantees the payment amount doesn't change at activation if nothing else did.
          const loanPrincipal = getLoanPrincipal(c);
          const projPayment = Number(c.expected_apr) > 0 && Number(c.loan_term_months) > 0 && loanPrincipal > 0
            ? calculateScheduledPayment(loanPrincipal, Number(c.expected_apr), Number(c.loan_term_months))
            : 0;
          // Payment/insurance anchor — derived from payment_start_date the same way
          // purchaseMonthIdx is derived from planned_purchase_date, falling back to
          // purchaseMonthIdx + 1 (the old implicit assumption) on pre-existing records that
          // predate requiring this field. Mirrors Forecast.tsx's paymentStartMonthIdx exactly.
          let paymentStartMonthIdx: number;
          if (c.payment_start_date) {
            const parts = (c.payment_start_date as string).split('-').map(Number);
            const psd = new Date(parts[0], parts[1] - 1, parts[2]);
            paymentStartMonthIdx = Math.max(0, (psd.getFullYear() - now.getFullYear()) * 12 + (psd.getMonth() - now.getMonth()));
          } else {
            paymentStartMonthIdx = purchaseMonthIdx + 1;
          }
          // Effective term — accounts for lump sums accelerating payoff, matching what the actual
          // loan-phase schedule (buildAmortizationSchedule) would show once activated. Without
          // this, the projected window always ran the full loan_term_months even when lump sums
          // pay the loan off earlier, disagreeing with the real schedule at activation.
          const effectiveTermMonths = (loanPrincipal > 0 && Number(c.expected_apr) >= 0 && Number(c.loan_term_months) > 0 && c.payment_start_date)
            ? buildAmortizationSchedule({
                loanAmount: loanPrincipal, apr: Number(c.expected_apr), termMonths: Number(c.loan_term_months),
                loanStartDate: c.planned_purchase_date ?? c.payment_start_date, paymentStartDate: c.payment_start_date,
                interestStartDate: c.payment_start_date, actualMonthlyPayment: 0,
                lumpSumPayments: c.lump_sum_payments ?? [],
              }).schedule.length
            : Number(c.loan_term_months) || 0;
          let insuranceStartMonthIdx = purchaseMonthIdx;
          if (c.insurance_start_date) {
            const parts = (c.insurance_start_date as string).split('-').map(Number);
            const isd = new Date(parts[0], parts[1] - 1, parts[2]);
            insuranceStartMonthIdx = Math.max(0, (isd.getFullYear() - now.getFullYear()) * 12 + (isd.getMonth() - now.getMonth()));
          }
          // Due days for month-0 syncCutoffDate gating in getVehicleExtrasForMonth.
          const paymentDueDay = c.payment_start_date ? new Date(c.payment_start_date + 'T00:00:00').getDate() : null;
          const insuranceDueDay = (c.insurance_start_date ?? c.planned_purchase_date)
            ? new Date((c.insurance_start_date ?? c.planned_purchase_date)! + 'T00:00:00').getDate() : null;
          return {
            purchaseMonthIdx, paymentStartMonthIdx, insuranceStartMonthIdx, projPayment, termMonths: effectiveTermMonths, insurance: Number(c.monthly_insurance || 0),
            paymentDueDay, insuranceDueDay,
            // Extra payments the user plans to make once this saving-phase car is financed —
            // mirrors Forecast.tsx's getMonthProjLumpSum.
            lumpSumPayments: (c.lump_sum_payments ?? []) as { date: string; amount: number }[],
          };
        });
      const m0SyncCutoff = syncCutoffDate ?? todayStr;
      const getVehicleExtrasForMonth = (m: number) => {
        const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
        const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        return vehicleForecastByMonth.reduce((s, v) => {
          // Month 0: skip items the stored balance already reflects; counting them again
          // understates available cash. `isCapturedInBalance` owns the comparison (strict <, so a
          // charge due ON the cutoff day still shows in month 0) — see `src/lib/sync-cutoff.ts`.
          const insuranceSynced = m === 0 && v.insuranceDueDay !== null
            && isCapturedInBalance(dueDateInMonth(mk, v.insuranceDueDay), m0SyncCutoff);
          const paymentSynced = m === 0 && v.paymentDueDay !== null
            && isCapturedInBalance(dueDateInMonth(mk, v.paymentDueDay), m0SyncCutoff);
          // Insurance follows insuranceStartMonthIdx — defaults to purchaseMonthIdx unless the
          // user set a separate insurance_start_date (e.g. coverage starts a month later).
          const insurance = m >= v.insuranceStartMonthIdx && !insuranceSynced ? v.insurance : 0;
          const inLoanWindow = m >= v.paymentStartMonthIdx && m < v.paymentStartMonthIdx + v.termMonths;
          const projLoan = inLoanWindow && !paymentSynced ? v.projPayment : 0;
          const lumpSum = inLoanWindow
            ? v.lumpSumPayments.filter(ls => ls.date.substring(0, 7) === mk).reduce((s2, ls) => s2 + Number(ls.amount), 0)
            : 0;
          return s + insurance + projLoan + lumpSum;
        }, 0);
      };

      // ── Lump-sum payments on phase='loan' car funds per month (mirrors the lump-sum portion
      // of Forecast.tsx's activeCarLoanByMonth — getTotalCarLoanMonthly covers only the regular
      // payment, lump_sum_payments on loan-phase cars are separate).
      const carLoanLumpByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
        const md = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const mk = `${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, '0')}`;
        return carFunds
          .filter(cf => cf.phase === 'loan')
          .flatMap(cf => (cf.lump_sum_payments ?? []).filter(ls => ls.date.substring(0, 7) === mk))
          .reduce((s, ls) => s + ls.amount, 0);
      });

      // ── Insurance on phase='loan' car funds per month — getTotalCarLoanMonthly/carLoanLumpByMonth
      // above cover the regular payment and lump sums for an active loan, but neither one (nor
      // anything else in this hook) ever adds the car's monthly_insurance once phase flips to
      // 'loan'. Anchored to loan_start_date (not payment_start_date) — insurance is needed the
      // day you own the car, not when the first bill posts, matching vehicleForecastByMonth's
      // saving-phase insurance (purchaseMonthIdx) above. Calendar-month comparison via
      // monthsBetween, not exact-date, for the same reason getActiveCarLoanPayments' gate was
      // fixed — different representative days within the same month must agree. Runs indefinitely
      // rather than capping at loan_term_months (insurance is an ownership cost, not a financing one).
      const carLoanInsuranceByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const dStr = d.toISOString().split('T')[0];
        const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        return carFunds
          .filter(cf => cf.phase === 'loan' && cf.loan_start_date)
          .filter(cf => {
            const insuranceAnchor = cf.insurance_start_date ?? cf.loan_start_date!;
            return monthsBetween(insuranceAnchor, dStr) >= 0;
          })
          .filter(cf => {
            // Month 0: skip if the stored balance already reflects the insurance charge — same
            // shared predicate as every other month-0 gate.
            if (i !== 0) return true;
            const dueDayBasis = cf.insurance_start_date ?? cf.payment_start_date ?? cf.loan_start_date;
            if (!dueDayBasis) return true;
            const insurDay = new Date(dueDayBasis + 'T00:00:00').getDate();
            return !isCapturedInBalance(dueDateInMonth(mk, insurDay), m0SyncCutoff);
          })
          .reduce((s, cf) => s + Number(cf.monthly_insurance || 0), 0);
      });

      // ── simulationMonthEvents (mirrors cardProjectionData exactly) ────────────
      const simRetireIds = new Set<string>(
        accounts.filter(a => a.active && ['401k', 'roth_ira', 'ira', 'hsa'].includes(a.account_type)).map(a => a.id),
      );
      const simTransferRules = rules.filter(r => r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment'));
      let simIncMult = 1;
      // Same annualized Federal Withholding the engine feeds the tax estimator (from Budget
      // Control's paycheck deductions) so the sim's tax-return injection matches the engine's.
      const simAnnualFederalWithheld = computeAnnualFederalWithheld(
        payConfig,
        profile?.paycheck_deductions as { value: number; mode: string; label?: string }[] | null,
      );
      const simSortedPromotions = [...(assumptions.promotions ?? [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
      let simNextPromotionIdx = 0;
      const simFirstBonusIdx = (!assumptions.bonusRecurring && assumptions.bonusEnabled && assumptions.bonusAmount > 0)
        ? (() => {
            for (let k = 1; k < PROJECTION_MONTHS; k++) {
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
        const simMonthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        // Scheduled promotions snap simIncMult to the new salary (gross basis, matching
        // weekly_gross_income) so the raise/bonus math below keeps compounding/scaling off
        // the new value afterward — mirrors the same pattern in Forecast.tsx's two loops.
        while (simNextPromotionIdx < simSortedPromotions.length && simSortedPromotions[simNextPromotionIdx].effectiveDate.slice(0, 7) <= simMonthKey) {
          const annualBase = payConfig.weeklyGross * 52;
          if (annualBase > 0) simIncMult = simSortedPromotions[simNextPromotionIdx].newAnnualSalary / annualBase;
          simNextPromotionIdx++;
        }
        if (assumptions.incomeGrowthEnabled && assumptions.incomeGrowth > 0 && d.getMonth() + 1 === assumptions.raiseMonth) {
          if (assumptions.raiseMode === 'flat') {
            const currentAnnual = monthlyTakeHome * 12 * simIncMult;
            if (currentAnnual > 0) simIncMult *= (1 + assumptions.incomeGrowth / currentAnnual);
          } else {
            simIncMult *= (1 + assumptions.incomeGrowth / 100);
          }
        }
        // Bonus + tax-return injection via the shared income model — identical to the engine
        // (forecast-engine.ts), which computes the bonus off annual GROSS and runs the full tax
        // estimator. Previously the sim used annual NET for the bonus and honored ONLY a manual
        // tax override (skipping the estimator), so its cash walk diverged from the engine's.
        const simAnnualGrossHere = payConfig.weeklyGross * 52 * simIncMult;
        const { bonusIncome: simBonusInc, taxReturnIncome: simTaxInc } = computeBonusAndTax({
          annualGrossHere: simAnnualGrossHere,
          monthDate: d,
          assumptions,
          isFirstBonusOccurrence: idx === simFirstBonusIdx,
          annualFederalWithheldFromBudget: simAnnualFederalWithheld,
        });
        const simActiveTransferDests = new Set<string>();
        let monthTransfers = 0;
        for (const tr of simTransferRules) {
          if (tr.start_date && new Date(tr.start_date + 'T00:00:00') > simMonthEnd) continue;
          if (tr.end_date && new Date(tr.end_date + 'T00:00:00') < d) continue;
          if (tr.deposit_account) simActiveTransferDests.add(tr.deposit_account);
          const amt = Number(tr.amount);
          monthTransfers += amt * countRuleOccurrencesInMonth(tr, d.getFullYear(), d.getMonth(), now);
        }
        const monthSavings = (goals ?? []).reduce((s, g) => {
          if (g.contribution_start_date && new Date(g.contribution_start_date + 'T00:00:00') > d) return s;
          if (g.linked_account && simRetireIds.has(g.linked_account)) return s;
          if (g.linked_account && simActiveTransferDests.has(g.linked_account)) return s;
          return s + Number(g.monthly_contribution);
        }, 0);
        const carLoanThisMonth = getTotalCarLoanMonthly(carFunds ?? [], d);
        const monthCarSaving = (carFunds ?? []).reduce((s, c) => {
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
        // Mirror the engine's i>0 income model exactly (forecast-engine.ts:664-666): bake the
        // income multiplier into gross THEN net it (adjustedConfig), and do NOT scale the
        // nonPaycheck component by the multiplier. Previously this preferred scheduled-events
        // `e.income` (miscounting paydays by ±1) and multiplied the whole raw income by
        // simIncMult (over-scaling nonPaycheck) — both inflated the sim's cash walk vs the
        // engine's authoritative one.
        const simAdjustedConfig = { ...payConfig, weeklyGross: payConfig.weeklyGross * simIncMult };
        const actualMonthPaycheck = getMonthNetIncome(simAdjustedConfig, d.getFullYear(), d.getMonth());
        return {
          ...e,
          income: actualMonthPaycheck + e.nonPaycheckIncome + simBonusInc + simTaxInc,
          // getVehicleExtrasForMonth/carLoanInsuranceByMonth/carLoanLumpByMonth fold the
          // saving-phase projected payment+insurance and loan-phase insurance/lump sums directly
          // into the real simulation here — see the comment above vehicleForecastByMonth for why
          // this (not just comprehensiveMExp) needed to know about them.
          expenses: e.expenses + (pauseSavings ? 0 : monthSavings + monthCarSaving) + monthTransfers + carLoanThisMonth
            + getVehicleExtrasForMonth(idx) + carLoanInsuranceByMonth[idx] + carLoanLumpByMonth[idx]
            + (planCashExpensesEarly[idx] ?? 0),
        };
      });

      // ── CC minimum total ──────────────────────────────────────────────────────
      const ccMinTotal = cards
        .filter(c => !c.autopayFullBalance && c.balance > 0)
        .reduce((s, c) => s + c.minPayment, 0);

      // Per-month mandatory installment cash cost. The engine deducts this separately from
      // availableCash (Step 2.5), so the look-ahead must also model it as an expense rather
      // than as part of ccMin — otherwise save-up caps include the installment amount and the
      // engine pays it twice (once as cascade, once as installmentCashCost), draining $300+
      // per save-up month more than the look-ahead predicted, causing floor breaches.
      // Plan-covered cards use the due-date-anchored schedule (upfrontPayByMonth — $0 before a
      // plan's first real due date); only cards with MANUAL Accounts-tab installment fields fall
      // back to the flat month-0-anchored decrement. Keeping this consistent with the engine's
      // own Step 2.5 (which receives the same upfrontPayByMonth) is what stops the look-ahead
      // reserving for installment cash a month or two before it actually leaves.
      const installmentCostByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, m) =>
        cards.reduce((s, c) => {
          if (installmentByCard.has(c.id)) return s; // schedule-based, added below
          const instBal = c.installmentBalance ?? 0;
          const instPmt = c.installmentMonthlyPayment ?? 0;
          if (instBal <= 0 || instPmt <= 0) return s;
          const remaining = Math.max(0, instBal - m * instPmt);
          return s + (remaining > 0 ? Math.min(instPmt, remaining) : 0);
        }, 0)
        + Object.values(upfrontPayByMonth[m] ?? {}).reduce((a, b) => a + b, 0)
      );

      // ── Car down-payment amounts per month (for combined look-ahead) ──────────
      // effectiveDP = what must still come from checking in the purchase month after monthly
      // savings have accumulated. When monthly savings cover all of `rem`, this is 0 — no
      // lump-sum shock in the purchase month and no save-up needed for that car event.
      const carDownPaymentByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
        return carFunds.reduce((s, c) => {
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
      const cyclingExcessByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, m) => {
        if (m === 0) return 0;
        const purchaseMonth = m - 1;
        return cards.reduce((s, c) => {
          if (c.balance > 0) return s;
          if (c.paymentPreference !== 'statement' && c.paymentPreference !== 'full' && !c.autopayFullBalance) return s;
          const purchased = cardPurchasesPerMonth[purchaseMonth]?.[c.id] ?? c.monthlyNewPurchases;
          return s + Math.max(0, purchased - c.monthlyNewPurchases);
        }, 0);
      });

      // Mortgage payment (mirrors Forecast.tsx's mortgageMonthlyPayment). vehicleForecastByMonth/
      // getVehicleExtrasForMonth/carLoanLumpByMonth/carLoanInsuranceByMonth (the car-fund
      // equivalents) moved up before simulationMonthEvents — see the block right after m0Expenses
      // above — so simulationMonthEvents' own .expenses can include them directly instead of only
      // the separate look-ahead's comprehensiveMExp seeing them.
      const mortgageAccountNames = new Set(
        accounts.filter(a => a.account_type === 'mortgage' && a.active !== false)
          .map(a => (a.name as string).toLowerCase()),
      );
      const monthlyMortgagePayment = debts.filter(d => mortgageAccountNames.has((d.name as string).toLowerCase()))
        .reduce((s, d) => s + Number(d.target_payment || d.min_payment || 0), 0);

      // ── Lump-sum goal transfers per month (mirrors Forecast.tsx's lumpTransferByMonth, the
      // .total figure only — per-account categorization is a display concern handled elsewhere).
      const lumpTransferByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
        const md = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const mk = `${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, '0')}`;
        let total = 0;
        for (const g of goals) {
          const lumps = Array.isArray(g.lump_sum_payments)
            ? (g.lump_sum_payments as unknown as { date: string; amount: number }[])
            : [];
          total += lumps.filter(ls => ls.date.substring(0, 7) === mk).reduce((s, ls) => s + Number(ls.amount), 0);
        }
        return total;
      });

      // ── Month-0 non-debt outflows beyond m0Expenses ───────────────────────────
      // forecast-engine's PASS-3 month-0 cash step (cashPreDebt) subtracts savings contributions,
      // transfers, car loan/vehicle costs, mortgage, and goal lump-sum transfers on top of
      // baseExpenses — but the sim's month 0 is fed via the month0RemainingExpenses override
      // (m0Expenses + plan cash), and simulationMonthEvents deliberately short-circuits idx 0,
      // so none of those components ever reached the sim's month-0 cash model. Month 0 is also
      // live-anchored in the convergence loop (target[0] = NaN), so the engine's target feedback
      // can never correct the drift: the sim's floor-safe month-0 payment landed the engine's
      // month-0 cash below its floor by exactly these dollars ("Cash below safe minimum" at m0).
      // Each component mirrors the engine's own month-0 treatment, including its syncCutoffDate
      // scoping where the engine scopes (transfers) and its full-amount treatment where it
      // doesn't (savings, car loan, mortgage, lump transfers).
      const m0MonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const m0MonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const m0SyncDay = parseInt(m0SyncCutoff.split('-')[2], 10);
      // Transfers: only occurrences strictly after the sync cutoff day — earlier ones are already
      // in the live balance. Non-cash-source transfers move money between non-cash accounts and
      // never touch checking (both rules mirror forecast-engine's month-0 monthTransfers loop).
      const nonCashSrcTypes = new Set(['savings', 'high_yield_savings', 'brokerage', 'roth_ira', '401k', 'ira', 'hsa']);
      const m0ActiveTransferDests = new Set<string>();
      let m0Transfers = 0;
      for (const tr of simTransferRules) {
        if (tr.start_date && new Date(tr.start_date + 'T00:00:00') > m0MonthEnd) continue;
        if (tr.end_date && new Date(tr.end_date + 'T00:00:00') < m0MonthStart) continue;
        if (tr.deposit_account) m0ActiveTransferDests.add(tr.deposit_account);
        const amt = Number(tr.amount);
        let monthAmt = amt;
        if (tr.frequency === 'weekly') {
          let weekCount = 0;
          const firstD = new Date(m0MonthStart);
          const dow = tr.due_day ?? 5;
          while (firstD.getDay() !== dow) firstD.setDate(firstD.getDate() + 1);
          while (firstD <= m0MonthEnd) {
            if (firstD.getDate() > m0SyncDay) weekCount++;
            firstD.setDate(firstD.getDate() + 7);
          }
          monthAmt = amt * weekCount;
        } else if (tr.frequency === 'monthly') {
          const dueDay = Math.min(tr.due_day || 1, m0MonthEnd.getDate());
          monthAmt = dueDay > m0SyncDay ? amt : 0;
        } else if (tr.frequency === 'yearly') {
          monthAmt = amt / 12;
        }
        // biweekly: leave monthAmt = amt (conservative; at most once per month — engine parity)
        const srcAcct = tr.payment_source ? accounts.find(a => a.id === tr.payment_source) : null;
        if (srcAcct && nonCashSrcTypes.has(srcAcct.account_type as string)) continue;
        m0Transfers += monthAmt;
      }
      const m0Savings = pauseSavings ? 0 : (goals ?? []).reduce((s, g) => {
        if (g.contribution_start_date && new Date(g.contribution_start_date + 'T00:00:00') > m0MonthStart) return s;
        if (g.linked_account && simRetireIds.has(g.linked_account)) return s;
        if (g.linked_account && m0ActiveTransferDests.has(g.linked_account)) return s;
        return s + Number(g.monthly_contribution);
      }, 0);
      const m0CarSaving = pauseSavings ? 0 : (carFunds ?? []).reduce((s, c) => {
        if (c.phase !== 'saving') return s;
        if (c.linked_account) return s;
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
      const m0ExtraOutflow = m0Transfers + m0Savings + m0CarSaving
        + getTotalCarLoanMonthly(carFunds ?? [], m0MonthStart)
        + getVehicleExtrasForMonth(0) + carLoanInsuranceByMonth[0] + carLoanLumpByMonth[0]
        + monthlyMortgagePayment + lumpTransferByMonth[0];

      // ── Combined look-ahead: one-time DB expenses + cycling excess ────────────
      // Comprehensive per-month expense figure for the look-ahead — mirrors Forecast.tsx's own
      // totalOut, minus the REVOLVING debt payment itself (tracked separately by
      // computeFloorProtection — cycling-card statement payments are mandatory and non-negotiable,
      // so they belong here as an expense, not as part of the reducible revolving allocation; this
      // mirrors Forecast.tsx's own rawDebtPayment, which already includes cycling via
      // allPaymentTotals). For m>0, simulationMonthEvents[m].expenses already folds in goal/
      // car-fund monthly contributions, the active car loan's regular payment, AND (since both were
      // moved into simulationMonthEvents directly) the saving-phase projected payment/insurance and
      // loan-phase insurance/lump sums — getVehicleExtrasForMonth/carLoanLumpByMonth/
      // carLoanInsuranceByMonth are deliberately NOT added again here; doing so would double-count
      // them on top of the look-ahead cap. Only the categories simulationMonthEvents still doesn't
      // know about (mortgage, goal lump-sum transfers, cycling) need to be added here. Month 0
      // intentionally stays m0Expenses-only — its own minimum-protection path (cashPreDebt, further
      // below) already accounts for monthlySavingsAndCar/vehicle/mortgage/cycling precisely;
      // duplicating that here would only affect maxDebtPaymentByMonth[0]'s cap, not the displayed
      // recommendation.
      const comprehensiveMExp = (m: number, cyclingPaymentByMonth: number[]): number =>
        m === 0
          ? m0Expenses
          : (simulationMonthEvents[m]?.expenses ?? monthlyExpenses)
            + monthlyMortgagePayment + lumpTransferByMonth[m] + cyclingPaymentByMonth[m];

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
      const runLookAhead = (floorByMonth: number[], cyclingPaymentByMonth: number[], ccMinByMonth?: number[], reducibleDebtCapByMonth?: number[]) => {
        // Strip installment from ccMinByMonth so the save-up cap reflects only the revolving
        // minimum. Installment is modeled as an expense below — the engine pays it separately
        // via installmentCashCost, so the look-ahead must not also include it in the cascade cap.
        const ccMinRevOnly = ccMinByMonth?.map((total, m) =>
          Math.max(0, total - installmentCostByMonth[m])
        );
        return computeFloorProtection({
          incomeByMonth: Array.from({ length: PROJECTION_MONTHS }, (_, m) => m === 0 ? m0Income : (simulationMonthEvents[m]?.income ?? monthlyTakeHome)),
          expenseByMonth: Array.from({ length: PROJECTION_MONTHS }, (_, m) =>
            comprehensiveMExp(m, cyclingPaymentByMonth) + installmentCostByMonth[m]
          ),
          oneTimeNetByMonth: Array.from({ length: PROJECTION_MONTHS }, (_, m) => {
            if (m === 0) return 0;
            const ot = oneTimeArr[m] ?? { income: 0, expenses: 0 };
            return ot.income - ot.expenses;
          }),
          carDownPaymentByMonth: Array.from({ length: PROJECTION_MONTHS }, (_, m) => m === 0 ? 0 : carDownPaymentByMonth[m]),
          floorByMonth,
          startingBalance: debtFundingBalance,
          ccMinTotal,
          ccMinByMonth: ccMinRevOnly,
          cyclingExcessByMonth,
          reducibleDebtCapByMonth,
          carFunds, transactions, ccSourceIds, now, formatCurrency,
        });
      };

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
      // ccMinInFloor[m]: how much of that month's floor is CC revolving minimums (only present
      // once a sim exists to know who's revolving) — threaded into simulateVariablePayoff's
      // ccMinAlreadyInFloorByMonth so it doesn't reserve those same dollars a second time via its
      // own reservedForRevolving before sizing cycling cards' payoff pool.
      const computeAugmentedFloor = (simResult: { monthlyRevolvingBalances: Map<string, number[]>; perCardMinPayments: Map<string, number[]>; monthlyCyclingBacklog: Map<string, number[]> }): { floor: number[]; ccMinInFloor: number[] } => {
        const floor: number[] = [];
        const ccMinInFloor: number[] = [];
        for (let m = 0; m < PROJECTION_MONTHS; m++) {
          const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
          const r = getAugmentedMinSafeCash(
            rules, payConfig, debtPayoffOptions.cashFloor, resolvedDebtFundingId, d,
            carFunds, {
              simCards: cards, monthlyRevolvingBalances: simResult.monthlyRevolvingBalances,
              perCardMinPayments: simResult.perCardMinPayments, monthlyCyclingBacklog: simResult.monthlyCyclingBacklog,
            }, m, syncCutoffDate,
          );
          floor.push(r.monthMinSafe);
          ccMinInFloor.push(r.ccRevolvingMinIncluded);
        }
        return { floor, ccMinInFloor };
      };

      // Full cycling-card statement payment per month (not just the excess over baseline) —
      // mirrors Forecast.tsx's rawDebtPayment, which already includes this via allPaymentTotals,
      // and this hook's own month-0 cyclingPayment (allPaymentTotals[0] - debtPaymentTotals[0]),
      // generalized to any month and any simulation pass. Without this, the look-ahead's cash
      // model never accounted for a cycling card's routine statement payment at all — only the
      // unusual excess — making it think more cash was available than Forecast's own model did.
      //
      // Gated on the card's LIVE balance (c.balance <= 0, mirroring cyclingExcessByMonth's own
      // gate below) rather than the simulation's per-month revolving balance: an early, uncapped
      // bootstrap pass (see the iterative refinement further down) can pay a currently-revolving
      // card off far faster than a properly-capped run ever would, which would otherwise
      // misclassify its ongoing new purchases as a "mandatory cycling payment" rather than its
      // real, reducible revolving allocation — inflating the apparent shortfall and triggering
      // far more save-up than actually needed. A card that's genuinely still revolving today
      // never counts here, however the (possibly overly-optimistic) simulation pass treats it.
      //
      // Sums monthlyMandatoryCyclingPayment (NOT monthlyPayments): the engine's avalanche/snowball
      // cascade now lets a cycling card receive a second, discretionary backlog-paydown payment on
      // top of its mandatory statement (see credit-card-engine.ts's cyclingBacklog) — that portion
      // is reducible debt paydown, not a fixed bill, and must not be folded into this non-reducible
      // expense figure or the look-ahead would over-reserve cash and choke off exactly the surplus
      // this unification exists to free for genuinely-revolving cards.
      const computeCyclingPaymentByMonth = (simResult: {
        monthlyMandatoryCyclingPayment: Map<string, number[]>;
        monthlyRevolvingBalances: Map<string, number[]>;
      }): number[] =>
        Array.from({ length: PROJECTION_MONTHS }, (_, m) =>
          cards.reduce((s, c) => {
            // Use the simulation's per-month revolving balance rather than the card's static
            // initial balance (c.balance). A cycling card with a non-zero initial balance
            // (e.g. Amex Gold at $700 mid-cycle) was excluded from cycling reservation for
            // ALL months — including future months after it pays off. The look-ahead then
            // never reserved cash for those statement payments, letting revolving paydown drain
            // savings freely and leaving the cycling pool short in month 2+.
            const revBal = simResult.monthlyRevolvingBalances.get(c.id)?.[m] ?? c.balance;
            if (revBal > 0) return s;
            const actual = simResult.monthlyMandatoryCyclingPayment.get(c.id)?.[m] ?? 0;
            // cardPurchasesPerMonth[m-1] = purchases deferred into month m's statement.
            // When the bootstrap underpays the mandatory, "actual" is too low, so the look-ahead
            // only saves enough to repeat the underpayment. Using max(actual, intended) ensures
            // the look-ahead always reserves the full statement amount, breaking the deadlock.
            // Month 0 is always an empty map (no deferred history), so intended is 0 there.
            const intended = m > 0 ? (cardPurchasesPerMonth[m - 1]?.[c.id] ?? 0) : 0;
            return s + Math.max(actual, intended);
          }, 0),
        );

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
        PROJECTION_MONTHS,
        simulationMonthEvents,
        undefined,
        cardPurchasesPerMonth,
        m0Income,
        m0Expenses + m0ExtraOutflow + (planCashExpensesEarly[0] ?? 0),
        oneTimeArrWithDP,
        m0SafeFloor,
        undefined,
        cashFloorByMonth,
        undefined,
        installmentChargeByMonth,
        upfrontPayByMonth,
      );

      // Outer refinement: each pass computes the augmented floor (the same getAugmentedMinSafeCash
      // floor Forecast's PASS-2 and pass3RevTotals use, which needs a card-minimum-payment
      // trajectory — i.e. needs a sim to already exist) from the previous pass's sim, re-runs the
      // look-ahead against that floor, then re-runs the simulation with the resulting caps. Three
      // passes converge quickly in practice — a card's minimum-due/payoff-month transitions are
      // coarse and rarely shift between passes — and bring this look-ahead's breach detection to
      // parity with Forecast's own floor instead of the narrower bare one.
      let augmentedCashFloorByMonth = cashFloorByMonth;
      let ccMinInFloorByMonth: number[] = Array(PROJECTION_MONTHS).fill(0);
      let lookAhead = runLookAhead(cashFloorByMonth, Array(PROJECTION_MONTHS).fill(0));
      for (let outer = 0; outer < 3; outer++) {
        const augmented = computeAugmentedFloor(sim);
        augmentedCashFloorByMonth = augmented.floor;
        ccMinInFloorByMonth = augmented.ccMinInFloor;
        const cyclingPaymentByMonth = computeCyclingPaymentByMonth(sim);
        // The save-up look-ahead's model of this month's UNAVOIDABLE debt outflow must reflect the
        // real contract minimum (revolvingMinDue), not the plain 2% formula that perCardMinPayments
        // carries. computeFloorProtection banks reserveNeeded on the assumption that only ccMin(m)
        // leaves for debt each month (netAtMin); if ccMin is under-stated the backward pass thinks
        // it preserves more cash than the cascade actually will, under-saves, and breaches the floor
        // in the shortfall month — shorting cycling cards (the cyclingFloor regression). Sourced
        // here rather than by inflating perCardMinPayments precisely because ccMinByMonth is a
        // SEPARATE parameter from floorByMonth: it can carry the contract min without inflating the
        // pre-paycheck floor (getAugmentedMinSafeCash stays on the formula, keeping payoff fast).
        // installmentCostByMonth is added back so runLookAhead's ccMinRevOnly strip (which subtracts
        // it) nets to the revolving-only contract min, mirroring perCardMinPayments' own instMinPay term.
        const ccMinByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, m) =>
          cards.reduce((s, c) => {
            const revBal = sim.monthlyRevolvingBalances.get(c.id)?.[m] ?? 0;
            // Q11: settled card has no month-0 revolving min outflow (cycle already paid).
            if (revBal > 0) return s + (m === 0 && c.m0MinSettled ? 0 : revolvingMinDue(c, revBal));
            const backlog = sim.monthlyCyclingBacklog.get(c.id)?.[m] ?? 0;
            if (backlog > 0) return s + revolvingMinDue(c, backlog);
            return s;
          }, 0) + installmentCostByMonth[m],
        );
        // Upper bound on the reducible debt payment: revolving + backlog outstanding entering
        // month m, from the previous pass's sim (same fixed-point sourcing as ccMinByMonth
        // above). Keeps computeFloorProtection's cash walk from assuming surplus flows to debt
        // after payoff — see reducibleDebtCapByMonth's JSDoc in floor-protection.ts. Month 0
        // stays uncapped (live-anchored; its payment is already bounded by live balances).
        const reducibleDebtCapByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, m) => {
          if (m === 0) return Infinity;
          return cards.reduce((s, c) =>
            s + Math.max(0, sim.monthlyRevolvingBalances.get(c.id)?.[m - 1] ?? 0)
              + Math.max(0, sim.monthlyCyclingBacklog.get(c.id)?.[m - 1] ?? 0), 0);
        });
        lookAhead = runLookAhead(augmentedCashFloorByMonth, cyclingPaymentByMonth, ccMinByMonth, reducibleDebtCapByMonth);
        sim = simulateVariablePayoff(
          cards,
          debtFundingBalance,
          debtPayoffOptions.cashFloor,
          debtStrategy,
          monthlyTakeHome,
          monthlyExpenses,
          PROJECTION_MONTHS,
          simulationMonthEvents,
          undefined,
          cardPurchasesPerMonth,
          m0Income,
          m0Expenses + m0ExtraOutflow + (planCashExpensesEarly[0] ?? 0),
          oneTimeArrWithDP,
          m0SafeFloor,
          lookAhead.maxDebtPaymentByMonth,
          augmentedCashFloorByMonth,
          ccMinInFloorByMonth,
          installmentChargeByMonth,
          upfrontPayByMonth,
        );
      }
      const { maxDebtPaymentByMonth, saveUpMonths, strictSaveUpMonths, saveUpReason } = lookAhead;

      const projs = cards.map(c => {
        const pays = sim.monthlyPayments.get(c.id) || [];
        const revBals = sim.monthlyRevolvingBalances.get(c.id) || [];
        // Real per-month purchases for this card (one-time transactions + payment plans +
        // scheduled rules), not the undefined default that made projectCardVariable fall back
        // to card.monthlyNewPurchases — a static average baseline. That fallback made a cycling
        // card's displayed end balance (data[i][card.name], what Forecast's popup shows) ignore
        // real one-time purchases and payment-plan charges entirely once the card had no
        // revolving balance, even though the simulation/Debt Payoff tab already paid them
        // correctly on the normal 1-cycle delay.
        const purchases = cardPurchasesPerMonth.map(monthMap => monthMap[c.id] ?? 0);
        const cyclingOwed = sim.monthlyCyclingOwed.get(c.id) || [];
        const cyclingInterest = sim.monthlyCyclingInterest.get(c.id) || [];
        const trueBalances = sim.monthlyBalances.get(c.id) || [];
        const trueInterest = sim.monthlyInterest.get(c.id) || [];
        return projectCardVariable(c, pays, PROJECTION_MONTHS, true, purchases, revBals, cyclingOwed, cyclingInterest, trueBalances, trueInterest);
      });

      // ── Derived arrays ────────────────────────────────────────────────────────
      const totalLimit = cards.reduce((s, c) => s + c.creditLimit, 0);
      const data = Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const row: ProjectionDataRow = { month: d.toLocaleString('en', { month: 'short', year: 'numeric' }), totalCCBalance: 0, displayCCBalance: 0, totalInterest: 0, utilization: 0 };
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
          // Paid-off statement/full card: its ongoing liability is THIS month's actual purchases
          // (recurring monthly/biweekly + scheduled yearly spikes in their due month + one-time),
          // read from cardPurchasesPerMonth exactly like the per-card row above (~line 1027) and the
          // "CC Purchases" popup. The flat card.monthlyNewPurchases estimate is wrong here: it
          // amortizes yearly items across every month instead of spiking them in their due month,
          // and it omits cards whose purchases only begin later (e.g. Venture X in an out-year).
          else if (card.paymentPreference === 'full' || card.paymentPreference === 'statement') displayBal += cardPurchasesPerMonth[i]?.[card.id] ?? card.monthlyNewPurchases;
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
      const debtPaymentTotals = Array.from({ length: PROJECTION_MONTHS }, (_, i) =>
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

      const allPaymentTotals = Array.from({ length: PROJECTION_MONTHS }, (_, i) =>
        cards.reduce((total, card) => {
          const pays = sim.monthlyPayments.get(card.id);
          return total + (pays?.[i] ?? 0);
        }, 0),
      );

      let perCardPayments = cards.map(c => ({
        name: c.name, id: c.id,
        payments: Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
          const pays = sim.monthlyPayments.get(c.id);
          return Math.round(pays?.[i] ?? 0);
        }),
      }));

      // ── monthlySavingsAndCar for month 0 (mirrors CreditCardEngine exactly) ───
      const retireIds = new Set<string>(
        accounts.filter(a => a.active && ['401k', 'roth_ira', 'ira', 'hsa'].includes(a.account_type)).map(a => a.id),
      );
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const activeTransferDests = new Set<string>(
        rules.filter(r =>
          r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment') && r.deposit_account &&
          !(r.start_date && new Date(r.start_date + 'T00:00:00') > monthEnd) &&
          !(r.end_date && new Date(r.end_date + 'T00:00:00') < now),
        ).map(r => r.deposit_account!),
      );
      const goalContrib = pauseSavings ? 0 : goals.reduce((s, g) => {
        const ruleIds: string[] = (g.linked_rule_ids ?? []).length > 0
          ? (g.linked_rule_ids ?? [])
          : g.linked_rule_id ? [g.linked_rule_id] : [];
        const linkedRules = ruleIds.map(id => rules.find(r => r.id === id)).filter((r): r is NonNullable<typeof r> => r != null);
        const startDate = linkedRules.map(r => r.start_date).filter((d): d is string => d != null).sort()[0]
          ?? g.contribution_start_date ?? null;
        if (startDate && new Date(startDate + 'T00:00:00') > now) return s;
        if (g.linked_account && retireIds.has(g.linked_account)) return s;
        if (g.linked_account && activeTransferDests.has(g.linked_account)) return s;
        const ruleMonthly = (amt: number, freq: string) =>
          freq === 'weekly' ? amt * 52 / 12 : freq === 'biweekly' ? amt * 26 / 12 : amt;
        const monthly = linkedRules.length > 0
          ? linkedRules.reduce((t, r) => t + ruleMonthly(Number(r.amount), r.frequency), 0)
          : Number(g.monthly_contribution);
        return s + monthly;
      }, 0);
      // Mirrors Forecast.tsx's vehicleProjections.contrib formula exactly (purchaseMonthIdx-based
      // denominator, linked_rule_id-gated skip) so the two pipelines never drift apart again.
      // linked_account is ignored when it equals the funding account itself — that balance is
      // already counted as available cash elsewhere, so treating it as "already saved" would
      // double-count the same dollars instead of protecting them for the upcoming purchase.
      const carReserve = pauseSavings ? 0 : carFunds.reduce((s, c) => {
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
      // The share of carReserve still HELD at month end. The forecast engine adds reserved-but-
      // unspent vehicle savings back to displayed Ending Cash (cumulativeCarReserveHeld,
      // forecast-engine.ts:1080-1084) and zeroes a vehicle's reserve on its purchase month. Only
      // month 0 matters here, so the sole exclusion is a vehicle bought this month.
      const carReserveHeld = pauseSavings ? 0 : carFunds.reduce((s, c) => {
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
        if (purchaseMonthIdx === 0) return s;
        const contrib = (c.linked_account && c.linked_rule_id) ? 0
          : (rem > 0 && isFinite(purchaseMonthIdx) ? Math.min(rem / (purchaseMonthIdx + 1), rem) : 0);
        return s + contrib;
      }, 0);
      const carReserveEvent = pauseSavings ? null : carFunds.find(c => {
        if (c.phase !== 'saving') return false;
        const linkedAcct = c.linked_account && c.linked_account !== resolvedDebtFundingId
          ? accountMap.get(c.linked_account) : null;
        const effectiveSaved = linkedAcct ? Number(linkedAcct.balance) : Number(c.current_saved || 0);
        const rem = Math.max(0, Number(c.down_payment_goal) - Number(c.gift_contribution || 0) - effectiveSaved);
        return rem > 0 && !(c.linked_account && c.linked_rule_id);
      });
      // Exclude loan payments the stored balance already reflects; counting them again understates
      // cash. Shares `isCapturedInBalance` with the forecast engine — finding §1.1 cause C, where
      // this filter had no counterpart in `forecast-engine.ts` at all and Forecast charged $537 the
      // Dashboard did not. This test was also `> cutoff` (dropping a payment due exactly ON the
      // cutoff day) while `getVehicleExtrasForMonth` above used `< cutoff` and kept it.
      const m0CarFundsForLoan = (carFunds ?? []).filter(cf => {
        if (cf.phase !== 'loan' || !cf.payment_start_date) return true;
        const payDay = new Date(cf.payment_start_date + 'T00:00:00').getDate();
        const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        return !isCapturedInBalance(dueDateInMonth(currentMonthStr, payDay), m0SyncCutoff);
      });
      const carLoanTotal = getTotalCarLoanMonthly(m0CarFundsForLoan);
      const monthlySavingsAndCar = goalContrib + carReserve + carLoanTotal;

      // ── PASS-3 equivalent: constrain per-card payments to cash-floor model ─────
      // Mirrors Forecast PASS 3 steps 2+3: tracks rolling cash and revolving balance,
      // clips revolving payments when cash would drop below the floor, redirects surplus.
      const p3RevBal0 = cards.reduce((s, c) => {
        if ((sim.monthlyRevolvingBalances.get(c.id)?.[0] ?? 1) === 0) return s;
        const acct = accounts.find(a => a.id === c.id);
        return s + (acct ? Number(acct.balance || 0) : 0);
      }, 0);

      const pass3RevTotals: number[] = [];
      let p3Cash = debtFundingBalance;
      let p3RevBal = p3RevBal0;
      let prevCcRevBal = p3RevBal0;
      let forecastRevolvingPayoffMonth: number | null = null;

      for (let m = 0; m < PROJECTION_MONTHS; m++) {
        const mInc   = m === 0 ? m0Income    : (simulationMonthEvents[m]?.income   ?? monthlyTakeHome);
        const mOneTimeNet = m === 0 ? 0 : (oneTimeArr[m]?.expenses ?? 0) - (oneTimeArr[m]?.income ?? 0);
        // m===0: simulationMonthEvents[0] is the unmodified forecastMonthEvents entry (no car-fund
        // terms folded in), so the vehicle/insurance/lump-sum figures still need adding here. For
        // m>0, simulationMonthEvents[m].expenses already includes them — adding again would
        // double-count.
        const mExp   = (m === 0 ? m0Expenses + monthlySavingsAndCar + getVehicleExtrasForMonth(0) + carLoanLumpByMonth[0] + carLoanInsuranceByMonth[0]
          : (simulationMonthEvents[m]?.expenses ?? monthlyExpenses) + (carDownPaymentByMonth[m] ?? 0))
          + monthlyMortgagePayment + lumpTransferByMonth[m] + mOneTimeNet;
        // Augmented (not bare cashFloorByMonth) so this matches the floor Forecast.tsx uses for
        // the same month — otherwise pass3RevTotals (which scales the displayed per-card amounts
        // for months 1+) and Forecast's own Ending Cash walk cap debt payments differently.
        const mFloor = getAugmentedMinSafeCash(
          rules, payConfig, debtPayoffOptions.cashFloor, resolvedDebtFundingId,
          new Date(now.getFullYear(), now.getMonth() + m, 1),
          carFunds, {
            simCards: cards, monthlyRevolvingBalances: sim.monthlyRevolvingBalances,
            perCardMinPayments: sim.perCardMinPayments, monthlyCyclingBacklog: sim.monthlyCyclingBacklog,
          }, m, syncCutoffDate,
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

        // Derive interest + new purchases from simulation's balance equation:
        //   ccRevBal[m] = ccRevBal[m-1] - simRevPay[m] + interest[m] + newPurchases[m]
        //   → interestAndNewPurchases = ccRevBal[m] - ccRevBal[m-1] + simRevPay[m]
        // Mirrors Forecast.tsx's virtualRevBal formula so the payoff month aligns with CC Debt Free.
        const curCcRevBal = p3RevBal > 0
          ? cards.reduce((s, c) => {
              if ((sim.monthlyRevolvingBalances.get(c.id)?.[0] ?? 1) === 0) return s;
              return s + (sim.monthlyRevolvingBalances.get(c.id)?.[m] ?? 0);
            }, 0)
          : 0;
        const intNew = p3RevBal > 0 ? Math.max(0, curCcRevBal - prevCcRevBal + simRevTotal) : 0;
        prevCcRevBal = curCcRevBal;

        p3Cash = cashPreDebt - simCycTotal - revPay;
        p3RevBal = Math.max(0, p3RevBal - revPay + intNew);

        let surplus = 0;
        if (!strictSaveUpMonths.has(m) && p3RevBal > 0 && p3Cash > mFloor) {
          surplus = Math.min(p3Cash - mFloor, p3RevBal);
          p3Cash -= surplus;
          p3RevBal = Math.max(0, p3RevBal - surplus);
        }

        if (forecastRevolvingPayoffMonth === null && p3RevBal < REVOLVING_DUST_DOLLARS && p3RevBal0 > 0) {
          forecastRevolvingPayoffMonth = m + 1;
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
      // Which simulateVariablePayoff arg variant produced activeSim — replayed verbatim by
      // resimulateWithDebtCash below. The refined-loop sim and the capped-retry sim2 differ
      // only in the month-0 expense figure and the max-debt cap array.
      let activeSimM0Expenses = m0Expenses + m0ExtraOutflow + (planCashExpensesEarly[0] ?? 0);
      let activeSimMaxDebt: number[] | undefined = maxDebtPaymentByMonth;
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
          PROJECTION_MONTHS,
          simulationMonthEvents,
          undefined,
          cardPurchasesPerMonth,
          m0Income,
          m0Expenses + m0ExtraOutflow,
          oneTimeArrWithDP,
          m0SafeFloor,
          cappedMaxDebt,
          augmentedCashFloorByMonth,
          ccMinInFloorByMonth,
          installmentChargeByMonth,
          upfrontPayByMonth,
        );
        perCardPayments = cards.map(c => ({
          name: c.name, id: c.id,
          payments: Array.from({ length: PROJECTION_MONTHS }, (_, i) =>
            Math.round(sim2.monthlyPayments.get(c.id)?.[i] ?? 0),
          ),
        }));
        activeSim = sim2;
        activeSimM0Expenses = m0Expenses + m0ExtraOutflow;
        activeSimMaxDebt = cappedMaxDebt;

        // Update data[i].totalCCBalance from sim2 so Forecast PASS 2 recomputeSimCash pins
        // cash to floor in the correct months. PASS 2 uses b.ccDebtBalance > 0 to decide
        // whether to simulate PASS 3's surplus redirect; if sim1 shows debt cleared when sim2
        // doesn't, PASS 2 stops pinning too early and misses floor breaches — causing it to
        // never reduce cycling payments (e.g. Amex Gold statement balance) to maintain the floor.
        for (let i = 0; i < PROJECTION_MONTHS; i++) {
          data[i].totalCCBalance = Math.round(Math.max(0,
            cards.reduce((s, c) => s + (sim2.monthlyRevolvingBalances.get(c.id)?.[i] ?? 0), 0),
          ));
        }

        // Update allPaymentTotals and debtPaymentTotals in-place from sim2
        for (let i = 0; i < PROJECTION_MONTHS; i++) {
          allPaymentTotals[i] = cards.reduce((total, card) =>
            total + (sim2.monthlyPayments.get(card.id)?.[i] ?? 0), 0);
        }
        const projs2 = cards.map(c =>
          projectCardVariable(c, sim2.monthlyPayments.get(c.id) || [], PROJECTION_MONTHS, true, undefined, sim2.monthlyRevolvingBalances.get(c.id) || [])
        );
        for (let i = 0; i < PROJECTION_MONTHS; i++) {
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
          const acct = accounts.find(a => a.id === c.id);
          return s + (acct ? Number(acct.balance || 0) : 0);
        }, 0);
        pass3RevTotals.length = 0;
        forecastRevolvingPayoffMonth = null;
        let p3Cash2 = debtFundingBalance;
        let p3RevBal2 = p3RevBal0_2;
        let prevCcRevBal2 = p3RevBal0_2;
        for (let m = 0; m < PROJECTION_MONTHS; m++) {
          const mInc2   = m === 0 ? m0Income    : (simulationMonthEvents[m]?.income   ?? monthlyTakeHome);
          const mOneTimeNet2 = m === 0 ? 0 : (oneTimeArr[m]?.expenses ?? 0) - (oneTimeArr[m]?.income ?? 0);
          // m===0 still needs getVehicleExtrasForMonth(0) added explicitly (see the identical note
          // on mExp above) — m>0 already has it via simulationMonthEvents[m].expenses.
          const mExp2   = (m === 0 ? m0Expenses + monthlySavingsAndCar + getVehicleExtrasForMonth(0)
            : (simulationMonthEvents[m]?.expenses ?? monthlyExpenses) + (carDownPaymentByMonth[m] ?? 0))
            + monthlyMortgagePayment + mOneTimeNet2;
          const mFloor2 = getAugmentedMinSafeCash(
            rules, payConfig, debtPayoffOptions.cashFloor, resolvedDebtFundingId,
            new Date(now.getFullYear(), now.getMonth() + m, 1),
            carFunds, {
              simCards: cards, monthlyRevolvingBalances: sim2.monthlyRevolvingBalances,
              perCardMinPayments: sim2.perCardMinPayments, monthlyCyclingBacklog: sim2.monthlyCyclingBacklog,
            }, m, syncCutoffDate,
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

          const curCcRevBal2 = p3RevBal2 > 0
            ? cards.reduce((s, c) => {
                if ((sim2.monthlyRevolvingBalances.get(c.id)?.[0] ?? 1) === 0) return s;
                return s + (sim2.monthlyRevolvingBalances.get(c.id)?.[m] ?? 0);
              }, 0)
            : 0;
          const intNew2 = p3RevBal2 > 0 ? Math.max(0, curCcRevBal2 - prevCcRevBal2 + simRevTotal2) : 0;
          prevCcRevBal2 = curCcRevBal2;

          p3Cash2 = cashPreDebt2 - simCycTotal2 - revPay2;
          p3RevBal2 = Math.max(0, p3RevBal2 - revPay2 + intNew2);
          let surplus2 = 0;
          if (!strictSaveUpMonths.has(m) && p3RevBal2 > 0 && p3Cash2 > mFloor2) {
            surplus2 = Math.min(p3Cash2 - mFloor2, p3RevBal2);
            p3Cash2 -= surplus2;
            p3RevBal2 = Math.max(0, p3RevBal2 - surplus2);
          }
          if (forecastRevolvingPayoffMonth === null && p3RevBal2 < REVOLVING_DUST_DOLLARS && p3RevBal0_2 > 0) {
            forecastRevolvingPayoffMonth = m + 1;
          }
          pass3RevTotals.push(Math.round(revPay2 + surplus2));
        }
      }

      // For save-up months where revolving debt is already cleared, cap only the DISCRETIONARY
      // portion of allPaymentTotals (backlog paydown) — not the mandatory cycling payments.
      // Mandatory cycling payments (Venture X's $1,800 statement etc.) must be paid regardless
      // of save-up; capping them to ccMinTotal was wrong because ccMinTotal reflects revolving
      // card minimums, not cycling card statements. Only the excess above the mandatory cycling
      // amount (i.e. backlog paydown that could be deferred) is subject to the save-up cap.
      const mandatoryCyclingByMonth = computeCyclingPaymentByMonth(activeSim);
      for (const m of saveUpMonths) {
        const cap = maxDebtPaymentByMonth[m];
        if (!isFinite(cap) || debtPaymentTotals[m] > 0) continue;
        const mandatory = mandatoryCyclingByMonth[m] ?? 0;
        const discretionary = Math.max(0, allPaymentTotals[m] - mandatory);
        const discretionaryCap = Math.max(0, cap - mandatory);
        if (discretionary > discretionaryCap) {
          allPaymentTotals[m] = mandatory + discretionaryCap;
        }
      }

      // Scale per-card: cycling cards keep full sim amount; revolving cards scale to pass-3 totals.
      // In save-up months with no revolving debt, scale cycling cards proportionally to the cap.
      // Uses activeSim (sim2 when triggered, sim1 otherwise) so revolving/cycling classification
      // and per-card amounts are consistent with the updated totals.
      //
      // lastRevPayMonth: last month where pass-3 made a live revolving payment.
      // After this month, pass3RevTotals[m] = 0 because the live balance is exhausted —
      // NOT because cash is constrained. In those months the simulation still projects
      // revolving payments (based on plan balances, which may exceed live balances), so
      // we show the simulation amount directly instead of scaling to 0.
      const lastRevPayMonth = pass3RevTotals.reduce((last, t, i) => t > 0 ? i : last, -1);

      // When pass3RevTotals[m] exceeds the natural simulated total (debtPaymentTotals[m]), that's
      // a surplus being redirected to debt beyond the card-payoff schedule's own pace — Forecast's
      // own PASS-3 does this whenever cash exceeds the floor. The scale below is capped at 1 (it
      // only ever reduces a card's natural payment, never increases it), so without this, the
      // displayed per-card amounts silently fall short of what Forecast's own walk actually pays —
      // a confirmed source of a real per-month gap between the popup's line items and Ending Cash.
      // Allocate the surplus in debt-strategy priority order (avalanche: highest APR first;
      // snowball: lowest balance first) — NOT proportional to each card's natural payment share.
      // Proportional allocation previously gave a lower-priority card (Discover, lower APR) a slice
      // of the surplus while a higher-priority card (Prime Visa, higher APR) still carried a
      // balance — avalanche should send 100% of any surplus to the highest-priority card with a
      // remaining balance before any other card gets a cent above its minimum.
      const extraPerCardByMonth = new Map<string, number[]>(cards.map(c => [c.id, Array<number>(PROJECTION_MONTHS).fill(0)]));
      for (let m = 0; m < PROJECTION_MONTHS; m++) {
        const simRevTotal = debtPaymentTotals[m];
        const target = pass3RevTotals[m] ?? 0;
        if (simRevTotal <= 0 || target <= simRevTotal) continue;
        let extra = target - simRevTotal;
        const revCards = cards
          .filter(c => (activeSim.monthlyRevolvingBalances.get(c.id)?.[m] ?? 0) > 0)
          .sort((a, b) => debtStrategy === 'avalanche' ? b.apr - a.apr : a.balance - b.balance);
        for (const c of revCards) {
          if (extra <= 0) break;
          const remainingBal = activeSim.monthlyRevolvingBalances.get(c.id)?.[m] ?? 0;
          const alloc = Math.max(0, Math.min(extra, remainingBal));
          extraPerCardByMonth.get(c.id)![m] = alloc;
          extra -= alloc;
        }
      }

      // Build per-card forecast-adjusted revolving balances by accumulating each card's slice of
      // the step-3 surplus (already avalanche-distributed in extraPerCardByMonth) and subtracting
      // from the SIM's monthly balance. Mirrors adjustedRevBal = max(0, simBal - cumulativeStep3Extra)
      // in Forecast.tsx but resolved per-card so the Debt Payoff chart and payoff labels match.
      const forecastAdjustedRevolvingBalances = new Map<string, number[]>(cards.map(c => [c.id, []]));
      {
        const cumExtraPerCard = new Map<string, number>(cards.map(c => [c.id, 0]));
        for (let m = 0; m < PROJECTION_MONTHS; m++) {
          for (const c of cards) {
            const extra = extraPerCardByMonth.get(c.id)?.[m] ?? 0;
            cumExtraPerCard.set(c.id, (cumExtraPerCard.get(c.id) ?? 0) + extra);
            const simBal = activeSim.monthlyRevolvingBalances.get(c.id)?.[m] ?? 0;
            forecastAdjustedRevolvingBalances.get(c.id)!.push(Math.max(0, simBal - (cumExtraPerCard.get(c.id) ?? 0)));
          }
        }
      }

      // When pass3RevTotals[m] requires scaling DOWN below the natural simulated total, applying
      // the same scale factor to every card uniformly can push an individual card below its own
      // minimum payment even though the combined total still covers every card's minimum in
      // aggregate — the same class of bug fixed for month 0's perCardAdjusted above, but that fix
      // never extended to this months-1+ path. Protect each revolving card's own minimum first,
      // then distribute only the leftover ("discretionary") pool proportional to each card's
      // natural extra above its own minimum — mirrors the month-0 algorithm exactly.
      const protectedPerCardByMonth = new Map<string, number[]>(cards.map(c => [c.id, Array<number>(PROJECTION_MONTHS).fill(0)]));
      for (let m = 0; m < PROJECTION_MONTHS; m++) {
        const simRevTotal = debtPaymentTotals[m];
        const target = pass3RevTotals[m] ?? 0;
        if (simRevTotal <= 0 || target >= simRevTotal) continue;
        const revCards = cards.filter(c => (activeSim.monthlyRevolvingBalances.get(c.id)?.[m] ?? 0) > 0);
        if (revCards.length === 0) continue;
        const minSum = revCards.reduce((s, c) => s + c.minPayment, 0);
        const discretionaryPool = Math.max(0, target - minSum);
        const naturalExtraTotal = revCards.reduce((s, c) => {
          const natural = Math.round(activeSim.monthlyPayments.get(c.id)?.[m] ?? 0);
          return s + Math.max(0, natural - c.minPayment);
        }, 0);
        for (const c of revCards) {
          const natural = Math.round(activeSim.monthlyPayments.get(c.id)?.[m] ?? 0);
          const extra = Math.max(0, natural - c.minPayment);
          const extraShare = naturalExtraTotal > 0 ? discretionaryPool * (extra / naturalExtraTotal) : 0;
          protectedPerCardByMonth.get(c.id)![m] = Math.min(natural, c.minPayment + extraShare);
        }
      }

      const perCardPaymentsScaled = cards.map(c => ({
        name: c.name, id: c.id,
        payments: Array.from({ length: PROJECTION_MONTHS }, (_, m) => {
          const simAmt = Math.round(activeSim.monthlyPayments.get(c.id)?.[m] ?? 0);
          const revBal = activeSim.monthlyRevolvingBalances.get(c.id)?.[m] ?? 0;
          if (revBal === 0) {
            // Cycling card — in save-up months with no revolving debt, preserve the mandatory
            // cycling payment and scale only the discretionary backlog-paydown portion.
            if (saveUpMonths.has(m) && debtPaymentTotals[m] === 0) {
              // Statement/full-balance preference cards must pay the full statement balance each
              // cycle to avoid interest — that amount is not discretionary, so never cap it.
              if (c.paymentPreference === 'statement' || c.paymentPreference === 'full') return simAmt;
              const cardMandatory = activeSim.monthlyMandatoryCyclingPayment.get(c.id)?.[m] ?? 0;
              const cardDiscretionary = Math.max(0, simAmt - cardMandatory);
              const totalDiscretionaryCapped = Math.max(0, allPaymentTotals[m] - (mandatoryCyclingByMonth[m] ?? 0));
              const totalCardDiscretionary = cards.reduce((s, cc) => {
                if ((activeSim.monthlyRevolvingBalances.get(cc.id)?.[m] ?? 0) > 0) return s;
                const ccAmt = Math.round(activeSim.monthlyPayments.get(cc.id)?.[m] ?? 0);
                const ccMandatory = activeSim.monthlyMandatoryCyclingPayment.get(cc.id)?.[m] ?? 0;
                return s + Math.max(0, ccAmt - ccMandatory);
              }, 0);
              const discretionaryShare = totalCardDiscretionary > 0
                ? Math.round(cardDiscretionary * (totalDiscretionaryCapped / totalCardDiscretionary))
                : 0;
              return Math.min(simAmt, cardMandatory + discretionaryShare);
            }
            return simAmt;
          }
          // Revolving card: when live balance exhausted before month m, pass3RevTotals[m] = 0
          // but the plan simulation still shows revolving activity — show simulation amount directly.
          if (pass3RevTotals[m] === 0 && lastRevPayMonth >= 0 && m > lastRevPayMonth) {
            return simAmt;
          }
          const simRevTotal = debtPaymentTotals[m];
          const scale = simRevTotal > 0 ? Math.min(1, pass3RevTotals[m] / simRevTotal) : 1;
          if (scale < 1) {
            const protectedAmt = protectedPerCardByMonth.get(c.id)?.[m];
            if (protectedAmt != null) return Math.round(protectedAmt);
          }
          const extra = extraPerCardByMonth.get(c.id)?.[m] ?? 0;
          return Math.round(simAmt * scale + extra);
        }),
        surpluses: Array.from({ length: PROJECTION_MONTHS }, (_, m) =>
          extraPerCardByMonth.get(c.id)?.[m] ?? 0,
        ),
      }));

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
        const acct = accounts.find(a => a.id === c.id);
        return s + (acct ? Number(acct.balance || 0) : 0);
      }, 0);

      const ccMinTotalRevolving = cards
        .filter(c => {
          const revBal0 = activeSim.monthlyRevolvingBalances.get(c.id)?.[0] ?? 1;
          // Q11: settled cards owe no minimum this month — see m0MinDueSettled.
          return revBal0 > 0 && !c.m0MinSettled;
        })
        .reduce((s, c) => s + c.minPayment, 0);

      // Floor used to cap month-0 payment capacity — augmented with active car-loan payments
      // and CC minimums (same function Dashboard/Forecast use to display "Cash floor") so the
      // cap here always matches what the user sees, instead of the bare pre-paycheck-bills floor.
      const m0FloorAugmented = getAugmentedMinSafeCash(
        rules, payConfig, debtPayoffOptions.cashFloor, resolvedDebtFundingId, now,
        carFunds, {
          simCards: cards, monthlyRevolvingBalances: activeSim.monthlyRevolvingBalances,
          perCardMinPayments: activeSim.perCardMinPayments, monthlyCyclingBacklog: activeSim.monthlyCyclingBacklog,
        }, 0, syncCutoffDate,
      ).monthMinSafe;

      // Vehicle insurance/projected loan and mortgage for month 0 — reuses the per-month
      // helpers defined above (which pass3RevTotals also uses) so month 0 and every later
      // month are computed identically.
      const m0VehicleInsurance = getVehicleExtrasForMonth(0) + carLoanInsuranceByMonth[0];
      const m0MortgagePayment = monthlyMortgagePayment;

      const ccMinForMonth = liveRevolvingBal > 0 ? Math.min(ccMinTotalRevolving, simRevolvingTotal) : 0;
      // Mirror forecast-engine.ts's PASS-3 month-0 cashPreDebt (forecast-engine.ts:1106) exactly so
      // the floor cap here holds against the same cash the Forecast row actually ends on. The prior
      // form omitted three month-0 outflows the engine subtracts: transfer/investment rules
      // (m0Transfers — e.g. Tre's $25/mo Roth IRA rule), goal lump-sum transfers
      // (lumpTransferByMonth[0]), and net one-time DB txns (+ oneTimeNet, engine adds income minus
      // expense). Missing them made cashPreDebt read higher than reality, so the cap authorized more
      // Discover paydown than the floor allowed and the current-month row landed below the augmented
      // floor. Do NOT add all of m0ExtraOutflow (line ~797): its savings/car/vehicle/mortgage terms
      // are already covered by monthlySavingsAndCar + m0VehicleInsurance + m0MortgagePayment above.
      // oneTimeArr[0] is force-zeroed in this hook (month-0 one-times are already in the live
      // balance); the term is kept for byte-for-byte parity with the engine's + b.oneTimeNet.
      const m0OneTimeNet = (oneTimeArr[0]?.income ?? 0) - (oneTimeArr[0]?.expenses ?? 0);
      // Finding §1.1: planCashExpensesEarly[0] belongs here too. The engine folds checking-sourced
      // payment-plan installments into baseExpenses (forecast-engine.ts:697), and this hook already
      // adds them to the SIM's month-0 expenses (lines ~975/1045/1321) and to the floor — but not to
      // cashPreDebt, so the cap authorized one month's installments more paydown than the Forecast
      // row actually had, and the chain below rendered a total the Forecast page never agreed with.
      const m0PlanExpenses = planCashExpensesEarly[0] ?? 0;
      const cashPreDebt = debtFundingBalance + m0Income - m0Expenses - m0PlanExpenses - monthlySavingsAndCar - m0VehicleInsurance - m0MortgagePayment
        - m0Transfers - lumpTransferByMonth[0] + m0OneTimeNet;

      // Findings §2.6/§2.3: the same chain, term by term, as integers — so a UI can render the
      // engine's own derivation instead of re-deriving it from page-local sums. monthlySavingsAndCar
      // is split back into its three components (goalContrib + carReserve + carLoanTotal) so each
      // gets a truthful label. cashPreDebt here is the sum of the ROUNDED terms, not a rounding of
      // the raw cashPreDebt above: that keeps the displayed equation exact in integer arithmetic,
      // at the cost of at most a dollar against the raw value used for the cap. See Month0CashChain.
      const m0Chain = ((): Month0CashChain => {
        const fundingBalance = Math.round(debtFundingBalance);
        const income = Math.round(m0Income);
        const expenses = Math.round(m0Expenses);
        const planExpenses = Math.round(m0PlanExpenses);
        const goalContributions = Math.round(goalContrib);
        const carReserveRounded = Math.round(carReserve);
        const carLoanPayment = Math.round(carLoanTotal);
        const vehicleInsurance = Math.round(m0VehicleInsurance);
        const mortgagePayment = Math.round(m0MortgagePayment);
        const transfers = Math.round(m0Transfers + lumpTransferByMonth[0]);
        const oneTimeNet = Math.round(m0OneTimeNet);
        return {
          fundingBalance, income, expenses, planExpenses, goalContributions,
          carReserve: carReserveRounded, carLoanPayment, vehicleInsurance, mortgagePayment,
          transfers, oneTimeNet,
          cashPreDebt: fundingBalance + income - expenses - planExpenses - goalContributions - carReserveRounded
            - carLoanPayment - vehicleInsurance - mortgagePayment - transfers + oneTimeNet,
        };
      })();
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
      // Q11: a settled card's minimum isn't owed this month, so nothing is "protected" for it —
      // its whole natural payment is discretionary extra, not min + extra.
      const protectedMin = (c: CardData): number => (c.m0MinSettled ? 0 : c.minPayment);
      const ccMinSumActive = cards.reduce((s, c) => {
        const revBal0 = activeSim.monthlyRevolvingBalances.get(c.id)?.[0] ?? 1;
        return revBal0 > 0 ? s + protectedMin(c) : s;
      }, 0);
      const discretionaryPool = Math.max(0, revolvingPayment - ccMinSumActive);
      const naturalExtraTotal = cards.reduce((s, c) => {
        const revBal0 = activeSim.monthlyRevolvingBalances.get(c.id)?.[0] ?? 1;
        if (revBal0 === 0) return s;
        const activeSimPay = Math.round(activeSim.monthlyPayments.get(c.id)?.[0] ?? 0);
        return s + Math.max(0, activeSimPay - protectedMin(c));
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
          const extra = Math.max(0, activeSimPay - protectedMin(c));
          const extraShare = naturalExtraTotal > 0 ? discretionaryPool * (extra / naturalExtraTotal) : 0;
          payment = Math.round(Math.min(activeSimPay, protectedMin(c) + extraShare));
        }
        return {
          id: c.id,
          name: c.name,
          payment,
          maxPayment: activeSimPay,
        };
      });

      // Zero out revolving cards whose current-month due date already passed syncCutoffDate.
      // Those payments cleared through Plaid and are already in the live balance; recommending
      // them again would double-count cash that's already gone.
      const m0MonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const perCardAdjustedFinal = syncCutoffDate ? perCardAdjusted.map(pca => {
        const card = cards.find(c => c.id === pca.id);
        if (!card || !card.dueDay) return pca;
        if ((activeSim.monthlyRevolvingBalances.get(card.id)?.[0] ?? 1) === 0) return pca;
        // Only treat a passed due date as "already paid" for autopay-full cards, whose statement
        // genuinely clears automatically and is already reflected in the live Plaid balance. A
        // non-autopay card (e.g. Discover, Prime Visa) that still carries a revolving balance is NOT
        // auto-settled — recommending $0 there hid real debt the user still owes and made the
        // recommendation diverge from the sim, which kept applying the (floor-bounded) paydown.
        if (!card.autopayFullBalance) return pca;
        // §1.1 cause C sweep: recommending $0 asserts the cash is already gone, so this is an
        // OUTFLOW gate and uses the shared `isCapturedInBalance` rule. With the settlement lag, an
        // autopay that fired in the last few days is no longer assumed settled — the payment stays
        // recommended rather than silently vanishing from the plan while the debit is still pending.
        return isCapturedInBalance(dueDateInMonth(m0MonthStr, card.dueDay), syncCutoffDate)
          ? { ...pca, payment: 0 }
          : pca;
      }) : perCardAdjusted;
      const revolvingPaymentFinal = perCardAdjustedFinal
        .filter(pca => (activeSim.monthlyRevolvingBalances.get(pca.id)?.[0] ?? 1) > 0)
        .reduce((s, pca) => s + pca.payment, 0);
      const safeToPayTotalFinal = Math.round(cyclingPayment + revolvingPaymentFinal);

      // Month-0 floor-capped ledger entry. The raw sim pays down to the BARE floor (m0SafeFloor),
      // overshooting the AUGMENTED floor (CC-min/car/insurance buffers) by ~$176. perCardAdjustedFinal
      // already scales month-0 payments back to availableForRevolving (the augmented-floor cap) — the
      // value month0.safeToPayTotal displays. This entry carries that scaled split into the ledger the
      // engine consumes so month-0 cash math (forecast-engine.ts:1121 ledgerEntry.total) lands on the
      // augmented floor, not below it. Threaded into BOTH the base hookResult ledger AND the resim ctx
      // (cardProjectionResim.ts rebuilds the ledger raw every convergence pass — the engine's final
      // cardProjectionData comes from there, so the base override alone never reached it). Months 1+
      // stay raw-sim, leaving the tuned Q6-Q12 convergence untouched.
      const month0PaymentLedger: PaymentLedgerEntry = (() => {
        const perCard = perCardAdjustedFinal.map(p => ({ id: p.id, payment: p.payment }));
        const total = perCard.reduce((s, p) => s + p.payment, 0);
        return { total, revolving: revolvingPaymentFinal, cycling: total - revolvingPaymentFinal, perCard };
      })();

      // Option B — full internal consistency. Option A (month0PaymentLedger above) only overrides
      // the ledger the engine reads for CASH; the SIM itself still paid the raw, un-floor-capped
      // month-0 amount, so its month-0-end balances ran ~$176 low (Discover projected balance under-
      // stated across the net-worth / total-debt / Debt-Payoff trajectory). Pinning each card's
      // month 0 to its perCardAdjustedFinal amount makes the sim ACTUALLY pay the augmented-floor-
      // capped payment, so every sim-derived field — balances, interest, payoff month — is consistent
      // with the recommendation and the popup. Months 1+ are left free, so the tuned Q6-Q12
      // convergence keeps solving them; it merely carries the extra ~$176 forward on the pinned card,
      // which the free months pay down. The pins are integers matching perCardAdjustedFinal exactly,
      // so buildPaymentLedger(pinnedSim)[0] equals month0PaymentLedger and the ledger override is now
      // redundant-but-consistent (kept so the popup still reconciles to the penny). Baked into BOTH
      // resim closures below via mergeM0FloorPins so every FROM-BASE convergence pass keeps the pin;
      // a user pin (Anomaly B withPaymentOverrides) for the same card/month wins over the floor pin.
      const m0FloorPins: { [cardId: string]: Record<number, number> } = {};
      for (const p of perCardAdjustedFinal) {
        m0FloorPins[p.id] = { 0: p.payment };
      }
      const mergeM0FloorPins = (
        pins?: { [cardId: string]: Record<number, number> },
      ): { [cardId: string]: Record<number, number> } => {
        const merged: { [cardId: string]: Record<number, number> } = {};
        for (const [id, months] of Object.entries(m0FloorPins)) merged[id] = { ...months };
        if (pins) for (const [id, months] of Object.entries(pins)) merged[id] = { ...(merged[id] ?? {}), ...months };
        return merged;
      };

      // First month where activeSim's total revolving balance is settled (all revolving cards
      // paid, sub-dollar dust tolerated — Q10). Mirrors Forecast.tsx's milestone condition.
      const simRevolvingPayoffMonth: number | null = firstRevolvingPayoffMonth(
        activeSim.monthlyRevolvingBalances,
        cards.map(c => c.id),
        PROJECTION_MONTHS,
      );

      // Phase 2 Option C step 3: replay the ACTIVE sim's exact args with the engine's per-month
      // revolving debt cash as param #20, rebuild sim-derived fields via the pure builder, keep
      // the live-anchored month-0 machinery and look-ahead outputs from this base result. See
      // the CardProjectionResult.resimulateWithDebtCash JSDoc for the month-0 NaN contract.
      const replayActiveSim = (
        target?: number[],
        forecastMaxDebtPaymentByMonth?: number[],
        pinnedPayments?: { [cardId: string]: Record<number, number> },
      ) => simulateVariablePayoff(
        cards,
        debtFundingBalance,
        debtPayoffOptions.cashFloor,
        debtStrategy,
        monthlyTakeHome,
        monthlyExpenses,
        PROJECTION_MONTHS,
        simulationMonthEvents,
        undefined,
        cardPurchasesPerMonth,
        m0Income,
        activeSimM0Expenses,
        oneTimeArrWithDP,
        m0SafeFloor,
        // Forecast's own PASS-2 cap, when supplied, is authoritative for Step 2's cycling-pool
        // cap during convergence — the same number Step 5's revolving cascade already follows
        // via `target` below. Without this, cycling-only save-up months (no revolving debt left)
        // kept following the sim's own, independently-computed look-ahead instead of Forecast's.
        forecastMaxDebtPaymentByMonth ?? activeSimMaxDebt,
        augmentedCashFloorByMonth,
        ccMinInFloorByMonth,
        installmentChargeByMonth,
        upfrontPayByMonth,
        target,
        pinnedPayments,
      );

      // Pins are baked into the closure (not passed per call) because the convergence loop
      // always resims FROM BASE — a per-call pin argument would be dropped on every pass
      // after the first.
      const makeResimulate = (pinnedPayments?: { [cardId: string]: Record<number, number> }) => {
        const resim = (target: number[], forecastMaxDebtPaymentByMonth?: number[]): CardProjectionResult => {
          const simT = replayActiveSim(target, forecastMaxDebtPaymentByMonth, mergeM0FloorPins(pinnedPayments));
          const resimFields = buildResimOverrides(simT, {
            cards, cardPurchasesPerMonth, now, saveUpMonths, maxDebtPaymentByMonth, month0PaymentLedger,
          });
          return { ...hookResult, ...resimFields, resimulateWithDebtCash: resim };
        };
        return resim;
      };
      const resimulateWithDebtCash = makeResimulate();

      // Anomaly B: same result rebuilt with user month-pins applied — base sim AND the
      // resimulateWithDebtCash closure both carry the pins, so a convergence loop run on
      // the variant keeps them on every pass.
      const withPaymentOverrides = (pinnedPayments: { [cardId: string]: Record<number, number> }): CardProjectionResult => {
        const simP = replayActiveSim(undefined, undefined, mergeM0FloorPins(pinnedPayments));
        const resimFields = buildResimOverrides(simP, {
          cards, cardPurchasesPerMonth, now, saveUpMonths, maxDebtPaymentByMonth, month0PaymentLedger,
        });
        return { ...hookResult, ...resimFields, resimulateWithDebtCash: makeResimulate(pinnedPayments), withPaymentOverrides };
      };

      // Mirrors credit-card-engine's manualStatementByCard eligibility + due-month derivation
      // (synthetic ISB pin): a statement-preference card with a manual statement balance and a
      // live balance, active from month 0, pays exactly the pinned amount at its due month.
      // Only months > 0 matter here — month 0 is already excluded from convergence feedback.
      const manualIsbPins = cards
        .filter(c => {
          if (c.paymentPreference !== 'statement' || c.statementBalance == null || c.balance <= 0) return false;
          if (c.startDate) {
            const startD = new Date(c.startDate + 'T00:00:00');
            const diff = (startD.getFullYear() - now.getFullYear()) * 12 + (startD.getMonth() - now.getMonth());
            if (diff > 0) return false;
          }
          return true;
        })
        .map(c => ({
          month: c.dueDay != null && c.dueDay >= now.getDate() ? 0 : 1,
          amount: Math.max(0, c.statementBalance!),
          minPayment: Number(c.minPayment || 0),
        }))
        .filter(p => p.month > 0);

      const hookResult: CardProjectionResult = {
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
        monthlyCyclingOwed: activeSim.monthlyCyclingOwed,
        monthlyCyclingInterest: activeSim.monthlyCyclingInterest,
        monthlyInterest: activeSim.monthlyInterest,
        monthlyCyclingBacklog: activeSim.monthlyCyclingBacklog,
        monthlyMandatoryCyclingPayment: activeSim.monthlyMandatoryCyclingPayment,
        // Month 0: overwrite ledger[0] with the augmented-floor-capped entry (see month0PaymentLedger
        // above). The engine consumes the RESIM ledger, not this base one, so the same override is
        // also threaded through the two buildResimOverrides ctx objects; this base override keeps the
        // non-resim hookResult self-consistent. Months 1+ stay raw-sim (tuned convergence untouched).
        paymentLedger: buildPaymentLedger(activeSim, cards).map((entry, i) => (i === 0 ? month0PaymentLedger : entry)),
        maxDebtPaymentByMonth,
        m0Income,
        m0Expenses,
        m0SafeFloor,
        debtFundingAccountId: resolvedDebtFundingId ?? null,
        saveUpMonths,
        strictSaveUpMonths,
        saveUpReason,
        forecastRevolvingPayoffMonth,
        simRevolvingPayoffMonth,
        manualIsbPins,
        forecastAdjustedRevolvingBalances,
        resimulateWithDebtCash,
        withPaymentOverrides,
        month0: {
          safeToPayTotal: safeToPayTotalFinal,
          maxCapacity: Math.round(maxCapacity),
          holdback: Math.round(holdback),
          holdbackEvent,
          cyclingPayment: Math.round(cyclingPayment),
          revolvingPayment: Math.round(revolvingPaymentFinal),
          perCardAdjusted: perCardAdjustedFinal,
          m0SafeFloor: Math.round(m0FloorAugmented),
          carReserve: Math.round(carReserve),
          carReserveEvent: carReserveEvent ? { vehicleName: carReserveEvent.vehicle_name as string } : null,
          carReserveHeld: Math.round(carReserveHeld),
          // Finding §1.1 — the ONE definition of month-end cash. Mirrors forecast-engine.ts's
          // `endingCash` for i=0: finalLiquid (cashPreDebt − the month-0 payment ledger total,
          // which safeToPayTotalFinal equals by construction — see month0PaymentLedger below)
          // plus the reserved-but-unspent vehicle savings the engine adds back for display.
          endCash: m0Chain.cashPreDebt - safeToPayTotalFinal + Math.round(carReserveHeld),
          vehicleInsurance: Math.round(m0VehicleInsurance),
          mortgagePayment: Math.round(m0MortgagePayment),
          chain: m0Chain,
        },
      };
      // Option B: rebuild the RETURNED base result's sim-derived fields from a month-0-pinned sim so
      // the fields Dashboard / Debt Payoff read DIRECTLY (not only through engine convergence) reflect
      // the augmented-floor-capped month-0 payment. month0 (the recommendation), income and save-up
      // sets stay from hookResult; the resimulateWithDebtCash / withPaymentOverrides closures already
      // bake the same pins so every convergence pass stays consistent.
      const m0PinnedSim = replayActiveSim(undefined, undefined, mergeM0FloorPins());
      const m0PinnedFields = buildResimOverrides(m0PinnedSim, {
        cards, cardPurchasesPerMonth, now, saveUpMonths, maxDebtPaymentByMonth, month0PaymentLedger,
      });
      const finalResult: CardProjectionResult = { ...hookResult, ...m0PinnedFields };
      if (import.meta.env.DEV) attachSimDebug(finalResult);
      return finalResult;
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
