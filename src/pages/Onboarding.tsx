// The ONE onboarding flow.
//
// Until 2026-08-14 there were three overlapping surfaces: this route (7 manual steps, gated by a
// localStorage key, no way to link a bank), a modal wizard on the Dashboard (gated by
// `profiles.onboarding_completed`, WITH bank connect for premium), and the Dashboard checklist.
// Finishing one left the others convinced you had never started. The modal's steps now live here —
// bank connect first for premium, its upsell pre-step for free — the modal is deleted, and
// completion is recorded in one place (`src/lib/onboarding-state.ts`). The checklist stays: it is a
// nudge, not a flow, and it reads the same store.

import { PREMIUM_MAX_LINKED } from '@/lib/plan-limits';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import { onboardingQueryKey } from '@/hooks/useOnboardingStatus';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { filterProfanity, LIMITS } from '@/lib/content-filter';
import { readReferral, clearReferral, resolveReferrerForSignup } from '@/lib/referral';
import { attributionColumnsForSignup } from '@/lib/attribution';
import {
  markOnboardingComplete,
  type OnboardingCompletionPath,
  readOnboardingCache,
  recordCurrentReleaseSeen,
  boundedWrite,
  SAVE_TIMEOUT_MESSAGE,
  writeOnboardingCache,
} from '@/lib/onboarding-state';
import {
  clearOnboardingDraft,
  readOnboardingDraft,
  readOnboardingStep,
  writeOnboardingStep,
  writeOnboardingDraft,
} from '@/lib/onboarding-draft';
import BankConnectStep, { BankLinkedHint } from '@/components/onboarding/BankConnectStep';
import ReferenceAccountButton from '@/components/shared/ReferenceAccountButton';
import RulesFoundCard from '@/components/rules/RulesFoundCard';
import PremiumUpsellStep from '@/components/onboarding/PremiumUpsellStep';
import DebtsStep from '@/components/onboarding/DebtsStep';
import GoalsStep from '@/components/onboarding/GoalsStep';
import { FieldLabel, Input, Select } from '@/components/onboarding/fields';
import { totalDebtOf, type DebtEntry, type GoalEntry } from '@/components/onboarding/types';
import {
  DollarSign, PiggyBank, ChevronRight,
  ChevronLeft, Check, Crown, Zap, BarChart3, Shield, Loader2, Fingerprint, Users,
} from 'lucide-react';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { Capacitor } from '@capacitor/core';
import { firstRunNavSummary } from '@/lib/first-run-nav';
import { canAddTransactions } from '@/lib/manual-entry-gate';
import { recordFirstWeekStep } from '@/lib/first-week-funnel';
import { paydayColumns, quickSetupReady, quickCardAccount } from '@/lib/quick-setup';
import { isCardEntry, cardAccountFromEntry, planCardAccountWrites, type CardAccountInsert, type ExistingCardAccount } from '@/lib/wizard-card-accounts';

type Step = 'quick' | 'welcome' | 'bank' | 'premium' | 'income' | 'expenses' | 'debts' | 'savings' | 'goals' | 'finish';

/**
 * THE FAST PATH (2026-10-09, Tre via Sam: 5 signups in 90 days, the latest quit on the FIRST screen).
 * A new user starts on ONE screen asking only what Safe to Spend and the payoff date need, saves, and
 * lands on Home with a real number; the rest is "finish later" on Home (OnboardingChecklist). The full
 * wizard below is unchanged and one tap away ("Set up step by step"), or `/onboarding?full=1`.
 * Its own funnel order, so `furthestStepPatch` can rank it: a fast finisher records 'quick'.
 */
const QUICK_STEPS: readonly Step[] = ['quick'];

/** The steps that ask for numbers by hand — the ones a linked bank makes optional. */
const MANUAL_STEPS: Step[] = ['income', 'expenses', 'debts', 'savings', 'goals'];
// Steps after income where a user without a bank may save what they have and finish later. Not
// income (the plan needs it) and not goals (its own button already saves).
const SAVE_EARLY_STEPS: Step[] = ['expenses', 'debts', 'savings'];

/**
 * The steps a reload may reopen on (ask b3f0bbcc). Never 'premium' or 'finish': both come after the
 * save, which clears the resume point, and reopening on either would claim a save nobody made.
 */
const RESUMABLE_STEPS: readonly Step[] = ['quick', 'welcome', 'bank', ...MANUAL_STEPS];
/** No stored step opens the FAST screen; `full` (the `?full=1` entry) opens the old wizard's Welcome. */
export function resumeStep(stored: string | null, full = false): Step {
  if ((RESUMABLE_STEPS as readonly string[]).includes(stored ?? '') && !(full && stored === 'quick')) return stored as Step;
  return full ? 'welcome' : 'quick';
}

/**
 * EVERY tier is asked to link a bank second (ask 2fb9bc69, Tre 10-06: "look for more to copy/improve
 * from our competitors. onboarding"). Copilot, Monarch and YNAB all lead with the bank link and build
 * the budget from history; ours already does that (RulesFoundCard) but showed it to premium only.
 * The first link has been free since 2026-09-06 (plaid-create-link-token: 200 + link_token for a
 * free account, measured 2026-10-06), so the old reason - "linking is what premium buys" - is gone.
 * Free accounts still see the premium pitch, one step before the finish, so nothing was removed.
 */
export function buildSteps(isPremium: boolean): Step[] {
  return isPremium
    ? ['welcome', 'bank', ...MANUAL_STEPS, 'finish']
    : ['welcome', 'bank', ...MANUAL_STEPS, 'premium', 'finish'];
}

/**
 * WHERE PEOPLE STOP, recorded as they go.
 *
 * Tre, 2026-09-02: onboarding is about value rather than a feature tour, and CONVERSION IS THE
 * METRIC. `onboarding_completed` is a boolean, so it can only answer "how many finished" — the
 * actionable question, WHICH STEP loses them, had no data behind it at all.
 *
 * ⚠️ MONOTONIC, AND THAT IS THE POINT. Pressing Back must never lower the recorded step: the
 * question is how FAR someone got, not where their cursor is now. A last-position field would say
 * a user who reached Goals and stepped back to check their income "stopped at income", which is
 * the opposite of true and would send the next redesign at the wrong screen.
 *
 * ⚠️ FIRE AND FORGET, DELIBERATELY. A failed write must never block or slow the wizard — losing a
 * funnel data point costs a statistic; making someone wait on it during signup costs the signup,
 * which is the very thing being measured. Errors are swallowed for that reason and no other.
 *
 * This writes nothing about a person that they have not already given us, on their own row. An
 * event stream would be a new category of collection needing its own consent, to answer a question
 * two columns already answer.
 */
