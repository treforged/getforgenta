import { useEffect, useRef } from 'react';
import { WidgetBridge } from '@/plugins/widget-bridge';
import { useViewedProfile } from '@/contexts/ViewedProfileContext';

interface Params {
  monthEndCash: number;
  netWorth: number;
  enabled: boolean;
}

const DEBOUNCE_MS = 500;

export function useWidgetSync({ monthEndCash, netWorth, enabled }: Params): void {
  // ⚠️ HOME-SCREEN WIDGETS ONLY EVER SYNC THE OWNER'S NUMBERS (partner-linking design
  // §5). In partner view the values arriving here are computed from the PARTNER's data,
  // so the guard lives inside the hook — every call site is covered, including ones
  // that forget to gate `enabled`. A source-lock test keeps viewedUserId out of here.
  const { isPartnerView } = useViewedProfile();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || isPartnerView) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      WidgetBridge.updateWidget({
        monthEndCash,
        netWorth,
        currency: 'USD',
        updatedAt: new Date().toISOString(),
      }).catch((err: unknown) => {
        console.warn('[WidgetBridge] updateWidget failed:', err);
      });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [monthEndCash, netWorth, enabled, isPartnerView]);
}
