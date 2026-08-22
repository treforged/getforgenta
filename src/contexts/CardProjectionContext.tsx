import { createContext, useContext, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  useAccounts, useTransactions, useRecurringRules, useDebts,
  useSavingsGoals, useCarFunds, useProfile, usePaymentPlans, useSyncedTransactions,
  useSyncedTransactionReviews,
} from '@/hooks/useSupabaseData';
import { buildConfirmedOccurrences } from '@/lib/confirmed-capture';
import { buildAutoMatchedOccurrences, mergeConfirmedOccurrences } from '@/lib/auto-matched-occurrences';
import { usePlaidItems } from '@/hooks/usePlaidItems';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useCardProjection, type CardProjectionResult } from '@/hooks/useCardProjection';
import { useForecastEngineInputs, type ForecastEngineInputsBundle } from '@/hooks/useForecastEngineInputs';
import { buildPayConfig, type PayScheduleConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents, PROJECTION_MONTHS, type ScheduledEvent } from '@/lib/scheduling';
import { calculateForecast, type ForecastInputs, type ForecastResult } from '@/lib/forecast-engine';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import { resolveFundingAccountId } from '@/lib/funding-account';
import { resolveSyncCutoffDate } from '@/lib/sync-cutoff';
import type { FilingStatus } from '@/lib/tax-estimator';
import { resolveCashFloor } from '@/lib/cash-floor';

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: true, incomeGrowth: 3, raiseMonth: 3, raiseMode: 'pct' as 'pct' | 'flat',
  investmentGrowth: 7, savingsInterest: 4.5,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as 'flat' | 'pct', bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnFilingStatus: 'single' as FilingStatus, taxReturnDependents: 0,
  taxReturnState: 'FL', taxReturnFederalWithheld: 0, taxReturnMonth: 2, taxReturnAmountOverride: 0,
  promotions: [] as { id: string; effectiveDate: string; newAnnualSalary: number }[],
};

export type AssumptionsType = typeof DEFAULT_ASSUMPTIONS;
export type PromotionEntry = AssumptionsType['promotions'][number];

type DebtPayoffOptions = {
  strategy: 'avalanche' | 'snowball';
  paymentMode: 'variable';
  cashFloor: number;
  overrides: Record<string, Record<number, number>>;
};

interface CardProjectionContextValue {
  /** Debt-cash-CONVERGED projection when the loop settles; the raw sim otherwise. */
  cardProjection: CardProjectionResult | null;
  /** Engine run matching `cardProjection` — the single authoritative forecast. */
  projections: ForecastResult;
  engineInputs: ForecastInputs;
  forecastInputsBundle: ForecastEngineInputsBundle;
  debtCashConverged: boolean;
  assumptions: AssumptionsType;
  setAssumptions: (val: AssumptionsType | ((prev: AssumptionsType) => AssumptionsType)) => void;
  pauseSavings: boolean;
  setPauseSavings: (val: boolean | ((prev: boolean) => boolean)) => void;
  debtStrategy: 'avalanche' | 'snowball';
  payConfig: PayScheduleConfig;
  cashFloor: number;
  forecastFundingAccountId: string | null;
  syncCutoffDate: string;
  scheduledEvents: ScheduledEvent[];
  debtPayoffOptions: DebtPayoffOptions;
}

const CardProjectionContext = createContext<CardProjectionContextValue | null>(null);

