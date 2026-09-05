import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { Json, Tables } from '@/integrations/supabase/types';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Link } from 'react-router';
import { BudgetSkeleton } from '@/components/shared/PageSkeleton';
import { useFormDraft, type FormDraft } from '@/hooks/useFormDraft';
import { formatCurrency } from '@/lib/calculations';
import FormModal, { type Field } from '@/components/shared/FormModal';
import { filterProfanity, LIMITS } from '@/lib/content-filter';
import { toast } from 'sonner';
import { useProfile, useAccounts, useRecurringRules, useSubscriptions, useDebts, useSavingsGoals, useCarFunds, type AccountRow, type RuleRow as RuleRowData } from '@/hooks/useSupabaseData';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { useSubscription } from '@/hooks/useSubscription';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Plus, Edit2, Trash2, Copy,
  CalendarDays, Pause, Play, ArrowLeftRight, CreditCard, X, ChevronDown, ChevronUp,
} from 'lucide-react';
import { getDayName, countRuleOccurrencesInMonth, describeBiweeklyAnchor } from '@/lib/scheduling';
import { CATEGORIES } from '@/lib/types';
import { generateRecommendations } from '@/lib/credit-card-engine';
import { useBudgetMonthTotals } from '@/hooks/useBudgetMonthTotals';
import { isFixedRule } from '@/lib/budget-month-totals';
import { useCardProjectionContext } from '@/contexts/CardProjectionContext';
import { buildMonth0Snapshot } from '@/lib/month0-budget-snapshot';
import { getBudgetAllocationShares, clipSegment } from '@/lib/budget-allocation';
import { buildPayConfig, getPaycheckNet, getRemainingIncomeThisMonth, getRemainingPaychecksThisMonth, getNextPaycheckDate, getPaychecksInMonth, getPrePaycheckNextMonthBills, getRemainingTransactionIncomeThisMonth, getRemainingTransactionExpensesThisMonth, getRemainingTransactionDebtPaymentsThisMonth, mergeWithGeneratedTransactions, createDebtPaymentTransactions, mergeDebtPaymentsIntoStream, type PayFrequency } from '@/lib/pay-schedule';
import { useTransactions } from '@/hooks/useSupabaseData';
import { useAutoEndReconcile } from '@/hooks/useAutoEndReconcile';
import RuleDriftPanel from '@/components/budget/RuleDriftPanel';
import RulesFoundCard from '@/components/rules/RulesFoundCard';
import { resolveCashFloor } from '@/lib/cash-floor';
import { ruleCustomInterval } from '@/lib/scheduling';

const emptyRuleForm = {
  name: '', amount: '', rule_type: 'expense', frequency: 'monthly',
  due_day: '1', due_month: '', category: 'Other', payment_source: '', deposit_account: '', notes: '', start_date: '', end_date: '',
  tax_rate: '',
  // Blank = repeat on `frequency` exactly as before. Set together, they are the user-chosen
  // interval (Tre, 2026-09-05: every other month, every three weeks, every five weeks).
  interval_count: '', interval_unit: '',
};

const INTERVAL_UNIT_OPTIONS = [
  { value: '', label: 'Use the frequency above' },
  { value: 'day', label: 'Days' },
  { value: 'week', label: 'Weeks' },
  { value: 'month', label: 'Months' },
  { value: 'year', label: 'Years' },
];

/** The typed "repeat every" box as a number the database will accept, or null for blank/invalid.
 * Bounds mirror the CHECK constraint exactly (1-60): an out-of-range value here is a value that
 * would drive the occurrence walk, and one the write would reject anyway. */
export function parseCustomIntervalCount(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= 60 ? n : null;
}

/** The caption under the "Repeat every" box, saying in words what the rule will actually do —
 * or naming what is still missing, because a half-filled pair is the one state that saves nothing
 * and the user cannot see why from two boxes alone. */
export function customIntervalFormHint(rawCount: string, rawUnit: string): string {
  const count = parseCustomIntervalCount(rawCount);
  const unit = rawUnit.trim();
  if (rawCount.trim() === '' && unit === '') return 'Leave blank to repeat on the frequency above';
  if (count === null && rawCount.trim() !== '') return 'Enter a whole number from 1 to 60';
  if (count !== null && unit === '') return 'Pick a unit as well — days, weeks, months or years';
  if (count === null && unit !== '') return 'Enter how many, as well as the unit';
  return customIntervalLabel({ interval_count: count, interval_unit: unit }) ?? '';
}

/** "Every 3 weeks" / "Every other month", or null when the rule just uses its frequency.
 * Written out in words on the rule row, because a cadence nobody can see on the list is a
 * cadence the user has to open the form to check. */
export function customIntervalLabel(
  rule: { interval_unit?: string | null; interval_count?: number | null },
): string | null {
  const interval = ruleCustomInterval(rule);
  if (!interval) return null;
  const unit = interval.count === 1 ? interval.unit : `${interval.unit}s`;
  if (interval.count === 2 && interval.unit === 'month') return 'Every other month';
  return interval.count === 1 ? `Every ${unit}` : `Every ${interval.count} ${unit}`;
}

// Common shape across real recurring_rules rows and the synthetic subscription/debt-sync
// "rule" entries (subsAsRules/debtPaymentRules) merged alongside them in fixedRules/debtRules.
type BudgetRule = {
  id: string; name: string; amount: number; rule_type: string; frequency: string; active: boolean;
  interval_unit?: string | null; interval_count?: number | null;
  category: string; due_day?: number | null; due_month?: number | null; start_date?: string | null;
  end_date?: string | null; cost_type?: string | null; isSub?: boolean; isDebtSync?: boolean;
  payment_source?: string | null; deposit_account?: string | null; notes?: string | null;
  tax_rate?: number | null; created_at?: string | null;
  /** Synthesised from a `savings_goals` row's own `monthly_contribution` — see `goalTransferRules`. */
  isGoalTransfer?: boolean;
  /** The ranked automatic extra the forecast diverts to this target in the CURRENT month. Shown
   *  beside the standing amount, never added to it — see `openTransferCalc`. */
  extraThisMonth?: number;
  /** The next month that DOES take one, when this month does not. Same rule: shown, never summed.
   *  Carried as an OFFSET from the current month — `nextExtraMonthLabel` dates it at render time,
   *  so the memo that builds these rows stays free of the calendar. */
  nextExtra?: { amount: number; monthIndex: number } | null;
};

/**
 * A row this page SYNTHESISED from another table rather than one of the user's own
 * `recurring_rules`. The record is owned by the surface it came from — Subscriptions, Debt Payoff,
 * Savings Goals — so every mutation here refuses one and the row renders without action buttons.
 */
const isSyntheticRule = (r: BudgetRule): boolean => Boolean(r.isSub || r.isDebtSync || r.isGoalTransfer);

/**
 * The sentence the rule editor shows under a biweekly rule's date field.
 *
 * A biweekly cadence has a PHASE, and the app derives one whether or not the user supplies it
 * (`resolveBiweeklyAnchor`). Showing the derived date is the whole point: "every 14 days" is
 * ambiguous until you say from when, and a user who disagrees can now pin their own.
 *
 * ⚠️ The shifted case is stated plainly rather than swallowed. When someone types their real first
 * paycheck date on a rule whose Day of Week names a different weekday, we MOVE their date — which
 * is defensible, since the weekday is also something they asked for — but a silently relocated
 * schedule is exactly the surprise this workstream exists to remove.
 */
