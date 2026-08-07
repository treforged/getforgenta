/**
 * PlaidProvider — the primary aggregator.
 *
 * Lifted from the original plaid-sync edge function with its behaviour intact:
 * balances from /accounts/balance/get, then APR / credit limit / minimum payment
 * from /liabilities/get for credit cards only.
 *
 * Deliberately NOT moved here: the "user marked this minimum payment as manual"
 * rule and the min-payment estimate fallback. Both are database policy rather
 * than provider behaviour, so they live in the sync pipeline where they apply
 * equally to every provider.
 */

import {
  type AccountType,
  type FinancialConnection,
  type FinancialProvider,
  type NormalizedAccount,
  type NormalizedTransaction,
  type ProviderSyncResult,
  type TransactionPage,
  TransactionsNotReadyError,
} from "./types.ts";

function plaidBaseUrl(): string {
  const env = Deno.env.get("PLAID_ENV") || "sandbox";
  return `https://${env}.plaid.com`;
}

function credentials(): { client_id: string; secret: string } {
  const client_id = Deno.env.get("PLAID_CLIENT_ID");
  const secret = Deno.env.get("PLAID_SECRET");
  if (!client_id || !secret) throw new Error("Plaid not configured");
  return { client_id, secret };
}

/** Plaid's type/subtype pair collapsed into the app's account vocabulary. */
export function mapPlaidType(type: string, subtype: string | null): AccountType {
  if (type === "depository") {
    if (subtype === "hsa") return "hsa";
    if (subtype === "savings" || subtype === "money market") return "savings";
    if (subtype === "cd") return "savings";
    return "checking";
  }
  if (type === "credit") return "credit_card";
  if (type === "investment") {
    const s = (subtype ?? "").toLowerCase();
    if (s === "hsa" || s === "health reimbursement arrangement") return "hsa";
    if (s === "roth" || s === "roth ira") return "roth_ira";
    if (
      [
        "401k", "401a", "403b", "457b", "457plan", "ira", "sep ira",
        "simple ira", "sarsep", "keogh", "pension", "profit sharing plan",
        "thrift savings plan",
      ].includes(s)
    ) {
      return "401k";
    }
    return "brokerage";
  }
  if (type === "loan") {
    if (subtype === "auto" || subtype === "auto loan") return "auto_loan";
    if (subtype === "student") return "student_loan";
    return "other_liability";
  }
  return "other_asset";
}

/** Plaid embeds APR in sandbox account names like "12.5% APR Interest Credit Card". */
function parseAprFromName(name: string): number | null {
  const m = name.match(/(\d+(?:\.\d+)?)\s*%\s*APR/i);
  return m ? parseFloat(m[1]) : null;
}

/**
 * One raw Plaid transaction → the app's shape.
 *
 * On sign: Plaid is already "positive = money out of THIS account, negative = money in", and that
 * holds for credit accounts too (a purchase is positive, a payment to the card is negative). It
 * therefore matches NormalizedTransaction's contract exactly and is passed through UNCHANGED.
 * Flipping it "to be safe" would invert every outflow — noted here because the absence of a
 * conversion looks like an oversight otherwise.
 */
function normalizeTransaction(t: Record<string, unknown>): NormalizedTransaction {
  const pfc = (t.personal_finance_category ?? null) as Record<string, unknown> | null;
  const legacyCategory = (t.category ?? null) as string[] | null;

  return {
    providerTransactionId: t.transaction_id as string,
    pendingTransactionId: (t.pending_transaction_id as string | null) ?? null,
    providerAccountId: t.account_id as string,
    amount: Number(t.amount ?? 0),
    // authorized_date is when the money was committed; `date` is when it posted. "Has this bill
    // been paid" is a question about commitment, and authorized_date is also stable across the
    // pending→posted transition while `date` can move.
    date: ((t.authorized_date as string | null) || (t.date as string)),
    pending: Boolean(t.pending),
    name: (t.name as string | null) ?? null,
    merchantName: (t.merchant_name as string | null) ?? null,
    category: (pfc?.primary as string | undefined) ?? legacyCategory?.[0] ?? null,
  };
}

