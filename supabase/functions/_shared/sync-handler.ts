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
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "./cors.ts";
import {
  type FinancialConnection,
  getProvider,
  type NormalizedAccount,
  type ProviderContext,
  ReauthRequiredError,
} from "./providers/index.ts";

const SYNC_COOLDOWN_MS = 23.5 * 60 * 60 * 1000;
const LOCK_TTL_MINUTES = 5;

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
 */
async function persistAccount(
  db: SupabaseClient,
  userId: string,
  connection: FinancialConnection,
  account: NormalizedAccount,
  now: string,
): Promise<void> {
  const { data: existing } = await db
    .from("accounts")
    .select("id, apr, credit_limit, min_payment_is_manual")
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
      min_payment: account.minPayment,
      plaid_account_id: account.providerAccountId,
      ...(account.liabilityDataAvailable ? { liability_synced_at: now } : {}),
    });
    if (error) console.error(`Account insert failed for ${account.providerAccountId}:`, error.message);
    return;
  }

  // Preserve values the provider didn't return, and never clobber a manual
  // minimum payment or a user's account_type correction.
  const minIsManual = existing.min_payment_is_manual === true;
  const effectiveApr = account.apr ?? existing.apr ?? null;
  const effectiveLimit = account.creditLimit ?? existing.credit_limit ?? null;

  const update: Record<string, unknown> = {
    ...shared,
    apr: effectiveApr,
    credit_limit: effectiveLimit,
  };

  if (account.apr != null) update.apr_plaid_synced = true;
  if (account.liabilityDataAvailable) update.liability_synced_at = now;

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
