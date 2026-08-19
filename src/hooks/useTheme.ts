/**
 * The live theme: the stored choice, what it currently resolves to, and how to change it.
 *
 * ⚠️ IT LISTENS TO THE SYSTEM WHILE THE CHOICE IS `system`, which is the half people forget. A user
 * on "match my device" whose phone flips to dark at sunset should flip with it without reopening
 * the app — otherwise "follow my device" only means "follow my device at the moment I last launched".
 *
 * ⚠️ `resolved` IS DERIVED, NOT STORED. The first version kept it in state and set it from an
 * effect, which is the cascading extra render `react-hooks/set-state-in-effect` exists to stop —
 * and eslint caught it. The only state here is the two INPUTS (what the user chose, what the device
 * says); the answer is computed during render and the effect does nothing but touch the DOM.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  applyTheme, readStoredTheme, resolveTheme, THEME_STORAGE_KEY, type ThemeChoice,
} from '@/lib/theme';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

function systemPrefersLight(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(LIGHT_QUERY).matches;
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readStoredTheme);
  const [prefersLight, setPrefersLight] = useState<boolean>(systemPrefersLight);

  const resolved = resolveTheme(choice, prefersLight);

  useEffect(() => { applyTheme(resolved); }, [resolved]);

  // The listener stays mounted whatever the choice is: `resolveTheme` ignores `prefersLight` unless
  // the choice is `system`, so tracking it always costs nothing and means switching back to
  // `system` is correct immediately rather than at the next device change.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(LIGHT_QUERY);
    const onChange = () => setPrefersLight(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const choose = useCallback((next: ThemeChoice) => {
    setChoice(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // The theme still applies for this session; only its persistence is lost. Failing the switch
      // because a store is unavailable would be the worse half to give up.
    }
  }, []);

  return { choice, resolved, choose };
}
