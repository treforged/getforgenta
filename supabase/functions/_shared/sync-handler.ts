/**
 * Provider-agnostic account sync.
 *
 * Lives in _shared so `financial-sync` and `plaid-sync` are two doors onto one
 * implementation — plaid-sync stays deployed because the nightly cron job and
 * already-shipped app builds still call it by name.
 *
 * Dispatches to whichever provider owns each connection and
 * writes a single normalised shape into public.accounts, so nothing downstream
 * — the forecast engine, the UI, the AI advisor — can tell Plaid data from
 * Akoya data.
 *
 * Actions:
 *   { action: "delink", connection_id | plaid_item_id }
 *   { force?: boolean, item_id?: string, connection_id?: string }   (default: sync)
 *
 * Database policy that is deliberately NOT in the provider modules, because it
 * applies identically to every provider:
 *   - account_type is never overwritten after insert (preserves user correction)
 *   - min_payment is never overwritten when the user marked it manual
 *   - min_payment falls back to an estimate when the provider omits it
 *   - apr is never overwritten when the stored value did not come from the provider
 *   - balance_tranches is SEEDED ONLY when empty, and never carries a promo_end_date
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "./cors.ts";
import { resolveAprOnSync } from "./providers/apr-sync-policy.ts";
import { shouldSeedTranches } from "./providers/balance-tranche-seed.ts";
import {
  type FinancialConnection,
  getProvider,
  type NormalizedAccount,
  type ProviderContext,
  ReauthRequiredError,
  TransactionsNotReadyError,
} from "./providers/index.ts";

const SYNC_COOLDOWN_MS = 23.5 * 60 * 60 * 1000;
const LOCK_TTL_MINUTES = 5;

/**
 * Cap on transaction pages per connection per run. At Plaid's 500-per-page maximum this is 10,000
 * transactions — comfortably more than a 24-month backfill across one item, while bounding the
 * function's wall clock so a pathological item cannot hold the mutex until the platform kills it.
 * A connection that genuinely needs more simply continues from its cursor on the next run.
 */
const MAX_TRANSACTION_PAGES = 20;

