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
  /** Months in the saving window that ALREADY end below their own floor. A plan that saves from
   *  them is advice the user cannot follow: they have no spare cash to set aside. Measured on
   *  Tre's forecast 2026-09-29 - Oct 2026 to Jan 2027 were below the floor while the line said
   *  "set aside $188/mo from Oct 2026". Empty means every window month has room. */
  blockedMonths: string[]
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
  /** Parallel to monthLabels: true where that month ends below its own floor. */
  belowFloor?: readonly boolean[]
}): FloorBreachSaveUp | null {
  const { breachIndex, endingCash, floor, monthLabels, belowFloor = [] } = input

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

  const blockedMonths: string[] = []
  for (let m = 1; m <= months; m++) if (belowFloor[m]) blockedMonths.push(monthLabels[m] ?? `month ${m}`)

  return { shortfall, months, perMonth, startLabel, blockedMonths }
}

/**
 * Formats a human‑readable suffix describing the saving plan.
 */
export function formatSaveUpSuffix(s: FloorBreachSaveUp): string {
  const { months, perMonth, shortfall, startLabel, blockedMonths } = s

  if (blockedMonths.length > 0) {
    // Never advise saving from a month that has nothing spare. Say how short, and why no plan.
    const span = blockedMonths.length === 1 ? blockedMonths[0] : `${blockedMonths[0]} to ${blockedMonths[blockedMonths.length - 1]}`
    const verb = blockedMonths.length === 1 ? 'is' : 'are'
    return ` - $${Math.ceil(shortfall).toLocaleString('en-US')} short, and ${span} ${verb} already below the floor, so there is no spare cash to set aside`
  }

  if (months >= 1) {
    return ` - set aside $${perMonth.toLocaleString('en-US')}/mo from ${startLabel} to cover it`
  }

  // months === 0
  return ` - $${Math.ceil(shortfall).toLocaleString('en-US')} short, no months left to save`
}
