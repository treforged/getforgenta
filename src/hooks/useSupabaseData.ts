import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { toast } from 'sonner';
import { sanitizePayload } from '@/lib/sanitize';
import {
  demoAssets, demoLiabilities, demoDebts, demoSavingsGoals, demoCarFunds, demoTransactions,
  demoNetWorthSnapshots, demoCarBuilds, demoCarBuildPhases, demoCarBuildItems,
  demoCarMaintenanceLogs,
} from '@/lib/demo-data';
import { PaymentPlan } from '@/lib/payment-plan-generator';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';
import type { CarBuild, CarBuildPhase, CarBuildItem, CarFund, CarMaintenanceLog } from '@/lib/types';
import type { PublicMaintenanceEntry } from '@/lib/public-maintenance';
import {
  validateReviewInput, validateReviewSet, findExclusiveReview, findReviewRowFor, applyReviewToSet,
  friendlyReviewWriteError,
  type ReviewInput, type ReviewStatus, type CarChargeKind,
} from '@/lib/synced-transaction-review';
import type { LedgerDraft } from '@/lib/synced-transaction-import';

// ─── Accounts (Centralized) ──────────────────────────────
// FIX #13: Demo accounts now have realistic balances that produce
// meaningful forecast projections. Checking balance supports the
// cash floor while showing debt payoff in action.
const demoAccounts = [
  { id: 'd1', user_id: 'demo', name: 'Chase Checking', account_type: 'checking', institution: 'Chase', balance: 2800, credit_limit: null, apr: null, active: true, notes: 'Primary checking', created_at: '', updated_at: '' },
  { id: 'd2', user_id: 'demo', name: 'Alliant Checking', account_type: 'checking', institution: 'Alliant', balance: 1000, credit_limit: null, apr: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'd3', user_id: 'demo', name: 'Marcus HYS', account_type: 'high_yield_savings', institution: 'Marcus', balance: 5800, credit_limit: null, apr: 4.5, active: true, notes: 'Emergency fund', created_at: '', updated_at: '' },
  { id: 'd4', user_id: 'demo', name: 'Fidelity 401k', account_type: '401k', institution: 'Fidelity', balance: 8500, credit_limit: null, apr: null, active: true, notes: 'Employer match 4%', created_at: '', updated_at: '' },
  { id: 'd5', user_id: 'demo', name: 'Roth IRA', account_type: 'roth_ira', institution: 'Fidelity', balance: 4200, credit_limit: null, apr: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'd6', user_id: 'demo', name: 'Robinhood', account_type: 'brokerage', institution: 'Robinhood', balance: 2000, credit_limit: null, apr: null, active: true, notes: 'Index funds', created_at: '', updated_at: '' },
  { id: 'd7', user_id: 'demo', name: 'Chase Sapphire', account_type: 'credit_card', institution: 'Chase', balance: 8500, credit_limit: 12000, apr: 22.99, active: true, notes: '', created_at: '', updated_at: '', payment_due_day: 15, payment_preference: 'statement' },
  { id: 'd8', user_id: 'demo', name: 'Discover It', account_type: 'credit_card', institution: 'Discover', balance: 4200, credit_limit: 7500, apr: 18.99, active: true, notes: '', created_at: '', updated_at: '', payment_due_day: 22, payment_preference: 'full' },
  { id: 'd9', user_id: 'demo', name: 'Cash', account_type: 'cash', institution: '', balance: 300, credit_limit: null, apr: null, active: true, notes: '', created_at: '', updated_at: '' },
];


export type AccountRow = Partial<Tables<'accounts'>> & {
  id: string; user_id: string; name: string; account_type: string; balance: number; active: boolean;
};

export function useAccounts() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['accounts', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async (): Promise<AccountRow[]> => {
      if (isDemo || !user) return demoAccounts;
      const { data, error } = await supabase.from('accounts').select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: Omit<TablesInsert<'accounts'>, 'user_id'>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('accounts').insert(sanitizePayload({ ...item, user_id: user.id }));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); toast.success('Account added'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string } & Partial<Tables<'accounts'>>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('accounts').update(sanitizePayload(item)).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); toast.success('Account updated'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('accounts').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); toast.success('Account deleted'); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Recurring Rules ─────────────────────────────────────
