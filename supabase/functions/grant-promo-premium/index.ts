/**
 * Admin-only: grants a free year of Premium via a real, trackable Stripe
 * subscription (100%-off coupon on the yearly price) — used for giveaway
 * winners (e.g. the Instagram build-sharing campaign).
 *
 * Deliberately writes nothing to user_subscriptions beyond linking
 * stripe_customer_id (required so the existing stripe-webhook can find the
 * user). plan/subscription_status/current_period_end are filled in by that
 * same webhook on customer.subscription.created + invoice.paid, exactly as
 * for any real subscriber — so expiry after the free year (failed renewal,
 * no card on file) is handled by code that already exists.
 *
 * Only callable with the Supabase service role key as the bearer token —
 * never a user JWT, never reachable from the client app.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@22.1.1";

const PRICE_ID_YEARLY = Deno.env.get("STRIPE_PRICE_YEARLY") ?? "price_1TDyCe2cDVgFonAb5P637p2r";
const PROMO_COUPON_ID = "forgenta-promo-1yr";

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

  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[grant-promo-premium] SUPABASE_SERVICE_ROLE_KEY not configured");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const providedKey = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (providedKey !== SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  if (!STRIPE_SECRET_KEY) {
    console.error("[grant-promo-premium] STRIPE_SECRET_KEY not configured");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { user_id?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userId = body.user_id;
  if (!userId) {
    return new Response(JSON.stringify({ error: "user_id is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2026-02-25.clover" });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(userId);
    if (authErr || !authUser?.user) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Find or create Stripe customer ───────────────────────────────────
    const { data: existingSub } = await supabase
      .from("user_subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();

    let customerId = existingSub?.stripe_customer_id ?? null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: authUser.user.email ?? undefined,
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;

      const { error: upsertErr } = await supabase
        .from("user_subscriptions")
        .upsert({ user_id: userId, stripe_customer_id: customerId }, { onConflict: "user_id" });
      if (upsertErr) throw new Error(upsertErr.message);
    }

    // ── Ensure the giveaway coupon exists (idempotent — created once, reused) ──
    let coupon: Stripe.Coupon;
    try {
      coupon = await stripe.coupons.retrieve(PROMO_COUPON_ID);
    } catch {
      coupon = await stripe.coupons.create({
        id: PROMO_COUPON_ID,
        percent_off: 100,
        duration: "once",
        name: "Forgenta promo — 1 year free",
      });
    }

    // ── Create the $0 subscription — no payment method required ──────────
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: PRICE_ID_YEARLY }],
      coupon: coupon.id,
      metadata: {
        supabase_user_id: userId,
        promo_note: body.note ?? "",
      },
    });

    console.log(`[grant-promo-premium] granted ${userId} -> sub ${subscription.id} (${subscription.status})`);

    return new Response(
      JSON.stringify({
        ok: true,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        status: subscription.status,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[grant-promo-premium] error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
