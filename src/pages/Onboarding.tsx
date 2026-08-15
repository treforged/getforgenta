// The ONE onboarding flow.
//
// Until 2026-08-14 there were three overlapping surfaces: this route (7 manual steps, gated by a
// localStorage key, no way to link a bank), a modal wizard on the Dashboard (gated by
// `profiles.onboarding_completed`, WITH bank connect for premium), and the Dashboard checklist.
// Finishing one left the others convinced you had never started. The modal's steps now live here —
// bank connect first for premium, its upsell pre-step for free — the modal is deleted, and
// completion is recorded in one place (`src/lib/onboarding-state.ts`). The checklist stays: it is a
// nudge, not a flow, and it reads the same store.

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import { onboardingQueryKey } from '@/hooks/useOnboardingStatus';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { filterProfanity, LIMITS } from '@/lib/content-filter';
import {
  markOnboardingComplete,
  readOnboardingCache,
  writeOnboardingCache,
} from '@/lib/onboarding-state';
import BankConnectStep, { BankLinkedHint } from '@/components/onboarding/BankConnectStep';
import RulesFoundCard from '@/components/rules/RulesFoundCard';
import PremiumUpsellStep from '@/components/onboarding/PremiumUpsellStep';
import DebtsStep from '@/components/onboarding/DebtsStep';
import GoalsStep from '@/components/onboarding/GoalsStep';
import { FieldLabel, Input, Select } from '@/components/onboarding/fields';
import { totalDebtOf, type DebtEntry, type GoalEntry } from '@/components/onboarding/types';
import {
  DollarSign, PiggyBank, ChevronRight,
  ChevronLeft, Check, Crown, Zap, BarChart3, Shield, Loader2, Fingerprint,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';

type Step = 'welcome' | 'bank' | 'premium' | 'income' | 'expenses' | 'debts' | 'savings' | 'goals' | 'finish';

/** The steps that ask for numbers by hand — the ones a linked bank makes optional. */
const MANUAL_STEPS: Step[] = ['income', 'expenses', 'debts', 'savings', 'goals'];

/**
 * Premium gets bank connect where free gets the premium pitch: linking is what premium buys, so the
 * two tiers see the same slot answered differently rather than a different-length flow.
 */
function buildSteps(isPremium: boolean): Step[] {
  return ['welcome', isPremium ? 'bank' : 'premium', ...MANUAL_STEPS, 'finish'];
}

const STEP_LABELS: Record<Step, string> = {
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

export default function Onboarding() {
  const { user } = useAuth();
  const { isPremium } = useSubscription();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('welcome');
  const [data, setData] = useState<OnboardingData>({
    ...DEFAULT_DATA,
    displayName: getInitialDisplayName(user?.user_metadata),
  });
  const [saving, setSaving] = useState(false);
  const [bankLinked, setBankLinked] = useState(false);

  const steps = useMemo(() => buildSteps(isPremium), [isPremium]);

  // Signal Swift cover that a post-auth page has mounted (same flag as Dashboard).
  // New users land here after OAuth sign-up; without this the cover waits the full
  // 6s fallback before dismissing.
  useEffect(() => {
    window.__forgenta_dashboard_ready = true;
    return () => { window.__forgenta_dashboard_ready = false; };
  }, []);

  // Auto-skip for accounts that are already set up. Three ways that can be true, in order of
  // certainty: this device remembers, the profile flag says so, or the account predates the flag
  // entirely and has profile data (display_name is the tell). The last two are migrations — they
  // write the completion back through the single store so this is the last time we have to guess.
  //
  // A FAILED read is not a "no": it leaves the user in the wizard, which they can skip in one tap,
  // rather than either trapping them or waving through someone who never onboarded.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const leave = () => { if (!cancelled) navigate('/dashboard', { replace: true }); };

    if (readOnboardingCache(user.id)) { leave(); return; }

    supabase.from('profiles').select('onboarding_completed, display_name').eq('user_id', user.id).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        if (data.onboarding_completed) {
          writeOnboardingCache(user.id);
          qc.setQueryData(onboardingQueryKey(user.id), true);
          leave();
          return;
        }
        if (data.display_name) {
          markOnboardingComplete(user.id).then(({ ok }) => {
            if (!ok || cancelled) return;
            qc.setQueryData(onboardingQueryKey(user.id), true);
            leave();
          });
        }
      });

    return () => { cancelled = true; };
  }, [user, navigate, qc]);

  const update = useCallback(<K extends keyof OnboardingData>(key: K, val: OnboardingData[K]) => {
    setData(prev => ({ ...prev, [key]: val }));
  }, []);

  const next = () => {
    const idx = steps.indexOf(step);
    if (idx < steps.length - 1) setStep(steps[idx + 1]);
  };

  const back = () => {
    const idx = steps.indexOf(step);
    if (idx > 0) setStep(steps[idx - 1]);
  };

  const handleFinish = async () => {
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

      const refCode = sessionStorage.getItem('forged:ref') || null;
      // `onboarding_completed` rides along with the profile write rather than being a second call:
      // it is the same row, the write is idempotent, and a separate call could fail on its own and
      // leave a finished setup marked unfinished (or worse, the reverse).
      const { error: profileError } = await supabase.from('profiles').update({
        onboarding_completed: true,
        display_name: cleanDisplayName,
        weekly_gross_income: wg,
        gross_income: gross,
        monthly_income_default: gross * (1 - tr / 100),
        tax_rate: tr,
        paycheck_frequency: data.paycheckFrequency,
        ...(refCode ? { referred_by: refCode } : {}),
      }).eq('user_id', user!.id);
      if (profileError) throw profileError;
      if (refCode) sessionStorage.removeItem('forged:ref');

      const expenses = [
        { label: 'Rent / Mortgage', amount: data.monthlyRent, category: 'Housing' },
        { label: 'Utilities', amount: data.monthlyUtilities, category: 'Utilities' },
        { label: 'Groceries', amount: data.monthlyGroceries, category: 'Food' },
        { label: 'Subscriptions', amount: data.monthlySubscriptions, category: 'Entertainment' },
      ].filter(e => parseFloat(e.amount) > 0);

      if (expenses.length > 0) {
        const { error } = await supabase.from('budget_items').insert(
          expenses.map(e => ({
            user_id: user!.id,
            label: e.label,
            amount: parseFloat(e.amount),
            category: e.category,
          }))
        );
        if (error) failed.push('monthly expenses');
      }

      const validDebts = data.debts.filter(d => d.name && parseFloat(d.balance) > 0);
      if (validDebts.length > 0) {
        const { error } = await supabase.from('debts').insert(
          validDebts.map(d => ({
            user_id: user!.id,
            name: filterProfanity(d.name.slice(0, LIMITS.debtName)).clean,
            balance: parseFloat(d.balance),
            apr: parseFloat(d.apr) || 0,
            min_payment: parseFloat(d.minPayment) || 0,
            credit_limit: parseFloat(d.creditLimit) || null,
          }))
        );
        if (error) failed.push('debts');
      }

      if (parseFloat(data.savingsBalance) > 0) {
        const { error } = await supabase.from('accounts').insert({
          user_id: user!.id,
          name: 'High-Yield Savings',
          account_type: 'high_yield_savings',
          balance: parseFloat(data.savingsBalance),
          apy_rate: parseFloat(data.savingsApy) || 0,
        });
        if (error) failed.push('savings account');
      }

      const regularGoals = data.goals.filter(g => g.goalType !== 'Car Fund' && g.name && parseFloat(g.targetAmount) > 0);
      if (regularGoals.length > 0) {
        const { error } = await supabase.from('savings_goals').insert(
          regularGoals.map(g => ({
            user_id: user!.id,
            name: g.name,
            target_amount: parseFloat(g.targetAmount),
            current_amount: 0,
            goal_type: g.goalType,
          }))
        );
        if (error) failed.push('savings goals');
      }

      const carGoals = data.goals.filter(g => g.goalType === 'Car Fund' && g.name);
      if (carGoals.length > 0) {
        const { error } = await supabase.from('car_funds').insert(
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
        );
        if (error) failed.push('car funds');
      }

      // Only reached once the profile write above landed, so the cache can never claim a setup that
      // did not save. The query cache is primed too, or the route gate would bounce us straight back
      // here on its stale copy.
      writeOnboardingCache(user!.id);
      qc.setQueryData(onboardingQueryKey(user!.id), true);
      if (failed.length > 0) {
        toast.error(`Profile saved, but we couldn't add: ${failed.join(', ')}. You can add these from the app.`);
      } else {
        toast.success('Your financial profile is ready!');
      }
      navigate('/dashboard');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  // Skip-all. An empty budget is the user's right, so this exits with nothing entered — but it is a
  // real write, and if it fails we say so and stay put rather than pretending setup is done.
  const skip = async () => {
    if (!user) { navigate('/dashboard'); return; }
    setSaving(true);
    const { ok } = await markOnboardingComplete(user.id);
    setSaving(false);
    if (!ok) {
      toast.error("We couldn't save that. Please try again.");
      return;
    }
    qc.setQueryData(onboardingQueryKey(user.id), true);
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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-5">
        {/* Header */}
        <div className="text-center">
          <h1 className="font-display font-bold text-xl tracking-tight text-gold">FORGENTA</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {step === 'finish' ? 'Your financial plan is ready.' : "Let's set up your financial profile."}
          </p>
        </div>

        {step !== 'finish' && <StepProgress step={step} steps={steps} />}

        <div className="card-forged p-5 space-y-5">

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
                <Input value={data.displayName} onChange={v => update('displayName', v)} placeholder="Your name" />
              </div>
            </div>
          )}

          {/* ── Bank connect (premium) ── */}
          {step === 'bank' && (
            <div className="space-y-4">
              <BankConnectStep
                linked={bankLinked}
                // Stays on this step once the link lands, rather than moving on immediately: the
                // first sync is what the patterns deck reads, and it arrives a moment later. The
                // card below appears if and when it finds something, and never otherwise.
                onLinked={() => setBankLinked(true)}
                onSkip={next}
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

          {/* ── Premium pitch (free — the slot premium spends on Plaid) ── */}
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
                <Select
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
                  <Input value={data.weeklyGross} onChange={v => update('weeklyGross', v)} placeholder="e.g. 1875" type="number" prefix="$" />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Tax Rate (%)</FieldLabel>
                  <Input value={data.taxRate} onChange={v => update('taxRate', v)} onBlur={() => { if (!data.taxRate.trim()) update('taxRate', '0'); }} placeholder="22" type="number" />
                </div>
              </div>
              {data.weeklyGross && (
                <div className="bg-primary/8 border border-primary/20 px-3 py-2.5 text-xs" style={{ borderRadius: 'var(--radius)' }}>
                  <span className="text-muted-foreground">Estimated monthly take-home: </span>
                  <span className="font-semibold text-primary">${Number(monthly()).toLocaleString()}</span>
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
              <p className="text-[10px] text-muted-foreground">Approximate is fine — you can adjust later in Budget Control.</p>
              {[
                { label: 'Rent / Mortgage', key: 'monthlyRent' as const },
                { label: 'Utilities', key: 'monthlyUtilities' as const },
                { label: 'Groceries', key: 'monthlyGroceries' as const },
                { label: 'Subscriptions', key: 'monthlySubscriptions' as const },
              ].map(({ label, key }) => (
                <div key={key} className="space-y-1">
                  <FieldLabel>{label}</FieldLabel>
                  <Input value={data[key]} onChange={v => update(key, v)} placeholder="0" type="number" prefix="$" />
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
                    <span className={`font-semibold ${net >= 0 ? 'text-primary' : 'text-destructive'}`}>
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
                <Input value={data.savingsBalance} onChange={v => update('savingsBalance', v)} placeholder="0" type="number" prefix="$" />
              </div>
              <div className="space-y-1">
                <FieldLabel>APY (%)</FieldLabel>
                <Input value={data.savingsApy} onChange={v => update('savingsApy', v)} placeholder="4.5" type="number" />
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
                    <span className="font-semibold text-destructive">−${totalExpenses.toLocaleString()}</span>
                  </div>
                )}
                {totalDebt > 0 && (
                  <div className="flex justify-between py-2 border-b border-border/40 text-xs">
                    <span className="text-muted-foreground">Total debt</span>
                    <span className="font-semibold text-destructive">${totalDebt.toLocaleString()}</span>
                  </div>
                )}
                {data.goals.filter(g => g.name).length > 0 && (
                  <div className="flex justify-between py-2 border-b border-border/40 text-xs">
                    <span className="text-muted-foreground">Active goals</span>
                    <span className="font-semibold">{data.goals.filter(g => g.name).length}</span>
                  </div>
                )}
                {data.weeklyGross && (
                  <div className="flex justify-between py-2 text-xs">
                    <span className="text-muted-foreground">Available after expenses</span>
                    <span className={`font-semibold ${net >= 0 ? 'text-primary' : 'text-destructive'}`}>
                      {net >= 0 ? '+' : ''}${net.toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              <div className="border border-primary/25 bg-primary/5 p-4 space-y-3" style={{ borderRadius: 'var(--radius)' }}>
                <div className="flex items-center gap-2">
                  <Crown size={14} className="text-gold" />
                  <span className="text-xs font-semibold">Unlock automatic tracking with Premium</span>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Connect your bank accounts with Plaid for <strong className="text-foreground">automatic transaction import</strong>,
                  daily balance updates, and real-time net worth — no manual entry.
                </p>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  {['Auto-sync transactions', 'Plaid bank connection', 'Unlimited history', 'Priority support'].map(f => (
                    <div key={f} className="flex items-center gap-1 text-muted-foreground">
                      <Shield size={9} className="text-primary shrink-0" /> {f}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <a
                    href="/premium"
                    onClick={e => { e.preventDefault(); handleFinish().then(() => setTimeout(() => (window.location.href = '/premium'), 500)); }}
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

              {/* Quick Access hint */}
              {(Capacitor.isNativePlatform() || typeof window !== 'undefined') && (
                <div className="flex items-start gap-2 bg-secondary border border-border px-3 py-2.5" style={{ borderRadius: 'var(--radius)' }}>
                  <Fingerprint size={13} className="text-muted-foreground mt-0.5 shrink-0" />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">Add a PIN or biometric lock</strong> for quick, secure access.{' '}
                    Find it in <strong className="text-foreground">Settings → Quick Access</strong> anytime.
                  </p>
                </div>
              )}
              </div>
            </div>
          )}

          {/* Navigation. The bank and premium steps carry their own buttons — a second "Continue"
              under them would race the Plaid handoff and the upgrade tap. */}
          {step !== 'finish' && step !== 'bank' && step !== 'premium' && (
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
                  onClick={next}
                  className="flex items-center gap-1.5 bg-primary text-primary-foreground px-5 py-2.5 text-xs font-semibold btn-press"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {step === 'goals' ? 'See your plan' : 'Continue'} <ChevronRight size={13} />
                </button>
              </div>
              {showSkipToPlan && (
                <button
                  onClick={() => setStep('finish')}
                  className="w-full text-center text-[10px] text-muted-foreground hover:text-foreground transition-colors py-1"
                >
                  Skip the rest — read it from my bank →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