export function furthestStepPatch(
  seen: string | null,
  startedAt: string | null,
  step: Step,
  stepOrder: readonly Step[],
  now: () => string = () => new Date().toISOString(),
): { onboarding_furthest_step?: string; onboarding_started_at?: string } | null {
  // Compared by POSITION IN THIS USER'S OWN FLOW, not alphabetically and not against a global
  // list: free and premium accounts see a different second step, so "further" only means anything
  // inside the sequence this user is actually walking.
  const seenIdx = seen ? stepOrder.indexOf(seen as Step) : -1;
  const nextIdx = stepOrder.indexOf(step);
  const patch: { onboarding_furthest_step?: string; onboarding_started_at?: string } = {};
  // An UNRECOGNISED stored value gives seenIdx -1, which would let any step overwrite it. That is
  // the right direction: a value this flow does not contain cannot be a position within it.
  if (nextIdx >= 0 && nextIdx > seenIdx) patch.onboarding_furthest_step = step;
  if (!startedAt) patch.onboarding_started_at = now();
  return Object.keys(patch).length > 0 ? patch : null;
}

async function recordFurthestStep(userId: string, step: Step, stepOrder: readonly Step[]) {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('onboarding_furthest_step, onboarding_started_at')
      .eq('user_id', userId)
      .maybeSingle();

    const patch = furthestStepPatch(
      data?.onboarding_furthest_step ?? null,
      data?.onboarding_started_at ?? null,
      step,
      stepOrder,
    );
    if (!patch) return;

    await supabase.from('profiles').update(patch).eq('user_id', userId);
  } catch {
    // See above: a lost data point is cheaper than a stalled signup.
  }
}

const STEP_LABELS: Record<Step, string> = {
  quick:    'Quick start',
  welcome:  'Welcome',
  bank:     'Bank',
  premium:  'Premium',
  income:   'Income',
  expenses: 'Expenses',
  debts:    'Debts',
  savings:  'Savings',
  goals:    'Goals',
  finish:   'Your Plan',
};

interface OnboardingData {
  displayName: string;
  weeklyGross: string;
  taxRate: string;
  paycheckFrequency: string;
  monthlyRent: string;
  monthlyUtilities: string;
  monthlyGroceries: string;
  monthlySubscriptions: string;
  debts: DebtEntry[];
  savingsBalance: string;
  /** Manual checking balance, asked only when no bank was linked. It is what Safe to Spend starts from (2c1170b3). */
  checkingBalance?: string;
  /** Fast path: 'YYYY-MM-DD' of the next payday (sets paycheck_day / paycheck_start_date). */
  nextPayday?: string;
  /** Fast path: one credit card, saved as a credit-card ACCOUNT so the payoff date can compute. */
  cardBalance?: string;
  cardApr?: string;
  savingsApy: string;
  goals: GoalEntry[];
}

const DEFAULT_DATA: OnboardingData = {
  displayName: '',
  weeklyGross: '',
  taxRate: '22',
  paycheckFrequency: 'biweekly',
  monthlyRent: '',
  monthlyUtilities: '',
  monthlyGroceries: '',
  monthlySubscriptions: '',
  debts: [],
  savingsBalance: '',
  savingsApy: '4.5',
  goals: [],
};

function StepProgress({ step, steps }: { step: Step; steps: Step[] }) {
  const idx = steps.indexOf(step);
  const pct = (idx / (steps.length - 1)) * 100;
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[10px] text-muted-foreground overflow-hidden">
        {steps.slice(0, -1).map((s, i) => (
          <span key={s} className={`truncate ${i <= idx ? 'text-primary font-medium' : ''}`}>{STEP_LABELS[s]}</span>
        ))}
      </div>
      <div className="h-1 bg-secondary rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function getInitialDisplayName(meta: Record<string, unknown> | undefined): string {
  if (!meta) return '';
  if (meta.given_name) return meta.given_name as string;
  if (meta.name) return (meta.name as string).split(' ')[0];
  if (meta.display_name) return meta.display_name as string;
  return '';
}

/**
 * Should the wizard send this account straight to the dashboard?
 *
 * EXTRACTED SO THE RULE CAN BE ASSERTED. It used to live inside a `useEffect`, where the only way
 * to test it was to render the whole page - so it was never tested, and a wrong answer here is
 * invisible until somebody signs up.
 *
 * WARNING: `display_name` IS DELIBERATELY IGNORED, and the parameter is kept ONLY so that stays
 * visible. Until 2026-09-15 a non-empty `display_name` meant "leave", on the reasoning that such
 * an account predated the flag. `Auth.tsx` sets `display_name` AT SIGNUP, so that tell stopped
 * separating a legacy account from a brand-new one, and new users were skipping setup entirely.
 *
 * A FAILED read is not a "no". It returns false, which leaves the user in the wizard - they can
 * skip in one tap - rather than waving through somebody who never onboarded.
 */
export function shouldLeaveOnboarding(
  data: { onboarding_completed?: boolean | null; display_name?: string | null } | null,
  error?: unknown,
): boolean {
  if (error || !data) return false;
  return data.onboarding_completed === true;
}

