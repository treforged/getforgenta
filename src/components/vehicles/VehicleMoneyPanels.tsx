import { useState, useMemo, useCallback } from 'react';
import { Plus, Car } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import FormModal, { type Field } from '@/components/shared/FormModal';
import { useFormDraft, type FormDraft } from '@/hooks/useFormDraft';
import { formatCurrency } from '@/lib/calculations';
import { getCarFundSaved } from '@/lib/vehicle-loan-engine';
import { useCarFunds, useAccounts, useRecurringRules, useTransactions, useProfile, type AccountRow } from '@/hooks/useSupabaseData';
import { useMatchedOccurrences } from '@/hooks/useMatchedOccurrences';
import { mergeWithGeneratedTransactions, getRemainingTransactionIncomeThisMonth, getRemainingTransactionExpensesThisMonth, getRemainingTransactionDebtPaymentsThisMonth } from '@/lib/pay-schedule';
import { useDemo } from '@/contexts/DemoContext';
import { filterProfanity, LIMITS } from '@/lib/content-filter';
import { isLiabilityAccountType } from '@/lib/net-worth';
import type { CarFund, CarFundSavedSource } from '@/lib/types';
import type { Json } from '@/integrations/supabase/types';
import SavingCard from './SavingCard';
import LoanCard from './LoanCard';
import BuyItDialog from './BuyItDialog';
import { addMonthsStr } from './vehicle-format';

/**
 * THE VEHICLE MONEY, WHEREVER IT IS SHOWN — the down-payment plans, the active auto loans, and
 * every write either of them makes (add, edit, delete, "I bought it", undo, planned extras).
 *
 * ⚠️ WHY THIS IS A COMPONENT AND NOT A PAGE. Tre, 2026-08-27: *"move saving for down payment and
 * active loans to the auto loans section inside the debt payoff tab. it makes more since there.
 * garage will just be the list of cars, the builds page, and maintenance"*. /debt's Auto Loans tab
 * already read the SAME loans — its two stat cards and its payoff trajectory come from the engine —
 * and was quoting these cars read-only with an "Edit on Vehicles page" link. This moves the SHELL
 * those cards live in, the way `Builds` moved into the Garage before it, so there is still exactly
 * ONE derivation of a car's money and now exactly one place to edit it.
 *
 * The two sections are stacked rather than put behind a second pill row: /debt already has a tab
 * bar directly above this, and nesting a second one would hide half the vehicle money behind a tap.
 */

const emptySavingForm = {
  vehicle_name: '', target_price: '', tax_fees: '', down_payment_goal: '', gift_contribution: '',
  current_saved: '', saved_source: 'fixed', saved_percent: '', monthly_insurance: '', expected_apr: '',
  loan_term_months: '', linked_account: '', linked_rule_id: '', planned_purchase_date: '',
  payment_start_date: '', insurance_start_date: '',
};

const emptyLoanForm = {
  vehicle_name: '', loan_amount: '', expected_apr: '', loan_term_months: '', loan_start_date: '',
  payment_start_date: '', interest_start_date: '', actual_monthly_payment: '', monthly_insurance: '',
  loan_payment_account: '', insurance_start_date: '', linked_loan_account_id: '',
};

const toMonthly = (amount: number, freq: string) =>
  freq === 'weekly' ? amount * 52 / 12
    : freq === 'biweekly' ? amount * 26 / 12
      : freq === 'quarterly' ? amount / 3
        : freq === 'annual' ? amount / 12 : amount;

