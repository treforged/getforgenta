import { createContext, useContext, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  useAccounts, useTransactions, useRecurringRules, useDebts,
  useSavingsGoals, useCarFunds, useProfile, usePaymentPlans,
} from '@/hooks/useSupabaseData';
import { usePlaidItems } from '@/hooks/usePlaidItems';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useCardProjection, type CardProjectionResult } from '@/hooks/useCardProjection';
import { buildPayConfig, type PayScheduleConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents, PROJECTION_MONTHS } from '@/lib/scheduling';
import type { FilingStatus } from '@/lib/tax-estimator';

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: true, incomeGrowth: 3, raiseMonth: 3, raiseMode: 'pct' as 'pct' | 'flat',
  investmentGrowth: 7, savingsInterest: 4.5,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as 'flat' | 'pct', bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnFilingStatus: 'single' as FilingStatus, taxReturnDependents: 0,
  taxReturnState: 'FL', taxReturnFederalWithheld: 0, taxReturnMonth: 2, taxReturnAmountOverride: 0,
};

type AssumptionsType = typeof DEFAULT_ASSUMPTIONS;

type DebtPayoffOptions = {
  strategy: 'avalanche' | 'snowball';
  paymentMode: 'variable';
  cashFloor: number;
  overrides: Record<string, Record<number, number>>;
};

interface CardProjectionContextValue {
  cardProjection: CardProjectionResult | null;
  assumptions: AssumptionsType;
  setAssumptions: (val: AssumptionsType | ((prev: AssumptionsType) => AssumptionsType)) => void;
  pauseSavings: boolean;
  setPauseSavings: (val: boolean | ((prev: boolean) => boolean)) => void;
  debtStrategy: 'avalanche' | 'snowball';
  payConfig: PayScheduleConfig;
  cashFloor: number;
  forecastFundingAccountId: string | null;
  syncCutoffDate: string;
  scheduledEvents: any[];
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
      const saved = (profile as any).forecast_assumptions;
      if (saved && typeof saved === 'object') {
        const { taxOverride: _dropped, ...migrated } = { ...saved };
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

  const cashFloor = useMemo(() => {
    const cf = (profile as any)?.cash_floor;
    return cf != null ? Number(cf) : 1000;
  }, [profile]);

  const forecastFundingAccountId = useMemo((): string | null => {
    const defaultId = (profile as any)?.default_deposit_account;
    if (defaultId) {
      const acct = (accounts ?? []).find(
        (a: any) => a.id === defaultId && a.active && ['checking', 'business_checking', 'cash'].includes(a.account_type),
      );
      if (acct) return acct.id as string;
    }
    const checking = (accounts ?? []).find((a: any) => a.active && a.account_type === 'checking');
    return (checking?.id as string) ?? null;
  }, [accounts, profile]);

  const syncCutoffDate = useMemo((): string => {
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (!forecastFundingAccountId) return localDate;
    const fundingAcct = (accounts ?? []).find((a: any) => a.id === forecastFundingAccountId);
    if (!fundingAcct?.plaid_item_id) return localDate;
    const plaidItem = plaidItems.find((pi: any) => pi.plaid_item_id === fundingAcct.plaid_item_id);
    if (!plaidItem?.last_synced_at) return localDate;
    return plaidItem.last_synced_at.split('T')[0];
  }, [forecastFundingAccountId, accounts, plaidItems]);

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
  });

  const value = useMemo<CardProjectionContextValue>(() => ({
    cardProjection,
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
    cardProjection, assumptions, setAssumptions, pauseSavings, setPauseSavings,
    debtStrategy, payConfig, cashFloor, forecastFundingAccountId, syncCutoffDate,
    scheduledEvents, debtPayoffOptions,
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
