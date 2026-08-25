import { backdropAction } from '@/lib/form-dismiss';
import PanelBar from '@/components/shared/PanelBar';
import SurfaceGuide from '@/components/shared/SurfaceGuide';
import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from 'react';
import { TransactionsSkeleton } from '@/components/shared/PageSkeleton';
import { useFormDraft, type FormDraft } from '@/hooks/useFormDraft';
import { formatCurrency } from '@/lib/calculations';
import { useTransactions, useAccounts, useRecurringRules, useAccountReconciliations, usePaymentPlans, useCarFunds, type AccountRow, type RuleRow } from '@/hooks/useSupabaseData';
import { usePersistedState } from '@/hooks/usePersistedState';
import { CATEGORIES, CATEGORY_EMOJI } from '@/lib/types';
import { PROJECTION_MONTHS } from '@/lib/credit-card-engine';
import { createDebtPaymentTransactions, mergeDebtPaymentsIntoStream, mergeWithGeneratedTransactionsForHorizon, type EnrichedTransaction } from '@/lib/pay-schedule';
import { useCardProjectionContext } from '@/contexts/CardProjectionContext';
import { getCardStartDateViolation } from '@/lib/card-start-date';
import BankActivity from '@/components/transactions/BankActivity';
import { useBankReviewQueueCount } from '@/hooks/useBankReviewQueue';
import FormModal, { type Field } from '@/components/shared/FormModal';
import DateScrollPicker from '@/components/shared/DateScrollPicker';
import { Plus, Edit2, Trash2, Copy, Repeat, AlertTriangle, SlidersHorizontal, Crown, Download, CreditCard, ChevronDown, ChevronUp, Split } from 'lucide-react';
import { planDraftFromTransaction } from '@/lib/payment-plan-from-transaction';
import {
  parseTransactionRepeat,
  ruleFromTransactionForm,
  transactionRepeatCadence,
  transactionRepeatHint,
  TRANSACTION_REPEAT_OPTIONS,
} from '@/lib/transaction-to-rule';
import { exportTransactionsCsv } from '@/lib/exportCsv';
import { exportTransactionsPdf } from '@/lib/exportPdf';
import { filterProfanity, LIMITS } from '@/lib/content-filter';
import { toast } from 'sonner';
import { Link, useSearchParams } from 'react-router';
import { useDemo } from '@/contexts/DemoContext';
import { useSubscription } from '@/hooks/useSubscription';
import { generatePaymentPlanTransactions, getPlanProgress, getNextPaymentDate, isPlanInProgress, PaymentPlan, PaymentPlanFrequency } from '@/lib/payment-plan-generator';
import { generateCarLoanTransactions } from '@/lib/vehicle-loan-engine';
import { scanForDuplicateTransactions } from '@/lib/duplicate-transaction-detection';
import { useDismissedDuplicates } from '@/hooks/useDismissedDuplicates';
import DuplicateTransactionWarning from '@/components/shared/DuplicateTransactionWarning';
import type { Tables } from '@/integrations/supabase/types';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import { activityTabFromSearch, effectiveActivityTab, type ActivityTab } from '@/lib/activity-tab';

// LAZY, not a plain import. Budget Control was its own route chunk until today; importing it
// statically here would fold it into the Activity chunk, so every visit to the planning ledger —
// by far the common one — would pay for a panel it never opens. Same trade, and the same measured
// reason, as `Accounts` inside `Dashboard`. Read the chunk sizes out of the build before changing
// this back.
const BudgetControl = lazy(() => import('@/pages/BudgetControl'));

const ALL_CATEGORIES = ['Income', ...CATEGORIES.filter(c => c !== 'Income')];

// `repeat` is the Repeats select, and it is the ONE field that changes what a save writes: anything
// other than 'none' creates a recurring rule instead of this row. See `lib/transaction-to-rule.ts`.
//
// `overrides_rule` is not a field anyone can see. It carries the id of the rule whose occurrence
// this form is standing in for, and it exists to HIDE the Repeats select on that one path:
// "Edit This Occurrence Only" saves with `editId` null, a new row and so add mode, while the user is
// plainly editing something that already repeats. Offering a repeat there would insert a SECOND
// rule beside the first and bill the same money twice, forever. It lives in the form rather than in
// its own state so a restored draft cannot come back without it.
const emptyForm = { date: new Date().toISOString().split('T')[0], type: 'expense', amount: '', category: 'Other', account: 'Checking', note: '', payment_source: '', repeat: 'none', overrides_rule: '' };

const emptyPlanForm = {
  name: '',
  provider: '',
  total_amount: '',
  frequency: 'monthly' as PaymentPlanFrequency,
  start_date: new Date().toISOString().split('T')[0],
  total_payments: '',
  category: 'Shopping',
  payment_source: '',
  plan_type: 'upfront' as 'upfront' | 'monthly_charge',
  notes: '',
};

