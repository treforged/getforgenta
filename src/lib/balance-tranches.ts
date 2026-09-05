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
  /**
   * The CONTRACTUAL instalment this tranche must receive each month while its promo is live, or
   * null for a promo that carries no schedule of its own (an ordinary balance-transfer rate).
   *
   * ⚠️ WITHOUT THIS FIELD THE MODEL INVENTS A REPRICE CLIFF. Measured on Tre's Prime Visa
   * 2026-08-20: four Chase Equal Pay promos totalling $5,587.75, each of which divides into a
   * WHOLE number of payments landing exactly on its own `promo_end_date` (largest residual across
   * all four: ten cents). They are equal-payment instalments sized to retire at expiry — that is
   * the product definition, not a coincidence. But every allocator here sorts highest-APR-first,
   * so a 0% tranche receives nothing, sits untouched until `trancheAprAsOf` flips it to the
   * standard rate, and only then becomes the avalanche target. The panel therefore showed
   * $4,460.80 repricing from 0% to 27.49% across Jul-Aug 2027 — money the statement shows will
   * already have been paid off. Honouring this figure is what removes that phantom.
   *
   * Plaid never supplies it, and `shouldSeedTranches` only writes when `balance_tranches` is
   * empty, so like `promo_end_date` this is a user-entered field a sync cannot clobber.
   *
   * Optional rather than required: most tranches genuinely have no instalment, and every stored
   * row predating this field is absent rather than null. `parseTranches` always normalises it to
   * a number or null, and `trancheMinimumAsOf` treats absent, null and 0 identically.
   */
  min_payment?: number | null;
  /**
   * A FLAT MONTHLY FEE this tranche charges, or null. Dollars, not a rate.
   *
   * ⚠️ A 0% TRANCHE IS NOT A FREE TRANCHE, and until this field existed the app said it was.
   * Chase Pay Over Time — which is what every one of Tre's Prime Visa tranches is — charges a
   * fixed monthly fee INSTEAD of interest. Measured 2026-09-05 from three plan-confirmation
   * emails: PayPal Zettle $1,322.50 principal with **$166.20 of fees**, Costco $368.89 with
   * $55.92, Carnival $410.00 with $62.28. **$284.40 across three plans, 13.5% of principal,
   * and the forecast could not see a cent of it** because `apr: 0` reads as costless.
   *
   * The arithmetic that proves it is a fee and not hidden interest: each plan's monthly payment
   * times twelve equals principal plus fees to within two cents (12 × $124.06 = $1,488.72
   * against $1,322.50 + $166.20 = $1,488.70). A rate would not divide that evenly.
   *
   * Null on every existing row and on anything Plaid supplies — Plaid does not report plan fees
   * — so absent means the same as it always did, and no projection moves until a user or a
   * statement fills it in. Same user-entered, sync-safe treatment as `promo_end_date` and
   * `min_payment`.
   */
  monthly_fee?: number | null;
  /**
   * TRUE when this tranche's schedule cannot be shortened by paying more.
   *
   * ⚠️ THIS MOVES THE PAYOFF DATE, NOT JUST THE COST, and it is why the fee alone was not
   * enough. Chase applies a payment by ALLOCATION RULES — the minimum goes to the LOWEST APR
   * balance and any surplus to the HIGHEST. So a cardholder carrying a 27.49% revolving balance
   * **cannot** choose to prepay a 0% Pay Over Time plan: every extra dollar is taken by the
   * expensive balance whether they want that or not. The plan runs its full term.
   *
   * Without this flag the engine treats a 0% tranche as something surplus can accelerate, and
   * projects a payoff date the card will not honour. With it, `min_payment` is a CEILING as well
   * as a floor: the tranche receives exactly its instalment and the surplus routes past it.
   *
   * Absent/false on every existing row, so nothing moves until a user marks a plan as one.
   */
  fixed_term?: boolean | null;
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
      min_payment: minPaymentOf(r.min_payment),
      monthly_fee: positiveOrNull(r.monthly_fee),
      fixed_term: r.fixed_term === true,
    });
  }
  return out;
}

