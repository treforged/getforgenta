/**
 * WHY: Answers "which card for this purchase" under the house rule
 * save-the-user-the-most-money: a carried balance means interest from day one,
 * which outweighs rewards; rates are user-entered and never invented;
 * planned cards are never suggested (ask 1f3217bb, plan docs/plans/2026-10-01_card-for-purchase-advisor.md).
 */
import { isCardOpenAsOf } from '@/lib/card-start-date';

export type PurchaseCategory = 'groceries' | 'gas' | 'dining' | 'travel' | 'other';
export const PURCHASE_CATEGORIES: readonly PurchaseCategory[] = ['groceries','gas','dining','travel','other'];
export interface CardRewards { base_pct: number; categories?: Partial<Record<PurchaseCategory, number>> }
export interface AdvisorCard {
  id: string; name: string; account_type: string; active: boolean | null;
  balance: number | string | null; apr: number | string | null; credit_limit: number | string | null;
  card_start_date?: string | null; rewards?: CardRewards | null;
}
export interface CardOption {
  id: string; name: string;
  rewardsEarned: number | null;
  monthlyInterest: number | null;
  utilizationAfter: number | null;
  overUtilization: boolean;
  netValue: number;
}
export interface ExcludedCard { id: string; name: string; why: 'not-open' | 'over-limit' }
export function rankCardsForPurchase(args: { cards: readonly AdvisorCard[]; amount: number; category: PurchaseCategory; today: Date; utilizationTarget?: number }): { ranked: CardOption[]; excluded: ExcludedCard[] } {
  const { cards, amount, category, today, utilizationTarget = 30 } = args;
  if (!(Number.isFinite(amount) && amount > 0)) {
    return { ranked: [], excluded: [] };
  }

  const excluded: ExcludedCard[] = [];
  const options: CardOption[] = [];

  for (const card of cards) {
    if (card.account_type !== 'credit_card' || card.active !== true) {
      continue;
    }

    if (!isCardOpenAsOf(card, today)) {
      excluded.push({ id: card.id, name: card.name, why: 'not-open' });
      continue;
    }

    const balance = Number(card.balance) || 0;
    const limit = Number(card.credit_limit) || 0;
    const aprRaw = card.apr == null || card.apr === '' ? null : Number(card.apr);
    const apr = aprRaw !== null && Number.isFinite(aprRaw) ? aprRaw : null;
    if (limit > 0 && balance + amount > limit) {
      excluded.push({ id: card.id, name: card.name, why: 'over-limit' });
      continue;
    }

    const rewardsEarned = card.rewards ? amount * (card.rewards.categories?.[category] ?? card.rewards.base_pct) / 100 : null;
    // A carried balance has no grace period: the purchase accrues interest from day one. An unknown
    // APR on a carried balance is null (ranked last), never treated as free.
    const monthlyInterest: number | null = balance > 0
      ? (apr === null ? null : amount * apr / 100 / 12)
      : 0;

    const utilizationAfter = limit > 0 ? (balance + amount) / limit * 100 : null;
    const overUtilization = utilizationAfter !== null && utilizationAfter > utilizationTarget;

    // Net is built from the ROUNDED parts, so the figures a user sees always add up.
    const earned = rewardsEarned === null ? null : Math.round(rewardsEarned * 100) / 100;
    const interest = monthlyInterest === null ? null : Math.round(monthlyInterest * 100) / 100;
    const netValue = (earned ?? 0) - (interest ?? 0);

    options.push({
      id: card.id,
      name: card.name,
      rewardsEarned: earned,
      monthlyInterest: interest,
      utilizationAfter: utilizationAfter === null ? null : Math.round(utilizationAfter * 10) / 10,
      overUtilization,
      netValue: Math.round(netValue * 100) / 100
    });
  }

  options.sort((a, b) => {
    if (a.monthlyInterest === null && b.monthlyInterest !== null) return 1;
    if (a.monthlyInterest !== null && b.monthlyInterest === null) return -1;
    if (a.netValue !== b.netValue) return b.netValue - a.netValue;
    if (a.overUtilization !== b.overUtilization) return a.overUtilization ? 1 : -1;
    if (a.utilizationAfter === null && b.utilizationAfter !== null) return 1;
    if (a.utilizationAfter !== null && b.utilizationAfter === null) return -1;
    if (a.utilizationAfter !== null && b.utilizationAfter !== null) {
      if (a.utilizationAfter !== b.utilizationAfter) return a.utilizationAfter - b.utilizationAfter;
    }
    return a.name.localeCompare(b.name);
  });

  return { ranked: options, excluded };
}
