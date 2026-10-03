import type { PayBehavior } from '@/lib/card-pay-behavior';
import { ordinal } from '@/lib/ordinal';
import { formatCurrency } from '@/lib/calculations';

export function cardPayHint(
  b: PayBehavior,
  preference: 'statement' | 'full' | null,
): { text: string; mismatch: boolean } | null {
  if (b.sampleSize === 0) {
    return null;
  }

  if (!b.autopay) {
    if (b.lastAmount === null) {
      return null;
    }
    return { text: `Last payment ${formatCurrency(b.lastAmount)}.`, mismatch: false };
  }

  // Autopay paths
  const dayPart = b.dayOfMonth !== null ? ` on the ${ordinal(b.dayOfMonth)}` : '';
  const lastPart = b.lastAmount !== null ? ` (last ${formatCurrency(b.lastAmount)})` : '';

  if (b.kind === 'minimum') {
    const base = `Your bank autopays the minimum${dayPart}`;
    const mismatch = preference === 'statement' || preference === 'full';
    let text = `${base}${lastPart}.`;
    if (mismatch) {
      const plan = preference === 'full' ? 'the full balance' : 'the statement balance';
      text += ` The plan assumes ${plan} is paid.`;
    }
    return { text, mismatch };
  }

  // 'statement_or_more' | 'unknown' (treated the same)
  const base = `Your bank autopays${dayPart}`;
  const mismatch = preference === null;
  let text = `${base}${lastPart}.`;
  if (mismatch) {
    text += ' The plan assumes only the minimum is paid.';
  }
  return { text, mismatch };
}