export const plaidProvider: FinancialProvider = {
  id: "plaid",

  async fetchAccounts(connection: FinancialConnection): Promise<ProviderSyncResult> {
    const { client_id, secret } = credentials();
    const base = plaidBaseUrl();
    const access_token = connection.access_token;
    if (!access_token) throw new Error("Plaid connection is missing its access token");

    const balRes = await fetch(`${base}/accounts/balance/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id, secret, access_token }),
    });
    const balBody = await balRes.json();

    if (!balRes.ok) {
      console.error(
        `Plaid balance fetch failed for item ${connection.provider_item_id}:`,
        JSON.stringify(balBody),
      );
      // ITEM_LOGIN_REQUIRED means the user's credentials at the bank changed —
      // no amount of retrying fixes that.
      if (balBody?.error_code === "ITEM_LOGIN_REQUIRED") {
        return { accounts: [], status: "reauth_required" };
      }
      throw new Error(balBody?.error_message ?? "Plaid balance fetch failed");
    }

    const rawAccounts: Record<string, unknown>[] = balBody.accounts ?? [];

    const accounts: NormalizedAccount[] = rawAccounts.map((acct) => {
      const balances = (acct.balances ?? {}) as Record<string, unknown>;
      const accountType = mapPlaidType(
        acct.type as string,
        (acct.subtype as string | null) ?? null,
      );
      const name = (acct.official_name as string) || (acct.name as string);

      return {
        providerAccountId: acct.account_id as string,
        name,
        accountType,
        balance: Math.abs(Number(balances.current ?? 0)),
        creditLimit: balances.limit != null ? Number(balances.limit) : null,
        apr: accountType === "credit_card" ? parseAprFromName(name) : null,
        minPayment: null,
        liabilityDataAvailable: false,
      };
    });

    // ── Liabilities: credit cards only ──────────────────────────────────────
    const creditCards = accounts.filter((a) => a.accountType === "credit_card");
    if (creditCards.length === 0) {
      return { accounts };
    }

    // liabilityDataAvailable is set for every credit card the moment the pass
    // runs — including when it fails — so the UI's re-link prompt clears for
    // institutions that simply don't expose liability data.
    for (const card of creditCards) card.liabilityDataAvailable = true;

    try {
      const liabRes = await fetch(`${base}/liabilities/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id, secret, access_token }),
      });

      if (!liabRes.ok) {
        const errBody = await liabRes.json().catch(() => ({}));
        console.warn(
          `Plaid liabilities non-OK for item ${connection.provider_item_id}:`,
          JSON.stringify(errBody),
        );
        return { accounts };
      }

      const liabBody = await liabRes.json();
      const byAccountId = new Map<string, Record<string, unknown>>();
      for (const liab of (liabBody.liabilities?.credit ?? [])) {
        byAccountId.set(liab.account_id, liab);
      }

      for (const card of creditCards) {
        const liab = byAccountId.get(card.providerAccountId);
        if (!liab) continue;

        const purchaseApr = ((liab.aprs ?? []) as Record<string, unknown>[])
          .find((a) => a.apr_type === "purchase_apr");
        if (purchaseApr) card.apr = parseFloat(purchaseApr.apr_percentage as string);
        if (liab.credit_limit != null) card.creditLimit = Number(liab.credit_limit);
        if (liab.minimum_payment_amount != null) {
          card.minPayment = Number(liab.minimum_payment_amount);
        }
      }
    } catch (err) {
      console.warn(
        `Plaid liabilities threw for item ${connection.provider_item_id}:`,
        err,
      );
    }

    return { accounts };
  },

  async fetchTransactions(
    connection: FinancialConnection,
    cursor: string | null,
  ): Promise<TransactionPage> {
    const { client_id, secret } = credentials();
    const access_token = connection.access_token;
    if (!access_token) throw new Error("Plaid connection is missing its access token");

    const res = await fetch(`${plaidBaseUrl()}/transactions/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id,
        secret,
        access_token,
        // Plaid's own maximum. Fewer, larger pages means fewer round trips inside the edge
        // function's wall-clock budget during the first backfill.
        count: 500,
        // `cursor` must be OMITTED for a first sync — sending null is an error, not "from the
        // beginning". This is the single easiest way to get a confusing 400 here.
        ...(cursor ? { cursor } : {}),
      }),
    });

    const body = await res.json();

    if (!res.ok) {
      // The item is linked and consented, Plaid just has not finished its initial pull yet. Normal
      // on a fresh connection; the caller treats it as a skip and retries on the next sync.
      if (body?.error_code === "PRODUCT_NOT_READY") {
        throw new TransactionsNotReadyError("plaid", body?.error_message ?? "transactions not ready");
      }
      console.error(
        `Plaid transactions/sync failed for item ${connection.provider_item_id}:`,
        JSON.stringify(body),
      );
      throw new Error(body?.error_message ?? "Plaid transaction sync failed");
    }

    return {
      added: (body.added ?? []).map(normalizeTransaction),
      modified: (body.modified ?? []).map(normalizeTransaction),
      // `removed` arrives as objects, not bare ids.
      removed: (body.removed ?? []).map((r: Record<string, unknown>) => r.transaction_id as string),
      nextCursor: body.next_cursor as string,
      hasMore: Boolean(body.has_more),
    };
  },

  async disconnect(connection: FinancialConnection): Promise<void> {
    if (!connection.access_token) return;
    const { client_id, secret } = credentials();

    const res = await fetch(`${plaidBaseUrl()}/item/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id, secret, access_token: connection.access_token }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      console.error("Plaid /item/remove non-OK:", JSON.stringify(errBody));
    }
  },
};
