// Bank connect, the first thing a premium user is asked for.
//
// Moved here verbatim from the retired Dashboard modal wizard (`OnboardingWizard.tsx`) when the two
// onboarding surfaces merged into the /onboarding route. `PlaidLinkButton` is mounted exactly as it
// was — it already picks hosted-link on native and the inline widget on web, and that choice is not
// this component's business.

import { useState } from 'react';
import { Check, Shield, Sparkles } from 'lucide-react';
import PlaidLinkButton from '@/components/shared/PlaidLinkButton';
import AkoyaFallbackPrompt from '@/components/shared/AkoyaFallbackPrompt';
import { findAkoyaInstitution, type AkoyaInstitution } from '@/config/akoya-institutions';

export default function BankConnectStep({
  linked,
  onLinked,
  onSkip,
}: {
  linked: boolean;
  onLinked: () => void;
  onSkip: () => void;
}) {
  // Set when Plaid reports it can't reach an institution Akoya can serve.
  const [akoyaFallback, setAkoyaFallback] = useState<AkoyaInstitution | null>(null);

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
            Do this first and the next few steps mostly fill themselves in.
          </p>
        </div>
      </div>

      {linked ? (
        <div className="flex items-center gap-2 bg-success/10 border border-success/30 px-3 py-2.5 text-xs text-success font-medium" style={{ borderRadius: 'var(--radius)' }}>
          {/* Says what is true and no more: the link succeeded. Whether the first sync has landed
              is a separate question, and the step below it answers that one honestly. */}
          <Check size={12} /> Bank connected
        </div>
      ) : (
        <div className="space-y-2">
          <PlaidLinkButton
            onSuccess={onLinked}
            onInstitutionUnavailable={name => setAkoyaFallback(findAkoyaInstitution(name))}
          />
          <AkoyaFallbackPrompt
            institution={akoyaFallback}
            onDismiss={() => setAkoyaFallback(null)}
          />
        </div>
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

/**
 * Shown on the manual steps once a bank is linked: entering by hand is now an option, not a
 * requirement. It says what will be read rather than promising the step is already done — the sync
 * has not run yet, and claiming otherwise would be a number we cannot stand behind.
 */
export function BankLinkedHint({ what }: { what: string }) {
  return (
    <div className="flex items-start gap-2 bg-primary/8 border border-primary/20 px-3 py-2.5" style={{ borderRadius: 'var(--radius)' }}>
      <Sparkles size={12} className="text-primary mt-0.5 shrink-0" />
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Your bank is connected — we'll read {what} from it once the first sync lands.
        Fill this in only if you want a head start.
      </p>
    </div>
  );
}
