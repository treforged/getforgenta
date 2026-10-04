import { formatCurrency } from '@/lib/calculations';

/**
 * "Bank's minimum: $X" beside a minimum the user typed in (ask ec48da25, 2026-10-03).
 *
 * A manual minimum is the user's decision, so sync never overwrites it. But a manual figure goes
 * stale silently: Tre's Discover read 150.40 while the bank took 198.17. The sync now records the
 * provider's figure in `bank_min_payment`, and this decides whether it is worth a line.
 *
 * Shown only when the minimum is manual, the bank's figure is known, positive, and differs by at
 * least a cent. A bank figure of 0 means "nothing still due on this statement" (paid already), not
 * "your minimum is $0", so it is never shown as a minimum.
 */
export function bankMinNote(
  minPayment: number | null | undefined,
  isManual: boolean | null | undefined,
  bankMin: number | null | undefined,
): string | null {
  if (isManual !== true) return null;
  if (bankMin == null || !Number.isFinite(bankMin) || bankMin <= 0) return null;
  if (minPayment != null && Math.abs(bankMin - minPayment) < 0.01) return null;
  return `Bank's minimum: ${formatCurrency(bankMin)}`;
}
