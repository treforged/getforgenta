/**
 * Provider-agnostic contract for account aggregation.
 *
 * Everything above this layer — the sync pipeline, the accounts table, the UI —
 * works in terms of NormalizedAccount and never branches on which aggregator
 * produced the data. Adding a third provider means adding one file here, not
 * touching call sites.
 */

export type ProviderId = "plaid" | "akoya";

export type ConnectionStatus = "active" | "reauth_required" | "revoked" | "error";

/**
 * The app's internal account vocabulary. Matches the `account_type` values the
 * accounts table and forecast engine already use — this is deliberately NOT the
 * union of what providers return.
 */
export type AccountType =
  | "checking"
  | "savings"
  | "hsa"
  | "credit_card"
  | "brokerage"
  | "roth_ira"
  | "401k"
  | "auto_loan"
  | "student_loan"
  | "other_liability"
  | "other_asset";

/** A row of public.financial_connections, as read with the service role. */
export interface FinancialConnection {
  id: string;
  user_id: string;
  provider: ProviderId;
  provider_item_id: string;
  institution_id: string | null;
  institution_name: string | null;
  access_token: string | null;
  refresh_token_encrypted: string | null;
  id_token_encrypted: string | null;
  token_expires_at: string | null;
  connection_status: ConnectionStatus;
  sync_cursor: string | null;
  last_synced_at: string | null;
}

/**
 * One sub-balance of a credit card sitting at its own rate, as seeded from provider data.
 *
 * Shaped to satisfy `parseTranches` in src/lib/balance-tranches.ts. `promo_end_date` is
 * deliberately ABSENT from this type: no aggregator supplies a promo end date, so it is a
 * user-entered field and a sync must never be able to write, clear or overwrite one.
 */
export interface SeededTranche {
  id: string;
  label: string;
  balance: number;
  apr: number;
}

/**
 * One account as the rest of the app understands it.
 *
 * `liabilityDataAvailable` records whether the provider was actually asked for
 * liability detail, so the UI's "re-link to get your APR" prompt can clear even
 * when the institution returns nothing.
 */
export interface NormalizedAccount {
  providerAccountId: string;
  name: string;
  accountType: AccountType;
  balance: number;
  creditLimit: number | null;
  apr: number | null;
  minPayment: number | null;
  liabilityDataAvailable: boolean;
  /**
   * Sub-balances the provider reports at their OWN rates (balance transfer, cash advance, promo).
   * Empty when the provider gave none — which is the common case and is not a failure.
   *
   * A SEED ONLY. Database policy decides whether it may be written, and it never may when the
   * account already has tranches, because those are the user's. See persistAccount.
   */
  balanceTranches: SeededTranche[];
}

/**
 * Credentials a provider rotated during a sync and that MUST be persisted.
 *
 * Akoya reissues the refresh token on every refresh and invalidates the one it
 * replaces, so dropping this on the floor permanently breaks the connection.
 */
export interface RotatedCredentials {
  accessToken?: string | null;
  refreshTokenEncrypted?: string | null;
  idTokenEncrypted?: string | null;
  tokenExpiresAt?: string | null;
}

export interface ProviderSyncResult {
  accounts: NormalizedAccount[];
  rotatedCredentials?: RotatedCredentials;
  /** Set when the connection can no longer be used without user re-consent. */
  status?: ConnectionStatus;
}

/**
 * One transaction, in the app's vocabulary.
 *
 * `amount` is normalised so POSITIVE ALWAYS MEANS MONEY LEAVING THE USER, whatever sign
 * convention the provider uses and whatever the account type. Doing this once at the provider
 * boundary is the only way every reader downstream gets to stop thinking about it.
 */
export interface NormalizedTransaction {
  providerTransactionId: string;
  /** The pending row this posted transaction supersedes, if any. Drives pending retirement. */
  pendingTransactionId: string | null;
  providerAccountId: string;
  amount: number;
  /** `YYYY-MM-DD`. Authorisation date when the provider has one — that is when money commits. */
  date: string;
  pending: boolean;
  name: string | null;
  merchantName: string | null;
  category: string | null;
}

/**
 * ONE PAGE of a transaction delta.
 *
 * Deliberately a page rather than the whole history: a first sync can span 24 months across every
 * account on an item, and accumulating that in memory before writing risks the function dying with
 * nothing persisted and the cursor unmoved. The caller loops, writing and advancing per page, so
 * progress survives a mid-backfill failure.
 */
export interface TransactionPage {
  added: NormalizedTransaction[];
  modified: NormalizedTransaction[];
  /** Provider transaction ids the provider says no longer exist. */
  removed: string[];
  /** Pass back on the next call. Persist ONLY after the page's rows are committed. */
  nextCursor: string;
  hasMore: boolean;
}

/**
 * Raised when the provider has not finished its initial transaction pull for this item.
 *
 * A soft, expected condition on a freshly linked connection — NOT a sync failure. The pipeline
 * skips transactions for this connection, leaves the cursor untouched, and lets the account/balance
 * half of the sync succeed normally.
 */
export class TransactionsNotReadyError extends Error {
  constructor(public readonly provider: ProviderId, message: string) {
    super(message);
    this.name = "TransactionsNotReadyError";
  }
}

/** Ambient config a provider needs, resolved once per request. */
export interface ProviderContext {
  /** ISO8601 UTC. Akoya requires it; Plaid ignores it. */
  lastAccessAt: string;
  /** Distinguishes a user-initiated refresh from the nightly cron. */
  interaction: "USER" | "BATCH";
}

/**
 * Raised when a provider says the connection needs the user back in the consent
 * flow. The sync pipeline catches this, marks the connection reauth_required and
 * stops retrying — Akoya explicitly warns against refresh loops.
 */
export class ReauthRequiredError extends Error {
  constructor(public readonly provider: ProviderId, message: string) {
    super(message);
    this.name = "ReauthRequiredError";
  }
}

export interface FinancialProvider {
  readonly id: ProviderId;

  /** Pull current account state. */
  fetchAccounts(
    connection: FinancialConnection,
    ctx: ProviderContext,
  ): Promise<ProviderSyncResult>;

  /**
   * Pull one page of the transaction delta since `cursor` (null = full history).
   *
   * Required rather than optional so a new provider cannot silently ship without transactions and
   * leave the forecast falling back to the date heuristic with no signal that it is doing so. A
   * provider that genuinely cannot supply them returns an empty page with `hasMore: false`.
   */
  fetchTransactions(
    connection: FinancialConnection,
    cursor: string | null,
  ): Promise<TransactionPage>;

  /**
   * Revoke access at the provider. Best-effort by contract: local cleanup runs
   * regardless of whether the remote call succeeds, so a user can always cut a
   * connection even when the aggregator is down.
   */
  disconnect(connection: FinancialConnection): Promise<void>;
}