export default function Onboarding() {
  const { user } = useAuth();
  const { isPremium } = useSubscription();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(() => resumeStep(
    readOnboardingStep(user?.id),
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('full') === '1',
  ));
  // A draft is only ever this user's own unsent answers (`onboarding-draft.ts`), and it wins over
  // the metadata prefill: what they typed beats what the identity provider guessed. Read once, in
  // the initializer — `ProtectedRoute` has already resolved auth by the time this mounts.
  const [data, setData] = useState<OnboardingData>(() => ({
    ...DEFAULT_DATA,
    displayName: getInitialDisplayName(user?.user_metadata),
    ...(readOnboardingDraft<OnboardingData>(user?.id) ?? {}),
  }));
  const [saving, setSaving] = useState(false);
  // Monarch asks this first (ask d53dbbe1). The answer only decides whether the finish screen
  // points at partner sharing; nothing is stored, so "Just me" is the default and costs nothing.
  const [budgetFor, setBudgetFor] = useState<'solo' | 'partner'>('solo');
  const [bankLinked, setBankLinked] = useState(false);

  const steps = useMemo(() => buildSteps(isPremium), [isPremium]);
  // "Where things are" on the finish screen: derived from the nav, plus the quick-add pointer only
  // where the `+` adds (a free native account's `+` is a Premium door). Growth pass 2026-10-09.
  const navSummary = useMemo(() => firstRunNavSummary(), []);
  // Same rule as QuickAddContext's door and the Transactions button (folded 2026-10-09).
  const quickAddOpen = canAddTransactions({ isPremium, isDemo: false, isNative: Capacitor.isNativePlatform() });

  // Signal Swift cover that a post-auth page has mounted (same flag as Dashboard).
  // New users land here after OAuth sign-up; without this the cover waits the full
  // 6s fallback before dismissing.
  useEffect(() => {
    window.__forgenta_dashboard_ready = true;
    return () => { window.__forgenta_dashboard_ready = false; };
  }, []);

  // Auto-skip for accounts that are already set up. TWO ways that can be true: this device
  // remembers, or the profile flag says so.
  //
  // ⚠️ THERE USED TO BE A THIRD, AND IT WAS REMOVED 2026-09-15 ON TRE'S CALL. Any account
  // carrying a `display_name` was waved through and marked complete, on the reasoning that it
  // "predates the flag entirely and has profile data (display_name is the tell)". THAT PREMISE
  // STOPPED BEING TRUE: `Auth.tsx` sets `display_name` AT SIGNUP, so the tell no longer
  // distinguishes a legacy account from a brand-new one, and a new user who typed their name
  // never saw this wizard at all. Measured: an account created 2026-09-15 02:26 was waved
  // through at 13:45 the same day, 11 hours old. 9 accounts sat one visit from the same thing,
  // and every metric built on `onboarding_completed` was measuring HAVING A NAME - including the
  // PMF survey's eligibility gate.
  //
  // The cost of removing it is bounded and small: a genuinely legacy user is shown the wizard and
  // SKIPS IT IN ONE TAP, which is the trade the note below already called cheap. That skip is now
  // recorded as `skipped` rather than silently becoming `wizard`, so it stays legible.
  // DO NOT REINSTATE THIS ON A `display_name` TEST. If legacy accounts ever need waving through
  // again, the signal has to be something signup does not also produce.
  //
  // A FAILED read is not a "no": it leaves the user in the wizard, which they can skip in one tap,
  // rather than either trapping them or waving through someone who never onboarded.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const leave = () => { if (!cancelled) navigate('/dashboard', { replace: true }); };

    if (readOnboardingCache(user.id)) { leave(); return; }

    supabase.from('profiles').select('onboarding_completed').eq('user_id', user.id).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        // CALL THE EXPORTED RULE, do not restate it. Until 2026-09-15 this branch held its OWN copy
        // of the same condition, so `shouldLeaveOnboarding` had six passing assertions and NO
        // production caller - the suite was green over a function the app never ran, and the two
        // copies were free to drift. It returns false on an error or a missing row, which is the
        // same early return this used to make by hand.
        if (!shouldLeaveOnboarding(data, error)) return;
        writeOnboardingCache(user.id);
        qc.setQueryData(onboardingQueryKey(user.id), true);
        leave();
      });

    return () => { cancelled = true; };
  }, [user, navigate, qc]);

  const update = useCallback(<K extends keyof OnboardingData>(key: K, val: OnboardingData[K]) => {
    setData(prev => ({ ...prev, [key]: val }));
  }, []);

  // Persisted from an effect, not from `update`, so the write stays out of the state updater —
  // React may run that twice. The first pass writes back exactly what it read, so a draft is never
  // clobbered by the mount that restored it.
  useEffect(() => {
    writeOnboardingDraft(user?.id, data);
  }, [data, user?.id]);

  // The resume point, beside the answers. Only steps before the save are recorded (resumeStep).
  useEffect(() => {
    if ((RESUMABLE_STEPS as readonly string[]).includes(step)) writeOnboardingStep(user?.id, step);
  }, [step, user?.id]);

  // Every step the user reaches is recorded, including the first — otherwise someone who opens the
  // wizard and closes it immediately is indistinguishable from someone who never opened it.
  useEffect(() => {
    if (!user?.id) return;
    void recordFurthestStep(user.id, step, step === 'quick' ? QUICK_STEPS : steps);
  }, [user?.id, step, steps]);

  const next = () => {
    const idx = steps.indexOf(step);
    if (idx < steps.length - 1) setStep(steps[idx + 1]);
  };

  const back = () => {
    const idx = steps.indexOf(step);
    if (idx > 0) setStep(steps[idx - 1]);
  };

  // ⚠️ THE SAVE RUNS ON "See your plan", BEFORE THE FINISH SCREEN, NOT ON ITS BUTTONS (2026-09-29).
  // The finish screen says "Your profile is set" and shows the take-home figure. Until this change
  // nothing had been saved when it said so: the write ran on "Continue free", a small button beside
  // a filled "Explore Premium", so a user who closed the app there lost every answer while being told
  // they were set up. Measured by `npm run measure:first-save` (first save was press 10 of 10; it is
  // now press 9). 11 of 28 real users saved nothing, and all 9 who signed in left on signup day.
  // `saved` makes the finish buttons navigate only, so "Explore Premium" cannot write twice.
  const [saved, setSaved] = useState(false);

  const persist = async (): Promise<boolean> => {
    if (saved) return true;
    setSaving(true);
    try {
      const wg = parseFloat(data.weeklyGross) || 0;
      const _tr = parseFloat(data.taxRate); const tr = isNaN(_tr) ? 0 : _tr;
      const gross = data.paycheckFrequency === 'biweekly' ? wg * 26 / 12 : wg * 52 / 12;

      const rawDisplayName = (data.displayName || user?.email?.split('@')[0] || 'User').slice(0, LIMITS.username);
      const { clean: cleanDisplayName, flagged: nameFlagged } = filterProfanity(rawDisplayName);
      if (nameFlagged) toast.warning('Display name contained inappropriate language and was cleaned.');

      // Sections that failed to save. supabase-js RETURNS errors, it does not throw,
      // so an unchecked write here fails silently — that is what hid the apy/apy_rate
      // column bug. The profile update below throws (it is idempotent, so retrying is
      // safe and nothing else is meaningful without it); the optional inserts that
      // follow record their failure and carry on, so one bad section cannot discard
      // the others and a retry cannot duplicate the rows that already landed.
      const failed: string[] = [];
      // A bounded insert that TIMED OUT may still have landed, so it is never retried (a retry could
      // add the rows twice) and the user is asked to check rather than told it failed.
      const unconfirmed: string[] = [];
      const noteInsert = (res: { error: unknown; timedOut?: true }, label: string) => {
        if ('timedOut' in res && res.timedOut) unconfirmed.push(label);
        else if (res.error) failed.push(label);
      };

      // ⚠️ THIS READ WAS THE BROKEN HALF OF THE REFERRAL CHAIN UNTIL 2026-08-18. It asked
      // sessionStorage for `forged:ref`; the capture in `Landing` wrote `forgenta:ref`. Nothing
      // ever wrote the key this line read, so `referred_by` was never populated for anybody —
      // 46 profiles, 0 referrers, measured. Both halves now go through `@/lib/referral`, which
      // owns the one key, and `resolveReferrerForSignup` drops a user's own code.
      const refCode = resolveReferrerForSignup(readReferral(), user?.id);
      // `onboarding_completed` rides along with the profile write rather than being a second call:
      // it is the same row, the write is idempotent, and a separate call could fail on its own and
      // leave a finished setup marked unfinished (or worse, the reverse).
      // Bounded (ask 61c40702): a write that never answers must end in a message, not a spinner.
      // The profile write is idempotent, so the retry the message asks for is safe.
      const profileResult = await boundedWrite(supabase.from('profiles').update({
        onboarding_completed: true,
        // The ONLY write that means a person walked the wizard. It is written here rather than
        // through `markOnboardingComplete` for the reason above, so `check:onboarding-attribution`
        // matches direct writes of the flag too - a gate that only knew the function call could
        // not see this path at all, which is the one that matters most.
        onboarding_completed_via: 'wizard' satisfies OnboardingCompletionPath,
        display_name: cleanDisplayName,
        weekly_gross_income: wg,
        gross_income: gross,
        monthly_income_default: gross * (1 - tr / 100),
        tax_rate: tr,
        paycheck_frequency: data.paycheckFrequency,
        // Only the fast screen asks for a payday; an unanswered one writes nothing (engine default: Friday).
        ...paydayColumns(data.paycheckFrequency, data.nextPayday),
        ...(refCode ? { referred_by: refCode } : {}),
        // Spread, so an unattributed signup writes NO acquisition columns rather than three
        // nulls - "arrived directly" and "we erased what was there" are different facts.
        ...attributionColumnsForSignup(),
      }).eq('user_id', user!.id));
      if ('timedOut' in profileResult) throw new Error(SAVE_TIMEOUT_MESSAGE);
      if (profileResult.error) throw profileResult.error;
      // Cleared only after the profile write above succeeded (it throws on error), so a failed
      // setup that the user retries does not lose the attribution on the first attempt.
      if (refCode) clearReferral();
      // First-week funnel (proposal G): the wizard's profile save is what 'finished' means.
      recordFirstWeekStep('onboarding_finished', user);

      const expenses = [
        { label: 'Rent / Mortgage', amount: data.monthlyRent, category: 'Housing' },
        { label: 'Utilities', amount: data.monthlyUtilities, category: 'Utilities' },
        { label: 'Groceries', amount: data.monthlyGroceries, category: 'Food' },
        { label: 'Subscriptions', amount: data.monthlySubscriptions, category: 'Entertainment' },
      ].filter(e => parseFloat(e.amount) > 0);

      if (expenses.length > 0) {
        const res = await boundedWrite(supabase.from('budget_items').insert(
          expenses.map(e => ({
            user_id: user!.id,
            label: e.label,
            amount: parseFloat(e.amount),
            category: e.category,
          }))
        ));
        noteInsert(res, 'monthly expenses');
      }

      // CARDS become credit-card ACCOUNTS (the payoff engine reads accounts, not `debts`); LOANS stay
      // `debts` rows. See src/lib/wizard-card-accounts.ts.
      const validDebts = data.debts.filter(d => d.name && parseFloat(d.balance) > 0 && !isCardEntry(d));
      if (validDebts.length > 0) {
        const res = await boundedWrite(supabase.from('debts').insert(
          validDebts.map(d => ({
            user_id: user!.id,
            name: filterProfanity(d.name.slice(0, LIMITS.debtName)).clean,
            balance: parseFloat(d.balance),
            apr: parseFloat(d.apr) || 0,
            min_payment: parseFloat(d.minPayment) || 0,
            credit_limit: parseFloat(d.creditLimit) || null,
          }))
        ));
        noteInsert(res, 'debts');
      }

      const checking = parseFloat(data.checkingBalance ?? '');
      if (!bankLinked && Number.isFinite(checking) && checking > 0) {
        const res = await boundedWrite(supabase.from('accounts').insert({
          user_id: user!.id,
          name: 'Checking',
          account_type: 'checking',
          balance: Math.round(checking * 100) / 100,
        }));
        noteInsert(res, 'checking account');
      }

      // Every card from setup (the Debts step's card rows and the fast screen's one card), deduplicated
      // against credit-card accounts that already exist (e.g. from a bank link): a same-named one is only
      // filled in, never inserted twice and never re-balanced.
      const setupCards: CardAccountInsert[] = [
        ...data.debts.filter(d => isCardEntry(d)).map(cardAccountFromEntry).filter((c): c is CardAccountInsert => c !== null),
        ...[quickCardAccount(data.cardBalance, data.cardApr)].filter((c): c is CardAccountInsert => c !== null),
      ];
      if (setupCards.length > 0) {
        const existingRes = await boundedWrite(supabase.from('accounts')
          .select('id, name, apr, credit_limit, min_payment, payment_due_day')
          .eq('user_id', user!.id).eq('account_type', 'credit_card'));
        // A failed read plans as "none exist": a possible duplicate is cheaper than a card silently dropped.
        const existing = ('data' in existingRes && Array.isArray(existingRes.data) ? existingRes.data : []) as ExistingCardAccount[];
        const plan = planCardAccountWrites(setupCards, existing);
        if (plan.inserts.length > 0) {
          const res = await boundedWrite(supabase.from('accounts').insert(plan.inserts.map(c => ({ user_id: user!.id, ...c }))));
          noteInsert(res, plan.inserts.length === 1 ? 'credit card' : 'credit cards');
        }
        for (const u of plan.updates) {
          const res = await boundedWrite(supabase.from('accounts').update(u.patch).eq('id', u.id).eq('user_id', user!.id));
          noteInsert(res, 'credit card details');
        }
      }

      if (parseFloat(data.savingsBalance) > 0) {
        const res = await boundedWrite(supabase.from('accounts').insert({
          user_id: user!.id,
          name: 'High-Yield Savings',
          account_type: 'high_yield_savings',
          balance: parseFloat(data.savingsBalance),
          apy_rate: parseFloat(data.savingsApy) || 0,
        }));
        noteInsert(res, 'savings account');
      }

      const regularGoals = data.goals.filter(g => g.goalType !== 'Car Fund' && g.name && parseFloat(g.targetAmount) > 0);
      if (regularGoals.length > 0) {
        const res = await boundedWrite(supabase.from('savings_goals').insert(
          regularGoals.map(g => ({
            user_id: user!.id,
            name: g.name,
            target_amount: parseFloat(g.targetAmount),
            current_amount: 0,
            goal_type: g.goalType,
          }))
        ));
        noteInsert(res, 'savings goals');
      }

      const carGoals = data.goals.filter(g => g.goalType === 'Car Fund' && g.name);
      if (carGoals.length > 0) {
        const res = await boundedWrite(supabase.from('car_funds').insert(
          carGoals.map(g => ({
            user_id: user!.id,
            vehicle_name: g.name,
            down_payment_goal: parseFloat(g.targetAmount) || 0,
            current_saved: 0,
            target_price: parseFloat(g.targetPrice) || 0,
            tax_fees: parseFloat(g.taxFees) || 0,
            monthly_insurance: parseFloat(g.monthlyInsurance) || 0,
            expected_apr: parseFloat(g.expectedApr) || 0,
            loan_term_months: parseInt(g.loanTermMonths) || 60,
          }))
        ));
        noteInsert(res, 'car funds');
      }

      // Only reached once the profile write above landed, so the cache can never claim a setup that
      // did not save. The query cache is primed too, or the route gate would bounce us straight back
      // here on its stale copy.
      writeOnboardingCache(user!.id);
      qc.setQueryData(onboardingQueryKey(user!.id), true);
      // Before Home opens, so the tour is the only dialog a new account meets (ask 47a25afa).
      await recordCurrentReleaseSeen(user!.id);
      // The answers are on the server now; the draft is spent. Cleared here and not in `finally`,
      // so a throw on the way up leaves the input intact for the retry.
      clearOnboardingDraft();
      if (failed.length > 0) {
        toast.error(`Profile saved, but we couldn't add: ${failed.join(', ')}. You can add these from the app.`);
      } else if (unconfirmed.length > 0) {
        toast.warning(`Profile saved. We couldn't confirm: ${unconfirmed.join(', ')}. Check them in the app before adding again.`);
      } else {
        toast.success('Your financial profile is ready!');
      }
      setSaved(true);
      return true;
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile');
      return false;
    } finally {
      setSaving(false);
    }
  };

  // "See your plan" and "Skip the rest": save, and move on only once it landed. The step after goals
  // is the finish for premium and the premium pitch for free (ask 2fb9bc69) - so the save still runs
  // BEFORE anything says "Your profile is set", and the pitch's buttons only navigate.
  const seePlan = async () => {
    if (await persist()) setStep(steps[steps.indexOf('goals') + 1] ?? 'finish');
  };

  // The FAST screen's save: same `persist` (same writes, same 'wizard' attribution, same
  // onboarding_finished event), then straight to Home with a number. No finish screen and no premium
  // pitch on this path: the goal is a number in under a minute (Tre's call to bring the pitch back).
  const quickSave = async () => {
    if (await persist()) navigate('/dashboard');
  };

  // The finish screen's own buttons. `persist` is a no-op once saved, so these only navigate.
  const handleFinish = async () => {
    if (await persist()) navigate('/dashboard');
  };

  // Skip-all. An empty budget is the user's right, so this exits with nothing entered — but it is a
  // real write, and if it fails we say so and stay put rather than pretending setup is done.
  const skip = async () => {
    if (!user) { navigate('/dashboard'); return; }
    setSaving(true);
    const { ok } = await markOnboardingComplete(user.id, 'skipped');
    setSaving(false);
    if (!ok) {
      toast.error("We couldn't save that. Please try again.");
      return;
    }
    qc.setQueryData(onboardingQueryKey(user.id), true);
    await recordCurrentReleaseSeen(user.id);
    // Skipping is a decision, not an interruption — the half-filled draft should not reappear.
    clearOnboardingDraft();
    navigate('/dashboard');
  };

  const monthly = useCallback(() => {
    const wg = parseFloat(data.weeklyGross) || 0;
    const _tr2 = parseFloat(data.taxRate); const tr = isNaN(_tr2) ? 0 : _tr2;
    const gross = data.paycheckFrequency === 'biweekly' ? wg * 26 / 12 : wg * 52 / 12;
    return (gross * (1 - tr / 100)).toFixed(0);
  }, [data.weeklyGross, data.taxRate, data.paycheckFrequency]);

  const totalDebt = totalDebtOf(data.debts);
  const totalExpenses = [data.monthlyRent, data.monthlyUtilities, data.monthlyGroceries, data.monthlySubscriptions]
    .reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const net = parseFloat(monthly()) - totalExpenses;

  // A linked bank turns the manual steps into an offer instead of a demand. It never removes them:
  // the sync has not run yet, free users have no bank, and a head start is still worth having.
  const hintFor = (what: string) => (bankLinked ? <BankLinkedHint what={what} /> : null);
  const showSkipToPlan = bankLinked && MANUAL_STEPS.includes(step);
  // Without a bank nothing was saved until "See your plan", four screens past income - so a person
  // who stopped on Expenses kept nothing but a local draft (ask 9d793687: 12 of 17 empty accounts
  // saved nothing). Once income is in, the plan has what it needs; the rest can be added in the app.
  const showSaveEarly = !bankLinked && SAVE_EARLY_STEPS.includes(step) && (parseFloat(data.weeklyGross) || 0) > 0;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-5">
        {/* Header */}
        <div className="text-center">
          <h1 className="font-display font-bold text-xl tracking-tight text-gold">FORGENTA</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {step === 'finish' ? 'Your financial plan is ready.' : step === 'quick' ? 'Under a minute. You can add the rest later.' : "Let's set up your financial profile."}
          </p>
        </div>

        {step !== 'finish' && step !== 'quick' && <StepProgress step={step} steps={steps} />}

        <div className="card-forged p-4 sm:p-5 space-y-5">

          {/* ── Quick start (the fast path; see QUICK_STEPS) ── */}
          {step === 'quick' && (
            <div className="space-y-3" data-testid="onboarding-quick">
              <h2 className="font-display font-bold text-lg">See what's safe to spend</h2>
              <div className="space-y-1.5">
                <FieldLabel>How often are you paid?</FieldLabel>
                <SegmentedControl label="How often are you paid?" value={data.paycheckFrequency as 'weekly' | 'biweekly' | 'monthly'}
                  onSelect={v => update('paycheckFrequency', v)}
                  options={[{ value: 'weekly', label: 'Weekly' }, { value: 'biweekly', label: 'Every 2 weeks' }, { value: 'monthly', label: 'Monthly' }]} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <FieldLabel>Pay per check</FieldLabel>
                  <Input label="Pay per check, before tax ($)" value={data.weeklyGross} onChange={v => update('weeklyGross', v)} placeholder="Gross" type="number" prefix="$" />
                </div>
                <div className="space-y-1">
                  <FieldLabel>In checking</FieldLabel>
                  <Input label="Money in checking right now ($)" value={data.checkingBalance ?? ''} onChange={v => update('checkingBalance', v)} placeholder="Today" type="number" prefix="$" />
                </div>
              </div>
              {data.weeklyGross && (
                <p className="text-[10px] text-muted-foreground">
                  About <span className="font-semibold text-foreground">${Number(monthly()).toLocaleString()}</span> a month after a {data.taxRate}% tax estimate. Fine-tune it later under Plan.
                </p>
              )}
              <div className="space-y-1">
                <FieldLabel>Next payday</FieldLabel>
                <Input label="Next payday" value={data.nextPayday ?? ''} onChange={v => update('nextPayday', v)} type="date" />
              </div>
              <div className="space-y-1">
                <FieldLabel>Your biggest credit card (optional)</FieldLabel>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Card balance ($)" value={data.cardBalance ?? ''} onChange={v => update('cardBalance', v)} placeholder="Owed" type="number" prefix="$" />
                  <Input label="Card APR (%)" value={data.cardApr ?? ''} onChange={v => update('cardApr', v)} placeholder="APR %" type="number" />
                </div>
                <p className="text-[10px] text-muted-foreground">Gives you a payoff date. Bills and the rest go on Home.</p>
              </div>
              <button
                onClick={quickSave}
                disabled={saving || !quickSetupReady(data.weeklyGross)}
                className="w-full flex items-center justify-center gap-1.5 bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold btn-press disabled:opacity-50"
                style={{ borderRadius: 'var(--radius)' }}
                data-testid="quick-save"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <>See my Safe to Spend <ChevronRight size={14} /></>}
              </button>
              {!quickSetupReady(data.weeklyGross) && (
                <p className="text-[10px] text-muted-foreground text-center">Enter your pay to continue.</p>
              )}
              <div className="flex items-center justify-between pt-1">
                <button onClick={skip} disabled={saving} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 py-2">
                  Skip setup →
                </button>
                <button onClick={() => setStep('welcome')} disabled={saving} className="text-xs text-primary hover:underline disabled:opacity-50 py-2" data-testid="quick-full">
                  Set up step by step (link a bank)
                </button>
              </div>
            </div>
          )}

          {/* ── Welcome ── */}
          {step === 'welcome' && (
            <div className="space-y-5">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 bg-primary/15 border border-primary/30 rounded-full flex items-center justify-center mx-auto">
                  <Zap size={22} className="text-primary" />
                </div>
                <h2 className="font-display font-bold text-lg">Welcome to Forgenta</h2>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto">
                  Takes 2 minutes. We'll build your personalized financial picture so your dashboard is ready from day one.
                </p>
              </div>
              <div className="space-y-1">
                <FieldLabel>What should we call you?</FieldLabel>
                <Input label="What should we call you?" value={data.displayName} onChange={v => update('displayName', v)} placeholder="Your name" />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>Who is this budget for?</FieldLabel>
                <SegmentedControl label="Who is this budget for?" value={budgetFor} onSelect={setBudgetFor}
                  options={[{ value: 'solo', label: 'Just me' }, { value: 'partner', label: 'Me and a partner' }]} />
              </div>
              {/* The demo's entry, moved here off `/auth` (2026-08-18). Setup is the one moment a
                  filled-in account answers a real question — "what am I building towards?" — and
                  the flag is in-memory, so nothing typed above is lost by looking. */}
              <ReferenceAccountButton />
            </div>
          )}

          {/* ── Bank connect (every tier; the first link is free) ── */}
          {step === 'bank' && (
            <div className="space-y-4">
              <BankConnectStep
                linked={bankLinked}
                // Stays on this step once the link lands, rather than moving on immediately: the
                // first sync is what the patterns deck reads, and it arrives a moment later. The
                // card below appears if and when it finds something, and never otherwise.
                onLinked={() => setBankLinked(true)}
                onSkip={next}
                free={!isPremium}
              />
              {bankLinked && (
                <>
                  <RulesFoundCard />
                  <button
                    onClick={next}
                    className="w-full flex items-center justify-center gap-1.5 bg-secondary border border-border px-3 py-2.5 text-xs font-medium hover:border-primary/40 hover:text-primary transition-colors"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    Continue setup <ChevronRight size={13} />
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── Premium pitch (free accounts, just before the finish) ── */}
          {step === 'premium' && (
            <PremiumUpsellStep onUpgrade={() => navigate('/premium')} onDecline={next} />
          )}

          {/* ── Income ── */}
          {step === 'income' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <DollarSign size={15} className="text-primary" />
                <h2 className="font-display font-semibold text-sm">Income & Paycheck</h2>
              </div>
              {hintFor('your paychecks')}
              <div className="space-y-1">
                <FieldLabel>Pay Frequency</FieldLabel>
                <Select label="Pay frequency"
                  value={data.paycheckFrequency}
                  onChange={v => update('paycheckFrequency', v)}
                  options={[
                    { value: 'weekly', label: 'Weekly' },
                    { value: 'biweekly', label: 'Biweekly (every 2 weeks)' },
                    { value: 'monthly', label: 'Monthly' },
                  ]}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <FieldLabel>Gross per paycheck ($)</FieldLabel>
                  <Input label="Gross per paycheck ($)" value={data.weeklyGross} onChange={v => update('weeklyGross', v)} placeholder="e.g. 1875" type="number" prefix="$" />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Tax Rate (%)</FieldLabel>
                  <Input label="Tax rate (%)" value={data.taxRate} onChange={v => update('taxRate', v)} onBlur={() => { if (!data.taxRate.trim()) update('taxRate', '0'); }} placeholder="22" type="number" />
                </div>
              </div>
              {data.weeklyGross && (
                <div className="bg-primary/8 border border-primary/20 px-3 py-2.5 text-xs" style={{ borderRadius: 'var(--radius)' }}>
                  <span className="text-muted-foreground">Estimated monthly take-home: </span>
                  <span className="font-semibold text-primary">${Number(monthly()).toLocaleString()}</span>
                </div>
              )}
              {/* Without a bank link the app has no checking balance, so Safe to Spend could only say "Add a
                  checking account" after the wizard - a dead end with no button (2c1170b3). One field here,
                  beside pay, puts a real number on Home the moment the wizard ends. A linked bank already has it. */}
              {!bankLinked && (
                <div className="space-y-1">
                  <FieldLabel>Money in checking right now ($)</FieldLabel>
                  <Input label="Money in checking right now ($)" value={data.checkingBalance ?? ''} onChange={v => update('checkingBalance', v)} placeholder="e.g. 1200" type="number" prefix="$" />
                  <p className="text-[10px] text-muted-foreground">Used for Safe to Spend until payday. Optional.</p>
                </div>
              )}
            </div>
          )}

          {/* ── Expenses ── */}
          {step === 'expenses' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <BarChart3 size={15} className="text-primary" />
                <h2 className="font-display font-semibold text-sm">Monthly Expenses</h2>
              </div>
              {hintFor('your recurring bills')}
              {/* "Plan", not "Activity -> Plan". Both halves were wrong: Tre renamed Activity to
                  Transactions on 2026-08-27 (see primary-nav.ts), so "Activity" is a name the app
                  deliberately no longer uses - and Plan is a top-level page at /budget, not a panel
                  underneath anything. `copy-pointers.gate.test.ts` now checks this class. */}
              <p className="text-[10px] text-muted-foreground">Approximate is fine — you can adjust later under Plan.</p>
              {[
                { label: 'Rent / Mortgage', key: 'monthlyRent' as const },
                { label: 'Utilities', key: 'monthlyUtilities' as const },
                { label: 'Groceries', key: 'monthlyGroceries' as const },
                { label: 'Subscriptions', key: 'monthlySubscriptions' as const },
              ].map(({ label, key }) => (
                <div key={key} className="space-y-1">
                  <FieldLabel>{label}</FieldLabel>
                  <Input label={label} value={data[key]} onChange={v => update(key, v)} placeholder="0" type="number" prefix="$" />
                </div>
              ))}
              {totalExpenses > 0 && data.weeklyGross && (
                <div className={`px-3 py-2.5 text-xs border ${net >= 0 ? 'bg-primary/8 border-primary/20' : 'bg-destructive/10 border-destructive/20'}`} style={{ borderRadius: 'var(--radius)' }}>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Monthly expenses</span>
                    <span className="font-semibold">${totalExpenses.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-muted-foreground">Remaining after expenses</span>
                    <span className={`font-semibold ${net >= 0 ? 'text-primary' : 'text-destructive-text'}`}>
                      {net >= 0 ? '+' : ''}${net.toLocaleString()}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* -- Debts -- */}
          {step === 'debts' && (
            <DebtsStep
              debts={data.debts}
              onChange={rows => update('debts', rows)}
              hint={hintFor('your card balances')}
            />
          )}

          {/* ── Savings ── */}
          {step === 'savings' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <PiggyBank size={15} className="text-primary" />
                <h2 className="font-display font-semibold text-sm">Savings Account</h2>
              </div>
              {hintFor('your savings balance')}
              <p className="text-[10px] text-muted-foreground">Your current savings balance. We'll track APY growth automatically.</p>
              <div className="space-y-1">
                <FieldLabel>Current savings balance</FieldLabel>
                <Input label="Current savings balance" value={data.savingsBalance} onChange={v => update('savingsBalance', v)} placeholder="0" type="number" prefix="$" />
              </div>
              <div className="space-y-1">
                <FieldLabel>APY (%)</FieldLabel>
                <Input label="APY (%)" value={data.savingsApy} onChange={v => update('savingsApy', v)} placeholder="4.5" type="number" />
              </div>
              {data.savingsBalance && data.savingsApy && (
                <div className="bg-primary/8 border border-primary/20 px-3 py-2.5 text-xs" style={{ borderRadius: 'var(--radius)' }}>
                  <span className="text-muted-foreground">Projected growth in 1 year: </span>
                  <span className="font-semibold text-primary">
                    +${((parseFloat(data.savingsBalance) || 0) * (parseFloat(data.savingsApy) / 100)).toFixed(0)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Goals ── */}
          {step === 'goals' && (
            <GoalsStep
              goals={data.goals}
              onChange={rows => update('goals', rows)}
              hint={hintFor('what you already put aside')}
            />
          )}

          {/* ── Finish ── */}
          {step === 'finish' && (
            <div className="space-y-5">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 bg-primary/15 border border-primary/30 rounded-full flex items-center justify-center mx-auto">
                  <Check size={22} className="text-primary" />
                </div>
                <h2 className="font-display font-bold text-lg">Your profile is set</h2>
              </div>

              <div className="space-y-2">
                {data.weeklyGross && (
                  <div className="flex justify-between py-2 border-b border-border/40 text-xs">
                    <span className="text-muted-foreground">Monthly take-home</span>
                    <span className="font-semibold">${Number(monthly()).toLocaleString()}</span>
                  </div>
                )}
                {totalExpenses > 0 && (
                  <div className="flex justify-between py-2 border-b border-border/40 text-xs">
                    <span className="text-muted-foreground">Monthly expenses</span>
                    <span className="font-semibold text-destructive-text">−${totalExpenses.toLocaleString()}</span>
                  </div>
                )}
                {totalDebt > 0 && (
                  <div className="flex justify-between py-2 border-b border-border/40 text-xs">
                    <span className="text-muted-foreground">Total debt</span>
                    <span className="font-semibold text-destructive-text">${totalDebt.toLocaleString()}</span>
                  </div>
                )}
                {data.goals.filter(g => g.name).length > 0 && (
                  <div className="flex justify-between py-2 border-b border-border/40 text-xs">
                    <span className="text-muted-foreground">Active goals</span>
                    <span className="font-semibold">{data.goals.filter(g => g.name).length}</span>
                  </div>
                )}
                {/* With no bills entered (e.g. "Save what I have" on Expenses), "after expenses" would be the
                    whole take-home presented as what is left - a confident number with nothing behind it. */}
                {data.weeklyGross && totalExpenses === 0 && (
                  <p className="py-2 text-xs text-muted-foreground" data-testid="finish-no-expenses">
                    Add your bills under Plan to see what is left each month.
                  </p>
                )}
                {data.weeklyGross && totalExpenses > 0 && (
                  <div className="flex justify-between py-2 text-xs">
                    <span className="text-muted-foreground">Available after expenses</span>
                    <span className={`font-semibold ${net >= 0 ? 'text-primary' : 'text-destructive-text'}`}>
                      {net >= 0 ? '+' : ''}${net.toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              {budgetFor === 'partner' && (
                <div className="border border-border p-4 space-y-2" style={{ borderRadius: 'var(--radius)' }} data-testid="finish-partner">
                  <div className="flex items-center gap-2">
                    <Users size={14} className="text-primary" />
                    <span className="text-xs font-semibold">Budget together</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {isPremium
                      ? "Invite your partner by email, and you can each see the other's budget."
                      : "See each other's budget. One Premium account sends the invite, and the partner joins free. Got an invite code? You can enter it there."}
                  </p>
                  <button
                    onClick={() => { void persist().then(ok => { if (ok) navigate('/account?partner=invite'); }); }}
                    disabled={saving}
                    className="w-full py-2 text-[10px] font-medium border border-border text-foreground hover:border-primary/40 hover:text-primary btn-press disabled:opacity-50"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    Set up partner sharing
                  </button>
                </div>
              )}

              <div className="border border-primary/25 bg-primary/5 p-4 space-y-3" style={{ borderRadius: 'var(--radius)' }}>
                <div className="flex items-center gap-2">
                  <Crown size={14} className="text-gold" />
                  <span className="text-xs font-semibold">Unlock automatic tracking with Premium</span>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Your first bank link is free. Premium <strong className="text-foreground">syncs it every morning</strong> and
                  links up to {PREMIUM_MAX_LINKED} accounts, so balances and net worth stay current with no manual entry.
                </p>
                {/* EVERY ITEM HERE MUST BE SOMETHING PREMIUM ACTUALLY ENFORCES. "Plaid bank connection" sat
                    here until 2026-10-06, but the first link is free (FREE_LINK_LIMIT); premium buys the
                    daily sync (plaid-sync-all reads premium users only) and the extra links. "Unlimited history"
                    sat here until 2026-09-18, and it was VACUOUS rather than merely undocumented: no
                    plan-bounded history query exists anywhere in src/, so free users already had it
                    and an upgrader received nothing new. Tre approved replacing it (abd764bf).
                    "Full payoff forecast" is measured - CreditCardEngine.tsx:2271 shows a free
                    account 3 months of year 1 and nothing after. */}
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  {['Auto-sync transactions', `Up to ${PREMIUM_MAX_LINKED} bank links`, 'Full payoff forecast', 'Priority support'].map(f => (
                    <div key={f} className="flex items-center gap-1 text-muted-foreground">
                      <Shield size={9} className="text-primary shrink-0" /> {f}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <a
                    href="/premium"
                    onClick={e => { e.preventDefault(); void persist().then(ok => { if (ok) window.location.href = '/premium'; }); }}
                    className="flex-1 text-center py-2 text-[10px] font-semibold bg-primary text-primary-foreground btn-press"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    Explore Premium
                  </a>
                  <button
                    onClick={handleFinish}
                    disabled={saving}
                    className="flex-1 py-2 text-[10px] font-medium border border-border text-muted-foreground hover:text-foreground btn-press disabled:opacity-50"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    {saving ? <Loader2 size={10} className="animate-spin inline" /> : 'Continue free'}
                  </button>
                </div>

              {/*
                WHERE THINGS ARE. The 2026-09-18 inventory found this flow teaching a layout the
                app no longer has, and the OMISSIONS were the larger half of it: first run named
                the Account tab's five sections NOWHERE, and taught the bottom bar not at all.

                ⚠️ THE BOTTOM BAR IS ICON-ONLY AND THE ACCOUNT SECTION BAR IS ICON-ONLY, so a
                first-run user is handed ten controls carrying no words at all. That is exactly
                the population this matters to: 23 of 29 real users have not opened the app in a
                month, and this portfolio already records that most users only ever saw first run.
                Naming the destinations once, here, is the cheapest thing that can be done about
                it - and it is the LAST thing read before they tap into the app.

                ⚠️ EVERY NAME BELOW IS ONE THE APP ACTUALLY RENDERS, and that is now enforced
                rather than promised: `copy-pointers.gate.test.ts` checks this class, and the
                names come from `PRIMARY_NAV` (literally, via `firstRunNavSummary`, since 2026-10-09: the hand-written list still said Garage three days after Plan replaced it) and Account's own section bar. This is the copy the
                gate was built to protect, which is why it was built first.
              */}
              <div className="border border-border bg-secondary px-3 py-2.5 space-y-1.5" style={{ borderRadius: 'var(--radius)' }}>
                <p className="text-[10px] font-semibold text-foreground">Where things are</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  The bar at the bottom of the screen:{' '}
                  {navSummary.map((d, i) => (
                    <span key={d.label}>
                      {i > 0 && (i === navSummary.length - 1 ? ', and ' : ', ')}
                      <strong className="text-foreground">{d.label}</strong>{d.purpose && ` for ${d.purpose}`}
                    </span>
                  ))}.
                </p>
                {quickAddOpen && (
                  <p className="text-[10px] text-muted-foreground leading-relaxed" data-testid="finish-quick-add">
                    Spent something? Tap the gold <strong className="text-foreground">+</strong> in the middle of the bar
                    (or <strong className="text-foreground">Add</strong> on Home) to log it in a few taps.
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Inside <strong className="text-foreground">Account</strong> you will find{' '}
                  Profile, Leaderboard, Achievements, Learn, Analytics and Forgenta AI.
                </p>
              </div>

              {/* App lock hint. NATIVE ONLY, and that is the fix rather than a detail: this used to read
                  `isNativePlatform() || typeof window !== 'undefined'`, whose right-hand side is TRUE IN
                  EVERY BROWSER — so the `||` made it unconditional on web while `AppLockSettings` opens
                  with `if (!Capacitor.isNativePlatform()) return null`. Every web user was sent to enable
                  a control that does not render for them, under a name ("Quick Access") that existed
                  nowhere in the app. Measured 2026-09-18, docs/onboarding-inventory-2026-09-18.md.
                  Web deliberately gets NO lock hint here: the feature is not there to point at. */}
              {Capacitor.isNativePlatform() && (
                <div className="flex items-start gap-2 bg-secondary border border-border px-3 py-2.5" style={{ borderRadius: 'var(--radius)' }}>
                  <Fingerprint size={13} className="text-muted-foreground mt-0.5 shrink-0" />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">Add a PIN or biometric lock</strong> for quick, secure access.{' '}
                    Find it in <strong className="text-foreground">Settings → Account Security → App lock</strong> anytime.
                  </p>
                </div>
              )}
              </div>
            </div>
          )}

          {/* Navigation. The bank and premium steps carry their own buttons — a second "Continue"
              under them would race the Plaid handoff and the upgrade tap. */}
          {step !== 'finish' && step !== 'bank' && step !== 'premium' && step !== 'quick' && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between">
                <button
                  onClick={step === 'welcome' ? skip : back}
                  disabled={step === 'welcome' && saving}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {step === 'welcome' ? 'Skip setup →' : <><ChevronLeft size={14} /> Back</>}
                </button>
                <button
                  onClick={step === 'goals' ? seePlan : next}
                  disabled={step === 'goals' && saving}
                  className="flex items-center gap-1.5 bg-primary text-primary-foreground px-5 py-2.5 text-xs font-semibold btn-press disabled:opacity-50"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {step === 'goals' ? 'See your plan' : 'Continue'} <ChevronRight size={13} />
                </button>
              </div>
              {showSkipToPlan && (
                <button
                  onClick={seePlan}
                  disabled={saving}
                  className="w-full text-center text-[10px] text-muted-foreground hover:text-foreground transition-colors py-1"
                >
                  Skip the rest — read it from my bank →
                </button>
              )}
              {showSaveEarly && (
                <button
                  onClick={seePlan}
                  disabled={saving}
                  className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                >
                  Save what I have — add the rest later →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
