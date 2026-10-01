import { useEffect, useRef, useState } from 'react';
import { WidgetBridge } from '@/plugins/widget-bridge';
import { useViewedProfile } from '@/contexts/ViewedProfileContext';
import { buildWidgetPayload, type WidgetDebtPayment } from '@/lib/widget-snapshot';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

interface Params {
  /** Null when the figure is not available. NOT zero — see `buildWidgetPayload`. */
  monthEndCash: number | null;
  netWorth: number | null;
  /** The user's own currency. The widget used to hardcode a dollar sign. */
  currency?: string | null;
  enabled: boolean;
  /** `buildNextDebtPayments(debtBreakdown)`. Compared by value, so a new array each render
   *  does not re-send an unchanged payload. */
  nextDebtPayments?: WidgetDebtPayment[] | null;
}

const DEBOUNCE_MS = 500;

export function useWidgetSync({ monthEndCash, netWorth, currency, enabled, nextDebtPayments }: Params): void {
  const debtKey = nextDebtPayments ? JSON.stringify(nextDebtPayments) : '';
  // ⚠️ HOME-SCREEN WIDGETS ONLY EVER SYNC THE OWNER'S NUMBERS (partner-linking design
  // §5). In partner view the values arriving here are computed from the PARTNER's data,
  // so the guard lives inside the hook — every call site is covered, including ones
  // that forget to gate `enabled`. A source-lock test keeps viewedUserId out of here.
  const { isPartnerView } = useViewedProfile();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resumeTick, setResumeTick] = useState(0);

  // Tre 2026-10-01 asked for the widget to update immediately when the app is opened (ask e74da89c);
  // without this, an unchanged figure never re-sends and the widget's 'Updated ... ago' keeps aging.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') setResumeTick(t => t + 1);
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Native cannot rely on visibilitychange arriving on the way back (see ResumeRecovery), so
    // appStateChange drives it there. addListener resolves a handle LATER, so cleanup may run first.
    let handle: { remove: () => void } | null = null;
    let unsubscribed = false;
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) setResumeTick(t => t + 1);
      }).then((h) => {
        if (unsubscribed) h.remove(); else handle = h;
      }).catch((err: unknown) => {
        console.warn('[WidgetBridge] appStateChange subscription failed:', err);
      });
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribed = true;
      handle?.remove();
    };
  }, []);

  useEffect(() => {
    if (!enabled || isPartnerView) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      // ⚠️ SENDING NOTHING IS A VALID OUTCOME. A widget is the one surface that
      // shows a number without anyone opening the app, so nobody opens the app to
      // check what their home screen already told them. A missing figure must
      // never be pushed as a zero; the widget then keeps saying "open Forgenta to
      // sync", which is true, instead of confidently showing $0.
      const payload = buildWidgetPayload(
        { monthEndCash, netWorth, currency, enabled: true, nextDebtPayments: debtKey ? (JSON.parse(debtKey) as WidgetDebtPayment[]) : null },
        new Date(),
      );
      if (!payload) return;
      WidgetBridge.updateWidget(payload).catch((err: unknown) => {
        console.warn('[WidgetBridge] updateWidget failed:', err);
      });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [monthEndCash, netWorth, currency, enabled, isPartnerView, debtKey, resumeTick]);
}