const biweeklyAnchorHint = (rule: { due_day?: number | null; start_date?: string | null; created_at?: string | null }): string => {
  const { anchor, pinned, shiftedFromInput } = describeBiweeklyAnchor(rule);
  const pretty = new Date(`${anchor}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
  if (shiftedFromInput) {
    return `Heads up: the schedule will run from ${pretty}, not the date entered — Day of Week above names a different weekday. Change either one so they agree.`;
  }
  if (pinned) return `Repeats every 14 days from ${pretty}.`;
  return `Repeats every 14 days from ${pretty}. Set a date to pin your own cycle.`;
};

/**
 * The note on a synthetic "from payoff" rule.
 *
 * A recommendation's `reason` is written for the /debt row, where it sits beside the amount it
 * describes. Standing alone as a note it has to carry itself, and two of the values cannot: an
 * unmodelled card has no reason at all (empty string, which reads as a missing note rather than
 * a card the projection could not price), and a bare "Partial statement" names a balance without
 * saying what is being done about it. Copy only, the amount and due day are untouched.
 */
/**
 * "Aug 2027" — the month a ranked extra lands in, from its offset.
 *
 * `nextAutoExtraForGoal` returns an OFFSET from the projection's month 0, deliberately: that module
 * has no calendar. Month 0 is the current month, so the offset is added to it here, at render time,
 * in the one place that knows what today is.
 */
const nextExtraMonthLabel = (monthIndex: number, now: Date): string =>
  new Date(now.getFullYear(), now.getMonth() + monthIndex, 1)
    .toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

const DEFAULT_STARTER_RULES = [
  { name: 'Weekly Paycheck', amount: 1875, rule_type: 'income', frequency: 'weekly', due_day: 5, category: 'Other', notes: 'Friday deposits' },
  { name: 'Rent', amount: 1400, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Bills' },
  { name: 'Utilities', amount: 150, rule_type: 'expense', frequency: 'monthly', due_day: 15, category: 'Bills' },
  { name: 'Groceries', amount: 400, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Groceries' },
  { name: 'Gas / Transport', amount: 200, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Gas' },
  { name: 'Dining Out', amount: 150, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Dining' },
  { name: 'Insurance', amount: 280, rule_type: 'expense', frequency: 'monthly', due_day: 14, category: 'Bills' },
  { name: 'Subscriptions', amount: 50, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Subscriptions' },
  { name: 'Miscellaneous', amount: 100, rule_type: 'expense', frequency: 'monthly', due_day: 1, category: 'Other' },
];

// ── Paycheck Deduction types + catalog ───────────────────────────────────────
export type PaycheckDeduction = {
  id: string;
  label: string;
  value: number;
  mode: 'flat' | 'pct';
  preTax: boolean;
  accountId?: string; // linked investment/retirement account
  goalId?: string;    // linked savings goal (monthly_contribution auto-synced)
};

// eslint-disable-next-line react-refresh/only-export-components -- small shared constant, not worth a separate file
export const DEDUCTION_CATALOG: { label: string; mode: 'flat' | 'pct'; preTax: boolean }[] = [
  // Benefits
  { label: 'Medical Insurance',          mode: 'flat', preTax: true  },
  { label: 'Dental Insurance',           mode: 'flat', preTax: true  },
  { label: 'Vision Insurance',           mode: 'flat', preTax: true  },
  { label: 'Accident Insurance',         mode: 'flat', preTax: false },
  { label: 'Life Insurance',             mode: 'flat', preTax: false },
  { label: 'Short/Long-Term Disability', mode: 'flat', preTax: false },
  { label: 'Critical Illness Insurance', mode: 'flat', preTax: false },
  // Retirement & Savings
  { label: '401(k) Traditional',         mode: 'pct',  preTax: true  },
  { label: '401(k) Roth',                mode: 'pct',  preTax: false },
  { label: '403(b)',                      mode: 'pct',  preTax: true  },
  { label: 'HSA',                         mode: 'flat', preTax: true  },
  { label: 'FSA (Medical)',               mode: 'flat', preTax: true  },
  { label: 'FSA (Dependent Care)',        mode: 'flat', preTax: true  },
  // Taxes
  { label: 'Federal Withholding',                mode: 'flat', preTax: false },
  { label: 'Fed FICA Medicare (1.45%)',          mode: 'pct',  preTax: false },
  { label: 'Fed OASDI / Social Security (6.2%)', mode: 'pct',  preTax: false },
  { label: 'State Income Tax',                   mode: 'flat', preTax: false },
  // Other
  { label: 'Commuter Benefits', mode: 'flat', preTax: true  },
  { label: 'Parking Benefits',  mode: 'flat', preTax: true  },
  { label: 'Union Dues',        mode: 'flat', preTax: false },
  { label: 'Wage Garnishment',  mode: 'flat', preTax: false },
];

// All catalog items in the Taxes group (indices 13-16) — used to enforce post-tax and suppress Tax Rate field
const TAX_CATALOG_LABELS = new Set(DEDUCTION_CATALOG.slice(13, 17).map(c => c.label.toLowerCase()));

const DEFAULT_DEDUCTIONS: PaycheckDeduction[] = [
  { id: 'medical', label: 'Medical Insurance', value: 0, mode: 'flat', preTax: true },
  { id: 'dental',  label: 'Dental Insurance',  value: 0, mode: 'flat', preTax: true },
  { id: 'vision',  label: 'Vision Insurance',  value: 0, mode: 'flat', preTax: true },
  { id: '401k',    label: '401(k) Traditional', value: 0, mode: 'pct',  preTax: true },
  { id: 'hsa',     label: 'HSA',               value: 0, mode: 'flat', preTax: true },
];

const RULE_TYPE_OPTIONS = [
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'debt_payment', label: 'Debt Payment' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'investment', label: 'Investment Contribution' },
];

function migrateOldDeductions(profile: Partial<Tables<'profiles'>>): PaycheckDeduction[] | null {
  const vals = [
    { id: '401k',    label: '401(k) Traditional', val: Number(profile?.deduction_401k_value), mode: profile?.deduction_401k_mode || 'pct',  preTax: profile?.deduction_401k_pretax  !== false },
    { id: 'hsa',     label: 'HSA',                val: Number(profile?.deduction_hsa),        mode: profile?.deduction_hsa_mode    || 'flat', preTax: profile?.deduction_hsa_pretax   !== false },
    { id: 'fsa',     label: 'FSA (Medical)',       val: Number(profile?.deduction_fsa),        mode: profile?.deduction_fsa_mode    || 'flat', preTax: profile?.deduction_fsa_pretax   !== false },
    { id: 'medical', label: 'Medical Insurance',   val: Number(profile?.deduction_medical),    mode: profile?.deduction_medical_mode || 'flat', preTax: profile?.deduction_medical_pretax !== false },
  ].filter(d => d.val > 0);
  if (vals.length === 0) return null;
  return vals.map(d => ({ id: d.id, label: d.label, value: d.val, mode: d.mode as 'flat' | 'pct', preTax: d.preTax }));
}

/**
 * ⚠️ Budget Control is a PANEL of the Activity surface since 2026-08-18, not a route of its own
 * (Tre: "we need to reduce how many separate tabs"). `/budget` redirects to `/transactions?tab=budget`.
 *
 * `embedded` suppresses ONLY the page <h1>, its subtitle and the outer page padding, because the
 * host already carries all three. Everything else — the guide modal, every control, every modal —
 * comes across untouched. Same prop, same scope, as `Accounts` inside `Dashboard`.
 */
export default function BudgetControl({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const { isPremium } = useSubscription();
  const { data: profile, update: updateProfile, loading: profileLoading } = useProfile();
  const { data: accounts, loading: accountsLoading } = useAccounts();
  const { data: rules, add: addRule, update: updateRule, remove: removeRule, loading: rulesLoading } = useRecurringRules();
  const { data: savingsGoals, update: updateGoal } = useSavingsGoals();
  // 97.3 — re-stamp goal auto-end dates when a rule that funds a goal is edited here.
  const { reconcile: reconcileAutoEnd } = useAutoEndReconcile();
  const { data: carFunds } = useCarFunds();
  const { data: subs } = useSubscriptions();
  const { data: debts } = useDebts();

  // Income state
  const [weeklyGross, setWeeklyGross] = useState(1875);
  const [weeklyGrossInput, setWeeklyGrossInput] = useState('1875');
  const [taxRate, setTaxRate] = useState(22);
  const [taxRateStr, setTaxRateStr] = useState('22');
  const [paycheckDay, setPaycheckDay] = useState(5);
  const [payFrequency, setPayFrequency] = useState<PayFrequency>('weekly');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Dynamic paycheck deductions
  const [deductions, setDeductions] = useState<PaycheckDeduction[]>([]);
  const [dedDisplayValues, setDedDisplayValues] = useState<Record<string, string>>({});
  const [showCatalog, setShowCatalog] = useState(false);
  const [deductionsCollapsed, setDeductionsCollapsedState] = useState<boolean>(false);
  const [incomeSectionCollapsed, setIncomeSectionCollapsedState] = useState<boolean>(false);
  const uiPrefsLoaded = useRef(false);
  const uiPrefsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveUiPrefs = useCallback((prefs: Record<string, boolean>) => {
    if (uiPrefsSaveTimer.current) clearTimeout(uiPrefsSaveTimer.current);
    uiPrefsSaveTimer.current = setTimeout(() => {
      updateProfile.mutate({ ui_preferences: prefs as unknown as Json });
    }, 600);
  }, [updateProfile]);
  const setDeductionsCollapsed = (v: boolean) => {
    setDeductionsCollapsedState(v);
    saveUiPrefs({ deductionsCollapsed: v, incomeSectionCollapsed });
  };
  const setIncomeSectionCollapsed = (v: boolean) => {
    setIncomeSectionCollapsedState(v);
    saveUiPrefs({ deductionsCollapsed, incomeSectionCollapsed: v });
  };
  const [customLabel, setCustomLabel] = useState('');

  // Paycheck rule lock — ID of the single income rule auto-synced by income settings
  const [paycheckRuleId, setPaycheckRuleId] = useState<string | null>(null);

  // Calc drawer

  // Rule form state
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  // The edited row's `created_at`, kept alongside the form because it is the biweekly phase anchor
  // whenever `start_date` is blank — the hint has to describe what the ENGINE will do, and the
  // engine reads this column. A rule being added has none yet, so the hint falls back to today,
  // which is what that rule's anchor will actually resolve to once it is written.
  const [editCreatedAt, setEditCreatedAt] = useState<string | null>(null);
  const [form, setForm] = useState(emptyRuleForm);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  // Guard only — never read during render. A ref rather than state because it
  // must flip synchronously: with state, a second effect run in the same tick
  // still sees `false` and seeds the starter rules twice.
  const starterSeededRef = useRef(false);
  const profileLoaded = useRef(false);

  // Hydrates the paycheck/tax/deductions form from the server profile once it
  // arrives. Every field is user-editable afterwards and auto-saved back, so
  // none of it can be derived from `profile`; the query resolves after mount, so
  // a lazy initializer cannot cover it either.
  useEffect(() => {
    if (profile) {
      const wg = Number(profile.weekly_gross_income) || 1875;
      const pf = (profile.paycheck_frequency as PayFrequency) || 'weekly';
      const perPaycheck = pf === 'biweekly' ? wg * 2 : pf === 'monthly' ? wg * 52 / 12 : wg;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWeeklyGross(wg);
      setWeeklyGrossInput(String(Math.round(perPaycheck * 100) / 100));
      const loadedTr = profile.tax_rate ?? 22;
      setTaxRate(loadedTr);
      setTaxRateStr(String(loadedTr));
      setPaycheckDay(profile.paycheck_day != null ? Number(profile.paycheck_day) : 5);
      setPayFrequency(pf);
      // Load deductions: prefer new JSONB column, migrate from legacy columns if needed
      const jsonDeds = profile.paycheck_deductions as PaycheckDeduction[] | null;
      if (jsonDeds && jsonDeds.length > 0) {
        setDeductions(jsonDeds);
        setDedDisplayValues(Object.fromEntries(jsonDeds.map(d => [d.id, String(d.value)])));
      } else {
        const migrated = migrateOldDeductions(profile);
        if (migrated) {
          setDeductions(migrated);
          setDedDisplayValues(Object.fromEntries(migrated.map(d => [d.id, String(d.value)])));
        }
        // else keep empty — user adds deductions manually
      }
      // Load the designated paycheck rule ID
      setPaycheckRuleId(profile.paycheck_rule_id ?? null);
      // Load UI preferences (collapse states) — only on first profile load
      if (!uiPrefsLoaded.current) {
        const uiPrefs = profile.ui_preferences as { deductionsCollapsed?: boolean; incomeSectionCollapsed?: boolean } | null;
        if (uiPrefs && typeof uiPrefs === 'object') {
          if (typeof uiPrefs.deductionsCollapsed === 'boolean') setDeductionsCollapsedState(uiPrefs.deductionsCollapsed);
          if (typeof uiPrefs.incomeSectionCollapsed === 'boolean') setIncomeSectionCollapsedState(uiPrefs.incomeSectionCollapsed);
        }
        uiPrefsLoaded.current = true;
      }
      profileLoaded.current = true;
    }
  }, [profile]);

  useEffect(() => {
    if (!rulesLoading && !isDemo && user && rules.length === 0 && !starterSeededRef.current) {
      starterSeededRef.current = true;
      DEFAULT_STARTER_RULES.forEach(r => {
        addRule.mutate({ ...r, active: true, due_month: null, payment_source: null, deposit_account: null, notes: r.notes || '' });
      });
    }
  }, [rulesLoading, isDemo, user, rules.length, addRule]);

  // Auto-save income/tax with debounce + auto-sync income rule
  const resolveAmt = (d: PaycheckDeduction, gross: number) =>
    d.mode === 'pct' ? gross * (d.value / 100) : d.value;

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doAutoSave = useCallback((
    wg: number, tr: number, pd: number, pf: PayFrequency, deds: PaycheckDeduction[],
  ) => {
    if (!profileLoaded.current || isDemo) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      setAutoSaveStatus('saving');
      const gross = pf === 'biweekly' ? wg * 2 : pf === 'monthly' ? wg * 52 / 12 : wg;
      const preTax  = deds.filter(d => d.preTax).reduce((s, d) => s + resolveAmt(d, gross), 0);
      const postTax = deds.filter(d => !d.preTax).reduce((s, d) => s + resolveAmt(d, gross), 0);
      // Federal Withholding / FICA / OASDI deductions replace the tax rate when active
      const taxDedActive = deds.some(d => /withholding|fica|oasdi/i.test(d.label) && d.value > 0);
      const effectiveTr = taxDedActive ? 0 : tr;
      const netPerPaycheck = (gross - preTax) * (1 - effectiveTr / 100) - postTax;
      const paychecksPerYear = pf === 'biweekly' ? 26 : pf === 'monthly' ? 12 : 52;
      // Backward-compat: keep legacy 401k columns so Forecast + use401kAutoUpdate still work
      const k401 = deds.find(d => d.id === '401k' || d.label.toLowerCase().includes('401(k) traditional') || d.label.toLowerCase().includes('401k'));
      // Resolve which rule is the designated paycheck rule (only that one gets synced)
      const targetRule = paycheckRuleId
        ? rules.find(r => r.id === paycheckRuleId)
        : rules.find(r => r.rule_type === 'income' && r.active);
      updateProfile.mutate({
        weekly_gross_income: wg,
        tax_rate: tr,
        paycheck_day: pd,
        paycheck_frequency: pf,
        gross_income: wg * 52 / 12,
        monthly_income_default: (netPerPaycheck * paychecksPerYear) / 12,
        paycheck_deductions: deds,
        paycheck_rule_id: targetRule?.id ?? paycheckRuleId,
        deduction_401k_value: k401?.value ?? 0,
        deduction_401k_mode: k401?.mode ?? 'pct',
        deduction_401k_pretax: k401?.preTax ?? true,
      }, {
        onSuccess: () => {
          setAutoSaveStatus('saved');
          setTimeout(() => setAutoSaveStatus('idle'), 2000);
          // Sync ONLY the designated paycheck rule — never touch other income rules
          if (targetRule) {
            if (!paycheckRuleId) setPaycheckRuleId(targetRule.id);
            const needsUpdate = Math.round(Number(targetRule.amount) * 100) !== Math.round(netPerPaycheck * 100) ||
              targetRule.frequency !== pf ||
              targetRule.due_day !== pd;
            if (needsUpdate) {
              updateRule.mutate({
                id: targetRule.id,
                amount: Math.round(netPerPaycheck * 100) / 100,
                frequency: pf,
                due_day: pd,
              });
            }
          } else if (wg > 0 && netPerPaycheck > 0) {
            // No income rule exists yet — auto-create one from the entered gross income.
            // The rule list invalidates after insert; the next doAutoSave will find and lock it in.
            addRule.mutate({
              name: 'Paycheck',
              rule_type: 'income',
              amount: Math.round(netPerPaycheck * 100) / 100,
              frequency: pf,
              due_day: pd,
              active: true,
              due_month: null,
              payment_source: null,
              deposit_account: null,
              notes: '',
            });
          }
          // Sync savings goal monthly_contribution for any linked deduction
          deds.forEach(d => {
            if (d.goalId && d.value > 0) {
              const flatAmt = d.mode === 'pct' ? gross * (d.value / 100) : d.value;
              const paychecksPerYr = pf === 'biweekly' ? 26 : pf === 'monthly' ? 12 : 52;
              const monthlyContrib = Math.round((flatAmt * paychecksPerYr / 12) * 100) / 100;
              updateGoal.mutate({ id: d.goalId, monthly_contribution: monthlyContrib });
            }
          });
        },
        onError: () => setAutoSaveStatus('idle'),
      });
    }, 800);
  }, [isDemo, updateProfile, rules, addRule, updateRule, paycheckRuleId, setPaycheckRuleId, updateGoal]);

  const handleWeeklyGrossBlur = () => {
    const parsed = parseFloat(weeklyGrossInput);
    if (!isNaN(parsed) && parsed > 0) {
      const wg = payFrequency === 'biweekly' ? parsed / 2 : payFrequency === 'monthly' ? parsed * 12 / 52 : parsed;
      setWeeklyGross(wg);
      doAutoSave(wg, taxRate, paycheckDay, payFrequency, deductions);
    } else {
      const perPaycheck = payFrequency === 'biweekly' ? weeklyGross * 2 : payFrequency === 'monthly' ? weeklyGross * 52 / 12 : weeklyGross;
      setWeeklyGrossInput(String(Math.round(perPaycheck * 100) / 100));
    }
  };
  const setTaxRateAuto = (v: number) => { setTaxRate(v); doAutoSave(weeklyGross, v, paycheckDay, payFrequency, deductions); };
  const setPaycheckDayAuto = (v: number) => { setPaycheckDay(v); doAutoSave(weeklyGross, taxRate, v, payFrequency, deductions); };
  const setPayFrequencyAuto = (v: PayFrequency) => {
    setPayFrequency(v);
    const perPaycheck = v === 'biweekly' ? weeklyGross * 2 : v === 'monthly' ? weeklyGross * 52 / 12 : weeklyGross;
    setWeeklyGrossInput(String(Math.round(perPaycheck * 100) / 100));
    doAutoSave(weeklyGross, taxRate, paycheckDay, v, deductions);
  };

  // Deduction CRUD — each mutates and auto-saves
  const updateDeduction = (id: string, patch: Partial<PaycheckDeduction>) => {
    const next = deductions.map(d => {
      if (d.id !== id) return d;
      const merged = { ...d, ...patch };
      // Catalog Taxes-group items are always post-tax — prevent toggle from changing it
      if (TAX_CATALOG_LABELS.has(merged.label.toLowerCase())) merged.preTax = false;
      return merged;
    });
    setDeductions(next);
    doAutoSave(weeklyGross, taxRate, paycheckDay, payFrequency, next);
  };
  const removeDeduction = (id: string) => {
    const next = deductions.filter(d => d.id !== id);
    setDeductions(next);
    setDedDisplayValues(prev => { const { [id]: _, ...rest } = prev; return rest; });
    doAutoSave(weeklyGross, taxRate, paycheckDay, payFrequency, next);
  };
  const addDeductionFromCatalog = (item: { label: string; mode: 'flat' | 'pct'; preTax: boolean }) => {
    // False positive: this runs from the catalog's onClick, never during render. Generating the
    // row id from the clock + a random suffix is exactly the kind of one-shot impurity an event
    // handler is allowed; the compiler-backed rule just cannot prove the call site.
    // eslint-disable-next-line react-hooks/purity
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const next = [...deductions, { id, label: item.label, value: 0, mode: item.mode, preTax: item.preTax }];
    setDeductions(next);
    setDedDisplayValues(prev => ({ ...prev, [id]: '0' }));
    doAutoSave(weeklyGross, taxRate, paycheckDay, payFrequency, next);
    setShowCatalog(false);
    setCustomLabel('');
  };

  // Unified pay schedule
  const paycheckGross = useMemo(() => {
    if (payFrequency === 'biweekly') return weeklyGross * 2;
    if (payFrequency === 'monthly') return weeklyGross * 52 / 12;
    return weeklyGross;
  }, [weeklyGross, payFrequency]);

  // Resolve each deduction to flat $ per paycheck
  const deductionAmounts = useMemo(() =>
    deductions.map(d => ({
      ...d,
      flatAmt: d.mode === 'pct' ? paycheckGross * (d.value / 100) : d.value,
    })),
    [deductions, paycheckGross]);

  const preTaxDeductionsFlat  = useMemo(() => deductionAmounts.filter(d => d.preTax).reduce((s, d) => s + d.flatAmt, 0), [deductionAmounts]);
  const postTaxDeductionsFlat = useMemo(() => deductionAmounts.filter(d => !d.preTax).reduce((s, d) => s + d.flatAmt, 0), [deductionAmounts]);

  // When any catalog Taxes-group deduction is active, they replace the Tax Rate %
  const hasTaxDeductions = useMemo(() =>
    deductions.some(d => TAX_CATALOG_LABELS.has(d.label.toLowerCase()) && d.value > 0),
    [deductions]);
  const effectiveTaxRate = hasTaxDeductions ? 0 : taxRate;

  const payConfig = useMemo(() => ({
    weeklyGross, taxRate: effectiveTaxRate, paycheckDay, frequency: payFrequency,
    preTaxDeductions: preTaxDeductionsFlat,
    postTaxDeductions: postTaxDeductionsFlat,
  }), [weeklyGross, effectiveTaxRate, paycheckDay, payFrequency, preTaxDeductionsFlat, postTaxDeductionsFlat]);

  const paycheckNet = useMemo(() => getPaycheckNet(payConfig), [payConfig]);
  const retire401kPerCheck = deductionAmounts
    .filter(d => /401|403|roth|ira/i.test(d.label))
    .reduce((s, d) => s + d.flatAmt, 0);
  const now = new Date();
  const monthlyTakeHome = useMemo(() => {
    const d = new Date();
    const paychecks = getPaychecksInMonth(payConfig, d.getFullYear(), d.getMonth());
    return paychecks.reduce((s, p) => s + p.net, 0);
  }, [payConfig]);
  const remainingIncome = useMemo(() => getRemainingIncomeThisMonth(payConfig), [payConfig]);
  const remainingPaychecks = useMemo(() => getRemainingPaychecksThisMonth(payConfig), [payConfig]);
  const nextPayday = useMemo(() => getNextPaycheckDate(payConfig), [payConfig]);

  const monthlyGross = useMemo(() => {
    const d = new Date();
    const paychecks = getPaychecksInMonth(payConfig, d.getFullYear(), d.getMonth());
    return paychecks.reduce((s, p) => s + p.gross, 0);
  }, [payConfig]);
  const annualGross = weeklyGross * 52;
  const paychecksPerYear = payFrequency === 'biweekly' ? 26 : payFrequency === 'monthly' ? 12 : 52;
  const annualTakeHome = paycheckNet * paychecksPerYear;

  /**
   * THE MONTH, DERIVED ONCE. The five buckets, the per-rule month amount and the totals all come
   * from `useBudgetMonthTotals`, which the Dashboard's `BudgetTotalsCard` reads too -- the two
   * surfaces agree by construction rather than by inspection. This page used to build all of it
   * inline (subscriptions, card payments, loan and liability payments, goal transfers), and that
   * assembly is exactly what would have drifted the moment either page changed.
   *
   * The debt breakdown and the matched-occurrence index come BACK OUT of the hook rather than
   * being fetched again: both re-run per call site.
   */
  const {
    buckets: { incomeRules, fixedRules, variableRules, debtRules, transferRules },
    totals, toCurrentMonthAmount, subsAsRules, debtPaymentRules, liabilityPaymentRules,
    goalTransferRules, debtBreakdown, matched, autoMatchedRuleIds,
  } = useBudgetMonthTotals();
  const { index: matchedOccurrences, occurrences: confirmedOccurrences } = matched;

  // Auto-pull debt payments from Debt Payoff recommendations (with full params)
  const { data: txns } = useTransactions();

  // Base transaction stream (recurring rules merged with real DB transactions)
  const baseTxns = useMemo(() =>
    mergeWithGeneratedTransactions(txns || [], rules, accounts),
    [txns, rules, accounts],
  );

  // Debt recommendations from the converged month-0 projection, by way of `useBudgetMonthTotals`
  // -- calling `useMonth0DebtBreakdown` again here would re-run that derivation a second time.
  const { recommendations: debtRecommendations } = debtBreakdown;


  // Inject debt payment transactions into the stream
  // ⚠️ CARD ROWS ONLY, deliberately. This feeds Remaining Cash On Hand through `remainingTxDebt`,
  // and the engine's cash floor ALREADY holds the loan payment (`chain.carLoanPayment`) and the
  // other-debt payment (`chain.otherDebtPayment`). Adding `liabilityPaymentRules` here would
  // subtract that money a second time.
  const debtPaymentTxns = useMemo(() => {
    const fundId = profile?.default_deposit_account ||
      accounts.find(a => a.account_type === 'checking' && a.active)?.id || null;
    return createDebtPaymentTransactions(debtRecommendations, fundId);
  }, [debtRecommendations, profile, accounts]);

  // Full transaction stream with debt payments — single source of truth
  const allMonthTransactions = useMemo(() =>
    mergeDebtPaymentsIntoStream(baseTxns, debtPaymentTxns),
    [baseTxns, debtPaymentTxns],
  );

  // §1A Stage B — "matched" badge.
  //
  // A rule lands here only when exactly one settled synced transaction confidently corresponds to
  // its occurrence THIS month. Absence means "no information" and is rendered as nothing at all:
  // most rules will be absent until every connection has backfilled, and a "not paid" state would
  // turn that gap into an accusation.
  //
  // Built from real `recurring_rules` occurrences rather than the merged view, so the synthetic
  // subscription and debt-sync entries can never pick up a badge — they have no payment_source to
  // attribute and their ids do not refer to rules at all.
  //
  // ⚠️ THE MATCHER CHANGED ON 2026-08-25, AND IT WIDENS WHAT CAN BE BADGED. This loop used to call
  // `matchOccurrence`, which locates an occurrence from `due_day` alone and therefore refuses
  // `weekly` and `biweekly` outright — so those rules could never carry the badge however plainly
  // the bank showed them paid, while the forecast (which matches on real occurrence dates) had
  // already captured them. Both sides now read the one index. See `matchedRuleIdsInMonth`.
  //
  // ⚠️ LABEL CHANGED ON 2026-08-25 TOO: the same index (`useMatchedOccurrences`) also merges in
  // USER-CONFIRMED matches, not only the automatic ones, so "auto-matched" overclaimed how a badged
  // rule got here. The label now just says "matched" — true whether the system found the charge on
  // its own or Tre confirmed it in a review.

  // Rules by category: the five buckets, already merged with their synthetic rows, from the hook.

  const { cardProjection } = useCardProjectionContext();

  // Split fixedRules into Bills-only and Subscriptions-only for separate tabs
  const billsRules = useMemo(() => fixedRules.filter(r => !r.isSub && r.category !== 'Subscriptions'), [fixedRules]);
  const subscriptionRules = useMemo(() => fixedRules.filter(r => r.isSub || r.category === 'Subscriptions'), [fixedRules]);


  const currentMonthDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth();


  // The five totals and the three sums over them, from the one hook. Same names the page has
  // always used, so nothing below this line had to change.
  const {
    income: totalRecurringIncome, fixed: totalFixedExpenses, variable: totalVariableExpenses,
    debt: totalDebtPayments, transfers: totalTransfers, expenses: totalExpenses, remaining,
  } = totals;

  const fundingAccount = useMemo(() => {
    const defaultId = profile?.default_deposit_account;
    if (defaultId) {
      const acct = accounts.find(a => a.id === defaultId);
      if (acct) return acct;
    }
    return accounts.find(a => a.account_type === 'checking' && a.active) || null;
  }, [accounts, profile]);

  // Remaining Cash On Hand — uses funding account + Transactions as single source of truth
  const fundingAccountBalance = useMemo(() => {
    if (fundingAccount) return Number(fundingAccount.balance);
    const liquidTypes = ['checking', 'business_checking', 'cash'];
    return accounts.filter(a => a.active && liquidTypes.includes(a.account_type)).reduce((s, a) => s + Number(a.balance), 0);
  }, [accounts, fundingAccount]);

  const remainingTxIncome = useMemo(() => getRemainingTransactionIncomeThisMonth(allMonthTransactions), [allMonthTransactions]);
  const remainingTxExpenses = useMemo(() => getRemainingTransactionExpensesThisMonth(allMonthTransactions, true, undefined, undefined, undefined, confirmedOccurrences), [allMonthTransactions, confirmedOccurrences]);
  const remainingTxDebt = useMemo(() => getRemainingTransactionDebtPaymentsThisMonth(allMonthTransactions), [allMonthTransactions]);

  const cashFloor = useMemo(() => resolveCashFloor(profile), [profile]);
  const prePaycheckBillsTotal = useMemo(() =>
    getPrePaycheckNextMonthBills(rules, payConfig, fundingAccount?.id || null).total,
    [rules, payConfig, fundingAccount]);

  const allAccountOptions = useMemo(() => [
    { value: '', label: 'None' },
    ...accounts.filter(a => a.active).map(a => ({ value: a.id, label: `${a.name} (${a.account_type.replace(/_/g, ' ')})` })),
  ], [accounts]);

  const depositAccountOptions = useMemo(() => [
    { value: '', label: 'None' },
    ...accounts.filter(a => a.active && ['checking', 'savings', 'high_yield_savings', 'business_checking', 'cash'].includes(a.account_type)).map(a => ({ value: a.id, label: a.name })),
  ], [accounts]);

  // editCreatedAt rides along because it is the biweekly phase anchor the hint
  // describes; losing it on restore would silently change what the hint claims.
  const draftValues = useMemo(() => ({ form, editCreatedAt }), [form, editCreatedAt]);

  const { restored: draftRestored, discard: discardDraft } = useFormDraft({
    formKey: 'budget-rules',
    open: showForm,
    editId,
    values: draftValues,
    enabled: !isDemo,
    onRestore: useCallback((draft: FormDraft<typeof draftValues>) => {
      setForm(draft.values.form);
      setEditCreatedAt(draft.values.editCreatedAt);
      setEditId(draft.editId);
      setShowForm(true);
    }, []),
  });

  const handleDiscardDraft = useCallback(() => {
    discardDraft();
    setForm(emptyRuleForm);
    setEditCreatedAt(null);
    setEditId(null);
  }, [discardDraft]);

  const openAdd = (type: string, category?: string) => {
    setForm({ ...emptyRuleForm, rule_type: type, category: category || 'Other' });
    setEditId(null);
    setEditCreatedAt(null);
    setShowForm(true);
  };

  const openEdit = (r: BudgetRule) => {
    if (isSyntheticRule(r)) return;
    setForm({
      name: r.name, amount: String(r.amount), rule_type: r.rule_type, frequency: r.frequency,
      interval_count: r.interval_count != null ? String(r.interval_count) : '',
      interval_unit: r.interval_unit || '',
      due_day: String(r.due_day), due_month: String(r.due_month || ''), category: r.category,
      payment_source: r.payment_source || '', deposit_account: r.deposit_account || '', notes: r.notes || '',
      start_date: r.start_date || '', end_date: r.end_date || '',
      tax_rate: r.tax_rate != null ? String(r.tax_rate) : '',
    });
    setEditId(r.id);
    setEditCreatedAt(r.created_at || null);
    setShowForm(true);
  };

  const handleSave = () => {
    const amount = parseFloat(form.amount);
    if (!form.name || isNaN(amount)) return;
    if (form.rule_type === 'income' && !form.start_date) {
      toast.error('Income rules require a Start Date');
      return;
    }
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      toast.error('End Date cannot be before Start Date');
      return;
    }
    // The custom interval is BOTH FIELDS OR NEITHER, and the database says so too. A count with no
    // unit is not a schedule and a unit with no count is ambiguous between "one" and "unset", so
    // this refuses the half-filled form here rather than letting the write fail with a constraint
    // error the user cannot act on.
    const intervalCount = parseCustomIntervalCount(form.interval_count);
    const intervalUnit = form.interval_unit.trim() || null;
    if (form.interval_count.trim() !== '' && intervalCount === null) {
      toast.error('Repeat every must be a whole number from 1 to 60');
      return;
    }
    if ((intervalCount === null) !== (intervalUnit === null)) {
      toast.error('Set both "Repeat every" and its unit, or leave both blank');
      return;
    }
    const { clean: cleanRuleName, flagged: ruleNameFlagged } = filterProfanity(form.name.trim().slice(0, LIMITS.ruleName));
    const { clean: cleanRuleNotes, flagged: ruleNotesFlagged } = filterProfanity(form.notes.trim().slice(0, LIMITS.ruleNotes));
    if (ruleNameFlagged || ruleNotesFlagged) toast.warning('Some content contained inappropriate language and was cleaned.');
    const parsedTaxRate = parseFloat(form.tax_rate);
    const payload: Partial<Tables<'recurring_rules'>> & { name: string } = {
      name: cleanRuleName, amount, rule_type: form.rule_type, frequency: form.frequency,
      due_day: parseInt(form.due_day) || 1, due_month: form.due_month ? parseInt(form.due_month) : null,
      category: form.category, payment_source: form.payment_source || null,
      deposit_account: form.deposit_account || null, notes: cleanRuleNotes, active: true,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      tax_rate: form.rule_type === 'income' && form.tax_rate.trim() !== '' && !isNaN(parsedTaxRate) ? parsedTaxRate : null,
      interval_count: intervalCount,
      interval_unit: intervalUnit,
    };
    if (editId) {
      // 97.3 — editing a rule moves the projection of every goal it funds, and the stamped
      // end_date is a REAL write the forecast honors (forecast-engine.ts:785). Cutting this
      // rule's amount without re-stamping would leave a stop date EARLIER than the new
      // completion month, hard-stopping contributions before the goal is funded — the one
      // direction goal-linkage.ts (4b) cannot rescue, since it only ever stops a rule earlier.
      //
      // Sequenced, not fired alongside: both writes can target this rule's end_date, and if the
      // reconcile landed first the save would overwrite it while the goal's stamp map still
      // claimed the new date — which the next reconcile would read as a user-set conflict and
      // then refuse to touch forever. Planned against the rule AS SAVED.
      const savedRules = rules.map(r => (r.id === editId ? { ...r, ...payload } : r));
      void updateRule
        .mutateAsync({ id: editId, ...payload })
        .then(() => reconcileAutoEnd(savedRules))
        .catch(() => { /* the mutation's own onError already surfaced this */ });
    } else {
      addRule.mutate(payload);
    }
    setShowForm(false);
    setEditId(null);
  };

  const toggleActive = (r: BudgetRule) => {
    if (isSyntheticRule(r)) return;
    updateRule.mutate({ id: r.id, active: !r.active });
  };

  const toggleCostType = (r: BudgetRule) => {
    if (isSyntheticRule(r)) return;
    const nextType = isFixedRule(r) ? 'variable' : 'fixed';
    updateRule.mutate({ id: r.id, cost_type: nextType });
  };

  const handleDelete = (id: string) => {
    if (id.startsWith('sub:') || id.startsWith('debt:')) return;
    if (deleteConfirm === id) { removeRule.mutate(id); setDeleteConfirm(null); }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000); }
  };

  const getAccountName = (id: string) => accounts.find(a => a.id === id)?.name || '';
  const freqLabel = (f: string) => f === 'weekly' ? 'Weekly' : f === 'biweekly' ? 'Biweekly' : f === 'monthly' ? 'Monthly' : 'Yearly';

  const formFields = useMemo(() => {
    const fields: Field[] = [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'e.g., Rent, Paycheck', required: true },
      { key: 'amount', label: 'Amount', type: 'number', placeholder: '0.00', step: '0.01', required: true,
        // ⚠️ `editId !== null` IS LOad-BEARING. `paycheckRuleId` starts as null and stays null until a
        // paycheck rule is identified, and `editId` is null whenever the form is ADDING rather than
        // editing — so a bare `editId === paycheckRuleId` was `null === null`, TRUE, and locked the
        // Amount box read-only on every new rule for anyone whose gross income is set and whose
        // paycheck rule is not. The box could not be typed into at all, with a hint pointing at a
        // settings page that had nothing to do with it. Found by pressing the form rather than
        // reading it.
        ...(editId !== null && editId === paycheckRuleId && weeklyGross > 0 ? { disabled: true, hint: 'Controlled by gross income in Income & Tax settings' } : {}) },
      { key: 'rule_type', label: 'Type', type: 'select', options: RULE_TYPE_OPTIONS },
      { key: 'frequency', label: 'Frequency', type: 'select', options: [{ value: 'weekly', label: 'Weekly' }, { value: 'biweekly', label: 'Biweekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }] },
      { key: 'due_day', label: form.frequency === 'weekly' || form.frequency === 'biweekly' ? 'Day of Week (0=Sun, 5=Fri)' : 'Due Day of Month', type: 'number' },
      // The user-chosen interval. Left blank — which is how every existing rule and every new one
      // starts — the frequency above governs and nothing about the rule changes. Filled in, these
      // two express "every other month", "every three weeks", "every five weeks" and everything
      // else of that shape WITHOUT the frequency list above growing an entry per cadence.
      { key: 'interval_count', label: 'Repeat every (optional)', type: 'number', placeholder: '1', step: '1',
        hint: customIntervalFormHint(form.interval_count, form.interval_unit) },
      { key: 'interval_unit', label: 'Interval unit', type: 'select', options: INTERVAL_UNIT_OPTIONS },
    ];
    if (form.frequency === 'yearly') {
      fields.push({ key: 'due_month', label: 'Due Month (1-12)', type: 'number' });
    }
    fields.push({ key: 'category', label: 'Category', type: 'select', options: CATEGORIES.map(c => ({ value: c, label: c })) });
    
    // On a biweekly rule this existing field is doing a second job — it is the phase anchor
    // `resolveBiweeklyAnchor` already prefers — so it is relabeled to say what it actually
    // controls and captioned with the cycle the engine will run. No new column, no new input.
    const isBiweekly = form.frequency === 'biweekly';
    const startDateLabel = isBiweekly
      ? (form.rule_type === 'income' ? 'First Paycheck Date (required)' : 'First Occurrence (optional)')
      : (form.rule_type === 'income' ? 'Start Date (required)' : 'Start Date (optional)');
    fields.push({
      key: 'start_date',
      label: startDateLabel,
      type: 'date',
      ...(form.rule_type === 'income' ? { required: true } : { clearable: true }),
      ...(isBiweekly ? { hint: biweeklyAnchorHint({
        due_day: form.due_day.trim() === '' ? null : Number(form.due_day),
        start_date: form.start_date || null,
        created_at: editCreatedAt,
      }) } : {}),
    });
    fields.push({ key: 'end_date', label: 'End Date (optional)', type: 'date', clearable: true });

    if (form.rule_type === 'income') {
      fields.push({ key: 'deposit_account', label: 'Deposit Into', type: 'select', options: depositAccountOptions });
      if (editId !== paycheckRuleId) {
        fields.push({ key: 'tax_rate', label: 'Tax Rate % (optional)', type: 'number', placeholder: '0', hint: 'Leave blank for no tax withheld', step: '0.1' });
      }
    } else if (form.rule_type === 'debt_payment' || form.rule_type === 'transfer' || form.rule_type === 'investment') {
      fields.push({ key: 'payment_source', label: 'Paid From', type: 'select', options: allAccountOptions });
      fields.push({ key: 'deposit_account', label: 'Apply To / Deposit Into', type: 'select', options: allAccountOptions });
    } else {
      fields.push({ key: 'payment_source', label: 'Charged To', type: 'select', options: allAccountOptions });
    }
    fields.push({ key: 'notes', label: 'Notes', type: 'text', placeholder: 'Optional' });
    return fields;
    // `form.start_date`, `form.due_day` and `editCreatedAt` are inputs to the biweekly hint above —
    // omit them and the caption goes stale the moment the user types.
  }, [form.frequency, form.rule_type, form.start_date, form.due_day, form.interval_count, form.interval_unit, editCreatedAt, allAccountOptions, depositAccountOptions, editId, paycheckRuleId, weeklyGross]);

  const handleDuplicate = (r: BudgetRule) => {
    if (isSyntheticRule(r)) return;
    setForm({
      name: `${r.name} (Copy)`, amount: String(r.amount), rule_type: r.rule_type, frequency: r.frequency,
      interval_count: r.interval_count != null ? String(r.interval_count) : '',
      interval_unit: r.interval_unit || '',
      due_day: String(r.due_day), due_month: String(r.due_month || ''), category: r.category,
      payment_source: r.payment_source || '', deposit_account: r.deposit_account || '', notes: r.notes || '',
      start_date: r.start_date || '', end_date: r.end_date || '',
      tax_rate: r.tax_rate != null ? String(r.tax_rate) : '',
    });
    setEditId(null);
    // A copy is a NEW row and will get its own `created_at` on save, so it does not inherit the
    // original's phase anchor. Only a pinned `start_date` (copied above) carries over.
    setEditCreatedAt(null);
    setShowForm(true);
    toast.info('Rule duplicated — edit and save');
  };


  const RuleRow = ({ r, color = 'text-destructive' }: { r: BudgetRule; color?: string }) => (
  <div className={`flex flex-col gap-2 py-3 border-b border-border/50 last:border-0 sm:flex-row sm:items-center sm:justify-between ${!r.active ? 'opacity-40' : ''}`}>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5 flex-wrap">
      <p className="text-sm sm:text-base font-medium wrap-break-word">{r.name}</p>
      {r.isSub && (
        <span
          className="text-xs px-1 py-0.5 bg-accent/20 text-accent-foreground border border-accent/30 shrink-0"
          style={{ borderRadius: 'var(--radius)' }}
        >
          sub
        </span>
      )}
      {r.isDebtSync && (
        <span
          className="text-xs px-1 py-0.5 bg-primary/20 text-primary border border-primary/30 shrink-0"
          style={{ borderRadius: 'var(--radius)' }}
        >
          from payoff
        </span>
      )}
      {r.isGoalTransfer && (
        <span
          className="text-xs px-1 py-0.5 bg-primary/20 text-primary border border-primary/30 shrink-0"
          style={{ borderRadius: 'var(--radius)' }}
          title="This goal's own monthly contribution. Edit it on Savings Goals."
        >
          from goal
        </span>
      )}
      {autoMatchedRuleIds.has(r.id) && (
        // Present tense and factual: a transaction matching this rule has settled this month. It
        // deliberately does NOT say "paid" — the matcher found a corresponding charge, which is
        // evidence, not an accounting assertion. There is no negative counterpart chip by design.
        // Says "matched", not "auto-matched": the underlying index also includes matches Tre
        // confirmed by hand, and the label should not claim the automatic path when it was a person.
        <span
          className="text-xs px-1 py-0.5 bg-success/20 text-success border border-success/30 shrink-0"
          style={{ borderRadius: 'var(--radius)' }}
          title="A settled transaction on the linked account matches this rule's amount and due date this month."
        >
          matched
        </span>
      )}
    </div>

    <p className="mt-1 text-xs sm:text-sm text-muted-foreground wrap-break-word">
      {customIntervalLabel(r) ?? freqLabel(r.frequency)}
      {r.due_day != null ? ` · Day ${r.due_day}` : ''}
      {r.due_month ? ` / Month ${r.due_month}` : ''}
      {r.start_date ? ` · Starts ${r.start_date}` : ''}
      {r.end_date ? ` · Ends ${r.end_date}` : ''}
      {r.payment_source ? ` · From: ${getAccountName(r.payment_source)}` : ''}
      {r.deposit_account ? ` · To: ${getAccountName(r.deposit_account)}` : ''}
    </p>
  </div>

  <div className="flex flex-col gap-2 sm:items-end shrink-0">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
      <span className={`text-sm sm:text-base font-display font-bold ${color}`}>
        {formatCurrency(Number(r.amount), false)}
      </span>
      <span className="text-xs sm:text-sm text-muted-foreground">
        /mo {formatCurrency(toCurrentMonthAmount(r), false)}
      </span>
      {/* The ranked automatic extra the forecast sends this target THIS month, beside the standing
          amount so the row reads "$510/mo + $1,107 extra this month" — Tre's own wording.
          ⚠️ Rendered only when there IS one. A "$0 extra this month" line states an absence as a
          figure, which he asked for explicitly never to appear. */}
      {(r.extraThisMonth ?? 0) > 0 && (
        <span
          className="text-xs sm:text-sm text-primary"
          title="On top of the standing transfer, the forecast diverts this much surplus to this goal in the current month."
        >
          + {formatCurrency(r.extraThisMonth ?? 0, false)} extra this month
        </span>
      )}
      {/* No extra THIS month, but one is coming. Says which month and how much rather than going
          silent — silence reads as "this never happens", and on his own data 40 of the next 60
          months carry one. Still never "$0 extra this month". */}
      {(r.extraThisMonth ?? 0) === 0 && r.nextExtra && (
        <span
          className="text-xs sm:text-sm text-muted-foreground"
          title="No surplus is being diverted to this goal in the current month. This is the next month the forecast sends one."
        >
          next: {formatCurrency(r.nextExtra.amount, false)} in {nextExtraMonthLabel(r.nextExtra.monthIndex, now)}
        </span>
      )}
    </div>

    {!isSyntheticRule(r) && (
      <div className="flex flex-wrap items-center gap-1">
        {r.rule_type === 'expense' && (
          <button
            onClick={() => toggleCostType(r)}
            title="Toggle fixed / variable"
            className={`text-xs px-1.5 py-0.5 border font-medium shrink-0 ${
              isFixedRule(r)
                ? 'bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20'
                : 'bg-gold/10 text-gold border-gold/30 hover:bg-gold/20'
            }`}
            style={{ borderRadius: 'var(--radius)' }}
          >
            {isFixedRule(r) ? 'Fixed' : 'Variable'}
          </button>
        )}
        <button onClick={() => handleDuplicate(r)} className="icon-btn text-muted-foreground hover:text-primary" title="Duplicate">
          <Copy size={13} />
        </button>
        <button onClick={() => toggleActive(r)} className="icon-btn text-muted-foreground hover:text-foreground">
          {r.active ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button onClick={() => openEdit(r)} className="icon-btn text-muted-foreground hover:text-foreground">
          <Edit2 size={13} />
        </button>
        <button
          onClick={() => handleDelete(r.id)}
          className={`icon-btn ${deleteConfirm === r.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}
        >
          <Trash2 size={13} />
        </button>
      </div>
    )}
  </div>
