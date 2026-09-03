import { useEffect, useRef } from 'react';
import { WidgetBridge } from '@/plugins/widget-bridge';
import { useViewedProfile } from '@/contexts/ViewedProfileContext';
import { buildWidgetPayload } from '@/lib/widget-snapshot';

interface Params {
  /** Null when the figure is not available. NOT zero — see `buildWidgetPayload`. */
  monthEndCash: number | null;
  netWorth: number | null;
  /** The user's own currency. The widget used to hardcode a dollar sign. */
  currency?: string | null;
  enabled: boolean;
}

const DEBOUNCE_MS = 500;

export function useWidgetSync({ monthEndCash, netWorth, currency, enabled }: Params): void {
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
      // ⚠️ SENDING NOTHING IS A VALID OUTCOME. A widget is the one surface that
      // shows a number without anyone opening the app, so nobody opens the app to
      // check what their home screen already told them. A missing figure must
      // never be pushed as a zero; the widget then keeps saying "open Forgenta to
      // sync", which is true, instead of confidently showing $0.
      const payload = buildWidgetPayload({ monthEndCash, netWorth, currency, enabled: true }, new Date());
      if (!payload) return;
      WidgetBridge.updateWidget(payload).catch((err: unknown) => {
        console.warn('[WidgetBridge] updateWidget failed:', err);
      });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [monthEndCash, netWorth, currency, enabled, isPartnerView]);
}
