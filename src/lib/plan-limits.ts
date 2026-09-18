/**
 * THE BANK-LINK CEILINGS THE APP ACTUALLY ENFORCES, in one client-side place.
 *
 * ⚠️ THE SERVER IS THE AUTHORITY, NOT THIS FILE. The money decision is made in
 * `supabase/functions/_shared/bank-link-entitlement.ts` (`decideBankLink`), which every provider
 * route calls before a link is created. These constants exist so the CLIENT — the copy a customer
 * reads, and the ceiling the UI stops offering at — cannot drift from that decision silently.
 * `plan-limits.gate.test.ts` asserts they still agree, and is DERIVED from the edge functions
 * rather than hand-named, so a fifth provider route added tomorrow is checked too.
 *
 * WHY IT EXISTS AT ALL. On 2026-09-18 `PremiumUpsellStep` told customers premium allows
 * "Up to 3 linked accounts" and that free was "manual-only". Both were false: premium is 10 and
 * free is 1. So the paywall UNDERSOLD the paid tier by more than three times AND told a free user
 * a feature was unavailable that they in fact get once — costing conversions in both directions
 * from one sentence. The number had been TYPED in five places (four edge functions and
 * `Accounts.tsx`), and a typed number is how the divergence was born; re-typing a correct one
 * only resets the clock. Import these instead.
 */

/** Live links a FREE account may hold. Mirrors `FREE_LINK_LIMIT` in bank-link-entitlement.ts. */
export const FREE_LINK_LIMIT = 1;

/** Live links a PREMIUM account may hold. Mirrors `MAX_LINKED` in every provider edge function. */
export const PREMIUM_MAX_LINKED = 10;

/** The ceiling for a given account, which is the only thing a caller usually wants. */
export function bankLinkCeilingFor(isPremium: boolean): number {
  return isPremium ? PREMIUM_MAX_LINKED : FREE_LINK_LIMIT;
}