/** A tranche instalment is only meaningful as a positive number; anything else reads as absent. */
function minPaymentOf(raw: unknown): number | null {
  return positiveOrNull(raw);
}

/** Shared by `min_payment` and `monthly_fee`: zero, negative and unparseable all read as absent. */
function positiveOrNull(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The instalment this tranche must receive in the month containing `asOf`, or 0.
 *
 * Zero once the promo has ended: past `promo_end_date` the balance is ordinary money at the
 * standard rate, with no schedule of its own left to protect.
 */
export function feeAsOf(tranche: BalanceTranche, asOf: string): number {
  if (!tranche.monthly_fee || tranche.monthly_fee <= 0) return 0;
  // Deliberately the SAME condition as trancheMinimumAsOf below. A plan's fee and its instalment
  // begin and end together; if these two ever disagree the card is being charged for a plan that
  // no longer has a schedule, or given a schedule it is not paying for.
  if (tranche.promo_end_date && asOf > tranche.promo_end_date) return 0;
  return tranche.monthly_fee;
}

export function trancheMinimumAsOf(tranche: BalanceTranche, asOf: string): number {
  if (!tranche.min_payment || tranche.min_payment <= 0) return 0;
  if (tranche.promo_end_date && asOf > tranche.promo_end_date) return 0;
  return tranche.min_payment;
}

/** A tranche's APR as of a date — promo rate until `promo_end_date`, the standard rate after. */
export function trancheAprAsOf(tranche: BalanceTranche, standardApr: number, asOf: string): number {
  if (tranche.promo_end_date && asOf >= tranche.promo_end_date) return standardApr;
  return tranche.apr;
}

export interface TrancheInterestLine {
  /** The source tranche's `id`. Carried so callers can map a line back without index arithmetic —
   *  lines with no usable balance are SKIPPED, so a line's position is not its tranche's position. */
  id: string;
  label: string;
  balance: number;
  apr: number;
  monthlyInterest: number;
  /**
   * The flat monthly fee this line charges, if any. Reported SEPARATELY from interest rather
   * than folded into it, because they are different things to a user: interest shrinks as the
   * balance does, a plan fee does not. A UI that added them would be unable to say why a 0%
   * tranche costs anything at all.
   */
  monthlyFee: number;
  /** Interest plus fee — what this line actually costs per month. */
  monthlyCost: number;
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
  /** Every line's flat fee. Zero for a card with no fee-bearing plan, which is most of them. */
  totalMonthlyFees: number;
  /**
   * What the card's balance ACTUALLY costs this month: interest plus fees.
   *
   * ⚠️ THIS IS THE NUMBER TO SHOW A USER. `totalMonthlyInterest` alone reports a Pay Over Time
   * card as costing nothing, which is how $284.40 a year went unseen.
   */
  totalMonthlyCost: number;
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
      id: t.id || t.label,
      label: t.label,
      balance: usable,
      apr,
      monthlyInterest: usable * (apr / 100) / 12,
      // The fee is charged for as long as the plan runs, and stops with it — past
      // `promo_end_date` the balance is ordinary money at the standard rate with no plan left
      // to charge for. Same rule as `trancheMinimumAsOf`, and it must stay the same rule.
      monthlyFee: feeAsOf(t, asOf),
      monthlyCost: usable * (apr / 100) / 12 + feeAsOf(t, asOf),
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
    totalMonthlyFees: lines.reduce((s, l) => s + l.monthlyFee, 0),
    totalMonthlyCost:
      lines.reduce((s, l) => s + l.monthlyCost, 0) + remainderMonthlyInterest,
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

/**
 * Whole months from `asOf` (YYYY-MM-DD) until `end`, floored at 1 so a division never explodes.
 *
 * Exported because `dated-commitments.ts` runs the same deadline arithmetic over savings goals and
 * car funds, and two definitions of "how many months do I have left" would eventually disagree by
 * one — which on a promo cliff is the difference between clearing it and not.
 */
export function monthsUntil(asOf: string, end: string): number {
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
  const byId = new Map(tranches.map(t => [t.id || t.label, t]));
  // ⚠️ Map lines back by ID, never by index. `trancheInterestBreakdown` SKIPS any tranche with no
  // usable balance (tranches summing past the card balance are clamped in listed order), so
  // `lines[i]` is not `tranches[i]` the moment one is clamped away, and the old index lookup
  // silently paid the wrong tranche.
  const buckets: TranchePayable[] = breakdown.lines.map(l => {
    const t = byId.get(l.id);
    return {
      id: l.id,
      apr: l.apr,
      balance: l.balance,
      minPayment: t ? trancheMinimumAsOf(t, asOf) : 0,
      promoEndDate: l.promoEndDate,
      fixedTerm: t?.fixed_term === true,
    };
  });
  if (breakdown.remainderBalance > 0) {
    buckets.push({
      id: 'remainder', apr: standardApr, balance: breakdown.remainderBalance,
      minPayment: 0, promoEndDate: null,
    });
  }
  return splitPaymentAcrossTranches(payment, buckets);
}

/** One payable sub-balance, as the splitter needs to see it. */
export interface TranchePayable {
  id: string;
  balance: number;
  /** The rate in force this month — already repriced if the promo has ended. */
  apr: number;
  /** The contractual instalment due this month, or 0. From `trancheMinimumAsOf`. */
  minPayment: number;
  /** Only for ordering the instalment pass; nulls sort last. */
  promoEndDate: string | null;
  /**
   * When true, `minPayment` is a CEILING as well as a floor — the surplus pass skips this
   * bucket entirely. See `BalanceTranche.fixed_term` for why Chase's allocation rules make an
   * accelerable 0% plan a fiction.
   */
  fixedTerm?: boolean;
}

/**
 * Split one month's payment across a card's sub-balances.
 *
 * TWO PASSES, AND THE ORDER OF THEM IS THE WHOLE POINT.
 *
 * 1. **Contractual instalments first.** A promo with its own schedule (Chase Equal Pay, and every
 *    "equal payments, no interest" plan) must receive its instalment or it falls behind its
 *    amortization and the shortfall reprices at the standard rate. Nothing about being 0% makes
 *    that money safe to skip — being 0% is exactly what an APR-ranked sweep uses to skip it.
 *    Soonest expiry first, so a short-dated plan is never starved by a long-dated one when the
 *    payment cannot cover both.
 * 2. **Everything left, highest rate first.** The CARD Act rule for anything above the minimum,
 *    and unchanged from the previous behaviour.
 *
 * A card whose tranches carry no `min_payment` therefore behaves EXACTLY as before — pass 1 is
 * empty and pass 2 is the old sweep. That parity is deliberate and is pinned by tests.
 */
export function splitPaymentAcrossTranches(
  payment: number,
  buckets: readonly TranchePayable[],
): Map<string, number> {
  const out = new Map<string, number>();
  let left = Math.max(0, payment);
  if (left <= 0) return out;

  const apply = (id: string, amount: number) => {
    if (amount <= 0) return;
    out.set(id, (out.get(id) ?? 0) + amount);
    left -= amount;
  };

  // Pass 1 — contractual instalments, soonest-expiring promo first.
  const instalments = buckets
    .filter(b => b.minPayment > 0 && b.balance > 0)
    .sort((a, b) => (a.promoEndDate ?? '9999-12-31').localeCompare(b.promoEndDate ?? '9999-12-31'));
  for (const b of instalments) {
    if (left <= 0) break;
    apply(b.id, Math.min(left, b.minPayment, b.balance));
  }

  // Pass 2 — the surplus, highest rate first, net of whatever pass 1 already put on each bucket.
  //
  // ⚠️ FIXED-TERM BUCKETS ARE EXCLUDED, and that is the whole point of the flag. A Chase Pay Over
  // Time plan cannot be prepaid while a revolving balance exists: the card's own allocation rules
  // send every surplus dollar to the highest APR. Paying one down here would project a payoff
  // date the card will not honour. Their instalment was already paid in pass 1, in full.
  const bySurplus = [...buckets].filter(b => !b.fixedTerm).sort((a, b) => b.apr - a.apr);
  for (const b of bySurplus) {
    if (left <= 0) break;
    apply(b.id, Math.min(left, b.balance - (out.get(b.id) ?? 0)));
  }
  return out;
}
