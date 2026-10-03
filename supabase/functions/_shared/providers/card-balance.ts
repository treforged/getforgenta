/**
 * The balance a credit card really owes, from Plaid's `balances` object.
 *
 * Pure and free of Deno APIs so it can be unit tested directly, same as apr-sync-policy.ts.
 *
 * THE DEFECT THIS FIXES (ask 1f00b82d). Plaid's `balances.current` is the POSTED balance. Some
 * issuers leave pending charges out of it. Tre's Robinhood card read current $926.85 while the
 * app showed $4,288.70 available against a $5,250 limit: limit - available = $961.30, which is
 * $926.85 plus $34.45 pending. Forgenta showed the smaller figure as the card's full amount.
 *
 * THE RULE. For a credit card with a limit and an available figure, owe the larger of `current`
 * and `limit - available`. Taking the larger never hides debt. It can only overstate the balance
 * when available is reduced for a reason other than spending (a hold), and an overstated debt is
 * the safe direction for a cash forecast. Any missing or non-finite input falls back to `current`.
 */
export function cardBalanceOwed(balances: Record<string, unknown>): number {
  const current = Math.abs(Number(balances.current ?? 0));
  const limit = balances.limit != null ? Number(balances.limit) : NaN;
  const available = balances.available != null ? Number(balances.available) : NaN;
  if (!Number.isFinite(limit) || !Number.isFinite(available) || limit <= 0) return current;
  const used = Math.round((limit - available) * 100) / 100;
  return used > current ? used : current;
}