export default function Transactions() {
  const { isDemo } = useDemo();
  const { isPremium } = useSubscription();
  const { data: transactions, add, update, remove, loading: transactionsLoading } = useTransactions();
  const { data: accounts, loading: accountsLoading } = useAccounts();
  const { data: rules, add: addRule, update: updateRule, loading: rulesLoading } = useRecurringRules();
  const { cardProjection, forecastFundingAccountId } = useCardProjectionContext();
  const { data: reconciliations } = useAccountReconciliations();
  const { data: paymentPlans, add: addPlan, update: updatePlan, remove: removePlan, loading: paymentPlansLoading } = usePaymentPlans();
  const { data: carFunds } = useCarFunds();

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterSource, setFilterSource] = useState('all');

  // Month filter: 'YYYY-MM' | 'all'
  const currentMonthStr = new Date().toISOString().slice(0, 7);
  const [filterMonth, setFilterMonth] = useState<string>(currentMonthStr);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editChoiceId, setEditChoiceId] = useState<string | null>(null);
  const [editChoiceRule, setEditChoiceRule] = useState<RuleRow | null>(null);

  // Payment plan state
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [editPlanId, setEditPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState(emptyPlanForm);
  // The form as it was when the popup opened. A backdrop tap compares against THIS, not
  // against an empty form, so editing an existing plan without changing anything still
  // counts as pristine. See `lib/form-dismiss.ts`.
  const [planBaseline, setPlanBaseline] = useState(emptyPlanForm);
  const [planDeleteConfirm, setPlanDeleteConfirm] = useState<string | null>(null);
  // N7 — the transaction the open plan modal was converted FROM, or null for an ordinary add/edit.
  // Held here rather than folded into `editPlanId` because the two mean opposite things at save
  // time: an edit updates a plan, a conversion inserts one AND deletes the row named here.
  const [convertSourceTxnId, setConvertSourceTxnId] = useState<string | null>(null);
  // Persisted so the section is in the same state the user left it in. UI preference, not
  // financial data, so localStorage (per-device) rather than a profile column — same choice as
  // `tre:debt:expanded-card` and `tre:debtpayoff:pause-savings`.
  const [showPlans, setShowPlans] = usePersistedState<boolean>('tre:transactions:show-plans', true);

  // §1B — Planning vs Bank Activity. The two streams are never interleaved: this page's rows are
  // what WILL happen (hand-entered plus generated debt/plan/car-loan occurrences), bank activity is
  // what DID. Persisted like the other view toggles above, for the same reason.
  //
  // ⚠️ AND SINCE 2026-08-18, Budget Control is the THIRD value of this same selector rather than a
  // tab of its own (Tre: "we need to reduce how many separate tabs"). It is one row of three, not
  // an outer row wrapping this one — see `activity-tab.ts` for why nesting was rejected. The key is
  // unchanged, so every stored 'planning'/'bank' keeps working; `effectiveActivityTab` heals
  // anything else rather than rendering an empty surface.
  const [storedTab, setActiveTab] = usePersistedState<ActivityTab>('tre:transactions:tab', 'planning');
  const activeTab = effectiveActivityTab(storedTab);
  // A link may name a panel — `/budget` redirects here saying `?tab=budget`. Honoured ONCE and then
  // stripped, after which the user's own remembered panel takes over again. Identical to Dashboard.
  const [searchParams, setSearchParams] = useSearchParams();
  const askedTab = activityTabFromSearch(searchParams);
  useEffect(() => {
    if (!askedTab) return;
    setActiveTab(askedTab);
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    setSearchParams(next, { replace: true });
  }, [askedTab, searchParams, setSearchParams, setActiveTab]);
  // Null while loading and null at zero — the tab renders no badge in both cases, because a "0" and
  // a badge that failed to compute are indistinguishable to a user.
  const reviewQueueCount = useBankReviewQueueCount();

  // Build account lookup map
  const accountMap = useMemo(() => {
    const map: Record<string, AccountRow> = {};
    accounts.forEach(a => { map[a.id] = a; map[`account:${a.id}`] = a; });
    return map;
  }, [accounts]);

  // Normalize a payment_source to `account:ID` format
  const normalizeSource = useCallback((src: string | null | undefined): string => {
    if (!src) return '';
    if (src.startsWith('account:')) return src;
    // If it's a raw account ID, prefix it
    if (accountMap[src]) return `account:${src}`;
    return src;
  }, [accountMap]);

  // Base transaction stream: real + generated recurring, over the SAME horizon the month filter
  // offers. This page used the current-month-only merge until 2026-08-13, so every future month in
  // the dropdown showed only hand-entered rows — see mergeWithGeneratedTransactionsForHorizon for
  // why this is a separate function and the engines keep the current-month one.
  const baseTxns: EnrichedTransaction[] = useMemo(() => {
    return mergeWithGeneratedTransactionsForHorizon(transactions, rules, accounts, PROJECTION_MONTHS)
      .map(t => ({ ...t, isGenerated: Boolean(t.isGenerated), isDebtPayment: false }));
  }, [transactions, rules, accounts]);

  const [pauseSavings] = usePersistedState<boolean>('tre:debtpayoff:pause-savings', false);

  // Savings/investing rule IDs for "paused" badge
  const savingsRuleIdsForBadge = useMemo(() => new Set<string>(
    rules.filter(r =>
      r.active && r.rule_type === 'expense' &&
      (r.category === 'Savings' || r.category === 'Investing'),
    ).map(r => r.id),
  ), [rules]);

  // "N active" counts plans that still owe an installment — plan.active alone counts finished
  // plans forever, since nothing writes that flag back when the last payment date passes.
  const activePlanCount = useMemo(
    () => paymentPlans.filter(p => isPlanInProgress(p)).length,
    [paymentPlans],
  );

  // Debt payment rows come from the SAME canonical month-0 projection the Dashboard widget, the
  // Debt Payoff tab, and Forecast read (cardProjection.month0.perCardAdjusted). This page used to
  // run its own 1-month simulateVariablePayoff with a different cash floor (raw profile floor, not
  // the augmented one), a hardcoded 'avalanche' strategy, and no override / vehicle / goal inputs.
  // The result: the ledger row for whichever card absorbed the surplus disagreed with the
  // recommendation shown everywhere else, while minimum-payment cards happened to match.
  const debtPaymentTransactions = useMemo(() => {
    const m0 = cardProjection?.month0;
    if (!m0) return [];
    const simCards = cardProjection?.simCards ?? [];
    return createDebtPaymentTransactions(
      m0.perCardAdjusted.map(rec => ({
        cardId: rec.id,
        cardName: rec.name,
        payment: rec.payment,
        dueDay: simCards.find(c => c.id === rec.id)?.dueDay ?? null,
      })),
      forecastFundingAccountId,
    );
  }, [cardProjection, forecastFundingAccountId]);

  // Map reconciliation records to transaction-like shape for rendering
  const reconciliationTxns: EnrichedTransaction[] = useMemo(() => {
    return (reconciliations || []).map(r => ({
      id: `recon:${r.id}`,
      date: r.effective_date,
      type: r.delta >= 0 ? 'income' : 'expense',
      amount: Math.abs(r.delta),
      category: 'Balance Adjustment',
      note: 'Balance Adjustment',
      payment_source: '',
      account: '',
      isGenerated: false,
      isDebtPayment: false,
      isReconciliation: true,
      reconciliationDelta: r.delta,
    }));
  }, [reconciliations]);

  const planTransactions = useMemo(() => generatePaymentPlanTransactions(paymentPlans), [paymentPlans]);
  const carLoanTransactions = useMemo(() => generateCarLoanTransactions(carFunds ?? []), [carFunds]);

  // Merge real + generated recurring + debt payments + reconciliations + plan payments + car loans
  const allTransactions = useMemo(() => {
    return [
      ...mergeDebtPaymentsIntoStream(baseTxns, debtPaymentTransactions),
      ...reconciliationTxns,
      ...planTransactions,
      ...carLoanTransactions,
    ].sort((a, b) => b.date.localeCompare(a.date));
  }, [baseTxns, debtPaymentTransactions, reconciliationTxns, planTransactions, carLoanTransactions]);

  const paymentSourceOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: 'cash', label: 'Cash' }];
    accounts.filter(a => a.active).forEach(a => {
      const typeLabel = a.account_type === 'credit_card' ? 'Credit Card'
        : a.account_type === 'high_yield_savings' ? 'HYS'
        : a.account_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      opts.push({ value: `account:${a.id}`, label: `${a.name} (${typeLabel})` });
    });
    if (opts.length === 1) {
      opts.push({ value: 'bank_account', label: 'Bank Account' });
      opts.push({ value: 'credit_card', label: 'Credit Card' });
    }
    return opts;
  }, [accounts]);

  const getSourceLabel = useCallback((source: string | null | undefined) => {
    if (!source) return 'Unassigned';
    // Try direct match
    const opt = paymentSourceOptions.find(o => o.value === source);
    if (opt) return opt.label;
    // Try with account: prefix
    const prefixed = paymentSourceOptions.find(o => o.value === `account:${source}`);
    if (prefixed) return prefixed.label;
    // Try raw account lookup
    const acct = accountMap[source];
    if (acct) return acct.name;
    if (source === 'bank_account') return 'Bank Account';
    if (source === 'credit_card') return 'Credit Card';
    if (source === 'cash') return 'Cash';
    return source;
  }, [paymentSourceOptions, accountMap]);

  // Check if a source account is missing/deleted
  const isSourceMissing = useCallback((source: string | null | undefined) => {
    if (!source || source === 'cash' || source === 'bank_account' || source === 'credit_card') return false;
    const id = source.startsWith('account:') ? source.slice(8) : source;
    return !accountMap[id] && !accountMap[`account:${id}`];
  }, [accountMap]);

  const filtered = useMemo(() => {
    return allTransactions.filter(t => {
      if (filterMonth !== 'all' && t.date.slice(0, 7) !== filterMonth) return false;
      if (filterType !== 'all' && t.type !== filterType) return false;
      if (filterCategory !== 'all' && t.category !== filterCategory) return false;
      if (filterSource !== 'all' && t.payment_source !== filterSource) return false;
      return true;
    });
  }, [allTransactions, filterMonth, filterType, filterCategory, filterSource]);

  // A hand-entered row the app also generates charges its month twice — Tre's Sep 2026 car payment
  // is the live case. Scanned off the RAW ledger plus the three generators, not off `allTransactions`
  // (which already interleaves both halves), so the pairing sees exactly what it must compare.
  const { dismissed: dismissedDuplicates, dismiss: dismissDuplicate } = useDismissedDuplicates();
  const duplicateCollisions = useMemo(() => scanForDuplicateTransactions({
    transactions,
    rules,
    accounts,
    paymentPlans,
    carFunds: carFunds ?? [],
    dismissed: dismissedDuplicates,
  }), [transactions, rules, accounts, paymentPlans, carFunds, dismissedDuplicates]);

  // Follow the month filter, so the panel talks about the ledger on screen. "All Time" shows every
  // collision — the whole point is that a duplicate in a month nobody is looking at is the one that
  // moves the forecast.
  const visibleDuplicates = useMemo(
    () => (filterMonth === 'all'
      ? duplicateCollisions
      : duplicateCollisions.filter(c => c.monthKey === filterMonth)),
    [duplicateCollisions, filterMonth],
  );

  const handleDeleteDuplicate = useCallback(async (manualId: string) => {
    try {
      await remove.mutateAsync(manualId);
      toast.success('Manual row deleted — the generated payment still stands.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete that transaction.');
    }
  }, [remove]);

  // Build month options as a fixed current-month-forward window (matches the projection
  // horizon used everywhere else in the app), not from distinct months actually present in
  // allTransactions. Deriving it from transaction dates let a long history of past months
  // fill the cap before the walk ever reached the current/future months, hiding them from
  // the dropdown entirely. Past months remain fully visible via "All Time" — they just don't
  // get their own dropdown entry.
  const monthOptions = useMemo(() => {
    const start = new Date();
    start.setDate(1);
    return Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
      return { value, label };
    });
  }, []);

  // `expense` here is every dollar that left, debt principal included — the honest CASH figure, and
  // deliberately NOT the Dashboard's Option B MONTHLY EXPENSES (§2.4). The two tiles legitimately
  // differ; `debtService` is the bridge between them, so it must be defined exactly as the
  // Dashboard's DEBT SERVICE tile is: card payments in full, plus the PRINCIPAL half of a car-loan
  // payment. The interest half is spending and stays inside the expense view on both pages.
  // `net` is unchanged by any of this — income minus all cash out is right either way.
  const totals = useMemo(() => {
    const realized = filtered.filter(t => t.category !== 'Balance Adjustment');
    const income = realized.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const expenses = realized.filter(t => t.type === 'expense');
    const expense = expenses.reduce((s, t) => s + Number(t.amount), 0);
    const debtService = expenses.reduce((s, t) => {
      if (t.isDebtPayment) return s + Number(t.amount);
      // Only a row that carries an explicit split contributes principal. A car-loan row predating
      // the split has no `principalPortion`, and counting its whole payment would overstate debt
      // service by the interest — better to under-report a bridge line than to misstate it.
      if (t.isCarLoanPayment && typeof t.principalPortion === 'number') return s + t.principalPortion;
      return s;
    }, 0);
    return { income, expense, debtService, net: income - expense };
  }, [filtered]);

  const spendBySource = useMemo(() => {
    const acc: Record<string, number> = {};
    filtered.filter(t => t.type === 'expense').forEach(t => {
      const src = getSourceLabel(t.payment_source || '');
      acc[src] = (acc[src] || 0) + Number(t.amount);
    });
    return acc;
  }, [filtered, getSourceLabel]);

  const { restored: draftRestored, discard: discardDraft } = useFormDraft({
    formKey: 'transactions',
    open: showForm,
    editId,
    values: form,
    enabled: !isDemo,
    onRestore: useCallback((draft: FormDraft<typeof emptyForm>) => {
      setForm(draft.values);
      setEditId(draft.editId);
      setShowForm(true);
    }, []),
  });

  const handleDiscardDraft = useCallback(() => {
    discardDraft();
    setForm(emptyForm);
    setEditId(null);
  }, [discardDraft]);

  const openAdd = () => { setForm(emptyForm); setEditId(null); setShowForm(true); };

  const openEditDirect = (t: EnrichedTransaction) => {
    setForm({ date: t.date, type: t.type, amount: String(t.amount), category: t.category, account: t.account || 'Checking', note: t.note || '', payment_source: normalizeSource(t.payment_source) || '', repeat: 'none', overrides_rule: '' });
    setEditId(t.id); setShowForm(true);
  };

  const handleEditClick = (t: EnrichedTransaction) => {
    if (t.isGenerated && t.ruleId) {
      const rule = rules.find(r => r.id === t.ruleId);
      setEditChoiceId(t.id);
      setEditChoiceRule(rule || null);
      return;
    }
    openEditDirect(t);
  };

  const handleEditOccurrence = (t: EnrichedTransaction) => {
    // Create as a real transaction (overrides this generated occurrence). `overrides_rule` keeps the
    // Repeats select off this dialog: the rule this occurrence came from is already the repeat, and
    // a second one beside it would bill the same money twice for good.
    setForm({ date: t.date, type: t.type, amount: String(t.amount), category: t.category, account: t.account || 'Checking', note: t.note || '', payment_source: normalizeSource(t.payment_source) || '', repeat: 'none', overrides_rule: t.ruleId || t.id });
    setEditId(null); // null = new transaction (override)
    setShowForm(true);
    setEditChoiceId(null);
    setEditChoiceRule(null);
    toast.info('Editing this occurrence only — saving will create a standalone transaction.');
  };

  const handleEditRule = () => {
    if (!editChoiceRule) return;
    // Navigate to Budget Control or open edit for the rule
    // For now, open a form pre-filled with rule data
    const r = editChoiceRule;
    setForm({
      date: new Date().toISOString().split('T')[0],
      type: r.rule_type === 'income' ? 'income' : 'expense',
      amount: String(r.amount),
      category: r.rule_type === 'income' ? 'Income' : r.category,
      account: 'Checking',
      note: r.name,
      payment_source: normalizeSource(r.payment_source || r.deposit_account) || '',
      repeat: 'none',
      overrides_rule: '',
    });
    // Store the rule ID for update
    setEditId(`rule:${r.id}`);
    setShowForm(true);
    setEditChoiceId(null);
    setEditChoiceRule(null);
    toast.info('Editing the recurring rule — changes affect all future occurrences.');
  };

  const duplicateTransaction = (t: EnrichedTransaction) => {
    setForm({
      date: new Date().toISOString().split('T')[0],
      type: t.type,
      amount: String(t.amount),
      category: t.category,
      account: t.account || 'Checking',
      note: t.note || '',
      payment_source: normalizeSource(t.payment_source) || '',
      repeat: 'none',
      // A duplicate is an ordinary new row, even when copied off a generated one, so the Repeats
      // select stays available here.
      overrides_rule: '',
    });
    setEditId(null);
    setShowForm(true);
  };

  // Ask 12: the Repeats choice, and it is deliberately forced back to 'none' whenever the modal is
  // editing something. Editing an existing row or overriding a generated occurrence keeps exactly
  // today's behaviour; turning a saved one-off into a rule is a different action with its own
  // consequences (which occurrences it replaces, what happens to the row it came from) and is not
  // built here.
  const canRepeat = !editId && !form.overrides_rule;
  const repeatChoice = canRepeat ? parseTransactionRepeat(form.repeat) : 'none';

  const handleSave = async () => {
    const amount = parseFloat(form.amount);
    if (!amount) return;

    const { clean: cleanNote, flagged: noteFlagged } = filterProfanity(form.note.trim().slice(0, LIMITS.transactionNote));
    if (noteFlagged) toast.warning('Note contained inappropriate language and was cleaned.');

    if (editId && editId.startsWith('rule:')) {
      // Update the recurring rule
      const ruleId = editId.slice(5);
      const rulePayload: { id: string } & Partial<Tables<'recurring_rules'>> = {
        id: ruleId,
        amount,
        name: cleanNote || 'Transaction',
        category: form.category,
      };
      if (form.type === 'income') {
        rulePayload.rule_type = 'income';
        rulePayload.deposit_account = form.payment_source?.startsWith('account:') ? form.payment_source.slice(8) : form.payment_source;
      } else {
        rulePayload.rule_type = 'expense';
        rulePayload.payment_source = form.payment_source?.startsWith('account:') ? form.payment_source.slice(8) : form.payment_source;
      }
      updateRule.mutate(rulePayload);
      toast.success('Recurring rule updated — future transactions will reflect this change.');
    } else {
      const violation = getCardStartDateViolation(form.date, form.payment_source, accounts ?? []);
      if (violation) { toast.error(violation); return; }
      if (repeatChoice !== 'none') {
        // ⚠️ THE RULE INSTEAD OF THE ROW, never both. The rule's own occurrence covers the entered
        // date (`generateMonthTransactionsFromRules`), so writing the transaction as well would put
        // two identical rows in that day and count the money twice.
        const intent = ruleFromTransactionForm({
          repeat: repeatChoice,
          date: form.date,
          type: form.type,
          amount,
          category: form.category,
          name: cleanNote,
          paymentSource: form.payment_source,
        });
        if (!intent.ok) { toast.error(intent.reason); return; }
        // `mutateAsync`, so a rejected insert leaves the form open with what the user typed rather
        // than closing on a rule that does not exist. `quiet` suppresses the hook's generic
        // "Recurring rule added" in favour of the one below, which says where to find it.
        try {
          await addRule.mutateAsync({ ...intent.payload, quiet: true });
        } catch {
          // The hook's own onError already named the cause.
          return;
        }
        toast.success(`Repeats ${transactionRepeatCadence(repeatChoice)}. Manage it under Budget Control.`);
      } else {
        const payload = { date: form.date, type: form.type, amount, category: form.category, account: form.account, note: cleanNote || 'Transaction', payment_source: form.payment_source };
        if (editId && !editId.startsWith('gen:')) {
          update.mutate({ id: editId, ...payload });
          toast.success('Transaction updated');
        } else {
          add.mutate(payload);
          toast.success('Transaction added');
        }
      }
    }
    setShowForm(false); setForm(emptyForm); setEditId(null);
  };

  const handleDelete = (id: string) => {
    if (id.startsWith('gen:')) return;
    if (deleteConfirm === id) { remove.mutate(id); setDeleteConfirm(null); }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000); }
  };

  const openAddPlan = () => { setPlanForm(emptyPlanForm); setPlanBaseline(emptyPlanForm); setEditPlanId(null); setConvertSourceTxnId(null); setShowPlanForm(true); };

  // N7 — the row's own "Convert to payment plan" action. Every refusal rule and every mapped field
  // lives in the lib function, so the button's visibility and this handler cannot disagree.
  const openConvertPlan = (t: EnrichedTransaction) => {
    const intent = planDraftFromTransaction(t, { paymentSource: normalizeSource(t.payment_source) });
    if (!intent.ok) { toast.error(intent.reason); return; }
    setPlanForm(intent.draft);
    setPlanBaseline(intent.draft);
    setEditPlanId(null);
    setConvertSourceTxnId(t.id);
    setShowPlanForm(true);
    toast.info('Converting this transaction — set how many payments, then save.');
  };

  const closePlanForm = () => { setShowPlanForm(false); setConvertSourceTxnId(null); };

  /**
   * A tap on the backdrop. Pristine dismisses; anything typed goes through the real save
   * handler, which validates — so an incomplete form stays open with its own message
   * instead of being discarded or written half-finished. See `lib/form-dismiss.ts`.
   */
  const dismissPlanForm = () => {
    if (backdropAction(planForm, planBaseline) === 'close') { closePlanForm(); return; }
    void handleSavePlan();
  };

  const openEditPlan = (plan: PaymentPlan) => {
    const loaded = {
      name: plan.name,
      provider: plan.provider ?? '',
      total_amount: String(plan.total_amount),
      frequency: plan.frequency,
      start_date: plan.start_date,
      total_payments: String(plan.total_payments),
      category: plan.category,
      payment_source: plan.payment_source ?? '',
      plan_type: plan.plan_type ?? 'upfront',
      notes: plan.notes ?? '',
    };
    setPlanForm(loaded);
    setPlanBaseline(loaded);
    setEditPlanId(plan.id);
    setConvertSourceTxnId(null);
    setShowPlanForm(true);
  };

  const handleSavePlan = async () => {
    const totalAmt = parseFloat(planForm.total_amount);
    const totalPay = parseInt(planForm.total_payments, 10);
    const payAmt = totalAmt / totalPay;
    if (!planForm.name.trim()) { toast.error('Plan name is required'); return; }
    if (!totalAmt || totalAmt <= 0) { toast.error('Total amount must be greater than 0'); return; }
    if (!totalPay || totalPay <= 0) { toast.error('Number of payments must be at least 1'); return; }
    const planViolation = getCardStartDateViolation(planForm.start_date, planForm.payment_source, accounts ?? []);
    if (planViolation) { toast.error(planViolation); return; }
    const { clean: cleanName, flagged: nameFlagged } = filterProfanity(planForm.name.trim().slice(0, LIMITS.planName));
    if (nameFlagged) toast.warning('Plan name contained inappropriate language and was cleaned.');
    const { clean: cleanNotes, flagged: notesFlagged } = filterProfanity(planForm.notes.trim().slice(0, LIMITS.planNotes));
    if (notesFlagged) toast.warning('Notes contained inappropriate language and was cleaned.');
    const payload = {
      name: cleanName,
      provider: planForm.provider.trim() || null,
      total_amount: totalAmt,
      payment_amount: payAmt,
      frequency: planForm.frequency,
      start_date: planForm.start_date,
      total_payments: totalPay,
      category: planForm.category,
      payment_source: planForm.payment_source || null,
      plan_type: planForm.plan_type,
      notes: cleanNotes || null,
      active: true,
    };
    if (editPlanId) {
      updatePlan.mutate({ id: editPlanId, ...payload });
    } else if (convertSourceTxnId) {
      // N7 — a conversion REPLACES the transaction, so the two writes are ordered and the delete is
      // conditional on the insert. `generatePaymentPlanTransactions` projects an installment row per
      // payment into this same stream, so leaving the original behind would double-count the
      // purchase everywhere the ledger is summed. `mutateAsync` (not `mutate`) is what makes the
      // ordering real; a rejected insert already toasts through the hook's own `onError`, and
      // reaching the catch means the row is deliberately left exactly where it was.
      // `silentSuccess` on both writes: a convert is ONE action to the user, so it gets one toast
      // below, not the hooks' "Payment plan added" + "Transaction deleted" pair on top of it.
      try {
        await addPlan.mutateAsync({ ...payload, silentSuccess: true });
      } catch {
        return;
      }
      try {
        await remove.mutateAsync({ id: convertSourceTxnId, silentSuccess: true });
        toast.success('Plan created — the original transaction was removed and replaced by its installments.');
      } catch {
        // The plan exists but its source row does not: both are now in the ledger, and saying so is
        // the only way the user knows to delete one. The hook's onError has already shown the cause.
        toast.warning('Plan created, but the original transaction could not be removed — delete it to avoid counting it twice.');
      }
    } else {
      addPlan.mutate(payload);
    }
    setShowPlanForm(false);
    setPlanForm(emptyPlanForm);
    setEditPlanId(null);
    setConvertSourceTxnId(null);
  };

  const handleDeletePlan = (id: string) => {
    if (planDeleteConfirm === id) {
      removePlan.mutate(id);
      setPlanDeleteConfirm(null);
    } else {
      setPlanDeleteConfirm(id);
      setTimeout(() => setPlanDeleteConfirm(null), 3000);
    }
  };

  const formFields = useMemo(() => {
    const fields: Field[] = [
      { key: 'date', label: 'Date', type: 'date' },
    ];
    // ADD MODE ONLY, and it sits next to Date because it is what the date means: one day, or the
    // first of a series. The hint spells out the resulting schedule AND that no single row is
    // written, which is the half a user would otherwise have to discover by counting rows.
    if (canRepeat) {
      const hint = transactionRepeatHint(repeatChoice, form.date);
      fields.push({
        key: 'repeat', label: 'Repeats', type: 'select', options: TRANSACTION_REPEAT_OPTIONS,
        ...(hint ? { hint } : {}),
      });
    }
    fields.push(
      { key: 'type', label: 'Type', type: 'select', options: [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }] },
      { key: 'amount', label: 'Amount', type: 'number', placeholder: '0.00', step: '0.01' },
      { key: 'category', label: 'Category', type: 'select', options: ALL_CATEGORIES.map(c => ({ value: c, label: c })) },
      { key: 'payment_source', label: editId?.startsWith('rule:') ? 'Account' : 'Payment Source', type: 'select', options: paymentSourceOptions },
      { key: 'note', label: repeatChoice === 'none' ? 'Note' : 'Note (becomes the rule name)', type: 'text', placeholder: 'What was this for?' },
    );
    return fields;
    // `repeatChoice` and `form.date` both feed the hint above. Omit either and the caption goes
    // stale the moment the user changes the cadence or the date.
  }, [paymentSourceOptions, editId, canRepeat, repeatChoice, form.date]);

  // The ledger is `transactions`; the Payment Plans panel is `paymentPlans`; the
  // scheduled rows are `rules`. None of those is `accounts`, which is all the
  // gate used to wait for — so "No payment plans yet." showed up first.
  if (accountsLoading || transactionsLoading || rulesLoading || paymentPlansLoading) {
    return <TransactionsSkeleton />;
  }

  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto stack-section overflow-x-hidden">
      {/* Header */}
