/**
 * The money-glance response body, built field by field (never a spread of the row), so a column
 * added to `safe_to_spend_snapshot` later can never leak into Leo's reply. The 7-key contract was
 * agreed with Vera (forged-glass Leo), ask 1dc2c388. Pure, so vitest covers it.
 */
export const GLANCE_KEYS = [
  "amount_cents", "payday", "horizon", "low_point_cents", "low_date", "floor_cents", "computed_at",
] as const;

export type Glance = {
  amount_cents: number;
  payday: string;
  horizon: string;
  low_point_cents: number;
  low_date: string;
  floor_cents: number;
  computed_at: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The 7-key body, or null when any field is malformed (the caller answers 500, never a guess). */
export function shapeGlance(row: Record<string, unknown>): Glance | null {
  const amount = Number(row.amount_cents);
  const low = Number(row.low_point_cents);
  const floor = Number(row.floor_cents);
  if (row.amount_cents === null || row.low_point_cents === null || row.floor_cents === null) return null;
  if (![amount, low, floor].every(Number.isFinite)) return null;
  const { payday, horizon, low_date } = row;
  if (typeof payday !== "string" || typeof horizon !== "string" || typeof low_date !== "string") return null;
  if (![payday, horizon, low_date].every((d) => DATE.test(d))) return null;
  const at = new Date(String(row.computed_at));
  if (row.computed_at == null || Number.isNaN(at.getTime())) return null;
  return {
    amount_cents: amount,
    payday,
    horizon,
    low_point_cents: low,
    low_date,
    floor_cents: floor,
    computed_at: at.toISOString(),
  };
}