</div>
  );

  // profile carries pay config, which every paycheck figure on this page derives
  // from — without it the totals render against a default profile and then jump.
  if (accountsLoading || rulesLoading || profileLoading) return <BudgetSkeleton />;

  return (
    <div className={embedded ? 'stack-section overflow-x-hidden' : 'py-4 lg:py-6 max-w-6xl mx-auto stack-section overflow-x-hidden'}>
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-3">
        {!embedded && (
          <div className="min-w-0">
            {/* "Plan", not "Budget Control" (Tre, 2026-08-27). The file, the route alias and the
                guide key keep their old names — renaming those orphans bookmarks and saved
                guide keys for nothing; only what a user reads changes. */}
            <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">Plan</h1>
            <p className="text-sm text-muted-foreground mt-0.5 sm:mt-1">Your single source of truth for income, expenses, and automation</p>
          </div>
        )}
      </div>

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-3">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div>
              <p className="text-sm sm:text-base font-semibold text-foreground">Recurring rules — the engine behind every projection</p>
              <p className="text-sm text-muted-foreground mt-0.5">Everything you set here flows automatically into the Dashboard, Debt Payoff engine, and 60-month Forecast.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: 'Income rules', desc: 'Weekly paycheck ($1,462.50) + monthly roommate contribution ($900) define the take-home the debt engine works with.' },
              { label: 'Expense rules', desc: 'Rent, utilities, car insurance, groceries, gas — each rule auto-generates a transaction every month so nothing is missed.' },
              { label: 'CC-tagged expenses', desc: 'Groceries and subscriptions marked as credit card purchases feed the debt engine\'s monthly purchase tracking.' },
              { label: 'Transfer rules', desc: 'Emergency fund ($300/mo) and investments ($825/mo) move automatically — Forecast accounts for these before sizing debt payments.' },
            ].map((f, i) => (
              <div key={i} className="flex gap-2 p-2.5 bg-secondary/40 text-xs sm:text-sm" style={{ borderRadius: 'var(--radius)' }}>
                <span className="text-primary font-bold shrink-0">→</span>
                <div><span className="font-medium text-foreground">{f.label}: </span><span className="text-muted-foreground">{f.desc}</span></div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">All data is fictional.</p>
            <Link to="/auth" className="text-sm font-semibold text-primary hover:underline">Use with your own data →</Link>
          </div>
        </div>
      )}

      {/* Income & Taxes — auto-saves */}
      <div className="card-forged p-3 sm:p-5 space-y-3 sm:space-y-4">
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={() => setIncomeSectionCollapsed(!incomeSectionCollapsed)}
            className="flex items-center gap-2 text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider shrink-0 hover:text-foreground transition-colors"
          >
            <span className={`flex items-center justify-center w-5 h-5 rounded bg-secondary border border-border transition-colors ${!incomeSectionCollapsed ? 'border-primary/30 text-primary' : ''}`}>
              {incomeSectionCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
            </span>
            Income & Taxes
          </button>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end min-w-0">
            {incomeRules.length > 0 && (
              <div className="flex w-full items-center gap-1 sm:w-auto">
                <span className="text-xs text-muted-foreground uppercase shrink-0">Rule:</span>
                <select
                  value={paycheckRuleId ?? ''}
                  onChange={e => {
                    const id = e.target.value || null;
                    setPaycheckRuleId(id);
                    updateProfile.mutate({ paycheck_rule_id: id });
                  }}
                  className="bg-secondary border border-border px-2 py-2 text-sm text-foreground w-full sm:w-auto min-w-0 sm:max-w-[130px]"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  <option value="">— none —</option>
                  {incomeRules.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            )}
            {autoSaveStatus === 'saving' && <span className="text-xs sm:text-sm text-muted-foreground animate-pulse">Saving…</span>}
            {autoSaveStatus === 'saved' && <span className="text-xs sm:text-sm text-success">✓ Saved</span>}
          </div>
        </div>

        {/* Collapsed summary — shows key info when section is folded */}
        {incomeSectionCollapsed && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground pt-1">
            <span>{freqLabel(payFrequency)} · Net: <span className="font-display font-bold text-success">{formatCurrency(paycheckNet, false)}</span></span>
            <span>Next: <span className="font-medium text-primary">{nextPayday.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span></span>
          </div>
        )}

        {!incomeSectionCollapsed && <>
        {/* Gross Income — prominent at top */}
        <div className="pb-3 border-b border-border">
          <label className="text-xs sm:text-sm text-muted-foreground uppercase">Gross Income (per paycheck)</label>
          <input type="number" value={weeklyGrossInput} onChange={e => setWeeklyGrossInput(e.target.value)} onBlur={handleWeeklyGrossBlur}
            className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} />
        </div>

        {/* Paycheck Deductions */}
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              onClick={() => setDeductionsCollapsed(!deductionsCollapsed)}
              className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
            >
              <span className={`flex items-center justify-center w-5 h-5 rounded bg-secondary border border-border transition-colors ${!deductionsCollapsed ? 'border-primary/30 text-primary' : ''}`}>
                {deductionsCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </span>
              Paycheck Deductions
            </button>
            <button
              onClick={() => setShowCatalog(true)}
              className="shrink-0 flex items-center gap-1 text-xs sm:text-sm text-primary border border-primary/30 px-2 py-1 hover:bg-primary/5 transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <Plus size={10} /> Add Deduction
            </button>
          </div>

          {!deductionsCollapsed && <>
          {/* Deduction rows — grouped by type */}
          {/* The ref access the rule reports is transitive and legitimate: this block reads no
              ref itself, but the row handlers it builds call doAutoSave(), which touches
              profileLoaded/autoSaveTimer — inside an event handler, where refs belong. The rule
              attributes that to the IIFE because the IIFE itself runs during render.
              TODO: extracting this 100+ line block into its own component would remove the
              attribution properly; deferred as a refactor rather than folded into a lint pass. */}
          {/* eslint-disable-next-line react-hooks/refs */}
          {(() => {
            const isCatalogItem = (label: string) => DEDUCTION_CATALOG.some(c => c.label.toLowerCase() === label.toLowerCase());
            const getGroup = (label: string): string => {
              const l = label.toLowerCase();
              if (DEDUCTION_CATALOG.slice(0, 7).some(c => c.label.toLowerCase() === l)) return 'Benefits';
              if (DEDUCTION_CATALOG.slice(7, 13).some(c => c.label.toLowerCase() === l)) return 'Retirement & Savings';
              if (DEDUCTION_CATALOG.slice(13, 17).some(c => c.label.toLowerCase() === l)) return 'Taxes';
              if (DEDUCTION_CATALOG.slice(17).some(c => c.label.toLowerCase() === l)) return 'Other';
              return 'Custom';
            };
            const groupOrder = ['Taxes', 'Benefits', 'Retirement & Savings', 'Other', 'Custom'];
            const grouped: Record<string, typeof deductionAmounts> = {};
            for (const d of deductionAmounts) {
              const g = getGroup(d.label);
              if (!grouped[g]) grouped[g] = [];
              grouped[g].push(d);
            }
            const retirementAccounts = accounts.filter(a => a.active && ['brokerage', 'roth_ira', '401k'].includes(a.account_type));
            return groupOrder.filter(g => grouped[g]?.length).map(group => (
              <div key={group} className="space-y-0">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-0.5 pt-2 pb-0.5">{group}</p>
                <div className="grid grid-cols-2 gap-2">
                  {grouped[group].map(d => {
              const isRetirement = /401|403|roth|ira/i.test(d.label);
              const isTaxItem = TAX_CATALOG_LABELS.has(d.label.toLowerCase());
              const fromCatalog = isCatalogItem(d.label);
              return (
                <div key={d.id} className="border border-border/40 p-2 space-y-1.5 min-w-0" style={{ borderRadius: 'var(--radius)' }}>
                  {/* Label + remove */}
                  <div className="flex items-start justify-between gap-1">
                    {fromCatalog ? (
                      <span className="flex-1 min-w-0 text-xs font-semibold text-foreground leading-tight">{d.label}</span>
                    ) : (
                      <input
                        type="text"
                        value={d.label}
                        onChange={e => updateDeduction(d.id, { label: e.target.value })}
                        className="flex-1 min-w-0 bg-transparent text-xs font-semibold text-foreground outline-hidden border-b border-transparent hover:border-border focus:border-primary transition-colors"
                      />
                    )}
                    <button onClick={() => removeDeduction(d.id)} className="text-muted-foreground hover:text-destructive shrink-0 p-1.5 -mr-1.5"><X size={14} /></button>
                  </div>
                  {/* Value input */}
                  <input
                    type="number" min={0} max={d.mode === 'pct' ? 100 : undefined} step={d.mode === 'pct' ? 0.5 : 1}
                    value={dedDisplayValues[d.id] ?? String(d.value)}
                    onChange={e => setDedDisplayValues(prev => ({ ...prev, [d.id]: e.target.value }))}
                    onBlur={e => { const v = parseFloat(e.target.value); const n = isNaN(v) ? 0 : v; setDedDisplayValues(prev => ({ ...prev, [d.id]: String(n) })); updateDeduction(d.id, { value: n }); }}
                    className="w-full bg-secondary border border-border px-2 py-1.5 text-sm text-foreground font-display font-bold text-right min-w-0"
                    style={{ borderRadius: 'var(--radius)' }}
                  />
                  {/* $/% toggle */}
                  <div className="flex gap-1">
                    <button onClick={() => updateDeduction(d.id, { mode: 'flat' })} className={`flex-1 text-xs py-0.5 border transition-colors ${d.mode === 'flat' ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary text-muted-foreground border-border'}`} style={{ borderRadius: 'var(--radius)' }}>$</button>
                    <button onClick={() => updateDeduction(d.id, { mode: 'pct' })} className={`flex-1 text-xs py-0.5 border transition-colors ${d.mode === 'pct' ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary text-muted-foreground border-border'}`} style={{ borderRadius: 'var(--radius)' }}>%</button>
                  </div>
                  {/* Pre/post-tax toggle */}
                  {!isTaxItem && (
                    <div className="flex gap-1">
                      <button onClick={() => updateDeduction(d.id, { preTax: true })} className={`flex-1 text-xs py-0.5 border transition-colors ${d.preTax ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary text-muted-foreground border-border'}`} style={{ borderRadius: 'var(--radius)' }}>Pre</button>
                      <button onClick={() => updateDeduction(d.id, { preTax: false })} className={`flex-1 text-xs py-0.5 border transition-colors ${!d.preTax ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary text-muted-foreground border-border'}`} style={{ borderRadius: 'var(--radius)' }}>Post</button>
                    </div>
                  )}
                  {/* Resolved amount hint */}
                  {d.value > 0 && (
                    <p className="text-xs text-muted-foreground text-right">
                      {d.mode === 'pct' ? formatCurrency(d.flatAmt, false) : `${paycheckGross > 0 ? ((d.value / paycheckGross) * 100).toFixed(1) : '0'}%`}
                    </p>
                  )}
                  {/* Retirement account + goal link */}
                  {isRetirement && (
                    <div className="space-y-1 pt-0.5 min-w-0">
                      {retirementAccounts.length > 0 && (
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="text-xs text-muted-foreground shrink-0">Acct:</span>
                          <select
                            value={d.accountId ?? ''}
                            onChange={e => updateDeduction(d.id, { accountId: e.target.value || undefined })}
                            className="flex-1 min-w-0 bg-secondary border border-border px-1 py-0.5 text-xs text-foreground"
                            style={{ borderRadius: 'var(--radius)' }}
                          >
                            <option value="">— none —</option>
                            {retirementAccounts.map(a => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {savingsGoals.length > 0 && (
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="text-xs text-muted-foreground shrink-0">Goal:</span>
                          <select
                            value={d.goalId ?? ''}
                            onChange={e => updateDeduction(d.id, { goalId: e.target.value || undefined })}
                            className="flex-1 min-w-0 bg-secondary border border-border px-1 py-0.5 text-xs text-foreground"
                            style={{ borderRadius: 'var(--radius)' }}
                          >
                            <option value="">— none —</option>
                            {savingsGoals.map(g => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {d.goalId && d.value > 0 && (
                        <p className="text-xs text-success">
                          {formatCurrency(Math.round(d.flatAmt * (payFrequency === 'biweekly' ? 26 : payFrequency === 'monthly' ? 12 : 52) / 12 * 100) / 100, false)}/mo → goal
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
                </div>
              </div>
            ));
          })()}

          {/* Totals summary */}
          {(preTaxDeductionsFlat + postTaxDeductionsFlat) > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs sm:text-sm pt-1">
              {preTaxDeductionsFlat > 0 && <span className="text-primary">−{formatCurrency(preTaxDeductionsFlat, false)} pre-tax <span className="text-success">(saves {formatCurrency(preTaxDeductionsFlat * (taxRate / 100), false)} tax)</span></span>}
              {postTaxDeductionsFlat > 0 && <span className="text-gold">−{formatCurrency(postTaxDeductionsFlat, false)} post-tax</span>}
            </div>
          )}
          {/* Gross → Net breakdown */}
          {(preTaxDeductionsFlat + postTaxDeductionsFlat) > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-xs sm:text-sm text-muted-foreground pt-1">
              <span className="font-medium text-foreground">{formatCurrency(paycheckGross, false)}</span>
              {preTaxDeductionsFlat > 0 && <><span className="text-primary">−{formatCurrency(preTaxDeductionsFlat, false)} pre-tax</span><span>→</span><span className="font-medium text-foreground">{formatCurrency(paycheckGross - preTaxDeductionsFlat, false)} taxable</span></>}
              {!hasTaxDeductions && <span>× {(100 - taxRate).toFixed(0)}%</span>}
              {postTaxDeductionsFlat > 0 && <><span className="text-gold">−{formatCurrency(postTaxDeductionsFlat, false)} post-tax</span></>}
              <span>→</span>
              <span className="font-display font-bold text-success">{formatCurrency(paycheckNet, false)} net</span>
            </div>
          )}
          {/* 401k per-paycheck breakdown — used by Forecast to compute remaining contributions this month */}
          {retire401kPerCheck > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground pt-1 border-t border-border/40 mt-1">
              <span className="font-medium text-foreground">401(k)/retirement: {formatCurrency(retire401kPerCheck, false)}/paycheck</span>
              <span>·</span>
              <span>{remainingPaychecks.length} paycheck{remainingPaychecks.length !== 1 ? 's' : ''} left this month</span>
              <span>→</span>
              <span className="font-medium text-foreground">{formatCurrency(retire401kPerCheck * remainingPaychecks.length, false)} remaining contribution this month</span>
            </div>
          )}
          </>}
        </div>

        {/* Income inputs — frequency, tax rate, payday */}
        <div className="pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="text-xs sm:text-sm text-muted-foreground uppercase">Pay Frequency</label>
            <select value={payFrequency} onChange={e => setPayFrequencyAuto(e.target.value as PayFrequency)}
              className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground" style={{ borderRadius: 'var(--radius)' }}>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          {hasTaxDeductions ? (
            <div className="flex flex-col justify-end">
              <p className="text-xs text-muted-foreground italic">Tax Rate hidden — using withholding deductions above</p>
            </div>
          ) : (
            <div>
              <label className="text-xs sm:text-sm text-muted-foreground uppercase">Tax Rate (%)</label>
              <input type="number" value={taxRateStr}
                onChange={e => setTaxRateStr(e.target.value)}
                onBlur={() => { const v = parseFloat(taxRateStr); const n = isNaN(v) ? 0 : v; setTaxRateStr(String(n)); setTaxRateAuto(n); }}
                className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} />
            </div>
          )}
          <div>
            <label className="text-xs sm:text-sm text-muted-foreground uppercase">{payFrequency === 'monthly' ? 'Pay Day of Month' : 'Paycheck Day'}</label>
            {payFrequency === 'monthly' ? (
              <input type="number" min={1} max={31} value={paycheckDay} onChange={e => setPaycheckDayAuto(parseInt(e.target.value) || 1)}
                className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} />
            ) : (
              <select value={paycheckDay} onChange={e => setPaycheckDayAuto(parseInt(e.target.value))}
                className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground" style={{ borderRadius: 'var(--radius)' }}>
                {[0,1,2,3,4,5,6].map(d => <option key={d} value={d}>{getDayName(d)}</option>)}
              </select>
            )}
          </div>
          <div className="flex flex-col justify-end">
            <p className="text-sm text-muted-foreground uppercase flex items-center gap-1"><CalendarDays size={10} /> Next Paycheck</p>
            <p className="text-sm font-display font-bold text-primary mt-1">{nextPayday.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2 border-t border-border">
          <div className="card-forged p-3 text-left">
  <p className="text-xs sm:text-sm text-muted-foreground">Per Paycheck (Net)</p>
  <p className="mt-1 text-base sm:text-lg font-display font-bold text-success wrap-break-word">
    {formatCurrency(paycheckNet, false)}
  </p>
</div>

<div className="card-forged p-3 text-left">
  <p className="text-xs sm:text-sm text-muted-foreground">Monthly Gross</p>
  <p className="mt-1 text-base sm:text-lg font-display font-bold text-foreground wrap-break-word">
    {formatCurrency(monthlyGross, false)}
  </p>
</div>

<div className="card-forged p-3 text-left">
  <p className="text-xs sm:text-sm text-muted-foreground">Monthly Take-Home</p>
  <p className="mt-1 text-base sm:text-lg font-display font-bold text-success wrap-break-word">
    {formatCurrency(monthlyTakeHome, false)}
  </p>
</div>

<div className="card-forged p-3 text-left">
  <p className="text-xs sm:text-sm text-muted-foreground">Annual Gross</p>
  <p className="mt-1 text-base sm:text-lg font-display font-bold text-foreground wrap-break-word">
    {formatCurrency(annualGross, false)}
  </p>
</div>

<div className="card-forged p-3 text-left">
  <p className="text-xs sm:text-sm text-muted-foreground">Annual Take-Home</p>
  <p className="mt-1 text-base sm:text-lg font-display font-bold text-success wrap-break-word">
    {formatCurrency(annualTakeHome, false)}
  </p>
</div>
      </div>
        </>}
      </div>

      {/* The rules the bank history implies, for a user who has linked something since setting up.
          Renders NOTHING when there is nothing to offer — never a "0 patterns" card, and never a
          badge: it is an offer that sits on the page the rules live on, not a nag. */}
      <RulesFoundCard />

      {/* The seven KPI tiles that stood here MOVED TO THE DASHBOARD on 2026-08-27 (Tre: "i
          wanted these moved to dashboard") and are `BudgetTotalsCard`, which reads the same
          `useBudgetMonthTotals` this page now reads. The eighth, Remaining Cash, was DELETED
          rather than moved: it was `debtSafeToPay`, which the Dashboard already shows as SAFE
          TO PAY. The allocation donut below divides up the same five totals and stays here. */}


      {/* Budget Allocation Bar — current month only, distinct colors */}
      <div className="card-forged p-5">
        <h3 className="text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider mb-1">Budget Allocation</h3>
        <p className="text-sm text-muted-foreground mb-4">{now.toLocaleString('en-US', { month: 'long', year: 'numeric' })} — current month only</p>
        {(() => {
          const { fixedPct, variablePct, debtPct, xferPct, remPct, overByPct } = getBudgetAllocationShares({
            income: totalRecurringIncome,
            fixed: totalFixedExpenses,
            variable: totalVariableExpenses,
            debt: totalDebtPayments,
            transfers: totalTransfers,
            remaining,
          });
          const R = 15.91549430918954;
          const seg = (pct: number, offset: number, color: string) => {
            const drawn = clipSegment(pct, offset);
            return drawn > 0 ? (
              <circle
                cx="18" cy="18" r={R}
                fill="transparent"
                stroke={color}
                strokeWidth="3.5"
                strokeDasharray={`${drawn} ${100 - drawn}`}
                strokeDashoffset={-offset}
              />
            ) : null;
          };
          return (
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <svg viewBox="0 0 36 36" className="w-32 h-32 shrink-0 -rotate-90">
                <circle cx="18" cy="18" r={R} fill="transparent" stroke="hsl(var(--secondary))" strokeWidth="3.5" />
                {seg(fixedPct,    0,                                          'hsl(0, 65%, 45%)'  )}
                {seg(variablePct, fixedPct,                                   'hsl(35, 85%, 50%)' )}
                {seg(debtPct,     fixedPct + variablePct,                     'hsl(210, 70%, 50%)')}
                {seg(xferPct,     fixedPct + variablePct + debtPct,           'hsl(280, 60%, 55%)')}
                {seg(remPct,      fixedPct + variablePct + debtPct + xferPct, 'hsl(142, 50%, 40%)')}
              </svg>
              <div className="min-w-0">
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs sm:text-sm text-muted-foreground">
                  {[
                    { label: 'Fixed',     pct: fixedPct,    color: 'hsl(0, 65%, 45%)'   },
                    { label: 'Variable',  pct: variablePct, color: 'hsl(35, 85%, 50%)'  },
                    { label: 'Debt',      pct: debtPct,     color: 'hsl(210, 70%, 50%)' },
                    { label: 'Transfers', pct: xferPct,     color: 'hsl(280, 60%, 55%)' },
                    { label: 'Remaining', pct: remPct,      color: 'hsl(142, 50%, 40%)' },
                  ].map(({ label, pct, color }) => (
                    <div key={label} className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
                      <span className={`truncate ${pct < 0 ? 'text-destructive font-medium' : ''}`}>{label} ({pct.toFixed(0)}%)</span>
                    </div>
                  ))}
                </div>
                {overByPct > 0 && (
                  <p className="mt-3 text-xs sm:text-sm text-destructive font-medium">
                    Over budget by {overByPct.toFixed(0)}% of income ({formatCurrency(Math.abs(remaining), false)}/mo more allocated than you take home).
                  </p>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Tabbed Rule Management */}
      <Tabs defaultValue="income" className="space-y-4">
        <TabsList className="grid grid-cols-3 sm:flex sm:flex-wrap bg-secondary border border-border h-auto gap-1 p-1 w-full">
          <TabsTrigger value="income" className="text-xs sm:text-sm data-[state=active]:bg-background whitespace-normal text-center leading-tight py-2">
            Income ({incomeRules.length})
          </TabsTrigger>
          <TabsTrigger value="fixed" className="text-xs sm:text-sm data-[state=active]:bg-background whitespace-normal text-center leading-tight py-2">
            Fixed ({billsRules.length})
          </TabsTrigger>
          <TabsTrigger value="subscriptions" className="text-xs sm:text-sm data-[state=active]:bg-background whitespace-normal text-center leading-tight py-2">
            Subs ({subscriptionRules.length})
          </TabsTrigger>
          <TabsTrigger value="variable" className="text-xs sm:text-sm data-[state=active]:bg-background whitespace-normal text-center leading-tight py-2">
            Variable ({variableRules.length})
          </TabsTrigger>
          <TabsTrigger value="debt" className="text-xs sm:text-sm data-[state=active]:bg-background whitespace-normal text-center leading-tight py-2">
            Debt ({debtRules.length})
          </TabsTrigger>
          <TabsTrigger value="transfers" className="text-xs sm:text-sm data-[state=active]:bg-background whitespace-normal text-center leading-tight py-2">
            Transfers ({transferRules.length})
          </TabsTrigger>
        </TabsList>

        {/* §1B Stage 7B — rules the bank has been contradicting for months. Above the tabs rather
            than inside one because a drifting rule can be in any of them, and the whole point is
            that it has gone unnoticed; putting it behind the right tab would keep it unnoticed. */}
        <RuleDriftPanel />

        <TabsContent value="income">
          <div className="card-forged p-5 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider">Income Rules</h3>
              <div className="flex items-center gap-3">
                <span className="text-sm sm:text-base font-display font-bold text-success">{formatCurrency(totalRecurringIncome, false)}/mo</span>
                <button onClick={() => openAdd('income')} className="flex items-center gap-1 text-xs sm:text-sm text-primary font-medium hover:underline"><Plus size={10} /> Add Income</button>
              </div>
            </div>
            {incomeRules.length === 0 && <p className="text-sm text-muted-foreground">No income rules. Add one to auto-generate paychecks.</p>}
            {incomeRules.map(r => <RuleRow key={r.id} r={r} color="text-success" />)}
          </div>
        </TabsContent>

        <TabsContent value="fixed">
          <div className="card-forged p-5 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider">Fixed Expenses</h3>
              <div className="flex items-center gap-3">
                <span className="text-sm sm:text-base font-display font-bold text-destructive">{formatCurrency(billsRules.filter(r => r.active).reduce((s, r) => s + toCurrentMonthAmount(r), 0), false)}/mo</span>
                <button onClick={() => openAdd('expense', 'Bills')} className="flex items-center gap-1 text-xs sm:text-sm text-primary font-medium hover:underline"><Plus size={10} /> Add Fixed</button>
              </div>
            </div>
            {billsRules.length === 0 && <p className="text-sm text-muted-foreground">No fixed expenses.</p>}
            {billsRules.map(r => <RuleRow key={r.id} r={r} />)}
          </div>
        </TabsContent>

        <TabsContent value="subscriptions">
          <div className="card-forged p-5 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider">Subscriptions</h3>
              <div className="flex items-center gap-3">
                <span className="text-sm sm:text-base font-display font-bold text-destructive">{formatCurrency(subscriptionRules.filter(r => r.active).reduce((s, r) => s + toCurrentMonthAmount(r), 0), false)}/mo</span>
                <button onClick={() => openAdd('expense', 'Subscriptions')} className="flex items-center gap-1 text-xs sm:text-sm text-primary font-medium hover:underline"><Plus size={10} /> Add Subscription</button>
              </div>
            </div>
            {subscriptionRules.length === 0 && <p className="text-sm text-muted-foreground">No subscriptions. Rules with category "Subscriptions" appear here.</p>}
            {subscriptionRules.map(r => <RuleRow key={r.id} r={r} />)}
          </div>
        </TabsContent>

        <TabsContent value="variable">
          <div className="card-forged p-5 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider">Variable Expenses</h3>
              <div className="flex items-center gap-3">
                <span className="text-sm sm:text-base font-display font-bold" style={{ color: 'hsl(35, 85%, 50%)' }}>{formatCurrency(totalVariableExpenses, false)}/mo</span>
                <button onClick={() => openAdd('expense', 'Other')} className="flex items-center gap-1 text-xs sm:text-sm text-primary font-medium hover:underline"><Plus size={10} /> Add Variable</button>
              </div>
            </div>
            {variableRules.length === 0 && <p className="text-sm text-muted-foreground">No variable expenses.</p>}
            {variableRules.map(r => <RuleRow key={r.id} r={r} color="text-foreground" />)}
          </div>
        </TabsContent>

        <TabsContent value="debt">
          <div className="card-forged p-5 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2"><CreditCard size={12} /> Debt Payments</h3>
              <div className="flex items-center gap-3">
                <span className="text-sm sm:text-base font-display font-bold text-destructive">{formatCurrency(totalDebtPayments, false)}/mo</span>
                <button onClick={() => openAdd('debt_payment', 'Debt Payments')} className="flex items-center gap-1 text-xs sm:text-sm text-primary font-medium hover:underline"><Plus size={10} /> Add Payment</button>
              </div>
            </div>
            {debtRules.length === 0 && <p className="text-sm text-muted-foreground">No debt payments. Add credit card accounts and visit Debt Payoff to generate recommendations.</p>}
            {debtRules.map(r => <RuleRow key={r.id} r={r} />)}
            {(debtPaymentRules.length > 0 || liabilityPaymentRules.length > 0) && (
              <p className="text-xs text-muted-foreground pt-2 border-t border-border/30">
                Items tagged "from payoff" are auto-synced: cards from the Debt Payoff Planner's recommendations,
                vehicle loans from the Vehicles page, and other loans from their liability accounts.
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="transfers">
          <div className="card-forged p-5 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2"><ArrowLeftRight size={12} /> Transfers & Investing</h3>
              <div className="flex items-center gap-3">
                <span className="text-sm sm:text-base font-display font-bold text-primary">{formatCurrency(totalTransfers, false)}/mo</span>
                <button onClick={() => openAdd('investment')} className="flex items-center gap-1 text-xs sm:text-sm text-primary font-medium hover:underline"><Plus size={10} /> Add Transfer</button>
              </div>
            </div>
            {transferRules.length === 0 && <p className="text-sm text-muted-foreground">No transfers or investment contributions configured.</p>}
            {transferRules.map(r => <RuleRow key={r.id} r={r} color="text-primary" />)}
            {goalTransferRules.length > 0 && (
              <p className="text-xs text-muted-foreground pt-2 border-t border-border/30">
                Items tagged "from goal" are a savings goal's own monthly contribution — edit them on Savings Goals.
                Any "extra this month" is surplus the forecast diverts on top, and is not counted in the total above.
              </p>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {showForm && (
        <FormModal
          title={editId ? 'Edit Rule' : 'Add Rule'}
          fields={formFields}
          values={form}
          onChange={(k, v) => setForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSave}
          draftRestored={draftRestored}
          onDiscardDraft={handleDiscardDraft}
          onClose={() => { setShowForm(false); setEditId(null); }}
          saving={addRule.isPending || updateRule.isPending}
          saveLabel={editId ? 'Update Rule' : 'Add Rule'}
        />
      )}

      {/* Catalog picker modal */}
      {showCatalog && (() => {
        const usedLabels = new Set(deductions.map(d => d.label.toLowerCase()));
        const CatalogBtn = ({ item }: { item: typeof DEDUCTION_CATALOG[number] }) => {
          const used = usedLabels.has(item.label.toLowerCase());
          return (
            <button
              key={item.label}
              onClick={() => !used && addDeductionFromCatalog(item)}
              disabled={used}
              className={`text-xs sm:text-sm px-2 py-1 border transition-colors ${used ? 'border-border bg-secondary text-muted-foreground opacity-40 cursor-not-allowed' : 'border-border bg-secondary hover:bg-primary/10 hover:border-primary/40 text-foreground'}`}
              style={{ borderRadius: 'var(--radius)' }}
              title={used ? 'Already added' : undefined}
            >
              {item.label}
            </button>
          );
        };
        return (
        <div className="modal-overlay bg-background/80 z-50" onClick={() => { setShowCatalog(false); setCustomLabel(''); }}>
          <div className="card-forged p-5 w-full max-w-md space-y-4 max-h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-display font-semibold text-sm">Add Deduction</h2>
              <button onClick={() => { setShowCatalog(false); setCustomLabel(''); }} className="icon-btn text-muted-foreground hover:text-foreground"><X size={16} /></button>
            </div>

            {/* Benefits */}
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Benefits</p>
              <div className="flex flex-wrap gap-1.5">
                {DEDUCTION_CATALOG.slice(0, 7).map(item => <CatalogBtn key={item.label} item={item} />)}
              </div>
            </div>

            {/* Retirement & Savings */}
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Retirement & Savings</p>
              <div className="flex flex-wrap gap-1.5">
                {DEDUCTION_CATALOG.slice(7, 13).map(item => <CatalogBtn key={item.label} item={item} />)}
              </div>
            </div>

            {/* Taxes */}
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Taxes</p>
              <div className="flex flex-wrap gap-1.5">
                {DEDUCTION_CATALOG.slice(13, 17).map(item => <CatalogBtn key={item.label} item={item} />)}
              </div>
            </div>

            {/* Other */}
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Other</p>
              <div className="flex flex-wrap gap-1.5">
                {DEDUCTION_CATALOG.slice(17).map(item => <CatalogBtn key={item.label} item={item} />)}
              </div>
            </div>

            {/* Custom */}
            <div className="space-y-1.5 pt-2 border-t border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Custom</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Deduction name…"
                  value={customLabel}
                  onChange={e => setCustomLabel(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && customLabel.trim()) {
                      addDeductionFromCatalog({ label: customLabel.trim(), mode: 'flat', preTax: false });
                    }
                  }}
                  className="flex-1 bg-secondary border border-border px-3 py-1.5 text-sm sm:text-base text-foreground"
                  style={{ borderRadius: 'var(--radius)' }}
                />
                <button
                  onClick={() => { if (customLabel.trim()) addDeductionFromCatalog({ label: customLabel.trim(), mode: 'flat', preTax: false }); }}
                  disabled={!customLabel.trim()}
                  className="btn btn-md btn-primary sm:text-sm"
                >
                  Add
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Custom deductions default to flat $ post-tax — adjust after adding.</p>
            </div>
          </div>
        </div>
        );
      })()}

    </div>
  );
}
