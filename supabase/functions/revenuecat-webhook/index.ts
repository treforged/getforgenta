/**
 * RevenueCat webhook handler.
 *
 * Receives server notifications from RevenueCat and writes entitlement
 * state to user_subscriptions. The app_user_id in every RevenueCat event
 * equals the Supabase user UUID set during SDK initialisation.
 *
 * Required Supabase Edge Function Secrets:
 *   REVENUECAT_WEBHOOK_SECRET  — shared secret from RevenueCat dashboard
 *
 * RevenueCat webhook URL to configure:
 *   https://mdtosrbfkextcaezuclh.supabase.co/functions/v1/revenuecat-webhook
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function removePlaidItemsForUser(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<void> {
  const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
  const PLAID_SECRET    = Deno.env.get("PLAID_SECRET");
  const plaidEnv        = Deno.env.get("PLAID_ENV") || "sandbox";
  const plaidBase       = `https://${plaidEnv}.plaid.com`;

  if (!PLAID_CLIENT_ID || !PLAID_SECRET) return;

  const { data: items } = await supabase
    .from("plaid_items")
    .select("access_token, plaid_item_id")
    .eq("user_id", userId);

  if (!items || items.length === 0) return;

  await Promise.all(
    items.map(async (item: { access_token: string; plaid_item_id: string }) => {
      try {
        const res = await fetch(`${plaidBase}/item/remove`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id:    PLAID_CLIENT_ID,
            secret:       PLAID_SECRET,
            access_token: item.access_token,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.error(`[rc-webhook] Plaid item/remove failed for ${item.plaid_item_id}:`, JSON.stringify(body));
        }
      } catch (e) {
        console.error(`[rc-webhook] Plaid item/remove error for ${item.plaid_item_id}:`, e);
      }
    }),
  );

  // Delete Plaid items; accounts stay with active=false so last balance is preserved.
  await supabase.from("plaid_items").delete().eq("user_id", userId);
  await supabase.from("accounts").update({ active: false })
    .eq("user_id", userId)
    .not("plaid_account_id", "is", null);
}

const RC_EVENT = {
  INITIAL_PURCHASE:  "INITIAL_PURCHASE",
  RENEWAL:           "RENEWAL",
  PRODUCT_CHANGE:    "PRODUCT_CHANGE",
  CANCELLATION:      "CANCELLATION",
  EXPIRATION:        "EXPIRATION",
  BILLING_ISSUE:     "BILLING_ISSUE",
  TRANSFER:          "TRANSFER",
} as const;

type RcEventType = typeof RC_EVENT[keyof typeof RC_EVENT];

interface RcEvent {
  type: RcEventType | string;
  app_user_id: string;
  original_app_user_id?: string;
  product_id?: string;
  expiration_at_ms?: number;
  original_transaction_id?: string;
  store?: "APP_STORE" | "PLAY_STORE" | "STRIPE" | "PROMOTIONAL";
  period_type?: "NORMAL" | "TRIAL" | "INTRO";
  environment?: "SANDBOX" | "PRODUCTION";
}

interface RcWebhookBody {
  api_version: string;
  event: RcEvent;
}

function resolveUserId(event: RcEvent): string {
  return event.original_app_user_id ?? event.app_user_id;
}

function resolveProvider(store: RcEvent["store"]): string {
  if (store === "APP_STORE") return "apple";
  if (store === "PLAY_STORE") return "google";
  return "stripe";
}

function resolveExpiry(expirationAtMs: number | undefined): string | null {
  if (!expirationAtMs) return null;
  return new Date(expirationAtMs).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Validate shared secret ────────────────────────────────────────────────────
  const secret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
  if (!secret) {
    console.error("[rc-webhook] REVENUECAT_WEBHOOK_SECRET not configured");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const providedSecret = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (providedSecret !== secret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Parse body ────────────────────────────────────────────────────────────────
  let body: RcWebhookBody;
  try {
    body = await req.json() as RcWebhookBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { event } = body;
  if (!event?.type || !event?.app_user_id) {
    return new Response(JSON.stringify({ error: "Missing event fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userId = resolveUserId(event);
  const provider = resolveProvider(event.store);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── TRANSFER: subscription moved between RevenueCat users ────────────────────
  // Revoke from the old owner and grant to the new owner as separate DB operations.
  if (event.type === RC_EVENT.TRANSFER) {
    const oldUserId = event.original_app_user_id;
    const newUserId = event.app_user_id;

    if (oldUserId && oldUserId !== newUserId) {
      await supabase.from("user_subscriptions").update({
        plan: "free",
        subscription_status: "canceled",
        cancel_at_period_end: false,
        current_period_end: null,
        revenuecat_app_user_id: null,
      }).eq("user_id", oldUserId);
    }

    const { error: transferError } = await supabase.from("user_subscriptions").upsert(
      {
        user_id: newUserId,
        plan: "premium",
        subscription_status: event.period_type === "TRIAL" ? "trialing" : "active",
        purchase_provider: resolveProvider(event.store),
        revenuecat_app_user_id: event.app_user_id,
        apple_original_transaction_id: event.original_transaction_id ?? null,
        current_period_end: resolveExpiry(event.expiration_at_ms),
        cancel_at_period_end: false,
      },
      { onConflict: "user_id" },
    );

    if (transferError) {
      console.error("[rc-webhook] DB error (TRANSFER):", transferError);
      return new Response(JSON.stringify({ error: "DB write failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`[rc-webhook] TRANSFER → ${oldUserId?.slice(0, 8)}… → ${newUserId.slice(0, 8)}…`);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Map event → subscription patch ───────────────────────────────────────────
  let patch: Record<string, unknown> | null = null;

  switch (event.type) {
    case RC_EVENT.INITIAL_PURCHASE:
      patch = {
        plan: "premium",
        subscription_status: event.period_type === "TRIAL" ? "trialing" : "active",
        purchase_provider: provider,
        revenuecat_app_user_id: event.app_user_id,
        apple_original_transaction_id: event.original_transaction_id ?? null,
        current_period_end: resolveExpiry(event.expiration_at_ms),
        cancel_at_period_end: false,
      };
      break;

    case RC_EVENT.RENEWAL:
      patch = {
        subscription_status: "active",
        current_period_end: resolveExpiry(event.expiration_at_ms),
        cancel_at_period_end: false,
      };
      break;

    case RC_EVENT.PRODUCT_CHANGE:
      patch = {
        plan: "premium",
        subscription_status: "active",
        current_period_end: resolveExpiry(event.expiration_at_ms),
      };
      break;

    case RC_EVENT.CANCELLATION:
      patch = {
        cancel_at_period_end: true,
      };
      break;

    case RC_EVENT.EXPIRATION:
      patch = {
        plan: "free",
        subscription_status: "canceled",
        cancel_at_period_end: false,
        current_period_end: null,
      };
      break;
    // Plaid cleanup for EXPIRATION is handled after the DB write below.

    case RC_EVENT.BILLING_ISSUE:
      patch = {
        subscription_status: "past_due",
      };
      break;

    default:
      return new Response(JSON.stringify({ received: true, action: "ignored" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
  }

  // ── Write to DB ───────────────────────────────────────────────────────────────
  const { error } = await supabase
    .from("user_subscriptions")
    .upsert(
      { user_id: userId, ...patch },
      { onConflict: "user_id" },
    );

  if (error) {
    console.error("[rc-webhook] DB error:", error);
    return new Response(JSON.stringify({ error: "DB write failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Disconnect Plaid when the subscription fully expires.
  // Accounts are kept with active=false so the last known balance is preserved.
  if (event.type === RC_EVENT.EXPIRATION) {
    await removePlaidItemsForUser(supabase, userId);
  }

  console.log(`[rc-webhook] ${event.type} → user ${userId.slice(0, 8)}… → ${JSON.stringify(patch)}`);

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
