/**
 * CI-only experiment for ask 8a202850; the flag is written only by the Debug build's
 * simulator launch environment (ViewController.swift), so no user device ever has it.
 */
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { NativeGlass } from '@/lib/native-glass';

export function useSimGlassExperiment(): void {
  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      try {
        if (!Capacitor.isNativePlatform()) {
          return;
        }

        let flag = false;
        try {
          flag = window.localStorage.getItem('forgenta:sim-glass-experiment') === '1';
        } catch {
          flag = false;
        }
        if (!flag) {
          return;
        }

        const support = await NativeGlass.isSupported().catch(() => ({ supported: false }));
        if (!support?.supported) {
          return;
        }

        const safeAreaDiv = document.createElement('div');
        safeAreaDiv.style.position = 'fixed';
        safeAreaDiv.style.top = '0';
        safeAreaDiv.style.left = '0';
        safeAreaDiv.style.width = '0';
        safeAreaDiv.style.height = 'env(safe-area-inset-top)';
        safeAreaDiv.style.visibility = 'hidden';
        safeAreaDiv.style.pointerEvents = 'none';
        document.body.appendChild(safeAreaDiv);
        const height = safeAreaDiv.getBoundingClientRect().height;
        document.body.removeChild(safeAreaDiv);

        if (height < 1) {
          return;
        }

        if (cancelled) {
          return;
        }

        await NativeGlass.apply({
          id: 'sim-top-strip',
          x: 0,
          y: 0,
          width: window.innerWidth,
          height,
          cornerRadius: 0,
        }).catch(() => {});
      } catch {
        // swallow all unexpected errors
      }
    }

    void run();

    return () => {
      cancelled = true;
      NativeGlass.remove({ id: 'sim-top-strip' }).catch(() => {});
    };
  }, []);
}
