import PanelBar from '@/components/shared/PanelBar';
import SurfaceGuide from '@/components/shared/SurfaceGuide';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { DebtSkeleton } from '@/components/shared/PageSkeleton';
import { useFormDraft, type FormDraft } from '@/hooks/useFormDraft';
import { formatCurrency, calculatePayoffMonths, calculateTotalInterest, simulateDebtPayoff } from '@/lib/calculations';
import { useDebts, useAccounts, useTransactions, useRecurringRules, useProfile, useAccountReconciliations, useSavingsGoals, useCarFunds, usePaymentPlans } from '@/hooks/useSupabaseData';
import FormModal from '@/components/shared/FormModal';
import CreditCardEngine from '@/components/debt/CreditCardEngine';
import { useDemo } from '@/contexts/DemoContext';
import { Plus, Edit2, Trash2, CreditCard, Landmark, Car } from 'lucide-react';
import { buildAmortizationSchedule, getActiveCarLoanPayments } from '@/lib/vehicle-loan-engine';
import { buildAutoExtraByTarget } from '@/lib/auto-extra-projection';
import { extraAwarePayoffMonthIndex } from '@/lib/extra-aware-payoff';
import { projectLiabilityBalances } from '@/lib/non-cc-liabilities';
import { PROJECTION_MONTHS } from '@/lib/scheduling';
import LiabilityTrajectoryChart from '@/components/debt/LiabilityTrajectoryChart';
import type { LiabilityTrajectoryInput } from '@/lib/liability-trajectory';
import { useCardProjectionContext } from '@/contexts/CardProjectionContext';
import { usePersistedState } from '@/hooks/usePersistedState';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import { isCardOpenAsOf } from '@/lib/card-start-date';
import { debtTabFromSearch, type DebtTab } from '@/lib/debt-tab';
import VehicleMoneyPanels from '@/components/vehicles/VehicleMoneyPanels';

const emptyForm = { name: '', balance: '', apr: '', min_payment: '', target_payment: '', credit_limit: '' };

// Mirrors the engine's nonCCLiabAccts filter (its liabilityTypes minus credit_card), so the
// "with extra payments" pairing below can only land on an account the engine actually projected.
const NON_CC_LIABILITY_TYPES = ['mortgage', 'student_loan', 'auto_loan', 'other_liability'];

