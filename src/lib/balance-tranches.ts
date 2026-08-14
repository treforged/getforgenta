// A card can hold balances at DIFFERENT rates, and a promo rate can EXPIRE. Pure, no I/O.
//
// THE REAL CASE THIS EXISTS FOR (Tre's Discover, 2026-08-13): $5,037.73 moved from Prime Visa on
// 2026-06-21 at a 7.99% promo with a 0% fee, EXPIRING 2028-01-04 — while the remaining ~$5,279 of
// purchases pays ~16.6%. The card was stored as one blended 12.89% APR, which happened to total
// about right that month ($110.82 modeled vs $106.12 actually charged) and becomes silently wrong
// the moment either tranche moves — and stays wrong forever from 2028-01-04, when the projection
// keeps charging 7.99% on money that reprices to the standard rate (~$36/mo, ~$433/yr, invisible).
//
// SHAPE: `accounts.balance_tranches` is a jsonb array; the account's `apr` column is the STANDARD
// rate — what a tranche reprices to when its promo ends, and what the remainder (balance minus all
// tranches) pays. Null/absent tranches = single-APR card = the pre-existing behavior, untouched.
//
// ENGINE INTEGRATION IS DONE (handoff item 3, golden tests in
// `__tests__/credit-card-engine.tranches.test.ts`). `credit-card-engine.ts` walks a per-card
// LEDGER of tranche balances alongside its own balance walk: interest accrues per tranche at its
// own rate (repriced at the cliff), payment is allocated by `allocatePaymentAcrossTranches` below,
// and avalanche ordering ranks on the resulting MARGINAL rate. This module stays pure and stays
// the single source of that arithmetic — the engine must never grow a second allocator.
//
// The parity rule that integration is held to: a card with no tranches produces numbers identical
// to the pre-tranche engine, to the cent. Keep it that way.

/** One sub-balance at its own rate. */
export interface BalanceTranche {
  id: string;
  label: string;
  balance: number;
  apr: number;
  /** `YYYY-MM-DD`, or null for a permanent rate (e.g. a fixed BT rate with no expiry). */
  promo_end_date: string | null;
}

/** Postgres numerics arrive as strings; jsonb from supabase-js arrives as unknown. */
export function parseTranches(raw: unknown): BalanceTranche[] {
  if (!Array.isArray(raw)) return [];
  const out: BalanceTranche[] = [];
  for (const t of raw) {
    if (typeof t !== 'object' || t === null) continue;
    const r = t as Record<string, unknown>;
    const balance = Number(r.balance);
    const apr = Number(r.apr);
    if (!Number.isFinite(balance) || balance <= 0) continue;
    if (!Number.isFinite(apr) || apr < 0) continue;
    out.push({
      id: String(r.id ?? ''),
      label: String(r.label ?? 'Promo balance'),
      balance,
      apr,
      promo_end_date: typeof r.promo_end_date === 'string' && r.promo_end_date ? r.promo_end_date : null,
    });
  }
  return out;
}

/** A tranche's APR as of a date — promo rate until `promo_end_date`, the standard rate after. */
export function trancheAprAsOf(tranche: BalanceTranche, standardApr: number, asOf: string): number {
  if (tranche.promo_end_date && asOf >= tranche.promo_end_date) return standardApr;
  return tranche.apr;
}

export interface TrancheInterestLine {
  label: string;
  balance: number;
  apr: number;
  monthlyInterest: number;
  /** Set when this line's rate is a promo that will end. */
  promoEndDate: string | null;
  /** What this line will cost per month AFTER the promo ends, at the standard rate. */
  monthlyInterestAfterPromo: number | null;
}

export interface TrancheInterestBreakdown {
  lines: TrancheInterestLine[];
  /** Balance not covered by any tranche, at the standard rate. Never negative. */
  remainderBalance: number;
  remainderMonthlyInterest: number;
  totalMonthlyInterest: number;
}

/**
 * The card's monthly interest, split by tranche, as of a date.
 *
 * The remainder (total balance minus tranches) pays the standard rate. Tranches summing past the
 * balance are clamped in LISTED ORDER — the honest reading of inconsistent data is that the later
 * entries are stale, and a negative remainder must never subtract interest.
 */
