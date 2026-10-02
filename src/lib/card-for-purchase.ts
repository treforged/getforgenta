/**
 * WHY: Answers "which card for this purchase" under the house rule
 * save-the-user-the-most-money: a carried balance means interest from day one,
 * which outweighs rewards; rates are user-entered and never invented;
 * planned cards are never suggested (ask 1f3217bb, plan docs/plans/2026-10-01_card-for-purchase-advisor.md).
 */
import { isCardOpenAsOf } from '@/lib/card-start-date';
import { toLocalDateStr } from '@/lib/scheduling';

export type PurchaseCategory = 'groceries' | 'gas' | 'dining' | 'travel' | 'other';
export const PURCHASE_CATEGORIES: readonly PurchaseCategory[] = ['groceries','gas','dining','travel','other'];
export interface CardRewards { base_pct: number; categories?: Partial<Record<PurchaseCategory, number>> }
export interface AdvisorCard {
  id: string; name: string; account_type: string; active: boolean | null;
  balance: number | string | null; apr: number | string | null; credit_limit: number | string | null;
  card_start_date?: string | null; rewards?: CardRewards | null; welcomeOffer?: WelcomeOffer | null;
}
export interface CardOption {
  id: string; name: string;
  rewardsEarned: number | null;
  monthlyInterest: number | null;
  utilizationAfter: number | null;
  overUtilization: boolean;
  offerValue: number | null;     // share of an OPEN welcome bonus this purchase earns, null when none
  netValue: number;
  /** A checking account's debit card (ask 37c89404): no interest, no utilization, spends cash now. */
  isDebit: boolean;
}
/** A welcome bonus: spend `required_spend` by `deadline` (YYYY-MM-DD) to earn `bonus_value` dollars. */
export interface WelcomeOffer { required_spend: number; spent: number; bonus_value: number; deadline: string }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates the accounts.card_rewards jsonb. Anything malformed is null: a wrong rate is worse than none. */
export function parseCardRewards(raw: unknown): CardRewards | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r.base_pct) || r.base_pct < 0 || r.base_pct > 100) return null;
  const categories: Partial<Record<PurchaseCategory, number>> = {};
  if (r.categories && typeof r.categories === 'object' && !Array.isArray(r.categories)) {
    for (const c of PURCHASE_CATEGORIES) {
      const v = (r.categories as Record<string, unknown>)[c];
      if (isNum(v) && v >= 0 && v <= 100) categories[c] = v;
    }
  }
  return { base_pct: r.base_pct, categories };
}

/** Validates the accounts.welcome_offer jsonb. Malformed or impossible offers are null. */
export function parseWelcomeOffer(raw: unknown): WelcomeOffer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isNum(o.required_spend) || o.required_spend <= 0) return null;
  if (!isNum(o.bonus_value) || o.bonus_value <= 0) return null;
  const spent = isNum(o.spent) && o.spent >= 0 ? o.spent : 0;
  if (typeof o.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.deadline)) return null;
  return { required_spend: o.required_spend, spent, bonus_value: o.bonus_value, deadline: o.deadline };
}

/**
 * The share of an open welcome bonus this purchase earns: each dollar toward the requirement is worth
 * bonus / required. Null when there is no offer, it has passed its deadline, or it is already met.
 */
export function welcomeOfferValue(offer: WelcomeOffer | null | undefined, amount: number, today: Date): number | null {
  if (!offer) return null;
  const remaining = offer.required_spend - offer.spent;
  if (remaining <= 0 || offer.deadline < toLocalDateStr(today)) return null;
  return Math.min(amount, remaining) * offer.bonus_value / offer.required_spend;
}

export interface ExcludedCard { id: string; name: string; why: 'not-open' | 'over-limit' | 'not-enough-cash' }

/** Account types that carry a debit card. Savings accounts do not, so they are never offered. */
export const DEBIT_ACCOUNT_TYPES: readonly string[] = ['checking'];
export function rankCardsForPurchase(args: { cards: readonly AdvisorCard[]; amount: number; category: PurchaseCategory; today: Date; utilizationTarget?: number }): { ranked: CardOption[]; excluded: ExcludedCard[] } {
  const { cards, amount, category, today, utilizationTarget = 30 } = args;
  if (!(Number.isFinite(amount) && amount > 0)) {
    return { ranked: [], excluded: [] };
  }

  const excluded: ExcludedCard[] = [];
  const options: CardOption[] = [];

  for (const card of cards) {
    const isDebit = DEBIT_ACCOUNT_TYPES.includes(card.account_type);
    if ((card.account_type !== 'credit_card' && !isDebit) || card.active !== true) {
      continue;
    }

    if (isDebit) {
      // Tre 2026-10-01: "debit cards should also be an option". A debit purchase leaves checking
      // today, so it can never cost interest - and it is impossible beyond the cash that is there.
      const cash = Number(card.balance) || 0;
      if (amount > cash) {
        excluded.push({ id: card.id, name: card.name, why: 'not-enough-cash' });
        continue;
      }
      const earned = card.rewards
        ? Math.round(amount * (card.rewards.categories?.[category] ?? card.rewards.base_pct) / 100 * 100) / 100
        : null;
      options.push({
        id: card.id, name: card.name, rewardsEarned: earned, monthlyInterest: 0,
        utilizationAfter: null, overUtilization: false, offerValue: null,
        netValue: earned ?? 0, isDebit: true,
      });
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
    const offerRaw = welcomeOfferValue(card.welcomeOffer, amount, today);
    const offer = offerRaw === null ? null : Math.round(offerRaw * 100) / 100;
    const netValue = (earned ?? 0) + (offer ?? 0) - (interest ?? 0);

    options.push({
      id: card.id,
      name: card.name,
      rewardsEarned: earned,
      monthlyInterest: interest,
      utilizationAfter: utilizationAfter === null ? null : Math.round(utilizationAfter * 10) / 10,
      overUtilization,
      offerValue: offer,
      netValue: Math.round(netValue * 100) / 100,
      isDebit: false,
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