<div className="space-y-3">
  {/* Title Row */}
  <div className="flex items-center gap-3">
    <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">
      Activity
    </h1>
    <div className="ml-auto">
      <SurfaceGuide surface="transactions" />
    </div>
  </div>

  {/* Tabs — planning stream vs what the bank reported.
      The Bank Activity tab carries the review-queue count: charges the app already has an answer
      for and is waiting on. NOT a count of unreviewed rows — most rows are unreviewed by design and
      always will be; see `@/lib/bank-activity-queue`. `useBankReviewQueueCount` returns null rather
      than 0, so a quiet queue and a queue that has not loaded both render nothing. */}
  <PanelBar>
    {([
      // Budget Control leads (Tre, 2026-08-18: "move budget control as the first tab of
      // transactions") — the rules are what every other number on this page derives from, so it
      // reads left to right as cause then effect: the rules, what they project, what the bank did.
      // A fresh SIGN-IN also lands here (`resetActivityTabForSignIn`, called from AuthContext);
      // within a session the panel is remembered. Tre, 2026-08-18: "it should land in whatever page
      // the user looked at last, on sign in it should be budget control though."
      { id: 'budget' as const, label: 'Budget Control', count: null as number | null },
      { id: 'planning' as const, label: 'Planning', count: null as number | null },
      { id: 'bank' as const, label: 'Bank Activity', count: reviewQueueCount },
    ]).map(t => (
      <button
        key={t.id}
        onClick={() => setActiveTab(t.id)}
        className={`seg-item btn-press ${activeTab === t.id ? 'seg-item-active' : ''}`}
        role="tab"
        aria-selected={activeTab === t.id}
      >
        {t.label}
        {t.count !== null && (
          <span
            className={`seg-badge ${activeTab === t.id ? 'seg-badge-active' : ''}`}
            title={`${t.count} bank ${t.count === 1 ? 'charge has' : 'charges have'} a suggested match waiting for you`}
          >
            {t.count}
          </span>
        )}
      </button>
    ))}
  </PanelBar>

  {/* Action Buttons — export and manual entry belong to the planning ledger only */}
  <div className={`flex flex-col gap-2 sm:flex-row sm:flex-wrap ${activeTab === 'planning' ? '' : 'hidden'}`}>
    {(isPremium || isDemo) ? (
      <>
        <button
          onClick={async () => {
            const filename = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
            await exportTransactionsCsv(filtered, filename);
          }}
          className="w-full sm:w-auto flex items-center justify-center gap-2 bg-secondary border border-border px-4 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <Download size={14} /> Export CSV
        </button>

        <button
          onClick={async () => {
            const period = filterMonth === 'all' ? 'All Time' : filterMonth;

            await exportTransactionsPdf(filtered, period);
          }}
          className="w-full sm:w-auto flex items-center justify-center gap-2 bg-secondary border border-border px-4 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <Download size={14} /> Export PDF
        </button>
      </>
    ) : (
      <Link
        to="/premium"
        className="w-full sm:w-auto flex items-center justify-center gap-2 bg-secondary border border-border px-4 py-2 text-sm font-medium text-primary/70 hover:text-primary hover:border-primary/40 transition-colors"
        style={{ borderRadius: 'var(--radius)' }}
      >
        <Crown size={14} /> Export
      </Link>
    )}

    {(isPremium || isDemo) ? (
      <button
        onClick={openAdd}
        className="w-full sm:w-auto flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold"
        style={{ borderRadius: 'var(--radius)' }}
      >
        <Plus size={14} /> Add Transaction
      </button>
    ) : (
      <Link
        to="/premium"
        className="w-full sm:w-auto flex items-center justify-center gap-2 bg-primary/20 text-primary px-4 py-2 text-sm font-semibold hover:bg-primary/30 transition-colors"
        style={{ borderRadius: 'var(--radius)' }}
      >
        <Crown size={14} /> Add Transaction
      </Link>
    )}
  </div>
