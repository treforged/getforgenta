/**
 * WHICH ACCOUNT DID THIS MONEY ACTUALLY COME OUT OF?
 *
 * Tre, 2026-08-27: *"that top section is a reflection of only the checking account (the debt
 * payment account) ... the net cash coming out of savings should NOT be taken out in that top
 * section and affect ending balance. make a new section that shows the change in other accounts
 * when there is one."*
 *
 * The forecast's cash walk is ONE account's story — the funding account every debt payment, bill
 * and paycheck runs through. A transaction whose `payment_source` names a different account of the
 * user's never touches that balance, so subtracting it from Ending Cash charges the wrong account
 * and understates the month. Live shape that found it: his **June 2027 lease-break fee of $3,830,
 * paid from Savings Account** — it left checking's ending cash on screen and left the savings
 * balance untouched, i.e. exactly backwards on both sides.
 *
 * Recurring expense rules already had this rule (`otherAccountExpenseItems` in `forecast-engine.ts`,
 * which excludes them from `baseExpenses`); one-time transactions did not. Credit cards were the
 * only source ever excluded, and a card is excluded for a different reason — the purchase becomes a
 * BALANCE, not a withdrawal — so that filter stays exactly where it is at every call site.
 */

/**
 * The asset account a payment really came out of, when that is NOT the funding account.
 *
 * Returns `null` — meaning "treat it as the funding account's cash", the behaviour every caller had
 * before this existed — when:
 *   • there is no `payment_source`, or it names nothing the user owns;
 *   • it names the funding account itself;
 *   • **there is no funding account to compare against.** Without one there is no "checking" to be
 *     other than, and guessing would move money on every row of a profile that has not chosen one.
 *
 * ⚠️ CREDIT CARDS MUST NOT BE IN `assetAccountIds`. A card purchase is not a withdrawal from an
 * asset — it raises a liability, and every caller already filters those out on its own line.
 */
export function otherAssetSourceId(
  paymentSource: string | null | undefined,
  fundingAccountId: string | null | undefined,
  assetAccountIds: ReadonlySet<string>,
): string | null {
  if (!paymentSource || !fundingAccountId) return null;
  const id = paymentSource.replace(/^account:/, '');
  if (id === fundingAccountId || !assetAccountIds.has(id)) return null;
  return id;
}

/** Every account that holds ASSET cash — i.e. every account that is not a credit card. The set
 *  `otherAssetSourceId` is meant to be handed. */
export function assetAccountIdsOf(
  accounts: readonly { id?: string | null; account_type?: string | null }[],
): Set<string> {
  const out = new Set<string>();
  for (const a of accounts) {
    if (typeof a.id !== 'string' || a.account_type === 'credit_card') continue;
    out.add(a.id);
  }
  return out;
}