export const CONNECTION_COLUMNS =
  "id, user_id, provider, provider_item_id, institution_id, institution_name, " +
  "access_token, refresh_token_encrypted, id_token_encrypted, token_expires_at, " +
  "connection_status, sync_cursor, last_synced_at";

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** Minimum payment estimate: max($25, 1% of balance + one month's interest). */
function estimateMinPayment(balance: number, apr: number): number {
  if (balance <= 0) return 0;
  const interest = (balance * (apr / 100)) / 12;
  return Math.max(25, Math.ceil(balance * 0.01 + interest));
}

/**
 * Claims the per-connection sync mutex.
 *
 * A conditional UPDATE is the mutex: only one caller can move sync_locked_until
 * from "free" to "held". Returns false when another worker holds it, in which
 * case the caller must not touch this connection's tokens at all.
 */
async function acquireLock(db: SupabaseClient, connectionId: string): Promise<boolean> {
  const now = new Date();
  const until = new Date(now.getTime() + LOCK_TTL_MINUTES * 60_000).toISOString();

  const { data } = await db
    .from("financial_connections")
    .update({ sync_locked_until: until })
    .eq("id", connectionId)
    .or(`sync_locked_until.is.null,sync_locked_until.lt.${now.toISOString()}`)
    .select("id");

  return (data?.length ?? 0) > 0;
}

async function releaseLock(db: SupabaseClient, connectionId: string): Promise<void> {
  await db
    .from("financial_connections")
    .update({ sync_locked_until: null })
    .eq("id", connectionId);
}

/**
 * Writes one normalised account through to the accounts table.
 *
 * Select-then-update-or-insert rather than upsert: the unique index on
 * (user_id, plaid_account_id) is partial, which PostgREST's ON CONFLICT cannot
 * target. Carried over from the original implementation.
 *
 * Exported for src/lib/__tests__/sync-handler-wiring.test.ts — the header's database
 * policy lives in THIS function's wiring of the pure policies, and the wiring is what
 * those tests pin (the policies themselves have their own suites).
 */
export async function persistAccount(
  db: SupabaseClient,
  userId: string,
  connection: FinancialConnection,
  account: NormalizedAccount,
  now: string,
): Promise<void> {
  const { data: existing } = await db
    .from("accounts")
    .select("id, apr, apr_plaid_synced, credit_limit, min_payment_is_manual, name_is_manual, balance_tranches")
    .eq("user_id", userId)
    .eq("plaid_account_id", account.providerAccountId)
    .maybeSingle();

  const shared = {
    name: account.name,
    institution: connection.institution_name ?? "",
    balance: account.balance,
    active: true,
    provider: connection.provider,
    connection_id: connection.id,
    plaid_item_id: connection.provider_item_id,
    updated_at: now,
  };

  if (!existing) {
    const { error } = await db.from("accounts").insert({
      ...shared,
      user_id: userId,
      account_type: account.accountType,
      credit_limit: account.creditLimit,
      apr: account.apr,
      // MUST be recorded on insert. `apr_plaid_synced` is what later syncs read to tell a
      // provider-owned rate from a hand-typed one; leaving it null on a row whose apr came
      // straight from Plaid would make the very next sync misread it as manual and freeze it.
      ...(account.apr != null ? { apr_plaid_synced: true } : {}),
      min_payment: account.minPayment,
      plaid_account_id: account.providerAccountId,
      ...(account.liabilityDataAvailable ? { liability_synced_at: now } : {}),
      // A brand-new row has no user tranches to protect, so the same rule reduces to "seed if the
      // provider gave us anything". Omitted entirely on an empty seed, leaving the column null.
      ...(shouldSeedTranches(null, account.balanceTranches)
        ? { balance_tranches: account.balanceTranches }
        : {}),
    });
    if (error) console.error(`Account insert failed for ${account.providerAccountId}:`, error.message);
    return;
  }

  // Preserve values the provider didn't return, and never clobber a manual
  // minimum payment, a manual APR, or a user's account_type correction.
  const minIsManual = existing.min_payment_is_manual === true;
  const aprDecision = resolveAprOnSync(
    account.apr,
    existing.apr != null ? Number(existing.apr) : null,
    (existing.apr_plaid_synced as boolean | null) ?? null,
  );
  const effectiveApr = aprDecision.apr;
  const effectiveLimit = account.creditLimit ?? existing.credit_limit ?? null;

  const update: Record<string, unknown> = {
    ...shared,
    apr: effectiveApr,
    credit_limit: effectiveLimit,
  };

  // A NAME THE USER CHOSE IS THEIRS, and this is the half that makes the rename stick. Without it
  // `shared.name` overwrites the edit on the very next run and the user watches their label revert
  // — which is exactly why the field used to be disabled in the form.
  //
  // ⚠️ `institution` is deliberately NOT covered. It is not a label, it is which connection this row
  // belongs to, and it keeps being written from the provider on every sync. Tre, 2026-08-21:
  // "allow user account rename... still block institution change."
  //
  // Delete rather than never-add, so the rule sits next to the other manual-override policies
  // instead of being buried in how `shared` is built.
  if (existing.name_is_manual === true) delete update.name;

  if (aprDecision.markPlaidSynced) update.apr_plaid_synced = true;
  if (aprDecision.keptManual) {
    console.log(
      `Kept manual APR ${effectiveApr} on ${account.providerAccountId}; ` +
        `${connection.provider} offered ${account.apr}`,
    );
  }
  if (account.liabilityDataAvailable) update.liability_synced_at = now;

  // Tranches are seeded, never merged. `update` is built key-by-key, so on any other outcome the
  // column is simply not in the payload and the user's rows are not touched at all.
  if (shouldSeedTranches(existing.balance_tranches, account.balanceTranches)) {
    update.balance_tranches = account.balanceTranches;
  }

  if (!minIsManual) {
    if (account.minPayment != null) {
      update.min_payment = account.minPayment;
      update.min_payment_plaid_synced = true;
    } else if (account.accountType === "credit_card" && effectiveApr) {
      update.min_payment = estimateMinPayment(account.balance, Number(effectiveApr));
    }
  }

  const { error } = await db.from("accounts").update(update).eq("id", existing.id);
  if (error) console.error(`Account update failed for ${account.providerAccountId}:`, error.message);
}

/**
 * Syncs one connection end to end: cooldown check, mutex, provider call,
 * credential rotation, account writes, status update.
 *
 * Shared by the per-user endpoint and the nightly cron so there is exactly one
 * implementation of the rules. Returns the provider account ids it touched.
 * Never throws — a failing connection is recorded on the row and skipped.
 */
/**
 * §1A — pull transaction deltas into public.synced_transactions.
 *
 * Page-at-a-time, and the cursor is persisted ONLY after each page's rows commit. That ordering is
 * the whole correctness argument: Plaid never re-offers a page once the cursor moves past it, so
 * advancing first would drop transactions permanently on any write failure. Advancing last makes
 * the pipeline at-least-once, and the unique (connection_id, provider_transaction_id) index makes
 * the replay a no-op.
 *
 * NEVER THROWS. Transactions are evidence that improves the forecast, not a prerequisite for it —
 * a failure here must not undo an account/balance sync that already succeeded, and must not mark
 * the connection `error` and take the user out of the app.
 */
async function syncTransactions(
  db: SupabaseClient,
  connection: FinancialConnection,
): Promise<number> {
  // provider account id → our accounts.id. Resolved once; the accounts pass has just run, so
  // every account on this connection exists.
  const { data: accountRows } = await db
    .from("accounts")
    .select("id, plaid_account_id")
    .eq("user_id", connection.user_id)
    .eq("connection_id", connection.id);

  const accountIdByProviderId = new Map<string, string>();
  for (const row of accountRows ?? []) {
    if (row.plaid_account_id) accountIdByProviderId.set(row.plaid_account_id as string, row.id as string);
  }

  let cursor = connection.sync_cursor;
  let written = 0;

  try {
    for (let page = 0; page < MAX_TRANSACTION_PAGES; page++) {
      const delta = await getProvider(connection.provider).fetchTransactions(connection, cursor);

      const upserts = [...delta.added, ...delta.modified].map((t) => ({
        user_id: connection.user_id,
        connection_id: connection.id,
        // null when the transaction belongs to an account we do not track (Plaid returns every
        // account on the item). The row is still kept — the account may be added later.
        account_id: accountIdByProviderId.get(t.providerAccountId) ?? null,
        provider_transaction_id: t.providerTransactionId,
        pending_transaction_id: t.pendingTransactionId,
        amount: t.amount,
        date: t.date,
        pending: t.pending,
        name: t.name,
        merchant_name: t.merchantName,
        category: t.category,
        updated_at: new Date().toISOString(),
      }));

      if (upserts.length > 0) {
        const { error } = await db
          .from("synced_transactions")
          .upsert(upserts, { onConflict: "connection_id,provider_transaction_id" });
        // Bail WITHOUT advancing the cursor: the same page is re-offered next run.
        if (error) throw new Error(`upsert failed: ${error.message}`);
        written += upserts.length;
      }

      // Retire superseded pending rows. Must run AFTER the upsert — the posted row is what carries
      // the pointer back to the pending one. Skipping this double-counts the same charge, which is
      // the exact error SETTLEMENT_LAG_DAYS exists to avoid.
      const supersededIds = [...delta.added, ...delta.modified]
        .map((t) => t.pendingTransactionId)
        .filter((id): id is string => !!id);

      const deletions = [...supersededIds, ...delta.removed];
      if (deletions.length > 0) {
        await db
          .from("synced_transactions")
          .delete()
          .eq("connection_id", connection.id)
          .in("provider_transaction_id", deletions);
      }

      cursor = delta.nextCursor;
      await db
        .from("financial_connections")
        .update({ sync_cursor: cursor })
        .eq("id", connection.id);

      if (!delta.hasMore) break;
    }
  } catch (err) {
    if (err instanceof TransactionsNotReadyError) {
      // Expected on a freshly linked connection. Cursor untouched; retried next sync.
      console.log(`Transactions not ready yet for connection ${connection.id}`);
      return written;
    }
    console.error(`Transaction sync failed for connection ${connection.id}:`, err);
  }

  return written;
}

export async function syncConnection(
  db: SupabaseClient,
  connection: FinancialConnection,
  ctx: ProviderContext,
  opts: { force?: boolean } = {},
): Promise<string[]> {
  const force = opts.force === true;
  const now = new Date().toISOString();
  const userId = connection.user_id;

  // A connection the user must reauthorise is skipped outright — retrying it
  // just generates noise and, for Akoya, risks a refresh loop.
  if (connection.connection_status === "reauth_required" && !force) return [];

  if (!force && connection.last_synced_at) {
    const age = Date.now() - new Date(connection.last_synced_at).getTime();
    if (age < SYNC_COOLDOWN_MS) {
      const { data: cached } = await db
        .from("accounts")
        .select("plaid_account_id")
        .eq("user_id", userId)
        .eq("connection_id", connection.id);
      return (cached ?? [])
        .map((row) => row.plaid_account_id as string | null)
        .filter((id): id is string => !!id);
    }
  }

  if (!(await acquireLock(db, connection.id))) {
    console.log(`Connection ${connection.id} is already syncing; skipped`);
    return [];
  }

  const touched: string[] = [];

  try {
    const result = await getProvider(connection.provider).fetchAccounts(connection, ctx);

    // Persist rotated credentials FIRST. For Akoya the old refresh token is
    // already dead at this point, so losing the new one loses the connection.
    if (result.rotatedCredentials) {
      const c = result.rotatedCredentials;
      const { error } = await db
        .from("financial_connections")
        .update({
          ...(c.accessToken !== undefined ? { access_token: c.accessToken } : {}),
          ...(c.refreshTokenEncrypted !== undefined
            ? { refresh_token_encrypted: c.refreshTokenEncrypted } : {}),
          ...(c.idTokenEncrypted !== undefined
            ? { id_token_encrypted: c.idTokenEncrypted } : {}),
          ...(c.tokenExpiresAt !== undefined ? { token_expires_at: c.tokenExpiresAt } : {}),
          updated_at: now,
        })
        .eq("id", connection.id);

      if (error) {
        // Nothing useful left to do: the provider rotated, we failed to record
        // it, so the stored token is now stale. Force reconsent.
        console.error(`Failed to persist rotated credentials for ${connection.id}:`, error.message);
        await db
          .from("financial_connections")
          .update({ connection_status: "reauth_required", updated_at: now })
          .eq("id", connection.id);
        return [];
      }
    }

    for (const account of result.accounts) {
      await persistAccount(db, userId, connection, account, now);
      touched.push(account.providerAccountId);
    }

    // After accounts, so the provider-account-id → accounts.id map is complete. Self-contained and
    // non-throwing: a transaction failure must not roll back balances that already landed.
    await syncTransactions(db, connection);

    await db
      .from("financial_connections")
      .update({
        last_synced_at: now,
        updated_at: now,
        connection_status: result.status ?? "active",
      })
      .eq("id", connection.id);
  } catch (err) {
    const needsReauth = err instanceof ReauthRequiredError;
    console.error(`Sync failed for connection ${connection.id}:`, err);
    await db
      .from("financial_connections")
      .update({
        connection_status: needsReauth ? "reauth_required" : "error",
        updated_at: now,
      })
      .eq("id", connection.id);
  } finally {
    await releaseLock(db, connection.id);
  }

  return touched;
}

export async function handleSync(req: Request): Promise<Response> {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401, cors);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: jwtErr } = await userClient.auth.getUser();
    if (jwtErr || !user) return json({ error: "Unauthorized" }, 401, cors);
    const userId = user.id;

    const body = await req.json().catch(() => ({}));

    // ── Delink ───────────────────────────────────────────────────────────────
    // No premium gate: revoking access must always be possible, and Akoya's
    // own requirements call for a consumer-accessible revocation path.
    if (body?.action === "delink") {
      const connectionId = body?.connection_id as string | undefined;
      const legacyItemId = body?.plaid_item_id as string | undefined;
      if (!connectionId && !legacyItemId) {
        return json({ error: "connection_id or plaid_item_id required" }, 400, cors);
      }

      let query = db.from("financial_connections").select(CONNECTION_COLUMNS).eq("user_id", userId);
      query = connectionId
        ? query.eq("id", connectionId)
        : query.eq("provider", "plaid").eq("provider_item_id", legacyItemId!);

      const { data: connection } = await query.maybeSingle<FinancialConnection>();
      if (!connection) return json({ error: "Connection not found" }, 404, cors);

      // Best-effort remote revoke; local cleanup happens either way so a user is
      // never stuck with a connection they can't remove.
      try {
        await getProvider(connection.provider).disconnect(connection);
      } catch (err) {
        console.error(`${connection.provider} disconnect failed:`, err);
      }

      await db.from("financial_connections").delete().eq("id", connection.id);

      // Accounts survive with their last known balance, just unlinked.
      await db
        .from("accounts")
        .update({
          plaid_account_id: null,
          plaid_item_id: null,
          connection_id: null,
          provider: "manual",
        })
        .eq("user_id", userId)
        .eq("connection_id", connection.id);

      return json({ ok: true }, 200, cors);
    }

    // ── Sync ─────────────────────────────────────────────────────────────────
    const { data: sub } = await db
      .from("user_subscriptions")
      .select("plan, subscription_status")
      .eq("user_id", userId)
      .maybeSingle();
    const isActive = sub?.plan === "premium" &&
      ["active", "trialing"].includes(sub?.subscription_status ?? "");
    if (!isActive) return json({ error: "Premium subscription required" }, 403, cors);

    const forceSync = body?.force === true;
    const connectionIdFilter = body?.connection_id as string | undefined;
    // item_id is the legacy plaid-sync parameter; still honoured by the shim.
    const itemIdFilter = body?.item_id as string | undefined;

    let query = db.from("financial_connections").select(CONNECTION_COLUMNS).eq("user_id", userId);
    if (connectionIdFilter) query = query.eq("id", connectionIdFilter);
    else if (itemIdFilter) query = query.eq("provider_item_id", itemIdFilter);

    const { data: connections, error: connErr } = await query.returns<FinancialConnection[]>();
    if (connErr) throw new Error(connErr.message);
    if (!connections || connections.length === 0) {
      return json({ synced: 0, accounts: [] }, 200, cors);
    }

    const now = new Date().toISOString();
    const ctx: ProviderContext = {
      lastAccessAt: now,
      interaction: body?.interaction === "BATCH" ? "BATCH" : "USER",
    };

    const touchedAccountIds: string[] = [];

    for (const connection of connections) {
      const touched = await syncConnection(db, connection, ctx, { force: forceSync });
      touchedAccountIds.push(...touched);
    }

    // Re-read final DB state so the client sees the values policy actually
    // settled on, not the raw provider response.
    let accounts: unknown[] = [];
    if (touchedAccountIds.length > 0) {
      const { data } = await db
        .from("accounts")
        .select("name, balance, account_type, apr, credit_limit, min_payment, plaid_account_id, liability_synced_at")
        .eq("user_id", userId)
        .in("plaid_account_id", touchedAccountIds);

      accounts = (data ?? []).map((a) => ({
        name: a.name,
        balance: Number(a.balance),
        type: a.account_type,
        plaid_account_id: a.plaid_account_id,
        apr: a.apr != null ? Number(a.apr) : null,
        credit_limit: a.credit_limit != null ? Number(a.credit_limit) : null,
        min_payment: a.min_payment != null ? Number(a.min_payment) : null,
        liability_synced: !!a.liability_synced_at,
      }));
    }

    return json({ synced: accounts.length, accounts, last_synced_at: now }, 200, cors);
  } catch (err) {
    console.error("financial-sync:", err);
    return json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
      cors,
    );
  }
}
