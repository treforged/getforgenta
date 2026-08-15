// The free user's stand-in for the bank-connect step.
//
// Carried over from the retired Dashboard modal wizard, which showed two upsell stages before free
// onboarding began. Premium is what unlocks the bank link, so this sits in exactly the slot the
// premium flow gives to Plaid, and declining drops straight into manual entry — nobody is blocked.

import { useState } from 'react';
import { Check, Crown, Zap } from 'lucide-react';
import { AI_ADVISOR_ENABLED } from '@/lib/feature-flags';

type UpsellStage = 'first' | 'second';

export default function PremiumUpsellStep({
  onUpgrade,
  onDecline,
}: {
  onUpgrade: () => void;
  onDecline: () => void;
}) {
  const [stage, setStage] = useState<UpsellStage>('first');

  return stage === 'first'
    ? <FirstUpsell onUpgrade={onUpgrade} onDecline={() => setStage('second')} />
    : <SecondUpsell onUpgrade={onUpgrade} onDecline={onDecline} />;
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
    ...(AI_ADVISOR_ENABLED ? ['AI Advisor — ask anything about your money'] : []),
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
    ...(AI_ADVISOR_ENABLED ? ['AI Advisor — ask your money anything, get real answers'] : []),
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
