import { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import InstructionsModal from '@/components/shared/InstructionsModal';
import { formatCurrency, formatYAxisTick } from '@/lib/calculations';
import { useAccounts, useDebts, useAccountReconciliations, useNetWorthSnapshots, type AccountRow } from '@/hooks/useSupabaseData';
import type { Tables } from '@/integrations/supabase/types';
import { useDemo } from '@/contexts/DemoContext';
import { useSubscription } from '@/hooks/useSubscription';
import { usePlaidItems } from '@/hooks/usePlaidItems';
import { Link } from 'react-router-dom';
import MetricCard from '@/components/shared/MetricCard';
import FormModal from '@/components/shared/FormModal';
import PlaidLinkButton, { PlaidSyncedAccount } from '@/components/shared/PlaidLinkButton';
import PremiumGate from '@/components/shared/PremiumGate';
import {
  Building2, Plus, Edit2, Trash2, Wallet, TrendingUp, TrendingDown,
  CreditCard, PiggyBank, Landmark, DollarSign, Eye, EyeOff,
  Link2, Unlink, Loader2, RefreshCw,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
} from 'recharts';
import { ArrowUpRight } from 'lucide-react';

interface NWTooltipProps {
  active?: boolean;
  payload?: { payload: { month: string }; value: number }[];
}

function NWTooltip({ active, payload }: NWTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border px-3 py-2 text-xs" style={{ borderRadius: 'var(--radius)' }}>
      <p className="font-medium">{payload[0].payload.month}</p>
      <p className="text-primary font-semibold">{formatCurrency(payload[0].value, false)}</p>
    </div>
  );
}

interface MatchEntry {
  plaidAccount: PlaidSyncedAccount & { plaid_account_id?: string };
  matchedAccountId: string | null; // null = keep as new
}

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'high_yield_savings', label: 'High-Yield Savings' },
  { value: 'hsa', label: 'HSA (Health Savings)' },
  { value: 'business_checking', label: 'Business Checking' },
  { value: 'brokerage', label: 'Brokerage' },
  { value: 'roth_ira', label: 'Roth IRA' },
  { value: '401k', label: '401k / Retirement' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'student_loan', label: 'Student Loan' },
  { value: 'auto_loan', label: 'Auto Loan' },
  { value: 'other_liability', label: 'Other Liability' },
  { value: 'other_asset', label: 'Other Asset' },
];

const ASSET_TYPES = ['checking', 'savings', 'high_yield_savings', 'hsa', 'business_checking', 'brokerage', 'roth_ira', '401k', 'cash', 'other_asset'];
const LIABILITY_TYPES = ['credit_card', 'mortgage', 'student_loan', 'auto_loan', 'other_liability'];
const LOAN_TYPES = ['mortgage', 'student_loan', 'auto_loan', 'other_liability'];
const LIQUID_TYPES = ['checking', 'savings', 'high_yield_savings', 'business_checking', 'cash'];
const INVESTMENT_TYPES = ['brokerage'];
const RETIREMENT_TYPES = ['roth_ira', '401k'];

const TYPE_LABELS: Record<string, string> = {};
ACCOUNT_TYPES.forEach(t => { TYPE_LABELS[t.value] = t.label; });

const TYPE_ICONS: Record<string, any> = {
  checking: Building2, savings: PiggyBank, high_yield_savings: PiggyBank,
  hsa: PiggyBank, business_checking: Building2, brokerage: TrendingUp,
  roth_ira: TrendingUp, '401k': TrendingUp, cash: DollarSign,
  credit_card: CreditCard, mortgage: Landmark, student_loan: Landmark, auto_loan: Landmark,
  other_liability: TrendingDown, other_asset: Wallet,
};

// Plaid sync runs Mon/Wed/Fri at 13:00 UTC (9 AM ET).
const PLAID_SYNC_DAYS = new Set([1, 3, 5, 6]); // Mon, Wed, Fri, Sat UTC day-of-week
const PLAID_SYNC_HOUR_UTC = 13;

function getLastScheduledSyncTime(from: Date): Date {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() - i);
    d.setUTCHours(PLAID_SYNC_HOUR_UTC, 0, 0, 0);
    if (PLAID_SYNC_DAYS.has(d.getUTCDay()) && d <= from) return d;
  }
  return new Date(from.getTime() - 7 * 24 * 60 * 60 * 1000);
}

