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

  /** Pull current account state. The only call the sync pipeline makes. */
  fetchAccounts(
    connection: FinancialConnection,
    ctx: ProviderContext,
  ): Promise<ProviderSyncResult>;

  /**
   * Revoke access at the provider. Best-effort by contract: local cleanup runs
   * regardless of whether the remote call succeeds, so a user can always cut a
   * connection even when the aggregator is down.
   */
  disconnect(connection: FinancialConnection): Promise<void>;
}