// FIX #14: Demo recurring rules now cover a full realistic budget with
// all rule types (income, expense, transfer, investment) so the forecast
// shows meaningful projections. Amounts are consistent with the demo
// profile's weekly_gross_income of $1875 @ 22% tax.
const demoRecurringRules = [
  // Income — $1875/week gross @ 22% tax = $1462.50 net per paycheck
  { id: 'r1', user_id: 'demo', name: 'Weekly Paycheck', amount: 1462.50, rule_type: 'income', frequency: 'weekly', due_day: 5, due_month: null, start_date: '2026-01-03', end_date: null, category: 'Other', payment_source: null, deposit_account: 'd1', active: true, notes: 'Friday deposits', created_at: '', updated_at: '' },
  // Fixed expenses
  { id: 'r2', user_id: 'demo', name: 'Rent', amount: 1600, rule_type: 'expense', frequency: 'monthly', due_day: 1, due_month: null, start_date: '2026-01-01', end_date: null, category: 'Bills', payment_source: 'd1', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'r3', user_id: 'demo', name: 'Utilities', amount: 200, rule_type: 'expense', frequency: 'monthly', due_day: 15, due_month: null, start_date: '2026-01-15', end_date: null, category: 'Bills', payment_source: 'd1', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'r4', user_id: 'demo', name: 'Car Insurance', amount: 280, rule_type: 'expense', frequency: 'monthly', due_day: 14, due_month: null, start_date: '2026-01-14', end_date: null, category: 'Car', payment_source: 'd1', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  // Variable expenses
  { id: 'r10', user_id: 'demo', name: 'Groceries', amount: 80, rule_type: 'expense', frequency: 'weekly', due_day: 6, due_month: null, start_date: '2026-01-06', end_date: null, category: 'Groceries', payment_source: 'd7', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'r11', user_id: 'demo', name: 'Gas', amount: 55, rule_type: 'expense', frequency: 'weekly', due_day: 3, due_month: null, start_date: '2026-01-03', end_date: null, category: 'Gas', payment_source: 'd1', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'r12', user_id: 'demo', name: 'Dining Out', amount: 120, rule_type: 'expense', frequency: 'monthly', due_day: 20, due_month: null, start_date: '2026-01-20', end_date: null, category: 'Dining', payment_source: 'd7', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  // Subscriptions
  { id: 'r5', user_id: 'demo', name: 'Amazon Prime', amount: 139, rule_type: 'expense', frequency: 'yearly', due_day: 15, due_month: 3, start_date: '2026-03-15', end_date: null, category: 'Subscriptions', payment_source: 'd7', deposit_account: null, active: true, notes: 'Annual renewal', created_at: '', updated_at: '' },
  { id: 'r13', user_id: 'demo', name: 'Streaming + Gym', amount: 85, rule_type: 'expense', frequency: 'monthly', due_day: 4, due_month: null, start_date: '2026-01-04', end_date: null, category: 'Subscriptions', payment_source: 'd7', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  // Transfers — savings and investments
  { id: 'r6', user_id: 'demo', name: 'Emergency Fund', amount: 300, rule_type: 'transfer', frequency: 'monthly', due_day: 5, due_month: null, start_date: '2026-01-05', end_date: null, category: 'Savings', payment_source: 'd1', deposit_account: 'd3', active: true, notes: 'HYS contribution', created_at: '', updated_at: '' },
  { id: 'r7', user_id: 'demo', name: '401k Contribution', amount: 375, rule_type: 'investment', frequency: 'monthly', due_day: 5, due_month: null, start_date: '2026-01-05', end_date: null, category: 'Investing', payment_source: 'd1', deposit_account: 'd4', active: true, notes: 'Pre-tax', created_at: '', updated_at: '' },
  { id: 'r8', user_id: 'demo', name: 'Roth IRA', amount: 250, rule_type: 'investment', frequency: 'monthly', due_day: 10, due_month: null, start_date: '2026-01-10', end_date: null, category: 'Investing', payment_source: 'd1', deposit_account: 'd5', active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'r9', user_id: 'demo', name: 'Brokerage', amount: 200, rule_type: 'investment', frequency: 'monthly', due_day: 10, due_month: null, start_date: '2026-01-10', end_date: null, category: 'Investing', payment_source: 'd1', deposit_account: 'd6', active: true, notes: 'Index funds', created_at: '', updated_at: '' },
  // Non-paycheck income — demonstrates Bug 2 fix (non-paycheck income included in simulation)
  { id: 'dr-roommate', user_id: 'demo', name: 'Roommate Contribution', amount: 900, rule_type: 'income', frequency: 'monthly', due_day: 1, due_month: null, start_date: '2026-01-01', end_date: null, category: 'Other', payment_source: null, deposit_account: 'd1', active: true, notes: 'Monthly rent split', created_at: '', updated_at: '' },
  // Explicit CC purchase rules — ensures monthlyNewPurchases is realistic for each card
  { id: 'dr-cc1', user_id: 'demo', name: 'Monthly Expenses', amount: 450, rule_type: 'expense', frequency: 'monthly', due_day: 5, due_month: null, start_date: '2026-01-05', end_date: null, category: 'Groceries', payment_source: 'account:d7', deposit_account: null, active: true, notes: 'Groceries & dining on Sapphire', created_at: '', updated_at: '' },
  { id: 'dr-cc2', user_id: 'demo', name: 'Subscriptions', amount: 85, rule_type: 'expense', frequency: 'monthly', due_day: 4, due_month: null, start_date: '2026-01-04', end_date: null, category: 'Subscriptions', payment_source: 'account:d8', deposit_account: null, active: true, notes: 'Streaming & services on Discover', created_at: '', updated_at: '' },
];

export type RuleRow = Partial<Tables<'recurring_rules'>> & {
  id: string; name: string; amount: number; rule_type: string; frequency: string; active: boolean;
  start_date: string | null; category: string;
};

export function useRecurringRules() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['recurring_rules', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async (): Promise<RuleRow[]> => {
      if (isDemo || !user) return demoRecurringRules;
      const { data, error } = await supabase.from('recurring_rules').select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: Omit<TablesInsert<'recurring_rules'>, 'user_id'>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      if (item.start_date && item.end_date && item.end_date < item.start_date) {
        throw new Error('End Date cannot be before Start Date');
      }
      const { error } = await supabase.from('recurring_rules').insert(sanitizePayload({ ...item, user_id: user.id }));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recurring_rules'] }); toast.success('Recurring rule added'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string } & Partial<Tables<'recurring_rules'>>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      if (item.start_date && item.end_date && item.end_date < item.start_date) {
        throw new Error('End Date cannot be before Start Date');
      }
      const { error } = await supabase.from('recurring_rules').update(sanitizePayload(item)).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recurring_rules'] }); toast.success('Recurring rule updated'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('recurring_rules').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
      // Deleting a rule must also scrub its id from savings_goals.linked_rule_ids /
      // linked_rule_id — the array column has no FK, so without this the goal keeps an
      // orphaned link that every consumer silently filters out (found live: a stale id
      // in Tre's Savings goal). car_funds is covered by a real FK; goals are not.
      const { data: linkedGoals, error: goalErr } = await supabase
        .from('savings_goals')
        .select('id, linked_rule_id, linked_rule_ids')
        .eq('user_id', user.id)
        .or(`linked_rule_id.eq.${id},linked_rule_ids.cs.{${id}}`);
      if (goalErr) throw goalErr;
      for (const g of linkedGoals ?? []) {
        const { error: updErr } = await supabase.from('savings_goals').update({
          linked_rule_id: g.linked_rule_id === id ? null : g.linked_rule_id,
          linked_rule_ids: (g.linked_rule_ids ?? []).filter((rid: string) => rid !== id),
        }).eq('id', g.id).eq('user_id', user.id);
        if (updErr) throw updErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring_rules'] });
      qc.invalidateQueries({ queryKey: ['savings_goals'] });
      toast.success('Recurring rule deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Assets ───────────────────────────────────────────────
export function useAssets() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['assets', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async () => {
      if (isDemo || !user) return demoAssets.map((a, i) => ({ ...a, id: String(i), user_id: 'demo', created_at: '', updated_at: '' }));
      const { data, error } = await supabase.from('assets').select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: { name: string; type: string; value: number; notes?: string }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('assets').insert(sanitizePayload({ ...item, user_id: user.id, notes: item.notes || '' }));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); toast.success('Asset added'); },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string; name?: string; type?: string; value?: number; notes?: string }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('assets').update(sanitizePayload(item)).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); toast.success('Asset updated'); },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('assets').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); toast.success('Asset deleted'); },
    onError: (e) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Liabilities ──────────────────────────────────────────
export function useLiabilities() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['liabilities', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async () => {
      if (isDemo || !user) return demoLiabilities.map((l, i) => ({ ...l, id: String(i), user_id: 'demo', created_at: '', updated_at: '' }));
      const { data, error } = await supabase.from('liabilities').select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: { name: string; type: string; balance: number; apr?: number; notes?: string }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('liabilities').insert(sanitizePayload({ ...item, user_id: user.id, notes: item.notes || '', apr: item.apr || 0 }));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['liabilities'] }); toast.success('Liability added'); },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string } & Partial<Tables<'liabilities'>>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('liabilities').update(sanitizePayload(item)).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['liabilities'] }); toast.success('Liability updated'); },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('liabilities').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['liabilities'] }); toast.success('Liability deleted'); },
    onError: (e) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Debts ────────────────────────────────────────────────
