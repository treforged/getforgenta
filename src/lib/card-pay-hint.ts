import type { PayBehavior } from '@/lib/card-pay-behavior';
import { ordinal } from '@/lib/ordinal';
import { formatCurrency } from '@/lib/calculations';

export function cardPayHint(
  b: PayBehavior,
  preference: 'statement' | 'full' | null,
  // True when THIS month's plan pays only the minimum on this card, e.g. because goals ranked
  // above the cards come first (Tre, 2026-10-03, decision 2d104bc7: "thats what the goal order
  // is for"). The plan then agrees with a minimum autopay, so it is not a mismatch.
  planPaysMinimum = false,
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
    const mismatch = !planPaysMinimum && (preference === 'statement' || preference === 'full');
    let text = `${base}${lastPart}.`;
    if (planPaysMinimum && (preference === 'statement' || preference === 'full')) {
      text += ' The plan pays the minimum too for now: goals ranked above your cards come first.';
    } else if (mismatch) {
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
