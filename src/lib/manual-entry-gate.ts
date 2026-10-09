/**
 * WHO CAN ADD A TRANSACTION BY HAND - one rule for every door (the full Add Transaction form on the
 * Transactions page and the quick-add sheet), so the two cannot disagree.
 *
 * Free on the WEB for everyone (Tre, 2026-10-09: quick add "yes", then the full Add Transaction
 * "yes"). In the NATIVE app it stays Premium (or the demo), which is where the store's own
 * subscription lives. Changing that is a pricing decision, not a refactor.
 */
export function canAddTransactions({ isPremium, isDemo, isNative }: { isPremium: boolean; isDemo: boolean; isNative: boolean }): boolean {
  return isPremium || isDemo || !isNative;
}
