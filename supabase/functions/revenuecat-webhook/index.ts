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

const RC_EVENT = {
  INITIAL_PURCHASE:  "INITIAL_PURCHASE",
  RENEWAL:           "RENEWAL",
  PRODUCT_CHANGE:    "PRODUCT_CHANGE",
  CANCELLATION:      "CANCELLATION",
  EXPIRATION:        "EXPIRATION",
  BILLING_ISSUE:     "BILLING_ISSUE",
} as const;

type RcEventType = typeof RC_EVENT[keyof typeof RC_EVENT];

interface RcEvent {
  type: RcEventType;
  app_user_id: string;
  original_app_user_id?: string;
  product_id?: string;
  expiration_at_ms?: number;
  original_transaction_id?: string;
  store?: "APP_STORE" | "PLAY_STORE" | "STRIPE" | "PROMOTIONAL";
  period_type?: "NORMAL" | "TRIAL" | "INTRO";
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

  console.log(`[rc-webhook] ${event.type} → user ${userId.slice(0, 8)}… → ${JSON.stringify(patch)}`);

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