export default function VehicleMoneyPanels() {
  const { data: carFunds, add, update, remove, loading } = useCarFunds();
  const { data: accounts } = useAccounts();
  const { data: rules } = useRecurringRules();
  const { data: transactions } = useTransactions();
  const { data: profile } = useProfile();
  const { isDemo } = useDemo();
  // §1B - occurrences a real payment has already answered: the ones the user confirmed AND the ones
  // the bank proves on its own. The confirmed half alone left this panel charging remaining cash for
  // bills the forecast had already captured.
  const { occurrences: confirmedOccurrences } = useMatchedOccurrences();

  const [showSavingForm, setShowSavingForm] = useState(false);
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [buyItFor, setBuyItFor] = useState<CarFund | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [savingForm, setSavingForm] = useState(emptySavingForm);
  const [loanForm, setLoanForm] = useState(emptyLoanForm);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [undoConfirm, setUndoConfirm] = useState<string | null>(null);

  const savingVehicles = useMemo(() => carFunds.filter(c => (c.phase ?? 'saving') === 'saving'), [carFunds]);
  const loanVehicles = useMemo(() => carFunds.filter(c => c.phase === 'loan'), [carFunds]);


  const liquidCash = useMemo(() =>
    accounts
      .filter(a => a.active && ['checking', 'business_checking', 'cash'].includes(a.account_type))
      .reduce((s, a) => s + Number(a.balance), 0),
    [accounts]
  );

  const cashFloor = useMemo(() => { const v = Number(profile?.cash_floor); return isNaN(v) ? 1000 : v; }, [profile]);

  const allMonthTransactions = useMemo(() =>
    mergeWithGeneratedTransactions(transactions || [], rules, accounts),
    [transactions, rules, accounts],
  );

  const remainingTxIncome = useMemo(() => getRemainingTransactionIncomeThisMonth(allMonthTransactions), [allMonthTransactions]);
  const remainingTxExpenses = useMemo(() => getRemainingTransactionExpensesThisMonth(allMonthTransactions, true, undefined, undefined, undefined, confirmedOccurrences), [allMonthTransactions, confirmedOccurrences]);
  const remainingTxDebt = useMemo(() => getRemainingTransactionDebtPaymentsThisMonth(allMonthTransactions), [allMonthTransactions]);

  // Available cash above floor today→EOM - mirrors Forecast month 0 surplus.
  const availableAboveFloor = useMemo(() =>
    Math.max(0, liquidCash + remainingTxIncome - remainingTxExpenses - remainingTxDebt - cashFloor),
    [liquidCash, remainingTxIncome, remainingTxExpenses, remainingTxDebt, cashFloor],
  );

  const accountMap = useMemo(() => {
    const map: Record<string, AccountRow> = {};
    accounts.forEach(a => { map[a.id] = a; });
    return map;
  }, [accounts]);

  const accountOptions = useMemo(() => [
    { value: '', label: 'None (Manual)' },
    ...accounts.filter(a => a.active).map(a => ({
      value: a.id,
      label: `${a.name} (${a.account_type.replace(/_/g, ' ')})`,
    })),
  ], [accounts]);

  // Restricted to liability-type accounts: this is the "this account IS the same loan" link net
  // worth uses to dedupe (net-worth.ts), so offering a checking or savings account here would
  // just be a confusing way to under-count debt.
  const autoLoanAccountOptions = useMemo(() => [
    { value: '', label: 'None (dedupe by name instead)' },
    ...accounts.filter(a => a.active && isLiabilityAccountType(a.account_type)).map(a => ({
      value: a.id,
      label: `${a.name} (${a.account_type.replace(/_/g, ' ')})`,
    })),
  ], [accounts]);

  const transferRuleOptions = useMemo(() => [
    { value: '', label: 'None (manual)' },
    ...rules
      .filter(r => (r.rule_type === 'transfer' || r.rule_type === 'investment') && r.active)
      .map(r => ({ value: r.id, label: `${r.name} - ${formatCurrency(r.amount, false)}/${r.frequency}` })),
  ], [rules]);

  const savingFormFields = useMemo(() => {
    const fields: Field[] = [
      { key: 'vehicle_name', label: 'Vehicle Name', type: 'text', placeholder: 'e.g., 2025 Honda Civic' },
      { key: 'target_price', label: 'Target Price', type: 'number', placeholder: '28000', step: '0.01' },
      { key: 'tax_fees', label: 'Tax & Fees', type: 'number', placeholder: '2000', step: '0.01' },
      { key: 'down_payment_goal', label: 'Down Payment Goal (total to dealer)', type: 'number', placeholder: '5600', step: '0.01' },
      { key: 'gift_contribution', label: 'Gift / External Contribution (optional)', type: 'number', placeholder: '0', step: '0.01' },
      { key: 'planned_purchase_date', label: 'Planned Purchase Date', type: 'date' },
      { key: 'payment_start_date', label: 'Planned First Payment Date', type: 'date' },
      { key: 'linked_account', label: 'Linked Account (auto-pull balance)', type: 'select', options: accountOptions },
      { key: 'linked_rule_id', label: 'Transfer Rule (auto-sync contribution)', type: 'select', options: transferRuleOptions },
    ];
    // §2.10: with an account linked, say WHICH part of that balance is car money. The whole balance
    // is the default and matches the pre-§2.10 behavior exactly; a percentage is the honest model
    // for a commingled account, and it can never claim more than the account actually holds.
    if (savingForm.linked_account) {
      fields.push({
        key: 'saved_source', label: 'Amount Saved', type: 'select',
        options: [
          { value: 'fixed', label: "The account's full balance" },
          { value: 'account_percent', label: 'A percentage of the balance' },
        ],
        hint: savingForm.saved_source === 'account_percent'
          ? 'Tracks the balance, so it can never claim more than the account holds.'
          : 'Pulls the full balance. Use a percentage if this account also holds other savings.',
      });
      if (savingForm.saved_source === 'account_percent') {
        fields.push({
          key: 'saved_percent', label: 'Percent of Balance Saved for This Vehicle',
          type: 'number', placeholder: '40', step: '0.01',
        });
      }
    } else {
      fields.push({ key: 'current_saved', label: 'Current Saved', type: 'number', placeholder: '0', step: '0.01' });
    }
    fields.push(
      { key: 'monthly_insurance', label: 'Monthly Insurance Est.', type: 'number', placeholder: '180', step: '0.01' },
      { key: 'insurance_start_date', label: 'Insurance Start Date (if different from purchase date)', type: 'date' },
      { key: 'expected_apr', label: 'Expected Loan APR %', type: 'number', placeholder: '5.9', step: '0.01' },
      { key: 'loan_term_months', label: 'Loan Term (months)', type: 'number', placeholder: '60' },
    );
    return fields;
  }, [savingForm.linked_account, savingForm.saved_source, accountOptions, transferRuleOptions]);

  // Both vehicle forms share one editId, so they share one draft: whichever was
  // open is the one that comes back, and reopening the other is a fresh form.
  const draftValues = useMemo(
    () => ({ savingForm, loanForm, which: showLoanForm ? 'loan' as const : 'saving' as const }),
    [savingForm, loanForm, showLoanForm],
  );

  const { restored: draftRestored, discard: discardDraft } = useFormDraft({
    formKey: 'vehicles',
    open: showSavingForm || showLoanForm,
    editId,
    values: draftValues,
    enabled: !isDemo,
    onRestore: useCallback((draft: FormDraft<typeof draftValues>) => {
      setSavingForm(draft.values.savingForm);
      setLoanForm(draft.values.loanForm);
      setEditId(draft.editId);
      if (draft.values.which === 'loan') setShowLoanForm(true);
      else setShowSavingForm(true);
    }, []),
  });

  const handleDiscardDraft = useCallback(() => {
    discardDraft();
    setSavingForm(emptySavingForm);
    setLoanForm(emptyLoanForm);
    setEditId(null);
  }, [discardDraft]);

  const openAddSaving = () => { setSavingForm(emptySavingForm); setEditId(null); setShowSavingForm(true); };
  const openAddLoan = () => { setLoanForm(emptyLoanForm); setEditId(null); setShowLoanForm(true); };

  const openEditSaving = (cf: CarFund) => {
    setSavingForm({
      vehicle_name: cf.vehicle_name,
      target_price: String(cf.target_price),
      tax_fees: String(cf.tax_fees),
      down_payment_goal: String(cf.down_payment_goal),
      gift_contribution: cf.gift_contribution ? String(cf.gift_contribution) : '',
      current_saved: String(cf.current_saved),
      saved_source: cf.saved_source ?? 'fixed',
      saved_percent: cf.saved_percent ? String(cf.saved_percent) : '',
      monthly_insurance: String(cf.monthly_insurance),
      expected_apr: String(cf.expected_apr),
      loan_term_months: String(cf.loan_term_months),
      linked_account: cf.linked_account ?? '',
      linked_rule_id: cf.linked_rule_id ?? '',
      planned_purchase_date: cf.planned_purchase_date ?? '',
      payment_start_date: cf.payment_start_date ?? '',
      insurance_start_date: cf.insurance_start_date ?? '',
    });
    setEditId(cf.id); setShowSavingForm(true);
  };

  const openEditLoan = (cf: CarFund) => {
    setLoanForm({
      vehicle_name: cf.vehicle_name, loan_amount: String(cf.loan_amount),
      expected_apr: String(cf.expected_apr), loan_term_months: String(cf.loan_term_months),
      loan_start_date: cf.loan_start_date ?? '', payment_start_date: cf.payment_start_date ?? '',
      interest_start_date: cf.interest_start_date ?? '', actual_monthly_payment: String(cf.actual_monthly_payment || ''),
      monthly_insurance: String(cf.monthly_insurance),
      loan_payment_account: cf.loan_payment_account ?? '',
      insurance_start_date: cf.insurance_start_date ?? '',
      linked_loan_account_id: cf.linked_loan_account_id ?? '',
    });
    setEditId(cf.id); setShowLoanForm(true);
  };

  const handleSaveSaving = () => {
    if (!savingForm.vehicle_name) return;
    if (!savingForm.planned_purchase_date) {
      toast.error('Planned Purchase Date is required.');
      return;
    }
    if (!savingForm.payment_start_date) {
      toast.error('Planned First Payment Date is required.');
      return;
    }
    const { clean: cleanVehicleName, flagged: vNameFlagged } = filterProfanity(savingForm.vehicle_name.trim().slice(0, LIMITS.vehicleName));
    if (vNameFlagged) toast.warning('Vehicle name contained inappropriate language and was cleaned.');
    const linkedAccount = savingForm.linked_account || null;
    const linkedRule = savingForm.linked_rule_id
      ? rules.find(r => r.id === savingForm.linked_rule_id)
      : null;
    // §2.10: percent mode is only meaningful against a linked account (the DB enforces this too),
    // so an unlinked fund always falls back to 'fixed'.
    const savedSource: CarFundSavedSource = linkedAccount && savingForm.saved_source === 'account_percent'
      ? 'account_percent'
      : 'fixed';
    const savedPercent = savedSource === 'account_percent'
      ? Math.min(100, Math.max(0, parseFloat(savingForm.saved_percent) || 0))
      : 0;
    if (savedSource === 'account_percent' && savedPercent <= 0) {
      toast.error('Enter the percent of that account’s balance saved for this vehicle.');
      return;
    }
    // `current_saved` stays the 'fixed' value. Under percent mode the figure is derived live by
    // getCarFundSaved, so this column is only a last-known snapshot for that row.
    const effectiveSaved = savedSource === 'account_percent'
      ? Math.max(0, Number(accountMap[linkedAccount!]?.balance ?? 0)) * (savedPercent / 100)
      : linkedAccount && accountMap[linkedAccount]
        ? Number(accountMap[linkedAccount].balance)
        : parseFloat(savingForm.current_saved) || 0;
    const payload = {
      vehicle_name: cleanVehicleName,
      target_price: parseFloat(savingForm.target_price) || 0,
      tax_fees: parseFloat(savingForm.tax_fees) || 0,
      down_payment_goal: parseFloat(savingForm.down_payment_goal) || 0,
      gift_contribution: parseFloat(savingForm.gift_contribution) || 0,
      current_saved: effectiveSaved,
      saved_source: savedSource,
      saved_percent: savedPercent,
      monthly_insurance: parseFloat(savingForm.monthly_insurance) || 0,
      expected_apr: parseFloat(savingForm.expected_apr) || 0,
      loan_term_months: parseInt(savingForm.loan_term_months) || 60,
      linked_account: linkedAccount,
      linked_rule_id: linkedRule?.id ?? null,
      planned_purchase_date: savingForm.planned_purchase_date || null,
      phase: 'saving' as const,
      // Pre-planned, ahead of activation - BuyItDialog prefills payment_start_date from this
      // instead of always defaulting to next-month. loan_start_date is intentionally left null
      // here - planned_purchase_date IS the loan's start date while saving (no separate field;
      // they're the same real-world date), and BuyItDialog/generateCarLoanTransactions both fall
      // back to planned_purchase_date when loan_start_date isn't set. Populating payment_start_date
      // here has no effect until the user actually hits "I bought it" - every loan-payment/
      // insurance calculation gates on phase === 'loan' first.
      loan_amount: 0, loan_start_date: null,
      payment_start_date: savingForm.payment_start_date || null,
      interest_start_date: null, actual_monthly_payment: 0,
      insurance_start_date: savingForm.insurance_start_date || null,
    };
    if (editId) update.mutate({ id: editId, ...payload });
    else add.mutate(payload);
    setShowSavingForm(false);
  };

  const handleSaveLoan = () => {
    if (!loanForm.vehicle_name) return;
    if (!loanForm.loan_start_date) {
      toast.error('Loan Start Date is required.');
      return;
    }
    if (!loanForm.payment_start_date) {
      toast.error('First Payment Date is required.');
      return;
    }
    const { clean: cleanLoanVehicleName } = filterProfanity(loanForm.vehicle_name.trim().slice(0, LIMITS.vehicleName));
    const payload: Partial<CarFund> & { vehicle_name: string } = {
      vehicle_name: cleanLoanVehicleName,
      loan_amount: parseFloat(loanForm.loan_amount) || 0,
      expected_apr: parseFloat(loanForm.expected_apr) || 0,
      loan_term_months: parseInt(loanForm.loan_term_months) || 60,
      loan_start_date: loanForm.loan_start_date || null,
      payment_start_date: loanForm.payment_start_date || null,
      interest_start_date: loanForm.interest_start_date || loanForm.payment_start_date || null,
      actual_monthly_payment: parseFloat(loanForm.actual_monthly_payment) || 0,
      monthly_insurance: parseFloat(loanForm.monthly_insurance) || 0,
      loan_payment_account: loanForm.loan_payment_account || null,
      insurance_start_date: loanForm.insurance_start_date || null,
      linked_loan_account_id: loanForm.linked_loan_account_id || null,
      phase: 'loan' as const,
    };
    // Only zero out saving-phase identity fields when creating a brand-new direct loan (no
    // saving-phase history exists to preserve). Editing an EXISTING loan - even just to tweak the
    // APR or term - must NOT touch these: this record may have come from a saving-phase car fund,
    // and overwriting them here destroyed that history permanently (Undo had no way to recover
    // it, since it assumes these fields were never touched). Supabase's .update() is a partial
    // PATCH, so omitting them on edit preserves whatever is already there.
    if (!editId) {
      payload.target_price = 0; payload.tax_fees = 0; payload.down_payment_goal = 0; payload.current_saved = 0;
      payload.linked_account = null; payload.linked_rule_id = null; payload.planned_purchase_date = null;
    }
    if (editId) update.mutate({ id: editId, ...payload });
    else add.mutate(payload);
    setShowLoanForm(false);
  };

  const handleBuyIt = (updates: Partial<CarFund>) => {
    if (!buyItFor) return;
    update.mutate({ id: buyItFor.id, ...updates });
    setBuyItFor(null);
    toast.success('Loan tracking started');
  };

  const handleDelete = (id: string) => {
    if (deleteConfirm === id) { remove.mutate(id); setDeleteConfirm(null); }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000); }
  };

  const handleUndo = (cf: CarFund) => {
    if (undoConfirm === cf.id) {
      update.mutate({
        id: cf.id,
        phase: 'saving',
        loan_amount: 0,
        loan_start_date: null,
        // payment_start_date is preserved, not nulled - it's a required saving-phase field now
        // (planned first-payment date), and the user already had a real planned value here.
        // Nulling it lost their plan on every undo and violated the "always required" invariant.
        interest_start_date: null,
        actual_monthly_payment: 0,
        // restore original saving-phase fields
        target_price: cf.target_price,
        tax_fees: cf.tax_fees,
        down_payment_goal: cf.down_payment_goal,
        current_saved: cf.current_saved,
        monthly_insurance: cf.monthly_insurance,
        expected_apr: cf.expected_apr,
        loan_term_months: cf.loan_term_months,
      });
      setUndoConfirm(null);
      toast.success('Reverted to saving phase');
    } else {
      setUndoConfirm(cf.id);
      setTimeout(() => setUndoConfirm(null), 3000);
    }
  };

  if (loading) return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {[0, 1].map(i => (
        <div key={i} className="card-forged p-4 space-y-3">
          <Skeleton className="h-4 w-40 bg-muted/50" />
          <Skeleton className="h-2 w-full bg-muted/50 rounded-full" />
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map(j => <Skeleton key={j} className="h-8 bg-muted/50" />)}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Loans</h2>
          <button onClick={openAddLoan} className="flex items-center gap-1.5 border border-border text-foreground px-3 py-1.5 text-xs font-medium btn-press hover:bg-muted/30 shrink-0" style={{ borderRadius: 'var(--radius)' }}>
            <Plus size={12} /> Add Loan
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {loanVehicles.map(cf => (
            <LoanCard
              key={cf.id}
              cf={cf}
              onEdit={() => openEditLoan(cf)}
              onDelete={() => handleDelete(cf.id)}
              onUndo={() => handleUndo(cf)}
              deleteConfirm={deleteConfirm === cf.id}
              undoConfirm={undoConfirm === cf.id}
              onSaveLumpSums={(lumps) => update.mutate({ id: cf.id, lump_sum_payments: lumps as unknown as Json })}
              liquidCash={liquidCash}
            />
          ))}
          {loanVehicles.length === 0 && (
            <div className="card-forged p-12 text-center md:col-span-2">
              <Car size={32} className="text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No active loans yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Hit "I bought it" on a saving-phase card to start tracking.</p>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Saving for Down Payment</h2>
          <button onClick={openAddSaving} className="flex items-center gap-1.5 border border-border text-foreground px-3 py-1.5 text-xs font-medium btn-press hover:bg-muted/30 shrink-0" style={{ borderRadius: 'var(--radius)' }}>
            <Plus size={12} /> Add Vehicle Goal
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {savingVehicles.map(cf => {
            const linkedAccount = cf.linked_account ? accountMap[cf.linked_account] : null;
            const linkedRule = cf.linked_rule_id
              ? rules.find(r => r.id === cf.linked_rule_id)
              : null;
            // §2.10: resolve the saved figure ONCE here and hand downstream a plain 'fixed' fund, so
            // nothing re-derives a percentage from an already-resolved number.
            const resolvedSaved = getCarFundSaved(
              cf, null, linkedAccount ? Number(linkedAccount.balance) : null,
            );
            const displayCf: CarFund = resolvedSaved === Number(cf.current_saved) && cf.saved_source === 'fixed'
              ? cf
              : { ...cf, current_saved: resolvedSaved, saved_source: 'fixed' };
            const monthlyContrib = linkedRule
              ? toMonthly(Number(linkedRule.amount), linkedRule.frequency)
              : 0;
            // Compute monthly needed when no transfer rule is linked
            const computedMonthlyNeeded = (() => {
              if (monthlyContrib > 0) return 0; // rule handles it
              const gift = Number(cf.gift_contribution) || 0;
              const personalGoal = Math.max(0, cf.down_payment_goal - gift);
              const rem = Math.max(0, personalGoal - resolvedSaved);
              if (rem <= 0) return 0;
              const now = new Date();
              let savingMonths = 13; // default: this month + 12 future
              if (cf.planned_purchase_date) {
                const parts = (cf.planned_purchase_date as string).split('-').map(Number);
                const pd = new Date(parts[0], parts[1] - 1, parts[2]);
                const diff = (pd.getFullYear() - now.getFullYear()) * 12 + (pd.getMonth() - now.getMonth());
                savingMonths = Math.max(1, diff + 1); // include the purchase month
              }
              return Math.min(rem / savingMonths, rem);
            })();
            return (
              <SavingCard
                key={cf.id}
                cf={displayCf}
                onEdit={() => openEditSaving(cf)}
                onDelete={() => handleDelete(cf.id)}
                onBuyIt={() => setBuyItFor(cf)}
                deleteConfirm={deleteConfirm === cf.id}
                linkedAccountName={linkedAccount?.name ?? null}
                monthlyContrib={monthlyContrib}
                computedMonthlyNeeded={computedMonthlyNeeded}
                onSaveLumpSums={(lumps) => update.mutate({ id: cf.id, lump_sum_payments: lumps as unknown as Json })}
                liquidCash={liquidCash}
                availableAboveFloor={availableAboveFloor}
              />
            );
          })}
          {savingVehicles.length === 0 && (
            <div className="card-forged p-12 text-center md:col-span-2">
              <p className="text-sm text-muted-foreground">No vehicle goals yet.</p>
              <button onClick={openAddSaving} className="mt-3 text-xs text-primary hover:underline">Add one</button>
            </div>
          )}
        </div>
      </section>

      {buyItFor && (
        <BuyItDialog
          cf={buyItFor} accountOptions={accountOptions} autoLoanAccountOptions={autoLoanAccountOptions}
          onConfirm={handleBuyIt} onClose={() => setBuyItFor(null)}
        />
      )}

      {showSavingForm && (
        <FormModal
          title={editId ? 'Edit Vehicle Goal' : 'Add Vehicle Goal'}
          fields={savingFormFields}
          values={savingForm}
          onChange={(k, v) => setSavingForm(prev => {
            const next = { ...prev, [k]: v };
            // Auto-suggest a first-payment date one month after purchase - matches the
            // purchaseMonthIdx + 1 relationship the saving-phase projection already assumes.
            // Only fills it in if it's not already set, so it never overwrites a manual edit.
            if (k === 'planned_purchase_date' && v && !prev.payment_start_date) {
              next.payment_start_date = addMonthsStr(v, 1);
            }
            return next;
          })}
          onSave={handleSaveSaving}
          draftRestored={draftRestored}
          onDiscardDraft={handleDiscardDraft}
          onClose={() => setShowSavingForm(false)}
        />
      )}

      {showLoanForm && (
        <FormModal
          title={editId ? 'Edit Auto Loan' : 'Add Auto Loan'}
          fields={[
            { key: 'vehicle_name', label: 'Vehicle Name', type: 'text', placeholder: 'e.g., Toyota RAV4' },
            { key: 'loan_amount', label: 'Loan Amount', type: 'number', placeholder: '25000', step: '0.01' },
            { key: 'expected_apr', label: 'APR %', type: 'number', placeholder: '5.9', step: '0.01' },
            { key: 'loan_term_months', label: 'Term (months)', type: 'number', placeholder: '60' },
            { key: 'loan_start_date', label: 'Loan Start Date', type: 'date' },
            { key: 'payment_start_date', label: 'First Payment Date', type: 'date' },
            { key: 'interest_start_date', label: 'Interest Start Date', type: 'date' },
            { key: 'actual_monthly_payment', label: 'Payment Override (blank = scheduled)', type: 'number', placeholder: '0', step: '0.01' },
            { key: 'monthly_insurance', label: 'Monthly Insurance', type: 'number', placeholder: '180', step: '0.01' },
            { key: 'insurance_start_date', label: 'Insurance Start Date (if different from loan start)', type: 'date' },
            { key: 'loan_payment_account', label: 'Monthly Payment Account', type: 'select', options: accountOptions },
            { key: 'linked_loan_account_id', label: 'Linked Loan Account (uses its live balance)', type: 'select', options: autoLoanAccountOptions },
          ]}
          values={loanForm}
          onChange={(k, v) => setLoanForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSaveLoan}
          draftRestored={draftRestored}
          onDiscardDraft={handleDiscardDraft}
          onClose={() => setShowLoanForm(false)}
        />
      )}
    </div>
  );
}
