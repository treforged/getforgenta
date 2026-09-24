/**
 * plaid-webhook - Plaid calls this when an item has new transactions (SYNC_UPDATES_AVAILABLE).
 *
 * verify_jwt = false: Plaid does not send a Supabase JWT. Authentication is Plaid's own signed
 * `Plaid-Verification` header, checked in _shared/plaid-webhook.ts against the key Plaid publishes
 * for that `kid`. An unsigned, stale, or body-mismatched request gets a 401 and does nothing.
 *
 * ⚠️ TRANSACTIONS ONLY. This path calls /transactions/sync and nothing else, because Plaid bills
 * the balance endpoint per call. The nightly 9 AM ET cron (plaid-sync-all) remains the backstop
 * and still does the full account + balance sync.
 *
 * Premium gate: the same entitlement the nightly cron applies. A connection whose owner is not
 * entitled is treated as unknown and pulls nothing.
 *
 * New surface, stated: anyone can POST here. Without a valid Plaid signature it returns 401 after
 * at most one /webhook_verification_key/get per unseen `kid` (cached, including misses, for 10
 * minutes). It never reads or writes user data before the signature passes.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CONNECTION_COLUMNS, syncTransactionsOnly } from "../_shared/sync-handler.ts";
import { isPremiumEntitled } from "../_shared/premium-entitlement.ts";
import { type FinancialConnection } from "../_shared/providers/index.ts";
import {
  handlePlaidWebhookEvent,
  type Jwk,
  type PlaidWebhookPayload,
  plaidKeyId,
  verifyPlaidWebhook,
} from "../_shared/plaid-webhook.ts";

const KEY_CACHE_MS = 10 * 60 * 1000;
const keyCache = new Map<string, { key: Jwk | null; at: number }>();

async function verificationKey(kid: string): Promise<Jwk | null> {
  const hit = keyCache.get(kid);
  if (hit && Date.now() - hit.at < KEY_CACHE_MS) return hit.key;

  const env = Deno.env.get("PLAID_ENV") || "sandbox";
  const res = await fetch(`https://${env}.plaid.com/webhook_verification_key/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: Deno.env.get("PLAID_CLIENT_ID"),
      secret: Deno.env.get("PLAID_SECRET"),
      key_id: kid,
    }),
  });
  const body = await res.json().catch(() => ({}));
  const key = res.ok && body?.key ? (body.key as Jwk) : null;
  keyCache.set(kid, { key, at: Date.now() });
  return key;
}

function reply(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);

  const raw = await req.text();
  const jwt = req.headers.get("Plaid-Verification");
  const kid = plaidKeyId(jwt);
  const key = kid ? await verificationKey(kid) : null;
  const verdict = await verifyPlaidWebhook(raw, jwt, key, Math.floor(Date.now() / 1000));
  if (!verdict.ok) {
    console.warn(`plaid-webhook refused: ${verdict.reason}`);
    return reply({ error: "unauthorized" }, 401);
  }

  let payload: PlaidWebhookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return reply({ error: "bad json" }, 400);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const result = await handlePlaidWebhookEvent<FinancialConnection>(payload, {
    findConnectionByItemId: async (itemId) => {
      const { data: connection } = await db
        .from("financial_connections")
        .select(CONNECTION_COLUMNS)
        .eq("provider", "plaid")
        .eq("provider_item_id", itemId)
        .maybeSingle<FinancialConnection>();
      if (!connection) return null;
      const { data: sub } = await db
        .from("user_subscriptions")
        .select("plan, subscription_status")
        .eq("user_id", connection.user_id)
        .maybeSingle();
      return isPremiumEntitled(sub) ? connection : null;
    },
    syncTransactionsOnly: (connection) => syncTransactionsOnly(db, connection),
  });

  console.log(`plaid-webhook ${payload.webhook_type}/${payload.webhook_code}: ${result.action}` +
    (result.written != null ? ` (${result.written} rows)` : ""));
  // Always 200 once verified, so Plaid does not retry an event we chose to ignore.
  return reply({ ok: true, action: result.action }, 200);
});
