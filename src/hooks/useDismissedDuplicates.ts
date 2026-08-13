import { useCallback } from 'react';
import { usePersistedState } from './usePersistedState';

/**
 * Which duplicate-transaction warnings the user has already answered "both are real" to.
 *
 * WHY localStorage AND NOT A COLUMN. A dismissal is a UI preference about a warning, not financial
 * data — nothing downstream reads it, and losing it costs one re-dismissal. The same call was made
 * for `tre:transactions:show-plans` and `tre:debtpayoff:pause-savings`. It also keeps this feature
 * free of a migration, which an unattended session must not apply.
 *
 * The consequence, stated rather than hidden: dismissals are PER DEVICE. Dismissing on the laptop
 * leaves the phone still warning. That is the honest failure direction — the warning reappearing is
 * a nuisance, a warning that vanished everywhere because of an untracked device preference is a
 * duplicate charge nobody sees again.
 *
 * One key for the whole app, so dismissing on /transactions also quiets the Forecast breakdown.
 */
const STORAGE_KEY = 'tre:duplicate-txn:dismissed';

/**
 * Kept bounded so a long-lived ledger cannot grow this without limit. Oldest go first; a key that
 * falls off simply asks its question again, which is the safe direction.
 */
const MAX_DISMISSALS = 250;

export interface DismissedDuplicates {
  dismissed: string[];
  dismiss: (key: string) => void;
  /** Undo a dismissal — used by the "show dismissed" affordance. */
  restore: (key: string) => void;
}

export function useDismissedDuplicates(): DismissedDuplicates {
  const [dismissed, setDismissed] = usePersistedState<string[]>(STORAGE_KEY, []);

  const dismiss = useCallback((key: string) => {
    setDismissed(prev => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      return next.length > MAX_DISMISSALS ? next.slice(next.length - MAX_DISMISSALS) : next;
    });
  }, [setDismissed]);

  const restore = useCallback((key: string) => {
    setDismissed(prev => (prev.includes(key) ? prev.filter(k => k !== key) : prev));
  }, [setDismissed]);

  return { dismissed, dismiss, restore };
}
