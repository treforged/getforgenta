import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/integrations/supabase/client';
import PlaidLinkButton from '@/components/shared/PlaidLinkButton';
import ModalShell from '@/components/shared/ModalShell';
import {
  X, ChevronRight, Crown, Check, Shield,
  DollarSign, CreditCard, PiggyBank, Zap,
} from 'lucide-react';

const WIZARD_DISMISSED_KEY = 'forged:onboarding_wizard_dismissed';
const WIZARD_STEP_KEY = 'forged:onboarding_step';

// Free users: steps 1-3 (income, debt, goals) — bank connect requires premium
// Premium users: steps 1-4 (bank, income, debt, goals)
type UpsellStage = 'first' | 'second' | null;

interface Props {
  onComplete: () => void;
  onDismiss: () => void;
}

const FREE_STEP_LABELS = ['Set your income', 'Add a debt', 'Create a goal'];
const PREMIUM_STEP_LABELS = ['Connect a bank', 'Set your income', 'Add a debt', 'Create a goal'];

export default function OnboardingWizard({ onComplete, onDismiss }: Props) {
  const { user } = useAuth();
  const { isPremium } = useSubscription();
  const navigate = useNavigate();

  const savedStep = parseInt(sessionStorage.getItem(WIZARD_STEP_KEY) ?? '1', 10);
  const [step, setStep] = useState(Math.min(Math.max(savedStep, 1), isPremium ? 4 : 3));

  // Free users start on the upsell pre-step. Premium users skip it entirely.
  const [upsellStage, setUpsellStage] = useState<UpsellStage>(isPremium ? null : 'first');
  const [bankLinked, setBankLinked] = useState(false);

  const stepLabels = isPremium ? PREMIUM_STEP_LABELS : FREE_STEP_LABELS;
  const totalSteps = stepLabels.length;

  const markComplete = async () => {
    sessionStorage.removeItem(WIZARD_STEP_KEY);
    if (user) {
      await supabase.from('profiles').update({ onboarding_completed: true } as any).eq('user_id', user.id);
    }
    onComplete();
  };

  const dismiss = () => {
    sessionStorage.setItem(WIZARD_DISMISSED_KEY, '1');
    sessionStorage.removeItem(WIZARD_STEP_KEY);
    onDismiss();
  };

  const nextStep = () => {
    if (step < totalSteps) setStep(step + 1);
    else markComplete();
  };

  const navigateTo = (path: string) => {
    const next = step < totalSteps ? step + 1 : step;
    sessionStorage.setItem(WIZARD_STEP_KEY, String(next));
    navigate(path);
  };

  const declineUpsell = () => {
    // Both upsell stages declined — enter free onboarding at step 1
    setUpsellStage(null);
    setStep(1);
  };

  const showingUpsell = upsellStage !== null;

  return (
    <ModalShell onDismiss={dismiss} zIndex="z-40">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 sm:px-6 sm:pt-6">
        <div>
          {showingUpsell ? (
            <>
              <div className="flex items-center gap-1.5">
                <Crown size={12} className="text-primary" />
                <p className="text-[10px] text-primary uppercase tracking-wider font-semibold">Exclusive offer</p>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Unlock Forgenta's full potential</p>
            </>
          ) : (
            <>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Getting started</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Step {step} of {totalSteps} — {stepLabels[step - 1]}
              </p>
            </>
          )}
        </div>
        <button
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground transition-colors p-3 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>

      {/* Progress bar — only shown during onboarding steps, not upsell */}
      {!showingUpsell && (
        <div className="mx-5 sm:mx-6 mt-4 h-1 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${(step / totalSteps) * 100}%` }}
          />
        </div>
      )}

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-5 space-y-5">

        {/* ── Upsell pre-step (free users only, before any onboarding steps) ── */}
        {showingUpsell && upsellStage === 'first' && (
          <FirstUpsell
            onUpgrade={() => navigateTo('/premium')}
            onDecline={() => setUpsellStage('second')}
          />
        )}

        {showingUpsell && upsellStage === 'second' && (
          <SecondUpsell
            onUpgrade={() => navigateTo('/premium')}
            onDecline={declineUpsell}
          />
        )}

        {/* ── Premium step 1: Bank connect ── */}
        {!showingUpsell && isPremium && step === 1 && (
          <BankConnectStep
            linked={bankLinked}
            onLinked={() => { setBankLinked(true); nextStep(); }}
            onSkip={nextStep}
          />
        )}

        {/* ── Free step 1 / Premium step 2: Income ── */}
        {!showingUpsell && step === (isPremium ? 2 : 1) && (
          <NavStep
            icon={<DollarSign size={16} className="text-primary" />}
            title="Set your monthly income"
            body="Head to Budget Control to enter your gross pay, deductions, and paycheck frequency. This powers every projection in Forgenta."
            ctaLabel="Open Budget Control"
            onNavigate={() => navigateTo('/budget')}
            onSkip={nextStep}
          />
        )}

        {/* ── Free step 2 / Premium step 3: Debt ── */}
        {!showingUpsell && step === (isPremium ? 3 : 2) && (
          <NavStep
            icon={<CreditCard size={16} className="text-primary" />}
            title="Add a debt"
            body="Add your credit cards or loans in Debt Payoff. The avalanche engine will calculate the fastest, cheapest path to zero."
            ctaLabel="Open Debt Payoff"
            onNavigate={() => navigateTo('/debt')}
            onSkip={nextStep}
          />
        )}

        {/* ── Free step 3 / Premium step 4: Goals ── */}
        {!showingUpsell && step === (isPremium ? 4 : 3) && (
          <NavStep
            icon={<PiggyBank size={16} className="text-primary" />}
            title="Create a savings goal"
            body="Add your first savings goal — emergency fund, vacation, down payment, or anything else. Forgenta tracks progress automatically."
            ctaLabel="Open Savings Goals"
            onNavigate={() => navigateTo('/goals')}
            onSkip={markComplete}
            isLast
          />
        )}
      </div>
    </ModalShell>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BankConnectStep({
  linked,
  onLinked,
  onSkip,
}: {
  linked: boolean;
  onLinked: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 bg-primary/15 border border-primary/30 rounded-full flex items-center justify-center shrink-0">
          <Shield size={14} className="text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold">Connect a bank account</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Link your bank via Plaid for automatic transaction import and daily balance updates.
          </p>
        </div>
      </div>

      {linked ? (
        <div className="flex items-center gap-2 bg-success/10 border border-success/30 px-3 py-2.5 text-xs text-success font-medium" style={{ borderRadius: 'var(--radius)' }}>
          <Check size={12} /> Bank connected — continuing…
        </div>
      ) : (
        <PlaidLinkButton onSuccess={onLinked} />
      )}

      <button
        onClick={onSkip}
        className="w-full text-center text-[10px] text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        Skip for now →
      </button>
    </div>
  );
}

function FirstUpsell({
  onUpgrade,
  onDecline,
}: {
  onUpgrade: () => void;
  onDecline: () => void;
}) {
  const highlights = [
    'Auto-sync bank balances every morning',
    'AI Advisor — ask anything about your money',
    'Up to 3 linked accounts with real transaction import',
    'Advanced 60-month cash flow forecast',
    'Export reports as PDF or CSV',
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 bg-primary/15 border border-primary/30 rounded-full flex items-center justify-center shrink-0">
          <Zap size={15} className="text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-snug">
            Get more done with Forgenta Premium
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Connect your bank once and let Forgenta do the heavy lifting — transactions, balances, and projections stay up to date automatically.
          </p>
        </div>
      </div>

      <ul className="space-y-2.5">
        {highlights.map(h => (
          <li key={h} className="flex items-start gap-2 text-xs text-muted-foreground">
            <Check size={11} className="text-primary mt-0.5 shrink-0" />
            {h}
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <button
          onClick={onUpgrade}
          className="flex-1 py-2.5 bg-primary text-primary-foreground text-xs font-semibold btn-press flex items-center justify-center gap-1.5"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <Crown size={12} /> Upgrade now
        </button>
        <button
          onClick={onDecline}
          className="flex-1 py-2.5 border border-border text-xs text-muted-foreground hover:text-foreground btn-press transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          No thanks
        </button>
      </div>
    </div>
  );
}

function SecondUpsell({
  onUpgrade,
  onDecline,
}: {
  onUpgrade: () => void;
  onDecline: () => void;
}) {
  const perks = [
    'Auto-sync every morning — wake up to fresh balances',
    'AI Advisor — ask your money anything, get real answers',
    'Up to 3 linked accounts vs. manual-only on free',
    'Advanced 60-month forecast with Plaid data',
    'Cancel anytime',
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold">Are you sure? Here's what you'd be missing:</p>

      <ul className="space-y-2">
        {perks.map(perk => (
          <li key={perk} className="flex items-start gap-2 text-xs text-muted-foreground">
            <Check size={11} className="text-primary mt-0.5 shrink-0" />
            {perk}
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <button
          onClick={onUpgrade}
          className="flex-1 py-2.5 bg-primary text-primary-foreground text-xs font-semibold btn-press"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Upgrade now
        </button>
        <button
          onClick={onDecline}
          className="flex-1 py-2.5 border border-border text-xs text-muted-foreground hover:text-foreground btn-press transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          I'll stay on free
        </button>
      </div>
    </div>
  );
}

function NavStep({
  icon,
  title,
  body,
  ctaLabel,
  onNavigate,
  onSkip,
  isLast = false,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  ctaLabel: string;
  onNavigate: () => void;
  onSkip: () => void;
  isLast?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 bg-primary/15 border border-primary/30 rounded-full flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{body}</p>
        </div>
      </div>

      <button
        onClick={onNavigate}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground text-xs font-semibold btn-press"
        style={{ borderRadius: 'var(--radius)' }}
      >
        {ctaLabel} <ChevronRight size={13} />
      </button>

      <button
        onClick={onSkip}
        className="w-full text-center text-[10px] text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        {isLast ? 'Finish setup' : 'Skip for now →'}
      </button>
    </div>
  );
}