function formatSyncStatus(lastSyncedAt: string | null): { text: string; isStale: boolean } {
  if (!lastSyncedAt) return { text: 'Not yet synced', isStale: false };
  const now = new Date();
  const lastSync = new Date(lastSyncedAt);
  const ms = now.getTime() - lastSync.getTime();
  const hours = ms / (1000 * 60 * 60);

  if (hours < 1) {
    const mins = Math.round(ms / (1000 * 60));
    return { text: mins <= 1 ? 'Updated just now' : `Updated ${mins} min ago`, isStale: false };
  }

  // Stale only when the most recent scheduled sync ran but our data predates it by >2 hours.
  const lastScheduled = getLastScheduledSyncTime(now);
  const missedSync = lastSync < lastScheduled && (now.getTime() - lastScheduled.getTime()) > 2 * 60 * 60 * 1000;

  const h = Math.floor(hours);
  if (h < 24) return { text: `Updated ${h} hour${h === 1 ? '' : 's'} ago`, isStale: missedSync };
  if (lastSync.toDateString() === now.toDateString()) {
    return { text: `Updated today at ${lastSync.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`, isStale: missedSync };
  }
  return { text: `Updated ${lastSync.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, isStale: missedSync };
}

const emptyForm = { name: '', account_type: '', institution: '', balance: '', credit_limit: '', apr: '', notes: '', min_payment: '', apy_rate: '', payment_due_day: '', apr_start_date: '', card_start_date: '' };
const APY_TYPES = ['401k', 'roth_ira', 'brokerage', 'savings', 'high_yield_savings'];

export default function Accounts() {
  const { isDemo } = useDemo();
  const { isPremium } = useSubscription();
  const { data: accounts, add, update, remove, loading } = useAccounts();
  const { data: debts, update: updateDebt, add: addDebt } = useDebts();
  const { add: addReconciliation } = useAccountReconciliations();
  const { items: plaidItems, loading: plaidLoading, remove: removePlaidItem, invalidate: invalidatePlaid } = usePlaidItems();
  const { data: snapshots, loading: snapshotsLoading } = useNetWorthSnapshots();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string; isLinked: boolean } | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'assets' | 'liabilities'>('all');
  const [matchEntries, setMatchEntries] = useState<MatchEntry[]>([]);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [matchSaving, setMatchSaving] = useState(false);
  const [plaidSyncing, setPlaidSyncing] = useState(false);
  const [unlinkConfirm, setUnlinkConfirm] = useState<string | null>(null);
  const [delinkConfirm, setDelinkConfirm] = useState<string | null>(null);
  const [delinking, setDelinking] = useState(false);
  const [plaidSyncResult, setPlaidSyncResult] = useState<{ institutionName: string; accounts: PlaidSyncedAccount[] } | null>(null);

  const handlePlaidSuccess = useCallback((syncedAccounts: PlaidSyncedAccount[], institutionName?: string) => {
  invalidatePlaid();
  qc.invalidateQueries({ queryKey: ['accounts'] });

  const name = institutionName ?? 'Your bank';
  setPlaidSyncResult({ institutionName: name, accounts: syncedAccounts });

  const manualAccounts = accounts.filter(a => !a.plaid_account_id && a.active);

  const matchableAccounts = syncedAccounts.filter((synced) =>
    manualAccounts.some((manual) => {
      const syncedName = synced.name.trim().toLowerCase();
      const manualName = manual.name.trim().toLowerCase();
      return syncedName === manualName;
    })
  );

  if (matchableAccounts.length > 0) {
    setMatchEntries(
      matchableAccounts.map((a) => ({
        plaidAccount: a,
        matchedAccountId: null,
      }))
    );
  } else {
    setMatchEntries([]);
  }
}, [invalidatePlaid, qc, accounts]);

  const handleConfirmMatch = useCallback(async () => {
    const toMatch = matchEntries.filter(e => e.matchedAccountId !== null);
    if (toMatch.length === 0) { setShowMatchModal(false); return; }
    setMatchSaving(true);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Not authenticated');

      // Fresh fetch of ALL user accounts from DB (bypasses stale React state)
      const { data: allAccountsRaw, error: fetchErr } = await supabase
        .from('accounts')
        .select('id, name, institution, plaid_account_id, plaid_item_id, balance, active')
        .eq('user_id', currentUser.id);
      if (fetchErr) throw new Error(fetchErr.message);

      const allAccounts = allAccountsRaw ?? [];
      const plaidCreatedAccounts = allAccounts.filter(a => a.plaid_account_id);

      let matched = 0;
      for (const entry of toMatch) {
        // Use fresh DB data to find existing account (not stale React state)
        const existingAccount = allAccounts.find(a => a.id === entry.matchedAccountId);
        if (!existingAccount) continue;

        const plaidAccountId = entry.plaidAccount.plaid_account_id;
        const plaidCreated = plaidAccountId
          ? plaidCreatedAccounts.find(a => a.plaid_account_id === plaidAccountId)
          : plaidCreatedAccounts.find(a => a.name === entry.plaidAccount.name);

        if (!plaidCreated) continue;

        // Delete the Plaid-created duplicate FIRST — frees the unique constraint on plaid_account_id
        const { error: deleteErr } = await supabase
          .from('accounts')
          .delete()
          .eq('id', plaidCreated.id)
          .eq('user_id', currentUser.id);

        if (deleteErr) {
          console.error('Match delete failed:', deleteErr);
          toast.error(`Failed to match "${existingAccount.name}": ${deleteErr.message}`);
          continue;
        }

        // Now stamp Plaid link fields onto the existing manual account
        const { error: updateErr } = await supabase
          .from('accounts')
          .update({
            plaid_account_id: plaidCreated.plaid_account_id,
            plaid_item_id: plaidCreated.plaid_item_id,
            name: plaidCreated.name,
            institution: plaidCreated.institution,
            balance: plaidCreated.balance,
            active: true,
          })
          .eq('id', existingAccount.id)
          .eq('user_id', currentUser.id);

        if (updateErr) {
          console.error('Match update failed:', updateErr);
          toast.error(`Failed to match "${existingAccount.name}": ${updateErr.message}`);
          continue;
        }
        matched++;
      }

      if (matched > 0) toast.success(`Matched ${matched} account${matched !== 1 ? 's' : ''}`);
      invalidatePlaid();
      qc.invalidateQueries({ queryKey: ['accounts'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Match failed');
    } finally {
      setMatchSaving(false);
      setShowMatchModal(false);
    }
  }, [matchEntries, invalidatePlaid, qc]);

  const activeAccounts = useMemo(() => accounts.filter(a => a.active), [accounts]);

  const summary = useMemo(() => {
    const active = activeAccounts;
    const liquidCash = active.filter(a => LIQUID_TYPES.includes(a.account_type)).reduce((s, a) => s + Number(a.balance), 0);
    const investments = active.filter(a => INVESTMENT_TYPES.includes(a.account_type)).reduce((s, a) => s + Number(a.balance), 0);
    const retirement = active.filter(a => RETIREMENT_TYPES.includes(a.account_type)).reduce((s, a) => s + Number(a.balance), 0);
    const ccDebt = active.filter(a => a.account_type === 'credit_card').reduce((s, a) => s + Number(a.balance), 0);
    const totalLiabilities = active.filter(a => LIABILITY_TYPES.includes(a.account_type)).reduce((s, a) => s + Number(a.balance), 0);
    const totalAssets = active.filter(a => ASSET_TYPES.includes(a.account_type)).reduce((s, a) => s + Number(a.balance), 0);
    const netWorth = totalAssets - totalLiabilities;
    return { liquidCash, investments, retirement, ccDebt, totalLiabilities, totalAssets, netWorth };
  }, [activeAccounts]);

  const netWorthTrend = useMemo(() => {
    if (snapshots.length === 0) {
      const now = new Date();
      return [{ month: now.toLocaleString('en', { month: 'short' }), value: summary.netWorth }];
    }
    return snapshots.map(s => ({
      month: new Date(s.snapshot_date).toLocaleString('en', { month: 'short', day: 'numeric' }),
      value: Number(s.net_worth),
    }));
  }, [snapshots, summary.netWorth]);

  const monthlyChange = useMemo((): number | null => {
    if (snapshots.length < 2) return null;
    const latest = snapshots[snapshots.length - 1];
    for (let i = snapshots.length - 2; i >= 0; i--) {
      const older = snapshots[i];
      const daysBetween = Math.floor(
        (new Date(latest.snapshot_date).getTime() - new Date(older.snapshot_date).getTime()) / 86400000,
      );
      if (daysBetween >= 25) return Number(latest.net_worth) - Number(older.net_worth);
    }
    return null;
  }, [snapshots]);

  const filteredAccounts = useMemo(() => {
    if (filterType === 'assets') return accounts.filter(a => ASSET_TYPES.includes(a.account_type));
    if (filterType === 'liabilities') return accounts.filter(a => LIABILITY_TYPES.includes(a.account_type));
    return accounts;
  }, [accounts, filterType]);

  const openAdd = (preType?: string) => { setForm({ ...emptyForm, account_type: preType ?? '' }); setEditId(null); setEditingPlaidLinked(false); setEditingPlaidLiability(false); setEditingPlaidAprSynced(false); setEditingPlaidMinSynced(false); setShowForm(true); };

  useEffect(() => {
    if (searchParams.get('new') === '1') openAdd(searchParams.get('type') ?? undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [editingPlaidLinked, setEditingPlaidLinked] = useState(false);
  const [editingPlaidLiability, setEditingPlaidLiability] = useState(false);
  const [editingPlaidAprSynced, setEditingPlaidAprSynced] = useState(false);
  const [editingPlaidMinSynced, setEditingPlaidMinSynced] = useState(false);

  const openEdit = (a: AccountRow) => {
    const matchDebt = debts.find(d => d.name.toLowerCase() === a.name.toLowerCase());
    const plaidLiability = !!a.plaid_account_id && !!a.liability_synced_at;
    // Credit cards: the Accounts row is the sole source of truth for min_payment (the debt
    // engine never reads the debts table for it — see credit-card-engine.ts), so always read it
    // back from here regardless of Plaid linkage. Other liability types (mortgage/auto/student)
    // still fall back to the debts table, which remains their real source.
    setForm({
      name: a.name, account_type: a.account_type, institution: a.institution || '',
      balance: String(a.balance),
      credit_limit: String(a.credit_limit || ''),
      apr: String(a.apr || ''),
      notes: a.notes || '',
      min_payment: a.account_type === 'credit_card'
        ? (a.min_payment != null && Number(a.min_payment) > 0 ? String(a.min_payment) : '')
        : plaidLiability
          ? (a.min_payment != null && Number(a.min_payment) > 0 ? String(a.min_payment) : '')
          : (matchDebt ? String(matchDebt.min_payment) : ''),
      apy_rate: a.apy_rate != null ? String(a.apy_rate) : '',
      payment_due_day: a.payment_due_day != null ? String(a.payment_due_day) : '',
      apr_start_date: a.apr_start_date || '',
      card_start_date: a.card_start_date || '',
    });
    setEditingPlaidLinked(!!a.plaid_account_id);
    setEditingPlaidLiability(plaidLiability);
    setEditingPlaidAprSynced(!!a.apr_plaid_synced);
    setEditingPlaidMinSynced(!!a.min_payment_plaid_synced);
    setEditId(a.id); setShowForm(true);
  };

  const handleSave = () => {
    const balance = parseFloat(form.balance);
    if (!form.name || isNaN(balance)) return;
    const dueDayRaw = parseInt(form.payment_due_day);
    const dueDayVal = form.account_type === 'credit_card' && !isNaN(dueDayRaw) && dueDayRaw >= 1 && dueDayRaw <= 28 ? dueDayRaw : null;
    const payload: Partial<Tables<'accounts'>> & { name: string } = {
      name: form.name, account_type: form.account_type, institution: form.institution,
      credit_limit: parseFloat(form.credit_limit) || null, apr: parseFloat(form.apr) || null,
      notes: form.notes, active: true,
      apy_rate: APY_TYPES.includes(form.account_type) && form.apy_rate !== '' ? parseFloat(form.apy_rate) : null,
      ...(form.account_type === 'credit_card' ? {
        payment_due_day: dueDayVal,
        card_start_date: form.card_start_date || null,
      } : {}),
      apr_start_date: LOAN_TYPES.includes(form.account_type) && form.apr_start_date ? form.apr_start_date : null,
    };
    // Never overwrite Plaid-managed balance — it is owned by the sync job
    if (!editingPlaidLinked) payload.balance = balance;
    // Always write min_payment to the accounts row for credit cards so the
    // debt engine reads a consistent value from accounts (not the debts table).
    if (form.account_type === 'credit_card') {
      const userMinPay = form.min_payment ? parseFloat(form.min_payment) : NaN;
      if (!isNaN(userMinPay) && userMinPay > 0) {
        // User explicitly entered a value — use it and release Plaid ownership so
        // future syncs don't overwrite the override.
        payload.min_payment = userMinPay;
        payload.min_payment_plaid_synced = false;
      } else if (editingPlaidLiability) {
        // Plaid-linked, no user input — compute from APR as fallback.
        const existingAcct = accounts.find(a => a.id === editId);
        const acctBalance = existingAcct ? Number(existingAcct.balance) : balance;
        const newApr = parseFloat(form.apr);
        if (!isNaN(newApr) && newApr > 0 && acctBalance > 0) {
          const monthly = (acctBalance * (newApr / 100)) / 12;
          payload.min_payment = Math.max(25, Math.ceil(acctBalance * 0.01 + monthly));
        }
      }
    }
    if (editId) {
      const existingAccount = accounts.find(a => a.id === editId);
      const projectedBalance = existingAccount ? Number(existingAccount.balance) : balance;
      update.mutate({ id: editId, ...payload });
      if (!editingPlaidLinked && balance !== projectedBalance) {
        addReconciliation.mutate({
          account_id: editId,
          source_table: 'accounts',
          effective_date: new Date().toISOString().split('T')[0],
          delta: balance - projectedBalance,
          actual_balance: balance,
          projected_balance: projectedBalance,
        });
      }
    } else {
      add.mutate({ ...payload, balance });
    }
    
    // Sync min_payment to the debts table for non-credit-card debt accounts (mortgage/auto/
    // student loans, managed entirely through the debts table). Credit cards are deliberately
    // excluded: accounts.min_payment (just written above) is their sole source of truth for the
    // debt engine, and mirroring it into a same-named debts row would recreate the exact dual-
    // source confusion this was meant to avoid. A credit card's debts row, if one exists for its
    // separate target_payment feature, still gets created/kept in sync by
    // CreditCardEngine.tsx's syncDebtAndAccount when the user sets a target payment.
    if (isLiability(form.account_type) && form.account_type !== 'credit_card' && form.min_payment) {
      const minPay = parseFloat(form.min_payment);
      if (!isNaN(minPay) && minPay > 0) {
        const matchDebt = debts.find(d => d.name.toLowerCase() === form.name.toLowerCase());
        if (matchDebt) {
          updateDebt.mutate({ id: matchDebt.id, min_payment: minPay, balance, apr: parseFloat(form.apr) || 0 });
        } else {
          addDebt.mutate({
            name: form.name, balance, apr: parseFloat(form.apr) || 0,
            min_payment: minPay, target_payment: minPay,
            credit_limit: parseFloat(form.credit_limit) || 0,
          });
        }
      }
    }
    
    setShowForm(false); setEditId(null);
  };

  const toggleActive = (a: AccountRow) => update.mutate({ id: a.id, active: !a.active });

  const handleDelete = (a: AccountRow) => {
    setDeleteConfirm({ id: a.id, name: a.name, isLinked: !!a.plaid_account_id });
  };

  const confirmDelete = () => {
    if (!deleteConfirm) return;
    remove.mutate(deleteConfirm.id);
    setDeleteConfirm(null);
  };

  const isLiability = (type: string) => LIABILITY_TYPES.includes(type);

  const handleUnlinkAccount = async (accountId: string) => {
    if (unlinkConfirm !== accountId) {
      setUnlinkConfirm(accountId);
      setTimeout(() => setUnlinkConfirm(null), 4000);
      return;
    }
    setUnlinkConfirm(null);
    try {
      const { error } = await supabase.from('accounts').update({ plaid_account_id: null, plaid_item_id: null }).eq('id', accountId);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('Account unlinked. Balance will no longer auto-sync.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unlink failed');
    }
  };

  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto space-y-8 overflow-x-hidden">
      {/* Plaid link success overlay */}
      {plaidSyncResult && !plaidSyncing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/85 backdrop-blur-sm p-4">
          <div className="card-forged w-full max-w-sm p-5 flex flex-col gap-4">
            <div className="flex flex-col items-center text-center gap-1.5">
              <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center">
                <Link2 size={22} className="text-success" />
              </div>
              <p className="text-sm font-semibold">{plaidSyncResult.institutionName} linked!</p>
              <p className="text-xs text-muted-foreground">
                {plaidSyncResult.accounts.length} account{plaidSyncResult.accounts.length !== 1 ? 's' : ''} synced
              </p>
            </div>

            {plaidSyncResult.accounts.length > 0 && (
              <div className="space-y-0 max-h-52 overflow-y-auto border border-border/40 rounded" style={{ borderRadius: 'var(--radius)' }}>
                {plaidSyncResult.accounts.map((acct, i) => {
                  const isCreditCard = acct.type === 'credit_card';
                  return (
                    <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 border-b border-border/30 last:border-0 text-xs">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{acct.name}</p>
                        <p className="text-muted-foreground">{formatCurrency(acct.balance, false)}</p>
                      </div>
                      {isCreditCard && (
                        <div className="flex flex-col gap-0.5 items-end shrink-0 text-[10px] font-medium">
                          <span className={acct.apr != null ? 'text-success' : 'text-muted-foreground'}>
                            APR {acct.apr != null ? `${acct.apr}%` : '—'}
                          </span>
                          <span className={acct.credit_limit != null ? 'text-success' : 'text-muted-foreground'}>
                            Limit {acct.credit_limit != null ? formatCurrency(acct.credit_limit, false) : '—'}
                          </span>
                          <span className={acct.min_payment != null ? 'text-success' : 'text-muted-foreground'}>
                            Min {acct.min_payment != null ? formatCurrency(acct.min_payment, false) : '—'}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {plaidSyncResult.accounts.some(a => a.type === 'credit_card' && !a.liability_synced) && (
              <p className="text-[10px] text-amber-500 text-center leading-relaxed">
                Card details (APR, limit, min) not available from this bank. Use Re-link in the Linked Banks section to retry.
              </p>
            )}

            <button
              onClick={() => {
                setPlaidSyncResult(null);
                if (matchEntries.length > 0) setShowMatchModal(true);
              }}
              className="w-full bg-primary text-primary-foreground py-2 text-xs font-semibold btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {matchEntries.length > 0 ? 'Match Accounts →' : 'Done'}
            </button>
          </div>
        </div>
      )}

      {/* Delete account confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/85 backdrop-blur-sm p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="card-forged w-full max-w-sm p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                <Trash2 size={18} className="text-destructive" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Delete "{deleteConfirm.name}"?</p>
                <p className="text-xs text-muted-foreground mt-1">This will permanently remove the account and all associated data. This cannot be undone.</p>
              </div>
            </div>
            {deleteConfirm.isLinked && (
              <div className="bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 text-xs text-amber-400 space-y-1" style={{ borderRadius: 'var(--radius)' }}>
                <p className="font-semibold">This account is linked to Plaid.</p>
                <p>Deleting it will disconnect the Plaid sync. It will no longer pull balance or transaction updates.</p>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2 text-xs font-semibold border border-border text-muted-foreground hover:text-foreground transition-colors"
                style={{ borderRadius: 'var(--radius)' }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 py-2 text-xs font-semibold bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                style={{ borderRadius: 'var(--radius)' }}
              >
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Plaid exchange/sync loading overlay */}
      {plaidSyncing && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-background/85 backdrop-blur-sm gap-3">
          <Loader2 size={28} className="animate-spin text-primary" />
          <p className="text-sm font-semibold text-foreground">Linking your bank…</p>
          <p className="text-xs text-muted-foreground">Exchanging token and syncing balances</p>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">Accounts</h1>
            <InstructionsModal pageTitle="Accounts Guide" sections={[
              { title: 'What is this page?', body: 'Accounts is the centralized source of truth for all your financial balances — checking, savings, investments, retirement, credit cards, and loans.' },
              { title: 'How it connects', body: 'Account balances drive net worth, liquid cash calculations, debt payoff recommendations, and payment source availability across the entire app.' },
              { title: 'Credit Cards', body: 'Credit card accounts automatically appear in the Debt Payoff Planner. Set APR and credit limits here for accurate utilization and interest calculations.' },
              { title: 'Tips', body: 'Mark accounts as inactive to exclude them from calculations without deleting. Use the filter to view assets vs liabilities separately.' },
            ]} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">Manage all financial accounts in one place</p>
        </div>
        <button onClick={() => openAdd()} className="w-full sm:w-auto flex items-center justify-center sm:justify-start gap-1.5 bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold btn-press" style={{ borderRadius: 'var(--radius)' }}>
          <Plus size={14} /> Add Account
        </button>
      </div>

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-3">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">Your financial foundation</p>
              <p className="text-xs text-muted-foreground mt-0.5">Every account type in one place — balances here drive every number across the entire app.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: 'Checking & Cash', desc: 'Liquid balance is the starting point for the debt payoff engine and the 60-month forecast.' },
              { label: 'Credit Cards', desc: 'Balance + APR feed the avalanche engine. Payment due date determines when each card gets paid.' },
              { label: 'Savings & HYS', desc: 'Tracked separately from cash so emergency funds are never counted as available for debt payments.' },
              { label: 'Investments & Retirement', desc: '401k, Roth IRA, and brokerage grow over time and appear in Net Worth projections.' },
            ].map((f, i) => (
              <div key={i} className="flex gap-2 p-2.5 bg-secondary/40 text-xs" style={{ borderRadius: 'var(--radius)' }}>
                <span className="text-primary font-bold shrink-0">→</span>
                <div><span className="font-medium text-foreground">{f.label}: </span><span className="text-muted-foreground">{f.desc}</span></div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground truncate">All data is fictional.</p>
            <Link to="/auth" className="text-xs font-semibold text-primary hover:underline">Use with your own data →</Link>
          </div>
        </div>
      )}

      {/* Summary Stats */}
      <div className="card-forged p-4 sm:p-5 space-y-3 sm:space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 text-center">
          <div>
            <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Net Worth</p>
            <p className={`text-lg sm:text-2xl font-display font-bold mt-0.5 ${summary.netWorth >= 0 ? 'text-primary' : 'text-destructive'}`}>{formatCurrency(summary.netWorth, false)}</p>
          </div>
          <div>
            <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total Assets</p>
            <p className="text-lg sm:text-2xl font-display font-bold mt-0.5 text-success">{formatCurrency(summary.totalAssets, false)}</p>
          </div>
          <div>
            <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total Liabilities</p>
            <p className="text-lg sm:text-2xl font-display font-bold mt-0.5 text-destructive">{formatCurrency(summary.totalLiabilities, false)}</p>
          </div>
          <div>
            <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium flex items-center justify-center gap-1">
              <ArrowUpRight size={9} /> Monthly Change
            </p>
            <p className={`text-lg sm:text-2xl font-display font-bold mt-0.5 ${monthlyChange === null ? 'text-muted-foreground' : monthlyChange >= 0 ? 'text-success' : 'text-destructive'}`}>
              {monthlyChange !== null ? (monthlyChange >= 0 ? '+' : '') + formatCurrency(monthlyChange, false) : '—'}
            </p>
            {monthlyChange === null && <p className="text-[9px] text-muted-foreground">no history yet</p>}
          </div>
        </div>
        <div className="border-t border-border/40" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 text-center">
          <div>
            <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Liquid Cash</p>
            <p className="text-sm sm:text-base font-display font-bold mt-0.5 text-success">{formatCurrency(summary.liquidCash, false)}</p>
          </div>
          <div>
            <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Investments</p>
            <p className="text-sm sm:text-base font-display font-bold mt-0.5 text-primary">{formatCurrency(summary.investments, false)}</p>
          </div>
          <div>
            <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Retirement</p>
            <p className="text-sm sm:text-base font-display font-bold mt-0.5 text-primary">{formatCurrency(summary.retirement, false)}</p>
          </div>
          <div>
            <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">CC Debt</p>
            <p className="text-sm sm:text-base font-display font-bold mt-0.5 text-destructive">{formatCurrency(summary.ccDebt, false)}</p>
          </div>
        </div>
      </div>

      {/* Net Worth History Chart — 2nd position */}
      <div className="card-forged p-5">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-5">
          {snapshots.length > 1 ? 'Net Worth History' : 'Current Net Worth'}
        </h3>
        {snapshotsLoading ? (
          <div className="h-[200px] flex items-end gap-2 px-2 pb-4 animate-pulse">
            {[40, 55, 48, 62, 70, 58, 75, 80].map((h, i) => (
              <div key={i} className="flex-1 bg-muted/40 rounded-sm" style={{ height: `${h}%` }} />
            ))}
          </div>
        ) : netWorthTrend.length <= 1 ? (
          <div className="flex flex-col items-center justify-center h-[160px] text-center">
            <Wallet size={24} className="text-primary mb-3" />
            <p className="text-2xl font-display font-bold text-primary whitespace-nowrap">{formatCurrency(summary.netWorth, false)}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {snapshots.length > 0
                ? 'First snapshot saved — chart will populate over the coming weeks.'
                : 'Historical chart appears once monthly snapshots are saved. See Forecast for projected trends.'}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={netWorthTrend} margin={{ left: 0, right: 8, top: 5, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 15%)" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 10, fill: 'hsl(240, 4%, 46%)' }}
                axisLine={false}
                tickLine={false}
                interval={Math.max(0, Math.ceil(netWorthTrend.length / 8) - 1)}
                angle={-35}
                textAnchor="end"
                height={48}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'hsl(240, 4%, 46%)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatYAxisTick}
              />
              <Tooltip content={<NWTooltip />} />
              <Line
                dataKey="value"
                stroke="hsl(43, 56%, 52%)"
                strokeWidth={2.5}
                dot={{ r: 4, fill: 'hsl(43, 56%, 52%)', strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {(['all', 'assets', 'liabilities'] as const).map(t => (
          <button key={t} onClick={() => setFilterType(t)} className={`px-3 py-1 text-xs font-medium border btn-press ${filterType === t ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`} style={{ borderRadius: 'var(--radius)' }}>
            {t === 'all' ? 'All Accounts' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Account List */}
      <div className="space-y-3">
        {loading && <div className="card-forged p-8 text-center"><p className="text-sm text-muted-foreground">Loading accounts...</p></div>}
        {!loading && filteredAccounts.length === 0 && (
          <div className="card-forged p-8 text-center"><p className="text-sm text-muted-foreground">No accounts yet. Add one above.</p></div>
        )}
        {filteredAccounts.map(a => {
          const Icon = TYPE_ICONS[a.account_type] || Wallet;
          const liability = isLiability(a.account_type);
          return (
            <div key={a.id} className={`card-forged p-4 transition-opacity ${!a.active ? 'opacity-40' : ''}`}>
              <div className="flex items-start gap-3 min-w-0">
                <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${liability ? 'bg-destructive/10' : 'bg-primary/10'}`}>
                  <Icon size={16} className={liability ? 'text-destructive' : 'text-primary'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm font-semibold truncate">{a.name}</p>
                      {a.plaid_account_id && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-primary/10 text-primary border border-primary/20 font-medium leading-none shrink-0" style={{ borderRadius: 'var(--radius)' }}>
                          Auto-sync
                        </span>
                      )}
                    </div>
                    <span className={`text-base font-display font-bold shrink-0 ${liability ? 'text-destructive' : 'text-success'}`}>
                      {liability ? '-' : ''}{formatCurrency(Number(a.balance), false)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {TYPE_LABELS[a.account_type] || a.account_type}
                    {a.institution ? ` · ${a.institution}` : ''}
                    {a.apr ? ` · ${a.apr}% APR` : ''}
                    {a.apr_start_date ? ` · Since ${a.apr_start_date}` : ''}
                    {a.apy_rate != null ? ` · ${a.apy_rate}% APY` : ''}
                    {a.credit_limit ? ` · Limit ${formatCurrency(Number(a.credit_limit), false)}` : ''}
                    {a.account_type === 'credit_card' && a.payment_due_day ? ` · Due ${a.payment_due_day}th` : ''}
                  </p>
                  <div className="flex items-center gap-0.5 mt-2 -ml-1">
                    {a.plaid_account_id && (
                      <button
                        onClick={() => handleUnlinkAccount(a.id)}
                        className={`text-xs font-medium px-1.5 py-1 border transition-colors mr-1 ${unlinkConfirm === a.id ? 'text-destructive border-destructive/40 bg-destructive/5' : 'text-muted-foreground border-transparent hover:text-destructive'}`}
                        style={{ borderRadius: 'var(--radius)' }}
                        title={unlinkConfirm === a.id ? 'Click again to confirm unlink' : 'Unlink from Plaid auto-sync'}
                      >
                        {unlinkConfirm === a.id ? 'Confirm unlink?' : <Unlink size={12} />}
                      </button>
                    )}
                    <button onClick={() => toggleActive(a)} className="icon-btn text-muted-foreground hover:text-foreground" title={a.active ? 'Deactivate' : 'Activate'}>
                      {a.active ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <button onClick={() => openEdit(a)} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
                    <button onClick={() => handleDelete(a)} className="icon-btn text-muted-foreground hover:text-destructive"><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
              {a.notes && <p className="text-xs text-muted-foreground mt-2 ml-12 break-words">{a.notes}</p>}
            </div>
          );
        })}
      </div>

      {/* ── Linked Banks (Plaid) ─────────────────────────────────────────── */}
      {!isDemo && (
        <div className="card-forged p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold flex items-center gap-1.5"><Link2 size={14} className="text-primary" /> Linked Banks</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Auto-sync balances from your bank accounts (premium)</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isPremium && plaidItems.length < 10 && (
                <PlaidLinkButton
                  onSuccess={handlePlaidSuccess}
                  onProcessing={setPlaidSyncing}
                />
              )}
            </div>
          </div>

          {isPremium && plaidItems.length > 0 && (() => {
            const mostRecent = plaidItems
              .map(i => i.last_synced_at)
              .filter(Boolean)
              .sort()
              .at(-1);
            return (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${mostRecent ? 'bg-green-500' : 'bg-yellow-500'}`} />
                {mostRecent
                  ? `Last synced ${new Date(mostRecent).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · Syncs Mon, Wed, Fri & Sat at 9 AM ET`
                  : 'Not yet synced · Syncs Mon, Wed, Fri & Sat at 9 AM ET'}
              </div>
            );
          })()}

          <p className="text-xs text-muted-foreground leading-relaxed">
            Bank connections are powered by{' '}
            <a href="https://plaid.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Plaid</a>
            , a trusted financial data platform used by thousands of apps. We never see your bank login credentials — Plaid handles authentication securely.{' '}
            <a href="https://plaid.com/legal/#end-user-privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Privacy Policy</a>
            {' · '}
            <a href="https://plaid.com/legal/#end-user-services-agreement" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Terms</a>
          </p>

          {!isPremium ? (
            <PremiumGate
              isPremium={false}
              title="Auto-Sync Bank Balances"
              features={['Connect up to 10 institutions', 'Balances sync daily and on demand', 'Flows into Forecast & Net Worth automatically']}
            >
              <div className="h-44" />
            </PremiumGate>
          ) : plaidLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> Loading linked banks…
            </div>
          ) : plaidItems.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No linked banks yet. Click "Link Bank Account" to connect your first institution.</p>
          ) : (
            <div className="space-y-2">
              {plaidItems.map(item => {
                const linkedAccounts = (accounts ?? []).filter(
                  a => a.plaid_item_id === item.plaid_item_id
                );
                const linkedCreditCards = linkedAccounts.filter(a => a.account_type === 'credit_card');
                const neverSynced = item.last_synced_at === null;
                const noAccounts = item.last_synced_at !== null && linkedAccounts.length === 0;
                const missingLiabilities = linkedCreditCards.length > 0 && linkedCreditCards.some(a => !a.liability_synced_at);
                const needsRelink = neverSynced || noAccounts || missingLiabilities;
                return (
                  <div key={item.id} className="space-y-2 border-b border-border/30 last:border-0 pb-2 last:pb-0">
                    <div className="flex items-center justify-between py-2 gap-2 min-w-0">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <Building2 size={13} className="text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">{item.institution_name ?? 'Bank'}</p>
                          {(() => {
                            const { text, isStale } = formatSyncStatus(item.last_synced_at);
                            return (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                {isStale && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 inline-block" />}
                                {text}
                              </p>
                            );
                          })()}
                        </div>
                      </div>
                      <button
                        disabled={delinking}
                        onClick={async () => {
                          if (delinkConfirm !== item.plaid_item_id) {
                            setDelinkConfirm(item.plaid_item_id);
                            return;
                          }
                          setDelinking(true);
                          setDelinkConfirm(null);
                          await removePlaidItem(item.plaid_item_id);
                          setDelinking(false);
                        }}
                        onBlur={() => setDelinkConfirm(null)}
                        className={`text-xs font-medium px-2 py-1 rounded border transition-colors shrink-0 ${
                          delinkConfirm === item.plaid_item_id
                            ? 'text-destructive border-destructive/40 bg-destructive/10'
                            : 'text-muted-foreground border-transparent hover:text-destructive'
                        }`}
                        title={delinkConfirm === item.plaid_item_id ? 'Click again to confirm' : 'Remove bank connection'}
                      >
                        {delinking && delinkConfirm === null ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : delinkConfirm === item.plaid_item_id ? (
                          'Confirm remove?'
                        ) : (
                          <Unlink size={13} />
                        )}
                      </button>
                    </div>
                    {needsRelink && (
                      <div className="flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <RefreshCw size={12} className="text-amber-500 shrink-0" />
                          <p className="text-xs text-muted-foreground">
                            {neverSynced || noAccounts
                              ? 'Sync pulled no accounts — re-link to try again.'
                              : 'Re-link to auto-populate APR and minimum payment from your bank.'}
                          </p>
                        </div>
                        <PlaidLinkButton
                          relinkItemId={item.plaid_item_id}
                          label="Re-link"
                          onSuccess={(accts) => handlePlaidSuccess(accts, item.institution_name ?? undefined)}
                          onProcessing={setPlaidSyncing}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Account Match Modal ─────────────────────────────────────────── */}
      {showMatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="card-forged w-full max-w-md p-5 space-y-4">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Match Linked Accounts</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Do any of these Plaid accounts match accounts you already added manually? We'll merge the balance and enable auto-sync on the existing one.
              </p>
            </div>
            <div className="space-y-3">
              {matchEntries.map((entry, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{entry.plaidAccount.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{formatCurrency(entry.plaidAccount.balance, false)}</p>
                  </div>
                  <select
                    className="bg-secondary border border-border text-xs px-2 py-1 rounded flex-1 min-w-0 truncate"
                    value={entry.matchedAccountId ?? ''}
                    onChange={e => setMatchEntries(prev => prev.map((en, j) => j === i ? { ...en, matchedAccountId: e.target.value || null } : en))}
                  >
                    <option value="">Keep as new account</option>
                    {accounts
  .filter(a => {
    if (a.plaid_account_id || !a.active) return false;
    const plaidName = entry.plaidAccount.name.trim().toLowerCase();
    const accountName = a.name.trim().toLowerCase();
    return plaidName === accountName;
  })
  .map(a => (
    <option key={a.id} value={a.id}>
      {a.name}
    </option>
  ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowMatchModal(false)} className="text-xs px-3 py-1.5 border border-border rounded hover:bg-secondary">Skip</button>
              <button
                onClick={handleConfirmMatch}
                disabled={matchSaving || matchEntries.every(e => !e.matchedAccountId)}
                className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded disabled:opacity-50"
              >
                {matchSaving ? 'Saving…' : 'Confirm Matches'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <FormModal
          title={editId ? 'Edit Account' : 'Add Account'}
          fields={[
            { key: 'name', label: 'Account Name', type: 'text', placeholder: 'e.g., Chase Checking', required: true, disabled: editingPlaidLinked },
            { key: 'account_type', label: 'Account Type', type: 'select', options: ACCOUNT_TYPES, required: true, placeholder: 'Select account type…' },
            { key: 'institution', label: 'Institution', type: 'text', placeholder: 'e.g., Chase, Fidelity', disabled: editingPlaidLinked, hint: editingPlaidLinked ? 'Managed by Plaid' : undefined },
            { key: 'balance', label: 'Current Balance', type: 'number' as const, placeholder: '0.00', step: '0.01', required: true, disabled: editingPlaidLinked, hint: editingPlaidLinked ? 'Balance is managed by Plaid auto-sync' : undefined },
            ...(form.account_type === 'credit_card' ? [
              { key: 'credit_limit', label: 'Credit Limit', type: 'number' as const, placeholder: '0', step: '0.01', disabled: editingPlaidLiability, hint: editingPlaidLiability ? 'Managed by Plaid' : undefined },
              { key: 'payment_due_day', label: 'Payment Due Day (1–28)', type: 'number' as const, placeholder: 'e.g. 15', step: '1', hint: 'Day of month your payment is due. Max 28 — not all months have 29–31.' },
              { key: 'card_start_date', label: 'Start Date (future cards)', type: 'date' as const, hint: 'Leave blank for existing cards. Set a future date to begin purchases from that month.' },
            ] : []),
            { key: 'apr', label: 'APR % (optional)', type: 'number' as const, placeholder: '0', step: '0.01', disabled: editingPlaidAprSynced, hint: editingPlaidAprSynced ? 'Managed by Plaid' : undefined },
            ...(APY_TYPES.includes(form.account_type) ? [
              { key: 'apy_rate', label: 'APY % (annual growth rate)', type: 'number' as const, placeholder: '7.0', step: '0.1' },
            ] : []),
            ...(LIABILITY_TYPES.includes(form.account_type) ? [
              { key: 'min_payment', label: 'Minimum Payment', type: 'number' as const, placeholder: '25', step: '0.01', hint: editingPlaidMinSynced ? 'Plaid-synced — enter a value here to override' : undefined },
            ] : []),
            ...(LOAN_TYPES.includes(form.account_type) ? [
              { key: 'apr_start_date', label: 'Interest Start Date (optional)', type: 'date' as const, hint: 'Date interest began accruing — used for total interest calculations.' },
            ] : []),
            { key: 'notes', label: 'Notes (optional)', type: 'text' as const, placeholder: 'Any details...' },
          ]}
          values={form}
          onChange={(k, v) => setForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditId(null); setEditingPlaidLinked(false); setEditingPlaidLiability(false); setEditingPlaidAprSynced(false); setEditingPlaidMinSynced(false); }}
          saving={add.isPending || update.isPending}
          saveLabel={editId ? 'Update Account' : 'Add Account'}
          notice={editingPlaidLinked ? `Balance, name, and institution are managed by Plaid.${editingPlaidLiability ? ` Credit limit is synced from Plaid.${editingPlaidAprSynced ? ' APR is synced from Plaid.' : ' APR was not returned by Plaid — you can edit it.'}${editingPlaidMinSynced ? ' Minimum payment is synced from Plaid.' : ' Minimum payment was not returned by Plaid — you can edit it.'}` : ''} Notes and payment due day are always editable.` : undefined}
        />
      )}
    </div>
  );
}
