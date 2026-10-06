/**
 * Forgenta Premium's first-year intro offer (Tre, 2026-10-06, decision 994dbd43, ask a6375f1c):
 * $0.99/month for the first 12 months, or $9.99 up front for the first year, then the regular price.
 * Tre first said $1/$10; App Store Connect has no $1.00 USD point, so he chose $0.99/$9.99 on EVERY
 * platform (ask 852772a5, 2026-10-06: "1. yes") - one price for the ads, and the cheaper of the two.
 * New subscribers only. All money is integer cents. Drafted by the free tier, reviewed by Ada.
 */
export type Plan = 'monthly' | 'yearly'

export const REGULAR_CENTS: Readonly<Record<Plan, number>> = {
  monthly: 999,
  yearly: 8999,
} as const

export const INTRO_CENTS: Readonly<Record<Plan, number>> = {
  monthly: 99,
  yearly: 999,
} as const

export const INTRO_MONTHS = 12

/**
 * Returns the per-month discount (in cents) for a given plan.
 */
export function introDiscountCents(plan: Plan): number {
  return REGULAR_CENTS[plan] - INTRO_CENTS[plan]
}

/**
 * Returns the total cost (in cents) for the first year, depending on whether the intro offer applies.
 */
export function firstYearCostCents(plan: Plan, intro: boolean): number {
  if (intro) {
    return plan === 'monthly' ? INTRO_CENTS[plan] * INTRO_MONTHS : INTRO_CENTS[plan]
  }
  return plan === 'monthly' ? REGULAR_CENTS[plan] * INTRO_MONTHS : REGULAR_CENTS[plan]
}

/**
 * Returns the amount saved (in cents) during the first year when using the intro offer.
 */
export function firstYearSavingsCents(plan: Plan): number {
  return firstYearCostCents(plan, false) - firstYearCostCents(plan, true)
}

/**
 * Formats an integer cent amount as a USD currency string (en-US locale).
 * Throws RangeError if the input is not a non-negative integer.
 */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RangeError('cents must be a non-negative integer')
  }
  const dollars = cents / 100
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return formatter.format(dollars)
}

/**
 * History of a user's subscription status.
 */
export interface IntroHistory {
  everSubscribed: boolean
  currentlyPremium: boolean
  compOrPromo: boolean
}

/**
 * Determines whether a user is eligible for the intro offer.
 * Eligible only when the user has never subscribed, is not currently premium,
 * and has no compensation or promotional flag.
 */
export function isIntroEligible(h: IntroHistory): boolean {
  return !h.everSubscribed && !h.currentlyPremium && !h.compOrPromo
}

/**
 * Returns a human-readable description of the intro offer for a given plan.
 */
export function introOfferLine(plan: Plan): string {
  // Derived from the constants, so the paywall copy cannot drift from what checkout charges.
  const intro = formatCents(INTRO_CENTS[plan])
  const regular = formatCents(REGULAR_CENTS[plan])
  return plan === 'monthly'
    ? `${intro}/mo for your first year, then ${regular}/mo`
    : `${intro} for your first year, then ${regular}/yr`
}
