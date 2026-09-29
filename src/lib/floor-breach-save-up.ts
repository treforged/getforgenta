/**
 * Calculates the amount needed to save up to reach a cash floor.
 * shortfall is the gap to the cash FLOOR (not zero) and is rounded up
 * to whole cents so the plan always covers the gap.
 */
export interface FloorBreachSaveUp {
  shortfall: number
  months: number
  perMonth: number
  startLabel: string | null
}

/**
 * Computes a saving plan to cover a cash shortfall before a breach.
 *
 * Returns null for any non‑finite inputs or when the shortfall is negligible.
 */
export function floorBreachSaveUp(input: {
  breachIndex: number
  endingCash: number
  floor: number
  monthLabels: readonly string[]
}): FloorBreachSaveUp | null {
  const { breachIndex, endingCash, floor, monthLabels } = input

  // Validate numeric inputs
  if (
    !Number.isFinite(breachIndex) ||
    !Number.isFinite(endingCash) ||
    !Number.isFinite(floor)
  ) {
    return null
  }

  // Test the RAW gap first: rounding up to cents before this check turns 4e-13 of float residue
  // into a $0.01 "shortfall". Half a cent matches the engine's own belowSafeMinimum tolerance.
  const rawShortfall = floor - endingCash
  if (rawShortfall <= 0.005) {
    return null
  }
  const shortfall = Math.ceil(rawShortfall * 100) / 100

  // Determine months available for saving (month 0 is current, partially elapsed)
  const months = Math.max(0, Math.floor(breachIndex) - 1)

  let perMonth: number
  let startLabel: string | null

  if (months === 0) {
    perMonth = shortfall
    startLabel = null
  } else {
    // Whole‑dollar amount, rounded up to ensure coverage
    perMonth = Math.ceil(shortfall / months)
    startLabel = monthLabels[1] ?? null
  }

  return { shortfall, months, perMonth, startLabel }
}

/**
 * Formats a human‑readable suffix describing the saving plan.
 */
export function formatSaveUpSuffix(s: FloorBreachSaveUp): string {
  const { months, perMonth, shortfall, startLabel } = s

  if (months >= 1) {
    return ` - set aside $${perMonth.toLocaleString('en-US')}/mo from ${startLabel} to cover it`
  }

  // months === 0
  return ` - $${Math.ceil(shortfall).toLocaleString('en-US')} short, no months left to save`
}