</div>

      {activeTab === 'bank' && (
        <ErrorBoundary variant="widget" label="Bank Activity"><BankActivity /></ErrorBoundary>
      )}

      {/* ⚠️ RENDERED, NOT LINKED TO — and `BudgetControl` is unchanged apart from an `embedded` prop
          that suppresses only its own <h1>/subtitle and page padding, because this page already
          carries both. Mounted only while its own panel is selected, so its profile/rules/accounts
          queries never run while the user is on the planning ledger. */}
      {activeTab === 'budget' && (
        <Suspense fallback={<div className="h-64" />}>
          <ErrorBoundary variant="widget" label="Budget Control"><BudgetControl embedded /></ErrorBoundary>
        </Suspense>
      )}

      {activeTab === 'planning' && (<>

      {!isPremium && !isDemo && (
        <div className="card-forged p-4 border-primary/20 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 space-y-2">
            <p className="text-xs font-semibold text-foreground">One-time transactions — Premium</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Record income windfalls and large one-time expenses that instantly update your Debt Payoff engine and 60-month Forecast.
            </p>
            <ul className="space-y-1">
              {[
                'Windfalls (bonuses, tax refunds) automatically boost payoff speed',
                "Big expenses (car down payment, medical bill) reduce that month's payments",
                'Adjustments flow instantly to Dashboard, Forecast, and Debt Payoff',
              ].map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="text-primary font-bold shrink-0 mt-px">→</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
          <Link
            to="/premium"
            className="shrink-0 self-start sm:self-center flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <Crown size={12} /> Upgrade Now
          </Link>
        </div>
      )}

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-3">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-foreground">The live ledger — real entries + auto-generated ones</p>
              <p className="text-xs text-muted-foreground mt-0.5">Everything that has happened or is planned flows through here. One-time entries directly shape what the debt engine and forecast can do.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: 'Auto-generated entries', desc: 'Budget Control recurring rules create transactions automatically — weekly paychecks, rent, groceries, and more.' },
              // ⚠️ Do not name a figure or a month here unless `demo-data.ts` still carries it. Both of these
              // lines used to cite a "$6,000 car purchase in June" and a "$3,000 gift in June" that had been
              // out of the fixture for months, so the guide described entries a visitor could not find.
              { label: 'One-time expenses', desc: 'A planned car down payment sits in a future month — it reduces available cash there, and the forecast pre-saves in the months before to cover it.' },
              { label: 'Bank-imported history', desc: 'Rows that came from the bank feed rather than being typed — the same charges the Bank Activity tab decides on.' },
              { label: 'Debt payments', desc: 'Auto-generated from the Debt Payoff engine each month — click to see the recommended amount per card.' },
            ].map((f, i) => (
              <div key={i} className="flex gap-2 p-2.5 bg-secondary/40 text-xs" style={{ borderRadius: 'var(--radius)' }}>
                <span className="text-primary font-bold shrink-0">→</span>
                <div><span className="font-medium text-foreground">{f.label}: </span><span className="text-muted-foreground">{f.desc}</span></div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">All data is fictional.</p>
            <Link to="/auth" className="text-xs font-semibold text-primary hover:underline">Use with your own data →</Link>
          </div>
        </div>
      )}

      {/* Payment Plans Section — visible to all, gated for free users */}
      <div className="card-forged overflow-hidden">
          <div
            onClick={() => setShowPlans(p => !p)}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/20 transition-colors cursor-pointer"
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setShowPlans(p => !p); }}
          >
            <div className="flex items-center gap-2">
              <CreditCard size={14} className="text-primary" />
              <span className="text-sm font-display font-semibold">Payment Plans</span>
              {(isPremium || isDemo) && activePlanCount > 0 && (
                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 font-medium" style={{ borderRadius: 'var(--radius)' }}>
                  {activePlanCount} active
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {(isPremium || isDemo) && (
                <button
                  onClick={e => { e.stopPropagation(); openAddPlan(); }}
                  className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium"
                >
                  <Plus size={12} /> Add Plan
                </button>
              )}
              {showPlans ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
            </div>
          </div>

          {showPlans && (
            <div className="border-t border-border">
              {!(isPremium || isDemo) ? (
                <div className="p-5 flex flex-col items-center text-center gap-3">
                  <Crown size={16} className="text-primary" />
                  <div>
                    <p className="text-xs font-semibold text-foreground">Payment Plans — Premium</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs">Track PayPal Pay in 4, 0% APR promos, and any installment plan. Payments flow into Transactions and Forecast automatically.</p>
                  </div>
                  <Link to="/premium" className="bg-primary text-primary-foreground px-4 py-1.5 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors" style={{ borderRadius: 'var(--radius)' }}>Upgrade Now</Link>
                </div>
              ) : paymentPlans.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-xs text-muted-foreground">No payment plans yet.</p>
                  <p className="text-xs text-muted-foreground mt-1">Track PayPal Pay in 4, 0% APR promos, and any installment plan.</p>
                  <button onClick={openAddPlan} className="mt-3 text-xs text-primary hover:underline font-medium">Add your first plan</button>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {paymentPlans.map(plan => {
                    const { paid, remaining, endDate } = getPlanProgress(plan);
                    const nextDate = getNextPaymentDate(plan);
                    const pct = Math.round((paid / plan.total_payments) * 100);
                    const remainingAmt = remaining * plan.payment_amount;
                    return (
                      <div key={plan.id} className={`p-4 ${!plan.active ? 'opacity-50' : ''}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-xs font-semibold truncate">{plan.name}</p>
                              {plan.provider && (
                                <span className="text-[10px] bg-secondary border border-border px-1.5 py-0.5 text-muted-foreground shrink-0" style={{ borderRadius: 'var(--radius)' }}>
                                  {plan.provider}
                                </span>
                              )}
                              {!plan.active
                                ? <span className="text-[10px] text-muted-foreground">(inactive)</span>
                                : remaining === 0 && <span className="text-[10px] text-muted-foreground">(complete)</span>}
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[10px] text-muted-foreground shrink-0">{paid}/{plan.total_payments}</span>
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                              <p className="text-[11px] text-muted-foreground">
                                {formatCurrency(plan.payment_amount, false)}/{plan.frequency === 'biweekly' ? '2 wks' : plan.frequency === 'weekly' ? 'wk' : 'mo'}
                              </p>
                              {remaining > 0 && nextDate && (
                                <p className="text-[11px] text-muted-foreground">Next: {nextDate}</p>
                              )}
                              <p className="text-[11px] text-muted-foreground">Remaining: {formatCurrency(remainingAmt, false)}</p>
                              <p className="text-[11px] text-muted-foreground">Ends: {endDate}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => openEditPlan(plan)} className="icon-btn text-muted-foreground hover:text-foreground" title="Edit"><Edit2 size={12} /></button>
                            <button
                              onClick={() => handleDeletePlan(plan.id)}
                              className={`icon-btn ${planDeleteConfirm === plan.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}
                              title="Delete"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="bg-secondary border border-border px-2 py-1 text-xs text-foreground font-medium min-w-[120px]" style={{ borderRadius: 'var(--radius)' }}>
          <option value="all">All Time</option>
          {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {(['all', 'income', 'expense'] as const).map(t => (
          <button key={t} onClick={() => setFilterType(t)} className={`px-3 py-1 text-xs font-medium border btn-press ${filterType === t ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`} style={{ borderRadius: 'var(--radius)' }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="bg-secondary border border-border px-2 py-1 text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }}>
          <option value="all">All Categories</option>
          {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className="bg-secondary border border-border px-2 py-1 text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }}>
          <option value="all">All Sources</option>
          {paymentSourceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <DuplicateTransactionWarning
        collisions={visibleDuplicates}
        onDelete={handleDeleteDuplicate}
        onDismiss={dismissDuplicate}
      />

      <div className="grid grid-cols-3 gap-3">
        <div className="card-forged p-3 text-center"><p className="text-xs text-muted-foreground uppercase">Income</p><p className="text-sm font-display font-bold text-success">{formatCurrency(totals.income, false)}</p></div>
        <div className="card-forged p-3 text-center">
          <p className="text-xs text-muted-foreground uppercase">Total Cash Out</p>
          <p className="text-sm font-display font-bold text-destructive">{formatCurrency(totals.expense, false)}</p>
          {totals.debtService > 0 && (
            <p className="text-[10px] text-muted-foreground mt-0.5">of which {formatCurrency(totals.debtService, false)} debt service</p>
          )}
        </div>
        <div className="card-forged p-3 text-center"><p className="text-xs text-muted-foreground uppercase">Net</p><p className={`text-sm font-display font-bold ${totals.net >= 0 ? 'text-primary' : 'text-destructive'}`}>{formatCurrency(totals.net, false)}</p></div>
      </div>

      {Object.keys(spendBySource).length > 0 && (
        <div className="card-forged p-4">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Spend by Payment Source</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(spendBySource).map(([src, amt]) => (
              <div key={src} className="p-3 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
                <p className="text-xs text-muted-foreground truncate">{src}</p>
                <p className="text-sm font-display font-bold text-destructive">{formatCurrency(amt, false)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card-forged divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="p-8 text-center"><p className="text-sm text-muted-foreground">No transactions found.</p></div>
        ) : filtered.map(t => {
          const isRecon = t.isReconciliation;
          const sourceMissing = !isRecon && isSourceMissing(t.payment_source);
          const reconDelta = t.reconciliationDelta;
          // N7 — the lib decides; the button is just the visible half of that answer. Same premium
          // gate as the Payment Plans section it feeds.
          const canConvertToPlan = (isPremium || isDemo)
            && planDraftFromTransaction(t, { paymentSource: normalizeSource(t.payment_source) }).ok;
          return (
            <div key={t.id} className={`flex items-center justify-between px-4 py-3 ${t.isGenerated ? 'bg-muted/5' : ''} ${t.isDebtPayment ? 'border-l-2 border-l-primary/40' : ''} ${isRecon ? 'border-l-2 border-l-adjusted/40' : ''}`}>
              <div className="flex items-center gap-3">
                {isRecon
                  ? <SlidersHorizontal size={14} className="text-gold" />
                  : <span className="text-base leading-none w-5 text-center shrink-0">{t.isDebtPayment ? '💳' : t.isCarLoanPayment ? '🚗' : t.type === 'income' ? '💰' : (CATEGORY_EMOJI[t.category] ?? '📦')}</span>
                }
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium">{t.note || '—'}</p>
                    {t.isGenerated && !t.isDebtPayment && <Repeat size={10} className="text-primary" />}
                    {t.isDebtPayment && <span className="text-[9px] text-primary bg-primary/10 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }}>debt payoff</span>}
                    {t.isPlanPayment && <span className="text-[9px] text-info bg-info/10 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }}>installment</span>}
                    {t.isCarLoanPayment && <span className="text-[9px] text-success bg-success/10 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }}>car loan</span>}
                    {pauseSavings && t.ruleId && savingsRuleIdsForBadge.has(t.ruleId) && (
                      <span className="text-[9px] text-muted-foreground bg-muted/20 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }}>paused</span>
                    )}
                    {isRecon && <span className="text-[9px] text-adjusted bg-adjusted/10 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }} title="Manual balance correction">reconciled</span>}
                    {sourceMissing && <span className="text-destructive" aria-label="Linked account not found"><AlertTriangle size={10} /></span>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.date} · {t.category}{!isRecon && <> · {sourceMissing ? <span className="text-destructive">⚠ Missing account</span> : getSourceLabel(t.payment_source)}</>}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold font-display whitespace-nowrap ${isRecon ? (reconDelta !== undefined && reconDelta >= 0 ? 'text-success' : 'text-destructive') : t.type === 'income' ? 'text-success' : 'text-destructive'}`}>
                  {isRecon ? (reconDelta !== undefined && reconDelta >= 0 ? '+' : '') : (t.type === 'income' ? '+' : '-')}{isRecon && reconDelta !== undefined ? formatCurrency(reconDelta, false) : formatCurrency(Number(t.amount), false)}
                </span>
                {!isRecon && <button onClick={() => duplicateTransaction(t)} className="icon-btn text-muted-foreground hover:text-foreground" title="Duplicate"><Copy size={12} /></button>}
                {!isRecon && <button onClick={() => handleEditClick(t)} className="icon-btn text-muted-foreground hover:text-foreground" title="Edit"><Edit2 size={12} /></button>}
                {canConvertToPlan && (
                  <button onClick={() => openConvertPlan(t)} className="icon-btn text-muted-foreground hover:text-primary" title="Convert to payment plan" aria-label="Convert to payment plan"><Split size={12} /></button>
                )}
                {!isRecon && !t.isGenerated && (
                  <button onClick={() => handleDelete(t.id)} className={`icon-btn ${deleteConfirm === t.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={12} /></button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      </>)}

      {/* Edit Choice Dialog for Generated Transactions */}
      {editChoiceId && (
        <div className="modal-overlay z-60 bg-black/60 backdrop-blur-sm" onClick={() => { setEditChoiceId(null); setEditChoiceRule(null); }}>
          <div className="bg-card border border-border p-4 sm:p-6 w-full sm:max-w-sm space-y-4 rounded-(--radius)" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-display font-bold">Edit Recurring Transaction</h3>
            <p className="text-xs text-muted-foreground">This transaction was auto-generated from a recurring rule. How would you like to edit it?</p>
            <div className="space-y-2">
              <button
                onClick={() => {
                  const t = allTransactions.find(tx => tx.id === editChoiceId);
                  if (t) handleEditOccurrence(t);
                }}
                className="w-full text-left p-3 border border-border hover:border-primary hover:bg-primary/5 transition-colors" style={{ borderRadius: 'var(--radius)' }}>
                <p className="text-xs font-semibold">Edit This Occurrence Only</p>
                <p className="text-xs text-muted-foreground">Creates a one-time override. Future months are unaffected.</p>
              </button>
              {editChoiceRule && (
                <button
                  onClick={handleEditRule}
                  className="w-full text-left p-3 border border-border hover:border-primary hover:bg-primary/5 transition-colors" style={{ borderRadius: 'var(--radius)' }}>
                  <p className="text-xs font-semibold">Edit Recurring Rule</p>
                  <p className="text-xs text-muted-foreground">Updates the source rule in Budget Control. All future occurrences change.</p>
                </button>
              )}
            </div>
            <button onClick={() => { setEditChoiceId(null); setEditChoiceRule(null); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}

      {showForm && (
        <FormModal
          title={editId?.startsWith('rule:') ? 'Edit Recurring Rule' : editId ? 'Edit Transaction' : 'Add Transaction'}
          fields={formFields}
          values={form}
          onChange={(k, v) => setForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSave}
          draftRestored={draftRestored}
          onDiscardDraft={handleDiscardDraft}
          onClose={() => { setShowForm(false); setEditId(null); }}
          saving={add.isPending || update.isPending || updateRule.isPending || addRule.isPending}
          saveLabel={editId?.startsWith('rule:') ? 'Update Rule' : editId ? 'Update' : repeatChoice !== 'none' ? 'Schedule Repeat' : 'Add Transaction'}
        />
      )}

      {/* Payment Plan Form Modal */}
      {showPlanForm && (
        <div className="modal-overlay z-60 bg-black/60 backdrop-blur-sm" onClick={dismissPlanForm}>
          <div className="bg-card border border-border w-full sm:max-w-md rounded-(--radius) overflow-y-auto max-h-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-sm font-display font-bold">{editPlanId ? 'Edit Payment Plan' : convertSourceTxnId ? 'Convert to Payment Plan' : 'Add Payment Plan'}</h3>
              <button onClick={closePlanForm} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
            </div>
            <div className="p-4 space-y-3">
              {convertSourceTxnId && (
                <p className="text-[10px] text-muted-foreground leading-relaxed p-2.5 bg-muted/30" style={{ borderRadius: 'var(--radius)' }}>
                  Saving replaces the original transaction with this plan's installments, so the purchase is only counted once.
                </p>
              )}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Plan Name *</label>
                <input
                  type="text"
                  value={planForm.name}
                  onChange={e => setPlanForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. AirPods Pro, MacBook Pro"
                  className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                  style={{ borderRadius: 'var(--radius)' }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Provider / Program</label>
                <input
                  type="text"
                  value={planForm.provider}
                  onChange={e => setPlanForm(p => ({ ...p, provider: e.target.value }))}
                  placeholder="e.g. PayPal Pay in 4, Prime Visa 12 months"
                  className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                  style={{ borderRadius: 'var(--radius)' }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Total Amount *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={planForm.total_amount}
                    onChange={e => setPlanForm(p => ({ ...p, total_amount: e.target.value }))}
                    placeholder="0.00"
                    className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                    style={{ borderRadius: 'var(--radius)' }}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Per Payment</label>
                  <div
                    className="w-full bg-muted/40 border border-border px-3 py-2 text-xs text-muted-foreground"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    {planForm.total_amount && planForm.total_payments && parseInt(planForm.total_payments, 10) > 0
                      ? formatCurrency(parseFloat(planForm.total_amount) / parseInt(planForm.total_payments, 10), false)
                      : '—'}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Frequency *</label>
                  <select
                    value={planForm.frequency}
                    onChange={e => setPlanForm(p => ({ ...p, frequency: e.target.value as PaymentPlanFrequency }))}
                    className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every 2 Weeks</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Total Payments *</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={planForm.total_payments}
                    onChange={e => setPlanForm(p => ({ ...p, total_payments: e.target.value }))}
                    placeholder="e.g. 4 or 12"
                    className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                    style={{ borderRadius: 'var(--radius)' }}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">First Payment Date *</label>
                <DateScrollPicker value={planForm.start_date} onChange={v => setPlanForm(p => ({ ...p, start_date: v }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Category</label>
                <select
                  value={planForm.category}
                  onChange={e => setPlanForm(p => ({ ...p, category: e.target.value }))}
                  className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Payment Source</label>
                <select
                  value={planForm.payment_source}
                  onChange={e => setPlanForm(p => ({ ...p, payment_source: e.target.value }))}
                  className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  <option value="">Unassigned</option>
                  {paymentSourceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Payment Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['upfront', 'monthly_charge'] as const).map(pt => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => setPlanForm(p => ({ ...p, plan_type: pt }))}
                      className={`py-2 px-3 text-xs font-medium border transition-colors ${planForm.plan_type === pt ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary text-muted-foreground border-border hover:text-foreground'}`}
                      style={{ borderRadius: 'var(--radius)' }}
                    >
                      {pt === 'upfront' ? 'Upfront' : 'Over Time'}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {planForm.plan_type === 'upfront'
                    ? 'Full amount charged to card upfront, paid off in installments (e.g. Chase Plan It)'
                    : 'Fixed amount charges to card each month until paid (e.g. Amazon BNPL)'}
                </p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Notes</label>
                <input
                  type="text"
                  value={planForm.notes}
                  onChange={e => setPlanForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Optional note"
                  className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                  style={{ borderRadius: 'var(--radius)' }}
                />
              </div>
              {planForm.total_amount && planForm.total_payments && parseInt(planForm.total_payments, 10) > 0 && (
                <div className="p-3 bg-muted/30 text-xs text-muted-foreground" style={{ borderRadius: 'var(--radius)' }}>
                  {formatCurrency(parseFloat(planForm.total_amount) / parseInt(planForm.total_payments, 10), false)}
                  {' / '}
                  {planForm.frequency === 'weekly' ? 'week' : planForm.frequency === 'biweekly' ? '2 weeks' : 'month'}
                  {' · '}
                  {planForm.total_payments} payments from {planForm.start_date}
                </div>
              )}
              <button
                onClick={handleSavePlan}
                disabled={addPlan.isPending || updatePlan.isPending || (Boolean(convertSourceTxnId) && remove.isPending)}
                className="w-full bg-primary text-primary-foreground py-2 text-xs font-semibold disabled:opacity-50"
                style={{ borderRadius: 'var(--radius)' }}
              >
                {addPlan.isPending || updatePlan.isPending || (convertSourceTxnId && remove.isPending) ? 'Saving...' : editPlanId ? 'Update Plan' : convertSourceTxnId ? 'Replace With Plan' : 'Add Plan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
