import { useEffect, useRef } from 'react';
import { WidgetBridge } from '@/plugins/widget-bridge';

interface Params {
  monthEndCash: number;
  netWorth: number;
  enabled: boolean;
}

const DEBOUNCE_MS = 500;

export function useWidgetSync({ monthEndCash, netWorth, enabled }: Params): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

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
  }, [monthEndCash, netWorth, enabled]);
}