export function CardProjectionProvider({ children }: { children: ReactNode }) {
  const { data: accounts } = useAccounts();
  const { data: transactions } = useTransactions();
  const { data: rules } = useRecurringRules();
  const { data: debts } = useDebts();
  const { data: goals } = useSavingsGoals();
  const { data: carFunds } = useCarFunds();
  const { data: profile, update: updateProfile } = useProfile();
  const { data: paymentPlans } = usePaymentPlans();
  const { items: plaidItems } = usePlaidItems();


  const [pauseSavings, setPauseSavings] = usePersistedState<boolean>('tre:debtpayoff:pause-savings', false);
  const [debtStrategy] = usePersistedState<'avalanche' | 'snowball'>('tre:debt:strategy', 'avalanche');
  const [persistedDebtFundingId] = usePersistedState<string>('tre:debt:fundingAccount', '');

  const [assumptions, setAssumptionsState] = useState<AssumptionsType>(DEFAULT_ASSUMPTIONS);
  const assumptionsLoaded = useRef(false);
  const assumptionsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (profile && !assumptionsLoaded.current) {
      const saved = profile.forecast_assumptions as (Partial<AssumptionsType> & { taxOverride?: unknown }) | null;
      if (saved && typeof saved === 'object') {
        const { taxOverride: _dropped, ...migrated } = { ...saved };
        // One-shot hydration of the saved forecast assumptions, guarded by
        // assumptionsLoaded so it can never re-run and clobber user edits. The
        // assumptions are user-editable and debounce-saved back to the profile,
        // so they cannot be derived from it; the profile query resolves after
        // mount, so a lazy initializer cannot cover this either.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAssumptionsState(prev => ({ ...prev, ...migrated }));
        assumptionsLoaded.current = true;
      }
    }
  }, [profile]);

  const setAssumptions = useCallback(
    (val: AssumptionsType | ((prev: AssumptionsType) => AssumptionsType)) => {
      setAssumptionsState(prev => {
        const next = typeof val === 'function' ? val(prev) : val;
        if (assumptionsSaveTimer.current) clearTimeout(assumptionsSaveTimer.current);
        assumptionsSaveTimer.current = setTimeout(() => {
          updateProfile.mutate({ forecast_assumptions: next });
        }, 800);
        return next;
      });
    },
    [updateProfile],
  );

  const payConfig = useMemo(() => buildPayConfig(profile), [profile]);

  // Automatic by default: `resolveCashFloor` returns 0, and `getMinSafeCash` then takes the
  // greater of that and the pre-paycheck bills — so the floor IS the bills. See cash-floor.ts.
  const cashFloor = useMemo(() => resolveCashFloor(profile), [profile]);

  const forecastFundingAccountId = useMemo((): string | null => {
    // Same validation rule the engine applies to the persisted debt-funding id — see
    // `src/lib/funding-account.ts` and finding §2.8.
    const fromProfile = resolveFundingAccountId(accounts ?? [], profile?.default_deposit_account);
    if (fromProfile) return fromProfile;
    const checking = (accounts ?? []).find(a => a.active && a.account_type === 'checking');
    return (checking?.id as string) ?? null;
  }, [accounts, profile]);

  // Finding §1.1 cause C: the rule lives in `src/lib/sync-cutoff.ts` now. This used to return the
  // raw sync date (or today, when the account had no Plaid link at all), which treated a payment
  // as already in the balance the day after it was due — but we store `balances.current`, which
  // excludes pending, so it may not be there yet. `resolveSyncCutoffDate` applies the settlement
  // lag and prefers `updated_at` over "today" for manually-maintained accounts.
  const syncCutoffDate = useMemo((): string => {
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const fundingAcct = forecastFundingAccountId
      ? (accounts ?? []).find(a => a.id === forecastFundingAccountId)
      : undefined;
    const plaidItem = fundingAcct?.plaid_item_id
      ? plaidItems.find(pi => pi.plaid_item_id === fundingAcct.plaid_item_id)
      : undefined;
    return resolveSyncCutoffDate({
      lastSyncedAt: plaidItem?.last_synced_at,
      balanceUpdatedAt: (fundingAcct as { updated_at?: string } | undefined)?.updated_at,
      today: localDate,
    });
  }, [forecastFundingAccountId, accounts, plaidItems]);

  // §1A Stage C part 2 — the settled transactions the month-0 capture gates consult.
  //
  // CURRENT month only: Stage C gates month 0 and nothing else, since every later month is
  // entirely in the future and no balance reflects it. `useSyncedTransactions` fetches the month
  // ± SYNCED_TXN_FETCH_SLACK_DAYS (7), comfortably wider than the matcher's DATE_WINDOW_DAYS (5),
  // so a month-0 due date's whole match window is always inside the fetch. Truncation at the
  // fetch edges can only raise the observed earliest and lower the observed latest, i.e. only ever
  // REDUCE claimed coverage — which falls back to the date heuristic, the safe direction.
  //
  // Fetched HERE, once, and handed to both `useCardProjection` and `useForecastEngineInputs`
  // below. Two independent fetches would be two array identities and, at the margins of a refetch,
  // two different answers for the same car payment — the precise shape of finding §1.1 cause C.
  const currentMonthKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);
  const { data: syncedTransactions } = useSyncedTransactions(currentMonthKey);

  // §1B Stage 4A — the rule occurrences the user confirmed a bank transaction already paid.
  // `useForecastEngineInputs` reads the same react-query cache entry and builds its own set; both
  // therefore see identical contents, unlike `syncedTransactions` above (whose two fetches could
  // genuinely diverge, which is why that one is fetched here and handed to both).
  const { data: syncedReviews } = useSyncedTransactionReviews();
  /**
   * The manual confirmations, unioned with the ones the bank already proves.
   *
   * ⚠️ THE SAME UNION MUST HAPPEN IN `useForecastEngineInputs`, and it does. These two build their
   * own sets from the same react-query cache entry, so they can only agree if they agree by
   * construction — the §1.1-cause-C lesson about two surfaces gating the same charge. Both call
   * `buildAutoMatchedOccurrences` over `syncedTransactions`, which is fetched once above precisely
   * so the two cannot see different rows.
   */
  const confirmedOccurrences = useMemo(
    () => mergeConfirmedOccurrences(
      buildConfirmedOccurrences(syncedReviews ?? []),
      buildAutoMatchedOccurrences({ rules: rules ?? [], transactions: syncedTransactions, month: new Date() }),
    ),
    [syncedReviews, rules, syncedTransactions],
  );

  const scheduledEvents = useMemo(
    () => generateScheduledEvents(rules ?? [], accounts ?? [], PROJECTION_MONTHS),
    [rules, accounts],
  );

  const debtPayoffOptions = useMemo<DebtPayoffOptions>(() => ({
    strategy: debtStrategy,
    paymentMode: 'variable',
    cashFloor,
    overrides: {},
  }), [cashFloor, debtStrategy]);

  const projectionAssumptions = useMemo(() => ({
    incomeGrowthEnabled: assumptions.incomeGrowthEnabled,
    incomeGrowth: assumptions.incomeGrowth,
    raiseMonth: assumptions.raiseMonth,
    raiseMode: assumptions.raiseMode,
    bonusEnabled: assumptions.bonusEnabled,
    bonusAmount: assumptions.bonusAmount,
    bonusMode: assumptions.bonusMode,
    bonusMonth: assumptions.bonusMonth,
    bonusRecurring: assumptions.bonusRecurring,
    taxReturnEnabled: assumptions.taxReturnEnabled,
    taxReturnAmountOverride: assumptions.taxReturnAmountOverride ?? 0,
    taxReturnMonth: assumptions.taxReturnMonth,
    // Tax-estimator identity inputs — thread through so the sim runs the same estimator as the
    // engine (parity for the CC-projection popup's displayed income).
    taxReturnFilingStatus: assumptions.taxReturnFilingStatus,
    taxReturnDependents: assumptions.taxReturnDependents,
    taxReturnState: assumptions.taxReturnState,
    taxReturnFederalWithheld: assumptions.taxReturnFederalWithheld,
    // Sim/engine income parity: without this the sim never sees scheduled promotions while the
    // engine does, and the convergence loop settles on a degenerate fixed point that can short
    // a cycling card's statement (Q7: VX missed its full Jan 2029 statement).
    promotions: assumptions.promotions,
  }), [assumptions]);

  const cardProjection = useCardProjection({
    accounts: accounts ?? [],
    transactions: transactions ?? [],
    rules: rules ?? [],
    debts: debts ?? [],
    goals: goals ?? [],
    carFunds: carFunds ?? [],
    profile,
    debtPayoffOptions,
    payConfig,
    scheduledEvents,
    pauseSavings,
    forecastFundingAccountId,
    debtStrategy,
    persistedDebtFundingId,
    assumptions: projectionAssumptions,
    syncCutoffDate,
    paymentPlans: paymentPlans ?? [],
    syncedTransactions,
    confirmedOccurrences,
  });

  const forecastInputsBundle = useForecastEngineInputs({
    cardProjectionData: cardProjection,
    assumptions,
    pauseSavings,
    payConfig,
    cashFloor,
    forecastFundingAccountId,
    syncCutoffDate,
    syncedTransactions,
    scheduledEvents,
    debtPayoffOptions,
  });

  // Phase 2 Option C: converge the sim's debt cash with the engine's monthly debtPayment so
  // popup payments == accordion payments+surplus. Not converged within the pass budget (or no
  // sim yet) ⇒ publish the raw pair — Option A display machinery is the zero-regression fallback.
  const convergence = useMemo(() => {
    if (!cardProjection) {
      return {
        cardProjection: null,
        projections: calculateForecast(forecastInputsBundle.engineInputs),
        converged: false,
        passes: 0,
      };
    }
    return runDebtCashConvergence(cardProjection, forecastInputsBundle.engineInputs);
  }, [cardProjection, forecastInputsBundle.engineInputs]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__convergenceDebug = {
        converged: convergence.converged,
        passes: convergence.passes,
        usedFallback: convergence.cardProjection === cardProjection && !convergence.converged,
        // Converged projection + capture inputs, exposed for live debugging and for recapturing
        // the golden fixture WITH debtPayoffOptions (the projection-harness fidelity gap).
        convergedProjection: convergence.cardProjection,
        // The converged ForecastResult (engine rows incl. rawEndingCash/rawMonthMinSafe) —
        // convergedProjection above is the SIM side only.
        forecastResult: convergence.projections,
        engineInputs: forecastInputsBundle.engineInputs,
        debtPayoffOptions,
      };
    }
  }, [convergence, cardProjection, forecastInputsBundle.engineInputs, debtPayoffOptions]);

  const engineInputs = useMemo<ForecastInputs>(() => (
    convergence.cardProjection === forecastInputsBundle.engineInputs.cardProjectionData
      ? forecastInputsBundle.engineInputs
      : { ...forecastInputsBundle.engineInputs, cardProjectionData: convergence.cardProjection }
  ), [convergence.cardProjection, forecastInputsBundle.engineInputs]);

  const value = useMemo<CardProjectionContextValue>(() => ({
    cardProjection: convergence.cardProjection,
    projections: convergence.projections,
    engineInputs,
    forecastInputsBundle,
    debtCashConverged: convergence.converged,
    assumptions,
    setAssumptions,
    pauseSavings,
    setPauseSavings,
    debtStrategy,
    payConfig,
    cashFloor,
    forecastFundingAccountId,
    syncCutoffDate,
    scheduledEvents,
    debtPayoffOptions,
  }), [
    convergence, engineInputs, forecastInputsBundle, assumptions, setAssumptions,
    pauseSavings, setPauseSavings, debtStrategy, payConfig, cashFloor,
    forecastFundingAccountId, syncCutoffDate, scheduledEvents, debtPayoffOptions,
  ]);

  return (
    <CardProjectionContext.Provider value={value}>
      {children}
    </CardProjectionContext.Provider>
  );
}

export function useCardProjectionContext(): CardProjectionContextValue {
  const ctx = useContext(CardProjectionContext);
  if (!ctx) throw new Error('useCardProjectionContext must be used within CardProjectionProvider');
  return ctx;
}
