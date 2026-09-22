/**
 * AkoyaFallbackPrompt
 *
 * Shown when Plaid could not reach an institution that Akoya can serve.
 * Renders nothing at all when the institution has no Akoya route, so the caller
 * can mount it unconditionally.
 */

import { AlertTriangle, X } from 'lucide-react';
import type { AkoyaInstitution } from '@/config/akoya-institutions';
import AkoyaConnectButton from '@/components/shared/AkoyaConnectButton';
import { AKOYA_ENABLED } from '@/lib/akoya-enabled';

interface AkoyaFallbackPromptProps {
  institution: AkoyaInstitution | null;
  onDismiss: () => void;
}

export default function AkoyaFallbackPrompt({
  institution,
  onDismiss,
}: AkoyaFallbackPromptProps) {
  // See `akoya-enabled.ts`. Guarded inside the component so every call site is covered;
  // this one has no hooks above it, so the top of the function is safe here.
  if (!AKOYA_ENABLED) return null;
  if (!institution) return null;

  return (
    <div className="flex items-start justify-between gap-3 bg-gold/10 border border-gold/20 rounded px-3 py-2.5">
      <div className="flex items-start gap-2 min-w-0">
        <AlertTriangle size={13} className="text-gold shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          We're temporarily unable to connect through Plaid. You can continue by
          connecting {institution.displayName} through Akoya.
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <AkoyaConnectButton institution={institution} />
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-muted-foreground hover:text-foreground p-1"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