export default function DebtPayoff() {
  const { data: debts, update, remove, loading: debtsLoading } = useDebts();
  const { add: addReconciliation } = useAccountReconciliations();
  const { data: accounts, loading: accountsLoading } = useAccounts();
  const { data: transactions } = useTransactions();
  const { data: rules } = useRecurringRules();
  const { data: profile, loading: profileLoading } = useProfile();
  const { data: goals } = useSavingsGoals();
  const { data: carFunds, loading: carFundsLoading } = useCarFunds();
  const { data: paymentPlans, loading: paymentPlansLoading } = usePaymentPlans();
  const { isDemo } = useDemo();

  const {
    cardProjection,
    projections,
    assumptions,
    pauseSavings,
    setPauseSavings,
  } = useCardProjectionContext();
  // The Debt Payoff accordion + trajectory display per-card balances via the shared step3-display
  // adjustment (sim balance minus cumulative PASS-3 surplus routed to the card) so they match the
  // Forecast month popup and CSV export. Unlike the earlier reverted
  // "forecastAdjustedRevolvingBalances" overlay — which subtracted the surplus WITHOUT a matching
  // payment line, so balances dropped faster than the shown payment — the accordion now also shows
  // the surplus-redirect line each month, so rows reconcile:
  // End = Start + purchases + interest − payment − surplus. Raw sim balances remain the model
  // (projectCardVariable inputs and payoff detection untouched); ETA tracks the sim's real
  // revolving-$0 month (see CreditCardEngine).

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [activeTab, setActiveTab] = usePersistedState<DebtTab>('tre:debtpayoff:activeTab', 'cards');
  const [searchParams, setSearchParams] = useSearchParams();

  // A deep link (`/debt?tab=auto`, which is what the Garage's car list points at now that the
  // vehicle money lives here) names the panel it means; the persisted tab cannot. Honoured once,
  // then stripped, so a later reload is a plain visit and the user's own tab wins again — the same
  // rule the Garage follows for `?tab=builds`.
  const askedTab = debtTabFromSearch(searchParams);
  useEffect(() => {
    if (!askedTab) return;
    setActiveTab(askedTab);
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    setSearchParams(next, { replace: true });
  }, [askedTab, searchParams, setSearchParams, setActiveTab]);

  const ccAccountNames = useMemo(() => new Set(
    accounts?.filter(a => a.account_type === 'credit_card').map(a => a.name.toLowerCase()) ?? []
  ), [accounts]);

  const mortgageAccountNames = useMemo(() => new Set(
    accounts?.filter(a => a.account_type === 'mortgage').map(a => a.name.toLowerCase()) ?? []
  ), [accounts]);

  const studentAccountNames = useMemo(() => new Set(
    accounts?.filter(a => a.account_type === 'student_loan').map(a => a.name.toLowerCase()) ?? []
  ), [accounts]);

  const mortgageDebts = useMemo(() => debts?.filter(d => mortgageAccountNames.has(d.name.toLowerCase())) ?? [], [debts, mortgageAccountNames]);
  const studentDebts = useMemo(() => debts?.filter(d => studentAccountNames.has(d.name.toLowerCase())) ?? [], [debts, studentAccountNames]);
  const otherDebts = useMemo(() => debts?.filter(d =>
    !ccAccountNames.has(d.name.toLowerCase()) &&
    !mortgageAccountNames.has(d.name.toLowerCase()) &&
    !studentAccountNames.has(d.name.toLowerCase())
  ) ?? [], [debts, ccAccountNames, mortgageAccountNames, studentAccountNames]);

  // The `debts` row and the ACCOUNT are two descriptions of one liability, paired by name. This is
  // the pairing, in one place, because two readers below need it for different reasons.
  const pairedLiabilityAccount = (name: string) => accounts?.find(a =>
    a.active && NON_CC_LIABILITY_TYPES.includes(a.account_type)
    && a.name.trim().toLowerCase() === name.trim().toLowerCase());

  /**
   * What this liability actually owes.
   *
   * ⚠️ THE ACCOUNT WINS WHENEVER THERE IS ONE, and the `debts` row is only the fallback. That is
   * Tre's own rule (2026-08-18, "if an account is connected the manual amount should be
   * disregarded") and, more importantly, it is what the ENGINE already does:
   * `listDebtServiceLiabilities` reads `Number(a.balance)` off the account. Until this landed these
   * tabs read the hand-typed `debts.balance` instead, so a connected student loan or mortgage
   * showed a figure that stopped moving the day it was typed while the Forecast used the live one -
   * and "Payoff In" and "Total Interest" here were computed from the stale number, which is how a
   * wrong payoff date reaches a customer who did everything right.
   */
  const liabilityBalance = (d: { name: string; balance: unknown }): number => {
    const paired = pairedLiabilityAccount(d.name);
    return paired ? Math.max(0, Number(paired.balance) || 0) : Number(d.balance);
  };

  const totalBalance = otherDebts.reduce((s, d) => s + liabilityBalance(d), 0);
  const totalMinPayment = otherDebts.reduce((s, d) => s + Number(d.min_payment), 0);
  const totalTargetPayment = otherDebts.reduce((s, d) => s + Number(d.target_payment), 0);

  const snowballOrder = [...otherDebts].sort((a, b) => Number(a.balance) - Number(b.balance));
  const avalancheOrder = [...otherDebts].sort((a, b) => Number(b.apr) - Number(a.apr));

  const debtInputs = useMemo(() => otherDebts.map(d => ({
    id: d.id,
    name: d.name,
    balance: Number(d.balance),
    apr: Number(d.apr),
    min_payment: Number(d.min_payment),
  })), [otherDebts]);

  const snowballSim = useMemo(
    () => simulateDebtPayoff(debtInputs, 'snowball', totalTargetPayment),
    [debtInputs, totalTargetPayment],
  );
  const avalancheSim = useMemo(
    () => simulateDebtPayoff(debtInputs, 'avalanche', totalTargetPayment),
    [debtInputs, totalTargetPayment],
  );


  const debtFreeDate = (months: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  // Targets the ranked waterfall ACTUALLY paid, keyed by target id (account id for a non-CC
  // liability, car_funds.id for a vehicle loan). No entry means no extra dollars ever reached the
  // debt, and the readouts below stay hidden - being ranked is not enough, because the engine
  // amortizes the ACCOUNT balance while the on-screen schedule amortizes the debts row's, and a
  // ranked debt receiving $0 must not turn that divergence into a phantom "with extras" line.
  const autoExtraTargets = useMemo(() => buildAutoExtraByTarget(projections.data), [projections.data]);

  // "With extra payments" payoff for a non-CC debt row: the first month the forecast engine's
  // extra-aware balance array opens at zero - the SAME shared-reference array the Forecast month
  // drawer itemises, so this readout cannot disagree with it. Shown only when the paired account
  // is RANKED (accounts.surplus_sort_order, under "Where the extra money goes" on Goals), the
  // waterfall actually paid it, and the payoff beats the scheduled readout. The engine's
  // reducers use Math.max(0, before - amount) - exact zero, no dust tolerance to invent here.
  const withExtrasPayoffMonths = (d: { name: string; balance: unknown; apr: unknown; target_payment: unknown }): number | null => {
    const paired = pairedLiabilityAccount(d.name);
    if (paired?.surplus_sort_order == null) return null;
    if (!autoExtraTargets.has(paired.id)) return null;
    const balances = projections.nonCCLiabilityBalancesById.get(paired.id);
    // ⚠️ A COUNT, NOT AN INDEX, and that is the whole reason for the `+ 1`. The helper answers
    // "which month index is it cleared in" (0 = this month); a row cleared in index m took m + 1
    // months. Tre, 2026-08-27: "the same should apply for all loans" — this row carried the same
    // off-by-one the two DATE readouts did, in the same direction, and for the same reason: the
    // balance array means one thing before an extra touches an entry and another after.
    const idx = extraAwarePayoffMonthIndex(balances, autoExtraTargets.get(paired.id));
    if (idx == null) return null;
    const months = idx + 1;
    // The SAME balance the row displays, or the comparison that decides whether to show the
    // "with extra payments" line would be against a number the user cannot see.
    const scheduled = calculatePayoffMonths(liabilityBalance(d), Number(d.apr), Number(d.target_payment));
    return months < scheduled ? months : null;
  };

  /**
   * The lines the Mortgage / Student Loans / Other Debts trajectory chart draws.
   *
   * The id is the SAME key `buildNonCCLiabilities` gives the row - the paired account's id, or
   * `debt:<id>` for a debts row with no account - so the chart reads the engine's own array rather
   * than re-deriving one. When the engine has no row for a debt (nothing paired it, nothing
   * projected it) the fallback amortizes the figures the card itself is showing, which is exactly
   * where its "Payoff In" months come from: a line that cannot disagree with the number beside it.
   */
  const liabilityTrajectoryInputs = (list: typeof otherDebts): LiabilityTrajectoryInput[] =>
    list.map(d => {
      const paired = pairedLiabilityAccount(d.name);
      const id = paired?.id ?? `debt:${d.id}`;
      const extras = (paired && autoExtraTargets.get(paired.id)) || null;
      const engineBalances = projections.nonCCLiabilityBalancesById.get(id);
      // `LIABILITY_MONTHS` - the engine's arrays carry one trailing closing balance past the last
      // forecast month, and the fallback must be the same length or the two would end on different
      // months depending on which one a debt happened to get.
      const scheduled = projectLiabilityBalances(
        liabilityBalance(d), Number(d.apr), Number(d.target_payment), PROJECTION_MONTHS + 1,
      );
      return {
        id,
        name: d.name,
        balances: engineBalances ?? scheduled,
        extrasByMonth: extras,
        // Only a debt the waterfall actually reaches gets a second line; for every other debt the
        // scheduled walk IS the drawn line, and drawing it twice says nothing.
        scheduled: extras?.some(v => v > 0) ? scheduled : null,
      };
    });

  const { restored: draftRestored, discard: discardDraft } = useFormDraft({
    formKey: 'debts',
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

  const openEdit = (d: (typeof otherDebts)[number]) => {
    setForm({ name: d.name, balance: String(d.balance), apr: String(d.apr), min_payment: String(d.min_payment), target_payment: String(d.target_payment), credit_limit: String(d.credit_limit || '') });
    setEditId(d.id); setShowForm(true);
  };

  const handleSave = () => {
    const balance = parseFloat(form.balance);
    if (!form.name || isNaN(balance)) return;
    const payload = {
      name: form.name, balance, apr: parseFloat(form.apr) || 0, min_payment: parseFloat(form.min_payment) || 0,
      target_payment: parseFloat(form.target_payment) || parseFloat(form.min_payment) || 0, credit_limit: parseFloat(form.credit_limit) || 0,
    };
    if (!editId) return;
    const existingDebt = debts?.find(d => d.id === editId);
    const projectedBalance = existingDebt ? Number(existingDebt.balance) : balance;
    const delta = balance - projectedBalance;
    update.mutate({ id: editId, ...payload });
    if (delta !== 0) {
      addReconciliation.mutate({
        account_id: editId,
        source_table: 'debts',
        effective_date: new Date().toISOString().split('T')[0],
        delta,
        actual_balance: balance,
        projected_balance: projectedBalance,
      });
    }
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    if (deleteConfirm === id) { remove.mutate(id); setDeleteConfirm(null); }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000); }
  };

  // `active` is not the flag for "has this card been opened yet" — `card_start_date` is, and
  // `isCardOpenAsOf` is its only predicate. A planned card is `active = true` with a future
  // start date, and counting it made the tab badge claim cards the panels below correctly
  // refuse to list.
  const openCreditCards = useMemo(
    () => (accounts ?? []).filter(a => a.account_type === 'credit_card' && a.active && isCardOpenAsOf(a, new Date())),
    [accounts],
  );
  const hasCreditCards = openCreditCards.length > 0;

  const activeAutoLoans = useMemo(() => getActiveCarLoanPayments(carFunds), [carFunds]);
  const loanVehicles = useMemo(() => carFunds.filter(c => c.phase === 'loan'), [carFunds]);

  /**
   * The same chart for the Auto Loans tab, from the engine's per-fund arrays.
   *
   * /vehicles already draws a chart PER LOAN; this is the one that answers "when does all of my
   * car debt go away", which is the question this page is for, and it keeps the five tabs from
   * being four-with-a-picture-and-one-without.
   *
   * ⚠️ THE SCHEDULED COMPANION IS JOINED ON THE CALENDAR MONTH, NOT ON POSITION. The amortization
   * schedule is indexed by payment number and dated from `payment_start_date` — in the past for a
   * loan already running — while the engine's array is indexed from THIS month. Lining them up by
   * index credits a payment made next year to a row from last year (the same trap /vehicles hit).
   */
  const autoTrajectoryInputs = (): LiabilityTrajectoryInput[] => {
    const now = new Date();
    const baseMonth = now.getFullYear() * 12 + now.getMonth();
    return loanVehicles.flatMap(cf => {
      if (!cf.payment_start_date || !cf.loan_start_date) return [];
      const proj = buildAmortizationSchedule({
        loanAmount: cf.loan_amount, apr: cf.expected_apr, termMonths: cf.loan_term_months,
        loanStartDate: cf.loan_start_date, paymentStartDate: cf.payment_start_date,
        interestStartDate: cf.interest_start_date ?? cf.payment_start_date,
        actualMonthlyPayment: cf.actual_monthly_payment,
        lumpSumPayments: cf.lump_sum_payments ?? [],
        currentBalance: cf.current_balance_override ?? null,
      });
      // NaN, not 0, for a month the schedule does not cover: the chart reads a non-finite entry as
      // "not projected" and leaves a gap, where a 0 would draw a paid-off loan that isn't.
      const scheduled = new Array<number>(PROJECTION_MONTHS + 1).fill(Number.NaN);
      for (const r of proj.schedule) {
        const d = new Date(r.date + 'T00:00:00');
        const i = (d.getFullYear() * 12 + d.getMonth()) - baseMonth;
        if (i >= 0 && i < scheduled.length) scheduled[i] = r.startBalance;
        // The month AFTER the last payment opens at nothing, and saying so is what lets the line
        // land on zero instead of stopping in mid-air.
        if (i + 1 >= 0 && i + 1 < scheduled.length) scheduled[i + 1] = r.endBalance;
      }
      const extras = autoExtraTargets.get(cf.id) ?? null;
      return [{
        id: cf.id,
        name: cf.vehicle_name,
        balances: projections.carLoanBalancesByFundId.get(cf.id) ?? scheduled,
        extrasByMonth: extras,
        scheduled: extras?.some(v => v > 0) ? scheduled : null,
      }];
    });
  };

  // The Auto / Mortgage / Student / Other tabs are fed by `debts` and `carFunds`,
  // not by `accounts`. Gating on accounts alone flashed "No mortgage tracked yet"
  // and "No other debts tracked yet" at users who have both.
  if (accountsLoading || debtsLoading || carFundsLoading || paymentPlansLoading || profileLoading) {
    return <DebtSkeleton />;
  }

  // Since 2026-08-24 (`buildOtherDebtPaymentSchedule`) this copy is true of all three non-CC debt tabs, not
  // just Mortgage where it used to live — the engine takes cash for mortgage, student loan AND other
  // liability payments alike before any credit card payoff. One shared element, rendered on Mortgage,
  // Student Loans and Other Debts below, so the three copies can't drift apart the way one-per-tab
  // duplicates would.
  const nonCcDebtExplainer = (
    <div className="p-3 bg-primary/5 border border-primary/20 text-xs text-muted-foreground" style={{ borderRadius: 'var(--radius)' }}>
      Mortgage, student loan and other debt payments are taken out of your cash before any credit card payoff, so they always take priority. Add each one as a debt entry matching the name of its account in Accounts. Payoff In shows the schedule at your target payment alone; when a debt is ranked under "Where the extra money goes" on Goals and receives extra money, a second "with extra payments" line shows how much sooner the forecast projects it clearing.
    </div>
  );

  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto stack-section overflow-x-hidden">
      {/* ⚠️ NOT `flex-wrap`, and the two controls are ONE group (Tre, 2026-08-27: "keep the add
          account button to the right on the debt payoff tab"). Wrapping put Add Account and the
          guide on their own line under the title, where `justify-between` then pushed them to
          OPPOSITE ends — so the button read as left-aligned at exactly the widths a phone uses.
          The title takes the slack (`flex-1`) and its subtitle already truncates, so the actions
          keep their intrinsic width and stay pinned right at every width. */}
      <div className="flex items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <div className="min-w-0">
            {/* Section label, not a hero: the hero number on the cards tab outranks the page
                title (DIRECTION.md rule 2). Still an h1 — demoting the type must not demote the
                document outline or the screen-reader landmark. */}
            <h1 className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Debt Payoff Planner</h1>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">Eliminate debt with realistic, due-date-aware projections</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to={`/accounts?new=1&type=${
              activeTab === 'cards' ? 'credit_card'
              : activeTab === 'auto' ? 'auto_loan'
              : activeTab === 'mortgage' ? 'mortgage'
              : activeTab === 'student' ? 'student_loan'
              : 'other_liability'
            }`}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium btn-press shrink-0 whitespace-nowrap"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <Plus size={12} /> Add Account
          </Link>
          <SurfaceGuide surface="debt" />
        </div>
      </div>

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-3">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-foreground">Avalanche engine — eliminate $12,700 using every spare dollar</p>
              <p className="text-xs text-muted-foreground mt-0.5">Jordan has two credit cards. The engine targets the highest APR first, pays minimums on the rest, and never drops below the $1,000 cash floor.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: 'Avalanche order', desc: 'Chase Sapphire (22.99% APR) gets all extra payments first. Discover It (18.99%) only gets extra after Sapphire is paid off.' },
              { label: 'Cash floor protection', desc: 'Each month the engine checks available cash after expenses and bills — extra payments only happen above the $1,000 floor.' },
              { label: 'Monthly projection table', desc: 'Shows exact payment, interest, and remaining balance each month. Click any payment to override the recommended amount.' },
              { label: 'Connects to Forecast', desc: 'These exact payment amounts feed the 60-month Forecast — debt payoff progress and end cash are synchronized.' },
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

      {/* The tab row and the panels it switches are ONE group (`stack-row`): a control row
          belongs to the content below it. See the vertical-rhythm block in `src/index.css`. */}
      <div className="stack-row">
      {/* Tabs */}
      <PanelBar>
        <button onClick={() => setActiveTab('cards')}
          className={`seg-item btn-press ${activeTab === 'cards' ? 'seg-item-active' : ''}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <CreditCard size={13} /> Credit Card Payoff {hasCreditCards && <span className={`seg-badge ${activeTab === 'cards' ? 'seg-badge-active' : ''}`}>{openCreditCards.length}</span>}
        </button>
        <button onClick={() => setActiveTab('auto')}
          className={`seg-item btn-press ${activeTab === 'auto' ? 'seg-item-active' : ''}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <Car size={13} /> Auto Loans {activeAutoLoans.length > 0 && <span className={`seg-badge ${activeTab === 'auto' ? 'seg-badge-active' : ''}`}>{activeAutoLoans.length}</span>}
        </button>
        <button onClick={() => setActiveTab('mortgage')}
          className={`seg-item btn-press ${activeTab === 'mortgage' ? 'seg-item-active' : ''}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <Landmark size={13} /> Mortgage {mortgageDebts.length > 0 && <span className={`seg-badge ${activeTab === 'mortgage' ? 'seg-badge-active' : ''}`}>{mortgageDebts.length}</span>}
        </button>
        <button onClick={() => setActiveTab('student')}
          className={`seg-item btn-press ${activeTab === 'student' ? 'seg-item-active' : ''}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <Landmark size={13} /> Student Loans {studentDebts.length > 0 && <span className={`seg-badge ${activeTab === 'student' ? 'seg-badge-active' : ''}`}>{studentDebts.length}</span>}
        </button>
        <button onClick={() => setActiveTab('other')}
          className={`seg-item btn-press ${activeTab === 'other' ? 'seg-item-active' : ''}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <Landmark size={13} /> Other Debts {otherDebts.length > 0 && <span className={`seg-badge ${activeTab === 'other' ? 'seg-badge-active' : ''}`}>{otherDebts.length}</span>}
        </button>
      </PanelBar>

      {activeTab === 'cards' && (
        <div className="flex items-center justify-between p-3 bg-secondary border border-border" style={{ borderRadius: 'var(--radius)' }}>
          <div className="min-w-0">
            <p className="text-xs font-medium">Pause optional savings transfers during payoff</p>
            <p className="text-xs text-muted-foreground">Excludes Savings &amp; Investing transfers from available cash calculation</p>
          </div>
          <button
            onClick={() => setPauseSavings((v: boolean) => !v)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ml-3 ${pauseSavings ? 'bg-primary' : 'bg-muted'}`}
            aria-label="Toggle pause savings"
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${pauseSavings ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
        </div>
      )}

      {activeTab === 'auto' && (
        <div className="space-y-4">
          {activeAutoLoans.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="card-forged p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase">Monthly Payments</p>
                <p className="text-lg font-display font-bold text-primary">{formatCurrency(activeAutoLoans.reduce((s, l) => s + l.payment, 0), false)}</p>
              </div>
              <div className="card-forged p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase">Total Remaining</p>
                <p className="text-lg font-display font-bold text-destructive">{formatCurrency(activeAutoLoans.reduce((s, l) => s + l.remainingBalance, 0), false)}</p>
              </div>
            </div>
          )}
          <LiabilityTrajectoryChart
            title="Auto Loan Payoff Trajectory"
            debts={autoTrajectoryInputs()}
            storageKey="tre:debtpayoff:auto:chart-years"
            icon={Car}
          />
          {/* ⚠️ THE VEHICLE MONEY LIVES HERE NOW (Tre, 2026-08-27: "move saving for down payment
              and active loans to the auto loans section inside the debt payoff tab. it makes more
              since there"). What stood here was a READ-ONLY copy of these same cars — a loan card
              and a "Planned Loans — Estimate" card, each ending in an "Edit on Vehicles page"
              link. The panel below is the real thing, writes included, so the round trip is gone
              and there is still only one derivation of a car's money. */}
          <VehicleMoneyPanels />
        </div>
      )}

      {activeTab === 'cards' && (
        <ErrorBoundary variant="widget" label="Credit Card Engine">
        <CreditCardEngine
          accounts={accounts} transactions={transactions} rules={rules} debts={debts} profile={profile}
          goals={goals ?? []} carFunds={carFunds ?? []}
          incomeGrowthEnabled={assumptions.incomeGrowthEnabled}
          incomeGrowth={assumptions.incomeGrowth}
          raiseMonth={assumptions.raiseMonth}
          raiseMode={assumptions.raiseMode}
          bonusEnabled={assumptions.bonusEnabled}
          bonusAmount={assumptions.bonusAmount}
          bonusMode={assumptions.bonusMode}
          bonusMonth={assumptions.bonusMonth}
          bonusRecurring={assumptions.bonusRecurring}
          taxReturnEnabled={assumptions.taxReturnEnabled}
          taxReturnAmountOverride={assumptions.taxReturnAmountOverride}
          taxReturnMonth={assumptions.taxReturnMonth}
          month0={cardProjection?.month0 ?? null}
          perCardPayments={cardProjection?.perCardPayments ?? null}
          perCardPaymentsScaled={cardProjection?.perCardPaymentsScaled ?? null}
          monthlyRevolvingBalances={cardProjection?.monthlyRevolvingBalances ?? null}
          monthlyCyclingOwed={cardProjection?.monthlyCyclingOwed ?? null}
          monthlyCyclingInterest={cardProjection?.monthlyCyclingInterest ?? null}
          monthlyBalances={cardProjection?.monthlyBalances ?? null}
          monthlyInterest={cardProjection?.monthlyInterest ?? null}
          paymentPlans={paymentPlans ?? []}
          forecastRevolvingPayoffMonth={cardProjection?.forecastRevolvingPayoffMonth ?? null}
          simRevolvingPayoffMonth={cardProjection?.simRevolvingPayoffMonth ?? null}
          pauseSavings={pauseSavings}
        />
        </ErrorBoundary>
      )}

      {activeTab === 'other' && (
        <>
          {nonCcDebtExplainer}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="card-forged p-4 text-center"><p className="text-xs text-muted-foreground uppercase">Total Owed</p><p className="text-lg font-display font-bold text-destructive">{formatCurrency(totalBalance, false)}</p></div>
            <div className="card-forged p-4 text-center"><p className="text-xs text-muted-foreground uppercase">Monthly Min</p><p className="text-lg font-display font-bold text-foreground">{formatCurrency(totalMinPayment, false)}</p></div>
            <div className="card-forged p-4 text-center"><p className="text-xs text-muted-foreground uppercase">Target Payment</p><p className="text-lg font-display font-bold text-primary">{formatCurrency(totalTargetPayment, false)}</p></div>
          </div>
          <LiabilityTrajectoryChart
            title="Other Debt Payoff Trajectory"
            debts={liabilityTrajectoryInputs(otherDebts)}
            storageKey="tre:debtpayoff:other:chart-years"
          />
          <div className="space-y-3">
            {otherDebts.map(d => {
              const bal = liabilityBalance(d), apr = Number(d.apr), tp = Number(d.target_payment);
              const months = calculatePayoffMonths(bal, apr, tp);
              const interest = calculateTotalInterest(bal, apr, tp);
              const extrasMonths = withExtrasPayoffMonths(d);
              return (
                <div key={d.id} className="card-forged p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-semibold">{d.name}</h3>
                      <p className="text-xs text-muted-foreground">{apr}% APR · Min {formatCurrency(Number(d.min_payment), false)}/mo</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-display font-bold text-destructive">{formatCurrency(bal, false)}</p>
                      <button onClick={() => openEdit(d)} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
                      <button onClick={() => handleDelete(d.id)} className={`icon-btn ${deleteConfirm === d.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div><p className="text-xs text-muted-foreground">Target Payment</p><p className="text-xs font-semibold text-primary">{formatCurrency(tp, false)}/mo</p></div>
                    <div>
                      {/* Same inversion as the vehicle card above, and for the same reason. */}
                      <p className="text-xs text-muted-foreground">Payoff In</p>
                      {extrasMonths != null ? (
                        <>
                          <p className="text-xs font-semibold text-primary">{extrasMonths} months</p>
                          <p className="text-[10px] text-muted-foreground">
                            {months === Infinity ? '—' : `${months} mo`} without extra payments
                          </p>
                        </>
                      ) : (
                        <p className="text-xs font-semibold">{bal <= 0 ? 'Paid' : months === Infinity ? '—' : `${months} months`}</p>
                      )}
                    </div>
                    <div><p className="text-xs text-muted-foreground">Total Interest</p><p className="text-xs font-semibold text-destructive">{interest === Infinity ? '—' : formatCurrency(interest, false)}</p></div>
                  </div>
                </div>
              );
            })}
            {otherDebts.length === 0 && <div className="card-forged p-12 text-center"><p className="text-sm text-muted-foreground">No other debts tracked yet.</p></div>}
          </div>
          {otherDebts.length > 1 && (
            <div className="grid md:grid-cols-2 gap-4">
              {([
                { label: 'Snowball', desc: 'Smallest balance first', sim: snowballSim, order: snowballOrder, orderLabel: (d: (typeof otherDebts)[number]) => formatCurrency(Number(d.balance), false) },
                { label: 'Avalanche', desc: 'Highest APR first — minimizes total interest', sim: avalancheSim, order: avalancheOrder, orderLabel: (d: (typeof otherDebts)[number]) => `${Number(d.apr)}% APR` },
              ] as const).map(({ label, desc, sim, order, orderLabel }) => (
                <div key={label} className="card-forged p-4 space-y-3">
                  <div>
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-muted/20 rounded p-2 text-center">
                      <p className="text-[9px] text-muted-foreground uppercase">Debt-Free</p>
                      <p className="text-xs font-display font-bold text-primary">{debtFreeDate(sim.totalMonths)}</p>
                      <p className="text-[9px] text-muted-foreground">month {sim.totalMonths}</p>
                    </div>
                    <div className="bg-muted/20 rounded p-2 text-center">
                      <p className="text-[9px] text-muted-foreground uppercase">Total Interest</p>
                      <p className="text-xs font-display font-bold text-destructive">{formatCurrency(sim.totalInterest, false)}</p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {order.map((d, i) => {
                      const result = sim.schedule.find(r => r.debtId === d.id);
                      return (
                        <div key={d.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                          <div>
                            <span className="text-xs"><span className="text-primary font-semibold mr-1.5">#{i + 1}</span>{d.name}</span>
                            <p className="text-[9px] text-muted-foreground ml-4">{orderLabel(d)}</p>
                          </div>
                          {result && (
                            <div className="text-right">
                              <p className="text-xs font-medium">Month {result.paidOffMonth}</p>
                              <p className="text-[9px] text-muted-foreground">{formatCurrency(result.totalInterest, false)} interest</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'mortgage' && (
        <div className="space-y-4">
          {nonCcDebtExplainer}
          {mortgageDebts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="card-forged p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase">Total Owed</p>
                <p className="text-lg font-display font-bold text-destructive">{formatCurrency(mortgageDebts.reduce((s, d) => s + liabilityBalance(d), 0), false)}</p>
              </div>
              <div className="card-forged p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase">Monthly Payment</p>
                <p className="text-lg font-display font-bold text-primary">{formatCurrency(mortgageDebts.reduce((s, d) => s + Number(d.target_payment), 0), false)}</p>
              </div>
            </div>
          )}
          <LiabilityTrajectoryChart
            title="Mortgage Payoff Trajectory"
            debts={liabilityTrajectoryInputs(mortgageDebts)}
            storageKey="tre:debtpayoff:mortgage:chart-years"
          />
          <div className="space-y-3">
            {mortgageDebts.map(d => {
              const bal = liabilityBalance(d), apr = Number(d.apr), tp = Number(d.target_payment);
              const months = calculatePayoffMonths(bal, apr, tp);
              const interest = calculateTotalInterest(bal, apr, tp);
              const extrasMonths = withExtrasPayoffMonths(d);
              return (
                <div key={d.id} className="card-forged p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-semibold">{d.name}</h3>
                      <p className="text-xs text-muted-foreground">{apr}% APR · Min {formatCurrency(Number(d.min_payment), false)}/mo</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-display font-bold text-destructive">{formatCurrency(bal, false)}</p>
                      <button onClick={() => openEdit(d)} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
                      <button onClick={() => handleDelete(d.id)} className={`icon-btn ${deleteConfirm === d.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div><p className="text-xs text-muted-foreground">Monthly Payment</p><p className="text-xs font-semibold text-primary">{formatCurrency(tp, false)}/mo</p></div>
                    <div>
                      {/* Same inversion as the vehicle card above, and for the same reason. */}
                      <p className="text-xs text-muted-foreground">Payoff In</p>
                      {extrasMonths != null ? (
                        <>
                          <p className="text-xs font-semibold text-primary">{extrasMonths} months</p>
                          <p className="text-[10px] text-muted-foreground">
                            {months === Infinity ? '—' : `${months} mo`} without extra payments
                          </p>
                        </>
                      ) : (
                        <p className="text-xs font-semibold">{bal <= 0 ? 'Paid' : months === Infinity ? '—' : `${months} months`}</p>
                      )}
                    </div>
                    <div><p className="text-xs text-muted-foreground">Total Interest</p><p className="text-xs font-semibold text-destructive">{interest === Infinity ? '—' : formatCurrency(interest, false)}</p></div>
                  </div>
                </div>
              );
            })}
            {mortgageDebts.length === 0 && (
              <div className="card-forged p-12 text-center">
                <Landmark size={28} className="text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No mortgage tracked yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Add a mortgage account in Accounts, then add a matching debt entry here.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'student' && (
        <div className="space-y-4">
          {nonCcDebtExplainer}
          {studentDebts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="card-forged p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase">Total Owed</p>
                <p className="text-lg font-display font-bold text-destructive">{formatCurrency(studentDebts.reduce((s, d) => s + liabilityBalance(d), 0), false)}</p>
              </div>
              <div className="card-forged p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase">Monthly Payment</p>
                <p className="text-lg font-display font-bold text-primary">{formatCurrency(studentDebts.reduce((s, d) => s + Number(d.target_payment), 0), false)}</p>
              </div>
            </div>
          )}
          <LiabilityTrajectoryChart
            title="Student Loan Payoff Trajectory"
            debts={liabilityTrajectoryInputs(studentDebts)}
            storageKey="tre:debtpayoff:student:chart-years"
          />
          <div className="space-y-3">
            {studentDebts.map(d => {
              const bal = liabilityBalance(d), apr = Number(d.apr), tp = Number(d.target_payment);
              const months = calculatePayoffMonths(bal, apr, tp);
              const interest = calculateTotalInterest(bal, apr, tp);
              const extrasMonths = withExtrasPayoffMonths(d);
              return (
                <div key={d.id} className="card-forged p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-semibold">{d.name}</h3>
                      <p className="text-xs text-muted-foreground">{apr}% APR · Min {formatCurrency(Number(d.min_payment), false)}/mo</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-display font-bold text-destructive">{formatCurrency(bal, false)}</p>
                      <button onClick={() => openEdit(d)} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
                      <button onClick={() => handleDelete(d.id)} className={`icon-btn ${deleteConfirm === d.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div><p className="text-xs text-muted-foreground">Target Payment</p><p className="text-xs font-semibold text-primary">{formatCurrency(tp, false)}/mo</p></div>
                    <div>
                      {/* Same inversion as the vehicle card above, and for the same reason. */}
                      <p className="text-xs text-muted-foreground">Payoff In</p>
                      {extrasMonths != null ? (
                        <>
                          <p className="text-xs font-semibold text-primary">{extrasMonths} months</p>
                          <p className="text-[10px] text-muted-foreground">
                            {months === Infinity ? '—' : `${months} mo`} without extra payments
                          </p>
                        </>
                      ) : (
                        <p className="text-xs font-semibold">{bal <= 0 ? 'Paid' : months === Infinity ? '—' : `${months} months`}</p>
                      )}
                    </div>
                    <div><p className="text-xs text-muted-foreground">Total Interest</p><p className="text-xs font-semibold text-destructive">{interest === Infinity ? '—' : formatCurrency(interest, false)}</p></div>
                  </div>
                </div>
              );
            })}
            {studentDebts.length === 0 && (
              <div className="card-forged p-12 text-center">
                <Landmark size={28} className="text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No student loans tracked yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Add a student loan account in Accounts, then add a matching debt entry here.</p>
              </div>
            )}
          </div>
        </div>
      )}

      </div>

      {showForm && (
        <FormModal
          title={editId ? 'Edit Debt' : 'Add Debt'}
          fields={[
            { key: 'name', label: 'Debt Name', type: 'text', placeholder: 'e.g., Student Loan' },
            { key: 'balance', label: 'Balance', type: 'number', placeholder: '0.00', step: '0.01' },
            { key: 'apr', label: 'APR %', type: 'number', placeholder: '5.5', step: '0.01' },
            { key: 'min_payment', label: 'Minimum Payment', type: 'number', placeholder: '0.00', step: '0.01' },
            { key: 'target_payment', label: 'Target Payment', type: 'number', placeholder: '0.00', step: '0.01' },
            { key: 'credit_limit', label: 'Credit Limit (if card)', type: 'number', placeholder: '0', step: '0.01' },
          ]}
          values={form}
          onChange={(k, v) => setForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSave}
          draftRestored={draftRestored}
          onDiscardDraft={handleDiscardDraft}
          onClose={() => setShowForm(false)}
          saving={update.isPending}
          saveLabel={editId ? 'Update Debt' : 'Add Debt'}
        />
      )}
    </div>
  );
}