export function trancheInterestBreakdown(
  totalBalance: number,
  tranches: readonly BalanceTranche[],
  standardApr: number,
  asOf: string,
): TrancheInterestBreakdown {
  const lines: TrancheInterestLine[] = [];
  let covered = 0;
  for (const t of tranches) {
    const usable = Math.max(0, Math.min(t.balance, totalBalance - covered));
    if (usable <= 0) continue;
    covered += usable;
    const apr = trancheAprAsOf(t, standardApr, asOf);
    const stillPromo = apr === t.apr && t.promo_end_date !== null;
    lines.push({
      label: t.label,
      balance: usable,
      apr,
      monthlyInterest: usable * (apr / 100) / 12,
      promoEndDate: stillPromo ? t.promo_end_date : null,
      monthlyInterestAfterPromo: stillPromo ? usable * (standardApr / 100) / 12 : null,
    });
  }
  const remainderBalance = Math.max(0, totalBalance - covered);
  const remainderMonthlyInterest = remainderBalance * (standardApr / 100) / 12;
  return {
    lines,
    remainderBalance,
    remainderMonthlyInterest,
    totalMonthlyInterest: lines.reduce((s, l) => s + l.monthlyInterest, 0) + remainderMonthlyInterest,
  };
}

export interface PromoExpiryWarning {
  label: string;
  balance: number;
  promoApr: number;
  standardApr: number;
  promoEndDate: string;
  /** The added cost of carrying this balance past the cliff, per month. */
  extraMonthlyInterest: number;
  /** Principal per month, starting now, to clear the tranche before it reprices. */
  requiredMonthlyPaydown: number;
  monthsRemaining: number;
}

/** Whole months from `asOf` (YYYY-MM-DD) until `end`, floored at 1 so a division never explodes. */
function monthsUntil(asOf: string, end: string): number {
  const [ay, am] = asOf.split('-').map(Number);
  const [by, bm] = end.split('-').map(Number);
  return Math.max(1, (by * 12 + bm) - (ay * 12 + am));
}

/**
 * The warnings a card's tranches carry as of a date: every still-active promo whose expiry would
 * make the balance more expensive. A promo cheaper than nothing (standard <= promo) warns nothing.
 */
export function promoExpiryWarnings(
  tranches: readonly BalanceTranche[],
  standardApr: number,
  asOf: string,
): PromoExpiryWarning[] {
  const out: PromoExpiryWarning[] = [];
  for (const t of tranches) {
    if (!t.promo_end_date || asOf >= t.promo_end_date) continue;
    if (standardApr <= t.apr) continue;
    const months = monthsUntil(asOf, t.promo_end_date);
    out.push({
      label: t.label,
      balance: t.balance,
      promoApr: t.apr,
      standardApr,
      promoEndDate: t.promo_end_date,
      extraMonthlyInterest: t.balance * ((standardApr - t.apr) / 100) / 12,
      requiredMonthlyPaydown: t.balance / months,
      monthsRemaining: months,
    });
  }
  return out.sort((a, b) => a.promoEndDate.localeCompare(b.promoEndDate));
}

/**
 * CARD Act §164: payment above the minimum goes to the highest-APR balance first.
 *
 * Rates are resolved as of `asOf`, so after a promo expires its tranche competes at the standard
 * rate. Returns dollars per tranche id, remainder under `'remainder'`. This is what makes an
 * avalanche recommendation correct on a multi-rate card — and it is exported for the engine
 * integration to reuse rather than re-derive.
 */
export function allocatePaymentAcrossTranches(
  payment: number,
  totalBalance: number,
  tranches: readonly BalanceTranche[],
  standardApr: number,
  asOf: string,
): Map<string, number> {
  const breakdown = trancheInterestBreakdown(totalBalance, tranches, standardApr, asOf);
  const buckets: { id: string; apr: number; balance: number }[] = breakdown.lines.map((l, i) => ({
    id: tranches[i]?.id ?? l.label, apr: l.apr, balance: l.balance,
  }));
  if (breakdown.remainderBalance > 0) {
    buckets.push({ id: 'remainder', apr: standardApr, balance: breakdown.remainderBalance });
  }
  buckets.sort((a, b) => b.apr - a.apr);

  const out = new Map<string, number>();
  let left = Math.max(0, payment);
  for (const b of buckets) {
    const applied = Math.min(left, b.balance);
    if (applied > 0) out.set(b.id, applied);
    left -= applied;
    if (left <= 0) break;
  }
  return out;
}
