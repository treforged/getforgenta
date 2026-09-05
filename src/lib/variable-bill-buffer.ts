/**
 * How much MORE than the plan a variable bill should reserve in the cash floor.
 *
 * Tre, 2026-09-05: *"for variable items, the cash floor should calculate an extra buffer based
 * on historical payments. ex. my electric bill for this month was like 190, but i planned for
 * much less."*
 *
 * The floor reserves every bill at its rule's PLANNED amount. That is right for a bill that is
 * the same every month and wrong for one that is not: a rule saying $120 keeps reserving $120
 * after a $190 charge has landed, and the difference comes out of money the plan had already
 * promised to debt.
 *
 * ── THE DATA THAT DECIDED THE DESIGN (measured 2026-09-05, read-only) ────────────────────────
 * 798 synced transactions over about 7.5 months, 155 merchants. Grouped by merchant and month,
 * 18 merchants have 5 or more months of history, and they fall into three shapes:
 *
 *   effectively fixed   3 of them, standard deviation under 1%. One is $54.07 every single month.
 *   genuinely variable  about 9. One has mean $140.46, range $99.69-$197.93, sd $33.95, p90 $180.88.
 *   not bills at all    about 3. One has mean $13,263 and a range of $460 to $21,785.
 *
 * ── WHY A FLAT PERCENTAGE IS WRONG, AND WHY p90 BEATS MEAN-PLUS-SIGMA ────────────────────────
 * A flat percentage is wrong in BOTH directions at once. It strands cash on the three items
 * whose standard deviation is zero — money that could be retiring 27% debt — and it still
 * under-covers the ones that swing 40%. So the buffer is per item, from that item's own history.
 *
 * And the statistic is the 90th percentile, not mean + N-sigma, because the sigma in this data
 * is inflated by exactly the rows that are NOT bills. On the item that matches Tre's own example
 * — mean $140.46, worst month $197.93, his "like 190" — p90 lands at $180.88: it covers the
 * overrun without reserving for the single worst month ever recorded.
 *
 * ── WHAT KEEPS THE NON-BILLS OUT ─────────────────────────────────────────────────────────────
 * This is only ever called for an item ALREADY IN THE FLOOR, which means an item built from one
 * of the user's own recurring rules. That is what stops the $13,263 row anywhere near a floor:
 * merchant-level grouping on its own produces nonsense, and the caller's scope is the guard.
 * Do not loosen it by calling this on arbitrary merchant history.
 *
 * Pure: no database, no clock, no React. It imports nothing.
 */

/** One past payment matched to a bill. */
export interface BillPayment {
  /**
   * Local date string, 'YYYY-MM-DD'.
   *
   * Unused by the maths on purpose, and kept anyway: the UI has to be able to SHOW which
   * payments produced a buffer. A floor nobody can trace back to the user's own rows is exactly
   * the confident number this codebase refuses to print.
   */
  date: string;
  /** Positive dollars. A negative or non-finite entry is dropped rather than corrected. */
  amount: number;
}

export interface BufferInput {
  /** The rule's planned amount for this bill. */
  plannedAmount: number;
  /** Past payments matched to this rule. Order does not matter. */
  history: readonly BillPayment[];
  /**
   * The user's explicit setting, when they have made one.
   *
   * ⚠️ Almost nobody has. `recurring_rules.cost_type` reads 430 null, 3 'variable', 2 'fixed'
   * on the live database, so variability is DERIVED from the history and this only overrides it.
   * A feature gated on a field nobody fills in is a feature that never runs.
   */
  costType?: 'fixed' | 'variable' | null;
}

export interface BufferResult {
  /** Dollars to add to the planned amount in the cash floor. Never negative. */
  buffer: number;
  /** What the floor should reserve for this item: plannedAmount + buffer. */
  reserve: number;
  /** Why the buffer is what it is. Never null — the UI must always be able to say. */
  reason: 'not-enough-history' | 'fixed' | 'planned-already-covers' | 'from-history';
  /** How many payments survived filtering and were actually used. */
  sampleCount: number;
  /** The 90th percentile of that history, or null when there was not enough of it. */
  p90: number | null;
}

/**
 * Below this there is no distribution, only a couple of numbers.
 *
 * With 7.5 months of data most items have five to seven points, where p90 is close to "the
 * worst month so far". That is the safe direction for a floor, but it is not the statistic it
 * looks like, and the UI should say "from your last N payments" rather than imply more.
 */
export const MIN_OBSERVATIONS = 3;

/** Spread at or below this reads as a fixed bill: $54.07 every month needs no buffer. */
export const VARIABLE_CV_THRESHOLD = 0.1;

/** Money is rounded to the cent everywhere, never left as float dust. */
const toCents = (n: number): number => Math.round(n * 100) / 100;

/**
 * The value at `fraction` through the sorted values, interpolating between neighbours.
 *
 * Sorts a COPY: a helper that reorders its caller's array is a helper that changes what the
 * caller sees next time it reads it.
 */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) throw new Error('percentile: no values');
  if (values.length === 1) return values[0];

  const sorted = [...values].sort((a, b) => a - b);
  const index = fraction * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Sample standard deviation over the mean — spread expressed as a share of size, so a $5 swing
 * on a $500 bill and a $5 swing on a $10 one are not treated as the same thing.
 *
 * Returns 0 for fewer than two values, and for a mean of 0, because there is no spread to
 * measure in either case and a division would be the only thing that happened.
 */
export function coefficientOfVariation(values: readonly number[]): number {
  if (values.length < 2) return 0;

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (mean === 0) return 0;

  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance) / mean;
}

/**
 * The buffer for one bill, and the reason for it.
 *
 * The order of the checks is the contract, so read it as a sequence: too little history beats
 * everything; then an explicit user setting; then the derived answer; and only then the
 * history-based buffer.
 */
export function computeVariableBillBuffer(input: BufferInput): BufferResult {
  const amounts = input.history
    .map(p => p.amount)
    .filter(a => Number.isFinite(a) && a >= 0);
  const sampleCount = amounts.length;

  // No distribution, so no buffer, and the caller says so rather than inventing one.
  if (sampleCount < MIN_OBSERVATIONS) {
    return {
      buffer: 0, reserve: toCents(input.plannedAmount),
      reason: 'not-enough-history', sampleCount, p90: null,
    };
  }

  const p90 = toCents(percentile(amounts, 0.9));

  // An explicit setting outranks the derived answer in BOTH directions: 'fixed' suppresses a
  // buffer the spread would have produced, and 'variable' skips the fixed check below.
  const derivedFixed = coefficientOfVariation(amounts) <= VARIABLE_CV_THRESHOLD;
  if (input.costType === 'fixed' || (input.costType !== 'variable' && derivedFixed)) {
    return {
      buffer: 0, reserve: toCents(input.plannedAmount),
      reason: 'fixed', sampleCount, p90,
    };
  }

  // A plan that already meets the 90th percentile needs nothing added. That is a real and common
  // outcome, and it gets its own reason so the UI can say "your plan already covers this"
  // instead of showing a silent zero that looks like a failure to compute.
  const buffer = toCents(Math.max(0, p90 - input.plannedAmount));
  return {
    buffer,
    reserve: toCents(input.plannedAmount + buffer),
    reason: buffer === 0 ? 'planned-already-covers' : 'from-history',
    sampleCount,
    p90,
  };
}