export type DebtRow = Partial<Tables<'debts'>> & {
  id: string; name: string; balance: number; apr: number; min_payment: number; target_payment: number;
};

export function useDebts() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['debts', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async (): Promise<DebtRow[]> => {
      if (isDemo || !user) return demoDebts.map((d, i) => ({ ...d, id: String(i), user_id: 'demo', created_at: '', updated_at: '', credit_limit: d.credit_limit || 0 }));
      const { data, error } = await supabase.from('debts').select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: { name: string; balance: number; apr: number; min_payment: number; target_payment: number; credit_limit?: number }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('debts').insert(sanitizePayload({ ...item, user_id: user.id }));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['debts'] }); toast.success('Debt added'); },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string } & Partial<Tables<'debts'>>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('debts').update(sanitizePayload(item)).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['debts'] }); toast.success('Debt updated'); },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('debts').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['debts'] }); toast.success('Debt deleted'); },
    onError: (e) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Account Reconciliations ──────────────────────────────
export function useAccountReconciliations() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['account_reconciliations', isDemo ? 'demo' : user?.id],
    enabled: !isDemo && !!user,
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase.from('account_reconciliations').select('*').eq('user_id', user.id).order('effective_date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: {
      account_id: string;
      source_table: 'accounts' | 'liabilities' | 'debts';
      effective_date: string;
      delta: number;
      actual_balance: number;
      projected_balance: number;
    }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('account_reconciliations').insert({ ...item, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['account_reconciliations'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, add };
}

// ─── Savings Goals ────────────────────────────────────────
export function useSavingsGoals() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['savings_goals', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async (): Promise<Partial<Tables<'savings_goals'>>[]> => {
      if (isDemo || !user) return demoSavingsGoals.map((g, i) => ({ ...g, id: String(i), user_id: 'demo', created_at: '', updated_at: '' }));
      const { data, error } = await supabase.from('savings_goals').select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: { name: string; target_amount: number; current_amount: number; monthly_contribution: number; target_date?: string | null }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('savings_goals').insert(sanitizePayload({ ...item, user_id: user.id }));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['savings_goals'] }); toast.success('Goal added'); },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string } & Partial<Tables<'savings_goals'>>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('savings_goals').update(sanitizePayload(item)).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['savings_goals'] }); toast.success('Goal updated'); },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('savings_goals').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['savings_goals'] }); toast.success('Goal deleted'); },
    onError: (e) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Car Funds ────────────────────────────────────────────
export function useCarFunds() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['car_funds', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async (): Promise<CarFund[]> => {
      if (isDemo || !user) return demoCarFunds.map((c, i) => ({ ...c, id: String(i), user_id: 'demo', created_at: '', updated_at: '' }));
      const { data, error } = await supabase.from('car_funds').select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return (data ?? []) as unknown as CarFund[];
    },
  });
  const add = useMutation({
    mutationFn: async (item: Omit<TablesInsert<'car_funds'>, 'user_id'>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('car_funds').insert(sanitizePayload({ ...item, user_id: user.id }));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_funds'] }); toast.success('Vehicle added'); },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string } & Partial<Tables<'car_funds'>>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('car_funds').update(sanitizePayload(item)).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_funds'] }); toast.success('Vehicle updated'); },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('car_funds').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_funds'] }); toast.success('Vehicle deleted'); },
    onError: (e) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Lump Sum Transfers ───────────────────────────────────
export function useLumpSumTransfers() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['lump_sum_transfers', isDemo ? 'demo' : user?.id],
    enabled: !isDemo && !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from('lump_sum_transfers').select('*').eq('user_id', user!.id).order('date');
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: { date: string; amount: number; label?: string | null; destination_type: string }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('lump_sum_transfers').insert(sanitizePayload({ ...item, user_id: user.id }));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lump_sum_transfers'] }); toast.success('Transfer planned'); },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string } & Partial<Tables<'lump_sum_transfers'>>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('lump_sum_transfers').update(sanitizePayload(item)).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lump_sum_transfers'] }); toast.success('Transfer updated'); },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('lump_sum_transfers').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lump_sum_transfers'] }); toast.success('Transfer removed'); },
    onError: (e) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Synced transactions (§1A, aggregator-owned, READ ONLY) ───────────────
//
// NOT the user's ledger. `synced_transactions` is written by the sync edge functions under the
// service role; RLS grants the client `select` and nothing else, and there is deliberately no
// add/update/remove here to match. The user's hand-entered transactions are `useTransactions`
// below — the two must never be merged, or the app appears to invent transactions nobody entered.
export type SyncedTransactionRow = Pick<
  Tables<'synced_transactions'>,
  'id' | 'account_id' | 'amount' | 'date' | 'pending' | 'name' | 'merchant_name'
>;

/** Slack either side of the month, ≥ the matcher's DATE_WINDOW_DAYS so no candidate is cut off. */
const SYNCED_TXN_FETCH_SLACK_DAYS = 7;

/**
 * Settled synced transactions overlapping `monthKey` (`YYYY-MM`), for rule matching.
 *
 * Scoped to the month plus a few days of slack either side, because a bill due on the 1st can post
 * in the prior month and the matcher looks ±DATE_WINDOW_DAYS around the due date. Fetching a
 * user's whole history would be thousands of rows to badge one screen.
 *
 * Demo mode returns nothing: there is no aggregator behind demo data, and inventing matches there
 * would put a "confirmed by your bank" badge on fixtures.
 */
