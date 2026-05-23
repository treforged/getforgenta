import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@22.1.1";
import { z } from "https://esm.sh/zod@3.25.76";
import {
  checkRateLimit,
  getClientIp,
  rateLimitedResponse,
  type RateLimitConfig,
} from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createTracer, hashId } from "../_shared/tracer.ts";

const RATE_LIMIT: RateLimitConfig = { windowMs: 60_000, max: 10 };

const bodySchema = z.object({
  session_id: z
    .string()
    .regex(/^cs_/, "session_id must be a Stripe checkout session ID"),
}).strict();

function toISO(unixSeconds: number | null | undefined): string | null {
  if (unixSeconds == null || !Number.isFinite(unixSeconds)) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

function getPeriodEnd(sub: Stripe.Subscription): number | null {
  return (sub as unknown as { current_period_end?: number }).current_period_end ?? null;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const tracer = createTracer("verify-checkout");
  const rootSpan = tracer.startSpan("fn.verify-checkout", {
    kind: "SERVER",
    attributes: { "http.method": req.method },
  });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const ip = getClientIp(req);
  const rl = await checkRateLimit(supabase, `${ip}:verify-checkout`, RATE_LIMIT);
  if (!rl.allowed) {
    rootSpan.end("ERROR", new Error("rate_limit_exceeded"));
    return rateLimitedResponse(corsHeaders, RATE_LIMIT, rl.resetAt);
  }

  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");

    // Require authenticated user — only the account owner can verify their own session
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      rootSpan.end("ERROR", new Error("unauthorized"));
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user: authUser }, error: jwtError } = await userClient.auth.getUser();
    if (jwtError || !authUser) {
      rootSpan.end("ERROR", new Error("unauthorized"));
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = authUser.id;
    const userHash = await hashId(userId);

    // Parse request body
    let parsed: { session_id: string };
    try {
      const json = await req.json();
      const result = bodySchema.safeParse(json);
      if (!result.success) {
        rootSpan.end("ERROR", new Error("validation_error"));
        return new Response(
          JSON.stringify({ error: result.error.issues[0].message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      parsed = result.data;
    } catch {
      rootSpan.end("ERROR", new Error("invalid_json"));
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Retrieve the checkout session from Stripe with subscription expanded
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2026-02-25.clover" });

    const stripeRetrieveSpan = tracer.startSpan("stripe.checkout.sessions.retrieve", {
      parentSpanId: rootSpan.spanId,
      kind: "CLIENT",
      attributes: { "peer.service": "stripe", "user.hash": userHash },
    });

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(parsed.session_id, {
        expand: ["subscription"],
      });
      stripeRetrieveSpan.end("OK");
    } catch (stripeErr) {
      stripeRetrieveSpan.end("ERROR", stripeErr);
      rootSpan.end("ERROR", stripeErr);
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Session must be complete (payment received or $0 promo accepted)
    if (session.status !== "complete") {
      rootSpan.end("OK");
      return new Response(
        JSON.stringify({ activated: false, reason: "session_not_complete" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sessionCustomerId = session.customer as string;
    const sessionUserId = session.metadata?.supabase_user_id ?? null;

    // Security: verify the session belongs to the authenticated user.
    // Path A — metadata present: must match the JWT user.
    if (sessionUserId && sessionUserId !== userId) {
      rootSpan.end("ERROR", new Error("user_mismatch"));
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Path B — no metadata: look up the stripe_customer_id to confirm ownership.
    if (!sessionUserId) {
      const { data: existing } = await supabase
        .from("user_subscriptions")
        .select("user_id")
        .eq("stripe_customer_id", sessionCustomerId)
        .maybeSingle();

      if (existing && existing.user_id !== userId) {
        rootSpan.end("ERROR", new Error("user_mismatch"));
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Use metadata user_id when present (handles edge case where customer was created
    // under a different auth session); otherwise fall back to the current auth user.
    const effectiveUserId = sessionUserId ?? userId;

    // Build subscription fields from the expanded subscription object if present
    let subscriptionStatus = "active";
    let subscriptionId: string | null = null;
    let periodEnd: string | null = null;

    if (session.subscription && typeof session.subscription === "object") {
      const sub = session.subscription as Stripe.Subscription;
      subscriptionStatus = sub.status;
      subscriptionId = sub.id;
      periodEnd = toISO(getPeriodEnd(sub));
    } else if (typeof session.subscription === "string" && session.subscription) {
      // Not expanded — retrieve it
      const stripeSubSpan = tracer.startSpan("stripe.subscriptions.retrieve", {
        parentSpanId: rootSpan.spanId,
        kind: "CLIENT",
        attributes: { "peer.service": "stripe" },
      });
      try {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        subscriptionStatus = sub.status;
        subscriptionId = sub.id;
        periodEnd = toISO(getPeriodEnd(sub));
        stripeSubSpan.end("OK");
      } catch (e) {
        stripeSubSpan.end("ERROR", e);
        // Non-fatal: we can still activate with status = active
      }
    }

    // Upsert the subscription record — this is the primary activation write
    const dbUpsertSpan = tracer.startSpan("db.user_subscriptions.upsert", {
      parentSpanId: rootSpan.spanId,
      kind: "CLIENT",
      attributes: {
        "db.table": "user_subscriptions",
        "db.operation": "upsert",
        "user.hash": userHash,
      },
    });

    const upsertPayload: Record<string, unknown> = {
      user_id: effectiveUserId,
      stripe_customer_id: sessionCustomerId,
      plan: "premium",
      subscription_status: subscriptionStatus,
    };
    if (subscriptionId) upsertPayload.stripe_subscription_id = subscriptionId;
    if (periodEnd) upsertPayload.current_period_end = periodEnd;

    const { error: upsertError } = await supabase
      .from("user_subscriptions")
      .upsert(upsertPayload, { onConflict: "user_id" });

    if (upsertError) {
      dbUpsertSpan.end("ERROR", new Error(upsertError.message));
      throw new Error(upsertError.message);
    }
    dbUpsertSpan.end("OK");

    rootSpan.end("OK");
    return new Response(
      JSON.stringify({
        activated: true,
        plan: "premium",
        subscription_status: subscriptionStatus,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "x-trace-id": tracer.traceId,
        },
      },
    );
  } catch (error) {
    console.error("verify-checkout error:", error);
    rootSpan.end("ERROR", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "x-trace-id": tracer.traceId,
        },
      },
    );
  }
});
