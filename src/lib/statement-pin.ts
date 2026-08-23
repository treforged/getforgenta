// ─── Pinned-statement eligibility ────────────────────────
// Extracted from hooks/useCardProjection.ts so the pure card-row builder shared by /debt and the
// Dashboard widget (month0-debt-breakdown.ts) can label a pinned card without importing a React
// hook module. The hook re-exports it unchanged, so existing imports keep working.
import type { CardData } from '@/lib/credit-card-engine';

/**
 * True when this card carries a pinned interest-saving statement balance — the eligibility half of
 * `deriveIsbPins` (hooks/useCardProjection.ts), exported so a recommendation row can label a
 * pinned card without open-coding another copy of the rule (see deriveIsbPins' warning).
 *
 * The DUE-MONTH half is deliberately NOT here: it treats a null dueDay as month 1, which is
 * right for the engine's reserve and wrong for a display that must not invent a date.
 */
export function hasPinnedStatement(c: CardData, now: Date): boolean {
  if (c.paymentPreference !== 'statement' || c.statementBalance == null || c.balance <= 0) return false;
  if (c.startDate) {
    const startD = new Date(c.startDate + 'T00:00:00');
    const diff = (startD.getFullYear() - now.getFullYear()) * 12 + (startD.getMonth() - now.getMonth());
    if (diff > 0) return false;
  }
  return true;
}