export function useSyncedTransactions(monthKey: string) {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  return useQuery({
    queryKey: ['synced_transactions', isDemo ? 'demo' : user?.id, monthKey],
    enabled: isDemo || !!user,
    queryFn: async (): Promise<SyncedTransactionRow[]> => {
      if (isDemo || !user) return [];
      const [year, month] = monthKey.split('-').map(Number);
      const pad = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const from = pad(new Date(year, month - 1, 1 - SYNCED_TXN_FETCH_SLACK_DAYS));
      const to = pad(new Date(year, month, SYNCED_TXN_FETCH_SLACK_DAYS));
      const { data, error } = await supabase
        .from('synced_transactions')
        .select('id, account_id, amount, date, pending, name, merchant_name')
        .eq('user_id', user.id)
        .eq('pending', false)
        .gte('date', from)
        .lte('date', to);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** What the §1B Bank Activity tab reads. Adds `category` — the provider bucket the map suggests from. */
export type BankActivityRow = Pick<
  Tables<'synced_transactions'>,
  'id' | 'account_id' | 'amount' | 'date' | 'pending' | 'name' | 'merchant_name' | 'category'
>;

/**
 * PostgREST caps a single response (1000 rows by default), and it does so SILENTLY — a truncated
 * page looks exactly like a complete one. A history browser that quietly stops at row 1000 would
 * show a user their recent months and hide the rest with no indication, so the fetch below pages
 * explicitly rather than trusting one call.
 */
const SYNCED_TXN_PAGE_SIZE = 1000;

/** Refuses to loop forever if the server ever returns full pages without advancing. 50k rows. */
const SYNCED_TXN_MAX_PAGES = 50;

/**
 * EVERY settled synced transaction, all accounts, all history (§1B Stage 1).
 *
 * SEPARATE FROM `useSyncedTransactions` ON PURPOSE — do not merge them. That hook is month-scoped
 * because it exists to badge one screen and fetching a whole history to do that would be thousands
 * of rows per render. This one is the opposite requirement: Tre's call (2026-08-08) is that all
 * history is browsable, because history is the INPUT to discovering recurring rules at onboarding
 * (§1C), not merely an archive. Widening the month-scoped hook to serve both would silently make
 * the /budget badge pay this hook's cost.
 *
 * Pending rows are excluded here, as everywhere in §1A/§1B: a pending charge is not a fact yet.
 *
 * ⚠️ Absence of a row in `synced_transaction_reviews` for anything returned here means UNREVIEWED,
 * and unreviewed means nothing at all. With all history in scope most rows are permanently
 * unreviewed by design, so no caller may read it as "this did not happen".
 *
 * Demo mode returns nothing — there is no aggregator behind demo data, and inventing bank rows
 * would put fabricated "your bank says" claims on fixtures.
 */
export function useAllSyncedTransactions() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  return useQuery({
    queryKey: ['synced_transactions', 'all', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async (): Promise<BankActivityRow[]> => {
      if (isDemo || !user) return [];
      const rows: BankActivityRow[] = [];
      for (let page = 0; page < SYNCED_TXN_MAX_PAGES; page++) {
        const from = page * SYNCED_TXN_PAGE_SIZE;
        const { data, error } = await supabase
          .from('synced_transactions')
          .select('id, account_id, amount, date, pending, name, merchant_name, category')
          .eq('user_id', user.id)
          .eq('pending', false)
          .order('date', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + SYNCED_TXN_PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < SYNCED_TXN_PAGE_SIZE) break;
      }
      return rows;
    },
  });
}

// ─── Synced transaction reviews (§1B Stage 2 — the USER'S decisions, full CRUD) ───
//
// The mirror image of `synced_transactions` above: those are provider facts and the client may only
// read them, because a user edit to a provider fact is reverted by the next sync. These rows are
// the user's own assertions, so they get full owner CRUD.
//
// ABSENCE MEANS UNREVIEWED. There is deliberately no 'unreviewed' status, so this table only ever
// holds rows someone acted on and never needs a backfill.
export type SyncedTransactionReviewRow = Tables<'synced_transaction_reviews'>;

// The rules themselves are pure and live in `@/lib/synced-transaction-review`, so they can be
// tested without a Supabase client. Re-exported here because every consumer already imports its
// data from this module.
export {
  isHandledReview, validateReviewInput, validateReviewSet, isLinkStatus, LINK_STATUSES,
  findExclusiveReview, findReviewRowFor, applyReviewToSet, linkTarget,
} from '@/lib/synced-transaction-review';
export type { ReviewStatus, ReviewInput, CarChargeKind } from '@/lib/synced-transaction-review';
export { planLedgerImport } from '@/lib/synced-transaction-import';
export type { LedgerDraft, ImportPlan, ImportContext } from '@/lib/synced-transaction-import';

/**
 * §1B SPLIT LINK — EVERY decision already recorded about one charge.
 *
 * ⚠️ SLICE B'S POINT, WIDENED BY SLICE C. Every write below used to be an upsert with
 * `{ onConflict: 'synced_transaction_id' }`, which does not merely USE the UNIQUE constraint — it
 * REQUIRES it. Postgres has to infer an arbiter index from the column list, so the moment split
 * link relaxes that constraint all three writes fail outright with "no unique or exclusion
 * constraint matching the ON CONFLICT specification". A partial unique index does not rescue them
 * either: Postgres can only infer a partial index when the statement repeats its predicate, and
 * supabase-js `onConflict` takes a bare column list with no `WHERE`. So the code had to stop
 * depending on the constraint BEFORE the migration could drop it, and find-then-write is how.
 *
 * Slice B returned one id because one row was all a charge could hold. Slice C returns the SET,
 * because which of them a decision belongs to is now a real question — `findReviewRowFor` answers
 * it, and `applyReviewToSet` turns the answer into the set the validator judges. Under today's
 * UNIQUE the set is never longer than one, which is what keeps this shippable ahead of the migration.
 *
 * ⚠️ A LIVE SELECT, not the cached `query.data`. A stale cache miss would become an INSERT that
 * duplicates a decision; a stale cache HIT would update a row that no longer exists and silently
 * write nothing. Selecting `*` rather than `id` is deliberate — the set rules read nine columns, and
 * a charge holds a handful of rows at most.
 */
async function fetchChargeReviews(
  userId: string,
  syncedTransactionId: string,
): Promise<SyncedTransactionReviewRow[]> {
  const { data, error } = await supabase
    .from('synced_transaction_reviews')
    .select('*')
    .eq('user_id', userId)
    .eq('synced_transaction_id', syncedTransactionId);
  if (error) throw error;
  return data ?? [];
}

/** A stored row in the shape the pure set rules read. Narrows `status` back to the union. */
const asReviewInput = (row: SyncedTransactionReviewRow): ReviewInput => ({
  synced_transaction_id: row.synced_transaction_id,
  status: row.status as ReviewStatus,
  rule_id: row.rule_id,
  transaction_id: row.transaction_id,
  payment_plan_id: row.payment_plan_id,
  car_fund_id: row.car_fund_id,
  car_charge_kind: row.car_charge_kind as CarChargeKind | null,
  occurrence_month: row.occurrence_month,
  occurrence_date: row.occurrence_date,
  category_override: row.category_override,
});

export function useSyncedTransactionReviews() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['synced_transaction_reviews', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async (): Promise<SyncedTransactionReviewRow[]> => {
      if (isDemo || !user) return [];
      const { data, error } = await supabase
        .from('synced_transaction_reviews')
        .select('*')
        .eq('user_id', user.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Find-then-write, NOT an upsert — see `fetchChargeReviews`.
  //
  // ⚠️ WHICH ROW A DECISION LANDS ON IS THE WHOLE OF SPLIT LINK, and it is `findReviewRowFor`'s
  // answer, not this function's. An exclusive decision replaces the charge's exclusive row; a link
  // replaces the row naming the SAME rule, plan or vehicle charge, and otherwise INSERTS a new one.
  // That is what makes "link another" add a badge instead of silently overwriting the first — the
  // failure mode that would look to a user like the app forgetting what they just told it.
  //
  // ⚠️ EVERY COLUMN IS WRITTEN ON BOTH PATHS, including the nulls. Changing a decision must CLEAR
  // the fields the previous one set — a `linked_rule` becoming `ignored` while keeping its stale
  // `rule_id` would read as linked to any query that checks the FK without the status.
  const save = useMutation({
    mutationFn: async (input: ReviewInput) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const problem = validateReviewInput(input);
      if (problem) throw new Error(problem);
      const existing = await fetchChargeReviews(user.id, input.synced_transaction_id);
      // BOTH validators, as Slice A specified. The routing above already forecloses a second
      // exclusive row and a target linked twice, so this can only fire if that routing is wrong —
      // which is exactly when a sentence beats a Postgres constraint name. It also catches the one
      // rule routing cannot enforce: a `category_override` riding along on a link row.
      const setProblem = validateReviewSet(applyReviewToSet(existing.map(asReviewInput), input));
      if (setProblem) throw new Error(setProblem);
      const target = findReviewRowFor(existing, input);
      const fields = {
        status: input.status,
        rule_id: input.rule_id ?? null,
        transaction_id: input.transaction_id ?? null,
        payment_plan_id: input.payment_plan_id ?? null,
        car_fund_id: input.car_fund_id ?? null,
        car_charge_kind: input.car_charge_kind ?? null,
        occurrence_month: input.occurrence_month ?? null,
        occurrence_date: input.occurrence_date ?? null,
        category_override: input.category_override ?? null,
        updated_at: new Date().toISOString(),
      };
      const { error } = target
        ? await supabase.from('synced_transaction_reviews')
            .update(sanitizePayload(fields)).eq('id', target.id).eq('user_id', user.id)
        : await supabase.from('synced_transaction_reviews')
            .insert(sanitizePayload({
              user_id: user.id,
              synced_transaction_id: input.synced_transaction_id,
              ...fields,
            }));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['synced_transaction_reviews'] }); },
    onError: (e: Error) => toast.error(friendlyReviewWriteError(e) ?? e.message),
  });

  // Category is the one field a user edits WITHOUT taking a position on what the charge is, so it
  // gets its own path: overriding the category of an already-linked row must not disturb the link.
  const setCategory = useMutation({
    mutationFn: async ({ syncedTransactionId, category }: { syncedTransactionId: string; category: string | null }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      // The lookup moved off the cached `query.data` and onto the database for the same reason the
      // upsert below did: a stale cache decides INSERT vs UPDATE wrongly, and both wrong answers
      // fail silently or unactionably.
      //
      // ⚠️ THE EXCLUSIVE ROW SPECIFICALLY, and this is Tre's 2026-08-09 decision made mechanical.
      // A category describes the CHARGE, not any one of the several things the charge paid — a rent
      // debit split across Rent and Water has one merchant and one label, not two. Taking whichever
      // row came back first would scatter the override across link rows, and a charge asserting two
      // categories has no rule for which one wins. `validateReviewSet` rejects that state; this is
      // what stops it being reachable in the first place.
      const existing = await fetchChargeReviews(user.id, syncedTransactionId);
      const exclusive = findExclusiveReview(existing);
      if (exclusive) {
        const { error } = await supabase
          .from('synced_transaction_reviews')
          .update({ category_override: category, updated_at: new Date().toISOString() })
          .eq('id', exclusive.id)
          .eq('user_id', user.id);
        if (error) throw error;
        return;
      }
      // No decision yet, and correcting a label is not one. `'categorized'` exists precisely so
      // this write does not have to borrow a status that would assert the charge is handled.
      const { error } = await supabase
        .from('synced_transaction_reviews')
        .insert(sanitizePayload({
          user_id: user.id,
          synced_transaction_id: syncedTransactionId,
          status: 'categorized' satisfies ReviewStatus,
          category_override: category,
          updated_at: new Date().toISOString(),
        }));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['synced_transaction_reviews'] }); },
    onError: (e: Error) => toast.error(friendlyReviewWriteError(e) ?? e.message),
  });

  // §1B Stage 3 — THE ONLY PATH IN THIS FILE THAT TURNS A BANK CHARGE INTO MONEY.
  //
  // It lives here rather than in `useTransactions` because it spans two tables and the review row is
  // this hook's to own: the ledger row and the `'imported'` decision are one act, and a caller
  // holding two hooks would be free to do half of it.
  //
  // ⚠️ WHETHER the charge may be imported at all is NOT decided here — `planLedgerImport` decides
  // that and hands back the exact row, precisely so the guard and the row cannot drift apart.
  const importToLedger = useMutation({
    mutationFn: async ({ syncedTransactionId, draft }: { syncedTransactionId: string; draft: LedgerDraft }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { data: inserted, error: insertError } = await supabase
        .from('transactions')
        .insert(sanitizePayload({ ...draft, user_id: user.id }))
        .select()
        .single();
      if (insertError) throw insertError;

      // Find-then-write, like `save` — see `fetchChargeReviews`.
      //
      // ⚠️ THE EXCLUSIVE ROW, for the same reason `setCategory` takes it: `'imported'` is an
      // exclusive status, and import idempotency ("a row already imported cannot be imported twice")
      // is the one job of the dropped UNIQUE that must survive split link untouched. Writing
      // `'imported'` onto a link row would destroy a link AND leave the charge importable again.
      //
      // ⚠️ DELIBERATELY WRITES THE SAME COLUMNS THE UPSERT DID, no more. An upsert only updates the
      // columns it names, so an existing row's `rule_id` / `occurrence_month` survived an import
      // before this change, and they survive it now. That may or may not be what anyone wants, but
      // Slice B's contract is "exactly equivalent, minus the constraint dependency" — widening the
      // write here would change live data under cover of a refactor.
      //
      // ⚠️ THE LOOKUP IS A NEW FAILURE POINT BETWEEN THE MONEY AND THE REVIEW, so it is inside the
      // compensated region. Letting a failed SELECT throw straight out would leave a ledger row with
      // no review — the exact double-count state the rollback below exists to prevent, arrived at by
      // the refactor rather than by a bad button.
      const reviewFields = {
        status: 'imported' satisfies ReviewStatus,
        transaction_id: inserted.id,
        updated_at: new Date().toISOString(),
      };
      const reviewError = await (async () => {
        try {
          const existingExclusive = findExclusiveReview(await fetchChargeReviews(user.id, syncedTransactionId));
          const { error } = existingExclusive
            ? await supabase.from('synced_transaction_reviews')
                .update(sanitizePayload(reviewFields)).eq('id', existingExclusive.id).eq('user_id', user.id)
            : await supabase.from('synced_transaction_reviews')
                .insert(sanitizePayload({
                  user_id: user.id,
                  synced_transaction_id: syncedTransactionId,
                  ...reviewFields,
                }));
          return error;
        } catch (e) {
          return e as Error;
        }
      })();

      // ⚠️ ROLL THE MONEY BACK. A ledger row with no review is spending that counts in twelve
      // surfaces AND is still offered for import — the exact double-count this feature is built to
      // prevent, arrived at by a partial failure rather than a bad button. There is no transaction
      // across two PostgREST calls, so the compensation is the transaction.
      if (reviewError) {
        await supabase.from('transactions').delete().eq('id', inserted.id).eq('user_id', user.id);
        throw reviewError;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['synced_transaction_reviews'] });
      toast.success('Added to your ledger');
    },
    onError: (e: Error) => toast.error(friendlyReviewWriteError(e) ?? e.message),
  });

  // Undoing an IMPORT deletes the LEDGER ROW, not the review.
  //
  // ⚠️ Do not route this through `remove` below. That deletes only the review, which would leave the
  // money in `public.transactions` while telling the user the import was undone. The FK is
  // `ON DELETE CASCADE` (chosen for exactly this), so deleting the transaction removes the review
  // for free and returns the charge to unreviewed and re-importable.
  const undoImport = useMutation({
    mutationFn: async (transactionId: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('transactions').delete().eq('id', transactionId).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['synced_transaction_reviews'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Deleting a review returns the synced transaction to unreviewed — the honest state when a user
  // undoes a decision, and what makes an import re-importable after the ledger row is removed.
  const remove = useMutation({
    mutationFn: async (syncedTransactionId: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase
        .from('synced_transaction_reviews')
        .delete()
        .eq('synced_transaction_id', syncedTransactionId)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['synced_transaction_reviews'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  // §1B SPLIT LINK Slice B — undo ONE of a charge's decisions, by row.
  //
  // ⚠️ WHY THIS EXISTS ALONGSIDE `remove` RATHER THAN REPLACING IT. `remove` deletes by
  // `synced_transaction_id`, which under one-row-per-charge means "undo this decision" and under
  // split link silently becomes "undo EVERY link on this charge". Both are wanted — per-link undo on
  // a badge, undo-everything on the charge — so they are two mutations with two names instead of one
  // whose meaning changed under it when the constraint was dropped.
  const removeLink = useMutation({
    mutationFn: async (reviewId: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase
        .from('synced_transaction_reviews')
        .delete()
        .eq('id', reviewId)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['synced_transaction_reviews'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { data: query.data ?? [], loading: query.isLoading, error: query.error, save, setCategory, remove, removeLink, importToLedger, undoImport };
}

// ─── Transactions (the USER'S manual ledger — full CRUD) ──────────────────
export type TransactionRow = Partial<Tables<'transactions'>> & {
  id: string; user_id: string; date: string; type: string; amount: number; category: string;
};

export function useTransactions() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['transactions', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async (): Promise<TransactionRow[]> => {
      if (isDemo || !user) return demoTransactions.map((t, i) => ({ ...t, id: String(i), user_id: 'demo', created_at: '', updated_at: '', payment_source: t.payment_source || 'bank_account' }));
      const { data, error } = await supabase.from('transactions').select('*').eq('user_id', user.id).order('date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: { date: string; type: string; amount: number; category: string; account?: string; note?: string; payment_source?: string | null; car_build_item_id?: string | null; car_maintenance_log_id?: string | null }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { data, error } = await supabase.from('transactions').insert(sanitizePayload({ ...item, user_id: user.id, note: item.note || '', account: item.account || 'Checking' })).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transactions'] }); toast.success('Transaction added'); },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string } & Partial<Tables<'transactions'>>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('transactions').update(sanitizePayload(item)).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transactions'] }); toast.success('Transaction updated'); },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    // Accepts a bare id, or `{ id, silentSuccess }` when the delete is one half of a larger action
    // (N7's convert-to-plan) whose caller owns the single success toast. Errors always toast.
    mutationFn: async (vars: string | { id: string; silentSuccess?: boolean }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const id = typeof vars === 'string' ? vars : vars.id;
      const { error } = await supabase.from('transactions').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      if (typeof vars === 'string' || !vars.silentSuccess) toast.success('Transaction deleted');
    },
    onError: (e) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Subscriptions ────────────────────────────────────────
const demoSubs = [
  { name: 'Spotify', cost: 10.99, billing: 'monthly', renewal_date: '2026-04-01', active: true },
  { name: 'Netflix', cost: 15.49, billing: 'monthly', renewal_date: '2026-04-05', active: true },
  { name: 'Gym Membership', cost: 49.99, billing: 'monthly', renewal_date: '2026-04-01', active: true },
  { name: 'iCloud Storage', cost: 2.99, billing: 'monthly', renewal_date: '2026-04-15', active: true },
  { name: 'Adobe Creative Suite', cost: 599.88, billing: 'yearly', renewal_date: '2026-09-01', active: true },
  { name: 'ChatGPT Plus', cost: 20.00, billing: 'monthly', renewal_date: '2026-04-10', active: false },
];

export function useSubscriptions() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['subscriptions', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async () => {
      if (isDemo || !user) return demoSubs.map((s, i) => ({ ...s, id: String(i), user_id: 'demo', created_at: '', updated_at: '' }));
      const { data, error } = await supabase.from('subscriptions').select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: Omit<TablesInsert<'subscriptions'>, 'user_id'>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('subscriptions').insert(sanitizePayload({ ...item, user_id: user.id }));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subscriptions'] }); toast.success('Subscription added'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string } & Partial<Tables<'subscriptions'>>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('subscriptions').update(sanitizePayload(item)).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subscriptions'] }); toast.success('Subscription updated'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('subscriptions').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subscriptions'] }); toast.success('Subscription deleted'); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Budget Items ─────────────────────────────────────────
const demoBudgetItems = [
  { label: 'Rent / Mortgage', amount: 1400, category: 'fixed' },
  { label: 'Utilities', amount: 120, category: 'fixed' },
  { label: 'Insurance', amount: 250, category: 'fixed' },
  { label: 'Subscriptions', amount: 85, category: 'fixed' },
  { label: 'Debt Payments', amount: 2250, category: 'fixed' },
  { label: 'Groceries', amount: 320, category: 'variable' },
  { label: 'Dining Out', amount: 110, category: 'variable' },
  { label: 'Gas / Transport', amount: 55, category: 'variable' },
  { label: 'Entertainment', amount: 30, category: 'variable' },
  { label: 'Miscellaneous', amount: 100, category: 'variable' },
];

export function useBudgetItems() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['budget_items', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async () => {
      if (isDemo || !user) return demoBudgetItems.map((b, i) => ({ ...b, id: String(i), user_id: 'demo', created_at: '', updated_at: '' }));
      const { data, error } = await supabase.from('budget_items').select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: async (item: Omit<TablesInsert<'budget_items'>, 'user_id'>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('budget_items').insert(sanitizePayload({ ...item, user_id: user.id }));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget_items'] }); toast.success('Budget item added'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string } & Partial<Tables<'budget_items'>>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('budget_items').update(sanitizePayload(item)).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget_items'] }); toast.success('Budget item updated'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('budget_items').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget_items'] }); toast.success('Budget item deleted'); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Profile ──────────────────────────────────────────────
// FIX #15: DEFAULT_PROFILE now has consistent values that match
// the demo recurring rules and produce correct calculations
const DEFAULT_PROFILE: Partial<Tables<'profiles'>> = {
  display_name: '', currency: 'USD', budget_start_day: 1,
  monthly_income_default: 6337.50, // 1875 * 4.33 * 0.78 (net)
  show_cents: true, compact_mode: false,
  is_premium: false,
  gross_income: 8118.75, // 1875 * 4.33
  tax_rate: 22,
  cash_floor: 1500,
  weekly_gross_income: 1875,
  paycheck_frequency: 'weekly',
  paycheck_day: 5,
  default_deposit_account: null,
  auto_generate_recurring: true,
  paycheck_deductions: [],
};

export function useProfile() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['profile', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async (): Promise<Partial<Tables<'profiles'>>> => {
      if (isDemo || !user) return { ...DEFAULT_PROFILE, display_name: 'Demo User', is_premium: true };
      try {
        const { data, error } = await supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
        if (error) throw error;
        if (!data) {
          // Auto-create profile if missing
          const { data: newProfile, error: insertErr } = await supabase
            .from('profiles')
            .insert({ user_id: user.id })
            .select()
            .maybeSingle();
          if (insertErr) {
            console.error('Failed to auto-create profile:', insertErr.message);
            return { ...DEFAULT_PROFILE, user_id: user.id };
          }
          return newProfile ?? { ...DEFAULT_PROFILE, user_id: user.id };
        }
        return data;
      } catch (err) {
        console.error('Profile fetch error:', err);
        return { ...DEFAULT_PROFILE, user_id: user.id };
      }
    },
    retry: 1,
  });
  const update = useMutation({
    mutationFn: async (item: Partial<Tables<'profiles'>>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('profiles').update(sanitizePayload(item)).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile'] }); toast.success('Settings saved'); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { data: query.data ?? DEFAULT_PROFILE, loading: query.isLoading, error: query.error, update };
}

// ─── Net Worth Snapshots ──────────────────────────────────
export function useNetWorthSnapshots() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['net_worth_snapshots', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async () => {
      if (isDemo) {
        // Return demo snapshots pre-shaped to match the DB row structure
        return demoNetWorthSnapshots.map((s, i) => ({
          ...s,
          id: `demo-nw-${i}`,
          user_id: 'demo',
          created_at: s.snapshot_date,
        }));
      }
      if (!user) return [];
      const { data, error } = await supabase
        .from('net_worth_snapshots')
        .select('*')
        .eq('user_id', user.id)
        .order('snapshot_date', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const upsert = useMutation({
    mutationFn: async (item: {
      snapshot_date: string;
      total_assets: number;
      total_liabilities: number;
      net_worth: number;
    }) => {
      if (isDemo || !user) return; // silently skip in demo
      const { error } = await supabase
        .from('net_worth_snapshots')
        .upsert(
          { ...item, user_id: user.id },
          { onConflict: 'user_id,snapshot_date' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['net_worth_snapshots'] });
    },
    // Silent — no toast on snapshot save
  });

  return { data: query.data ?? [], loading: query.isLoading, upsert };
}

// ─── Payment Plans ───────────────────────────────────────
const demoPaymentPlans: PaymentPlan[] = [
  {
    id: 'pp1',
    user_id: 'demo',
    name: 'AirPods Pro',
    provider: 'PayPal Pay in 4',
    total_amount: 249,
    payment_amount: 62.25,
    frequency: 'biweekly',
    start_date: '2026-06-01',
    total_payments: 4,
    category: 'Shopping',
    payment_source: null,
    plan_type: 'upfront',
    notes: null,
    active: true,
    created_at: '',
  },
  {
    id: 'pp2',
    user_id: 'demo',
    name: 'MacBook Pro',
    provider: 'Prime Visa 12 months',
    total_amount: 1799,
    payment_amount: 149.92,
    frequency: 'monthly',
    start_date: '2026-05-15',
    total_payments: 12,
    category: 'Shopping',
    payment_source: null,
    plan_type: 'upfront',
    notes: '0% APR promotional period',
    active: true,
    created_at: '',
  },
];

export function usePaymentPlans() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['payment_plans', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async () => {
      if (isDemo || !user) return demoPaymentPlans;
      const { data, error } = await supabase.from('payment_plans').select('*').eq('user_id', user.id).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    // `silentSuccess` lets a caller that composes this write into a larger action (N7's
    // convert-to-plan pairs it with a transaction delete) show ONE toast for the whole action
    // instead of three. Errors always toast — only the success message is the caller's to own.
    mutationFn: async ({ silentSuccess: _, ...item }: Omit<PaymentPlan, 'id' | 'user_id' | 'created_at'> & { silentSuccess?: boolean }) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { data, error } = await supabase.from('payment_plans').insert(sanitizePayload({ ...item, user_id: user.id })).select().single();
      if (error) throw error;
      return data as unknown as PaymentPlan;
    },
    onSuccess: (_data, vars) => { qc.invalidateQueries({ queryKey: ['payment_plans'] }); if (!vars.silentSuccess) toast.success('Payment plan added'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string } & Partial<Tables<'payment_plans'>>) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('payment_plans').update(sanitizePayload(item)).eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payment_plans'] }); toast.success('Payment plan updated'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { error } = await supabase.from('payment_plans').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payment_plans'] }); toast.success('Payment plan removed'); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { data: (query.data ?? []) as PaymentPlan[], loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Car Builds ──────────────────────────────────────────
const _EMPTY_ARR: CarBuild[] = [];

export function useCarBuilds() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['car_builds', isDemo ? 'demo' : user?.id],
    enabled: isDemo || !!user,
    queryFn: async (): Promise<CarBuild[]> => {
      if (isDemo || !user) return demoCarBuilds as CarBuild[];
      const { data, error } = await supabase
        .from('car_builds')
        .select('*')
        .eq('user_id', user.id)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as CarBuild[];
    },
  });

  const add = useMutation({
    mutationFn: async (item: { name: string; year?: number | null; make?: string | null; model?: string | null; notes?: string | null; sort_order?: number }) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('car_builds')
        .insert(sanitizePayload({ ...item, user_id: user.id }))
        .select()
        .single();
      if (error) throw error;
      return data as CarBuild;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_builds'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string } & Partial<Tables<'car_builds'>>) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('car_builds')
        .update(sanitizePayload(item))
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_builds'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('car_builds')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_builds'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { data: query.data ?? _EMPTY_ARR, loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Car Build Phases ────────────────────────────────────
export function useCarBuildPhases(buildId: string | null) {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['car_build_phases', isDemo ? `demo-${buildId}` : buildId],
    enabled: (isDemo || !!user) && !!buildId,
    queryFn: async () => {
      if (isDemo || !user) return demoCarBuildPhases.filter(p => p.build_id === buildId);
      if (!buildId) return [];
      const { data, error } = await supabase
        .from('car_build_phases')
        .select('*')
        .eq('build_id', buildId)
        .eq('user_id', user.id)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });

  const add = useMutation({
    mutationFn: async (item: { title: string; build_id: string; sort_order?: number }) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('car_build_phases')
        .insert(sanitizePayload({ ...item, user_id: user.id }))
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_build_phases', buildId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string } & Partial<Tables<'car_build_phases'>>) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('car_build_phases')
        .update(sanitizePayload(item))
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_build_phases', buildId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('car_build_phases')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_build_phases', buildId] }); qc.invalidateQueries({ queryKey: ['car_build_items', buildId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorder = useMutation({
    mutationFn: async (rows: { id: string; sort_order: number }[]) => {
      if (!user || !buildId) throw new Error('Not authenticated');
      const results = await Promise.all(
        rows.map(r =>
          supabase.from('car_build_phases')
            .update({ sort_order: r.sort_order })
            .eq('id', r.id)
            .eq('user_id', user.id)
        )
      );
      const err = results.find(r => r.error);
      if (err?.error) throw err.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_build_phases', buildId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove, reorder };
}

// ─── Car Build Items ─────────────────────────────────────
export function useCarBuildItems(buildId: string | null) {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['car_build_items', isDemo ? `demo-${buildId}` : buildId],
    enabled: (isDemo || !!user) && !!buildId,
    queryFn: async () => {
      if (isDemo || !user) return demoCarBuildItems.filter(item => item.build_id === buildId);
      if (!buildId) return [];
      const { data, error } = await supabase
        .from('car_build_items')
        .select('*')
        .eq('build_id', buildId)
        .eq('user_id', user.id)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });

  const add = useMutation({
    mutationFn: async (item: { name: string; phase_id: string; build_id: string; brand?: string | null; price?: number | null; link?: string | null; sort_order?: number }) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('car_build_items')
        .insert(sanitizePayload({ ...item, user_id: user.id }))
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_build_items', buildId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string } & Partial<Tables<'car_build_items'>>) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('car_build_items')
        .update(sanitizePayload(item))
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_build_items', buildId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('car_build_items')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_build_items', buildId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorder = useMutation({
    mutationFn: async (rows: { id: string; sort_order: number; phase_id: string }[]) => {
      if (!user || !buildId) throw new Error('Not authenticated');
      const results = await Promise.all(
        rows.map(r =>
          supabase.from('car_build_items')
            .update({ sort_order: r.sort_order, phase_id: r.phase_id })
            .eq('id', r.id)
            .eq('user_id', user.id)
        )
      );
      const err = results.find(r => r.error);
      if (err?.error) throw err.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_build_items', buildId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { data: query.data ?? [], loading: query.isLoading, error: query.error, add, update, remove, reorder };
}

// ─── Car Maintenance Logs ────────────────────────────────
const _EMPTY_MAINTENANCE: CarMaintenanceLog[] = [];

export function useCarMaintenanceLogs(buildId: string | null) {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['car_maintenance_logs', isDemo ? `demo-${buildId}` : buildId],
    enabled: (isDemo || !!user) && !!buildId,
    queryFn: async (): Promise<CarMaintenanceLog[]> => {
      if (isDemo || !user) return demoCarMaintenanceLogs.filter(l => l.build_id === buildId);
      if (!buildId) return [];
      const { data, error } = await supabase
        .from('car_maintenance_logs')
        .select('*')
        .eq('build_id', buildId)
        .eq('user_id', user.id)
        .order('service_date', { ascending: false });
      if (error) throw error;
      return (data ?? []) as CarMaintenanceLog[];
    },
  });

  const add = useMutation({
    mutationFn: async (item: Omit<Tables<'car_maintenance_logs'>, 'id' | 'user_id' | 'created_at'>) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('car_maintenance_logs')
        .insert(sanitizePayload({ ...item, user_id: user.id }))
        .select()
        .single();
      if (error) throw error;
      return data as CarMaintenanceLog;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_maintenance_logs', buildId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...item }: { id: string } & Partial<Tables<'car_maintenance_logs'>>) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('car_maintenance_logs')
        .update(sanitizePayload(item))
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['car_maintenance_logs', buildId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('car_maintenance_logs')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    // A linked transaction survives the delete (FK is ON DELETE SET NULL), so the
    // ledger has to be refetched or it keeps showing a link to a row that is gone.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['car_maintenance_logs', buildId] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { data: query.data ?? _EMPTY_MAINTENANCE, loading: query.isLoading, error: query.error, add, update, remove };
}

// ─── Public build by share token (no auth required) ──────────────────────────
// Calls the `public-build` Edge Function instead of PostgREST directly.
// The Edge Function validates the exact token server-side (service role) so
// unauthenticated callers cannot enumerate builds or access any data without
// knowing the precise share UUID.
const SUPABASE_FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export function usePublicBuild(shareToken: string | undefined) {
  const query = useQuery({
    queryKey: ['public_build', shareToken],
    enabled: !!shareToken,
    queryFn: async () => {
      if (!shareToken) return null;
      const res = await fetch(
        `${SUPABASE_FUNCTIONS_URL}/public-build?token=${encodeURIComponent(shareToken)}`,
        {
          method: 'GET',
          headers: {
            'apikey': SUPABASE_PUBLISHABLE_KEY,
            'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          },
        },
      );
      if (!res.ok) return null;
      const json = await res.json();
      // `maintenance*` were added 2026-08-12. A response from a not-yet-deployed
      // function has neither, and the safe reading of a missing flag is private.
      return {
        ...json,
        maintenancePublic: json.maintenancePublic === true,
        maintenance: json.maintenance ?? [],
      } as {
        // The flag is reported once, as `maintenancePublic` — the Edge Function
        // strips it from the build object, so the type must not claim it.
        build: Omit<CarBuild, 'maintenance_public'>;
        phases: CarBuildPhase[];
        items: CarBuildItem[];
        maintenancePublic: boolean;
        maintenance: PublicMaintenanceEntry[];
        displayName: string | null;
      };
    },
  });

  return { data: query.data ?? null, loading: query.isLoading, notFound: !query.isLoading && !query.data };
}
