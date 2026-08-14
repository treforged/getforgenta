/**
 * Pure mapping from Akoya's FDX-shaped payloads onto the app's account model.
 *
 * Deliberately free of Deno APIs, network calls and environment access so it
 * can be unit tested directly — the response shape is the part most likely to
 * surprise us against real institution data, and it's the part worth pinning
 * down with tests.
 */

import type { AccountType, NormalizedAccount } from "./types.ts";

/**
 * Akoya returns FDX accounts as a category-keyed union:
 *
 *   { "accounts": [ { "investmentAccount": { ... } }, { "depositAccount": { ... } } ] }
 *
 * `investmentAccount` and `depositAccount` are confirmed in Akoya's docs. The
 * remaining categories (annuity, insurance, loan, line of credit) follow the
 * same convention but were not seen literally, so the category is derived from
 * whichever key is present rather than matched against a hardcoded list. An
 * unrecognised category still yields a usable account.
 */
export function unwrapAccount(
  entry: Record<string, unknown>,
): { category: string; account: Record<string, unknown> } | null {
  const key = Object.keys(entry).find(
    (k) => k.endsWith("Account") && typeof entry[k] === "object" && entry[k] !== null,
  );
  if (!key) return null;
  return {
    category: key.slice(0, -"Account".length).toLowerCase(),
    account: entry[key] as Record<string, unknown>,
  };
}

/** FDX enum values arrive in assorted casings; flatten before comparing. */
function normalizeEnum(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Maps an FDX account onto the app's vocabulary, preferring the specific
 * accountType over the broad category.
 */
export function mapAkoyaType(category: string, accountType: unknown): AccountType {
  const t = normalizeEnum(accountType);

  if (["HSA", "HEALTHREIMBURSEMENTARRANGEMENT"].includes(t)) return "hsa";
  if (["ROTH", "ROTHIRA", "ROTH401K"].includes(t)) return "roth_ira";
  if ([
    "401K", "401A", "403B", "457B", "457PLAN", "IRA", "SEPIRA", "SIMPLEIRA",
    "SARSEP", "KEOGH", "PENSION", "PROFITSHARINGPLAN", "THRIFTSAVINGSPLAN",
    "ROLLOVERIRA", "TRADITIONALIRA",
  ].includes(t)) {
    return "401k";
  }
  if (["CREDITCARD", "CHARGECARD"].includes(t)) return "credit_card";
  if (["AUTOLOAN", "AUTO", "VEHICLELOAN"].includes(t)) return "auto_loan";
  if (["STUDENTLOAN", "STUDENT"].includes(t)) return "student_loan";
  if (["CHECKING", "DDA"].includes(t)) return "checking";
  if (["SAVINGS", "MONEYMARKET", "MMA", "CD", "CERTIFICATEOFDEPOSIT"].includes(t)) {
    return "savings";
  }
  if (["BROKERAGE", "TAXABLE", "INDIVIDUAL", "JOINT"].includes(t)) return "brokerage";

  // Fall back to the category when the specific type is unknown or absent.
  switch (category) {
    case "deposit": return "checking";
    case "investment": return "brokerage";
    case "lineofcredit": return "credit_card";
    case "loan": return "other_liability";
    case "insurance":
    case "annuity": return "other_asset";
    default: return "other_asset";
  }
}

function firstNumber(
  source: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && !isNaN(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

/**
 * Resolves a display balance.
 *
 * FDX spreads balance across category-specific fields, and which one an
 * institution populates varies. The order below prefers the settled figure over
 * the available figure so a pending transaction doesn't make the number jump.
 * Worth re-checking against real Fidelity sandbox data before production.
 */
function resolveBalance(account: Record<string, unknown>): number {
  const direct = firstNumber(account, [
    "currentBalance",
    "balance",
    "accountValue",
    "currentValue",
    "availableBalance",
    "availableCashBalance",
  ]);
  return direct != null ? Math.abs(direct) : 0;
}

export function normalizeAkoyaAccounts(payload: unknown): NormalizedAccount[] {
  const entries = (payload as Record<string, unknown>)?.accounts;
  if (!Array.isArray(entries)) return [];

  const accounts: NormalizedAccount[] = [];

  for (const entry of entries) {
    const unwrapped = unwrapAccount(entry as Record<string, unknown>);
    if (!unwrapped) {
      console.warn("Akoya account entry had no recognisable category key");
      continue;
    }

    const { category, account } = unwrapped;
    const accountId = account.accountId;
    if (typeof accountId !== "string" || accountId === "") {
      console.warn(`Akoya ${category} account missing accountId; skipped`);
      continue;
    }

    const accountType = mapAkoyaType(category, account.accountType);
    const name =
      (account.nickname as string) ||
      (account.productName as string) ||
      (account.description as string) ||
      (account.displayName as string) ||
      "Account";

    accounts.push({
      providerAccountId: accountId,
      name,
      accountType,
      balance: resolveBalance(account),
      creditLimit: firstNumber(account, ["creditLine", "creditLimit"]),
      apr: firstNumber(account, ["annualPercentageRate", "interestRate"]),
      minPayment: firstNumber(account, ["minimumPaymentAmount", "minimumPayment"]),
      // Akoya returns rate and payment detail inline with the account, so a
      // successful call means liability data was as available as it gets.
      liabilityDataAvailable: accountType === "credit_card",
      // FDX has no per-rate balance breakdown, so Akoya can never seed tranches. Empty rather
      // than absent: "the provider offered none" is the honest reading, and persistAccount
      // leaves the column untouched on an empty seed.
      balanceTranches: [],
    });
  }

  return accounts;
}
