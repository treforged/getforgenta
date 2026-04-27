import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkRateLimit,
  getClientIp,
  rateLimitedResponse,
  type RateLimitConfig,
} from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createTracer, hashId } from "../_shared/tracer.ts";

const RATE_LIMIT: RateLimitConfig = { windowMs: 60_000, max: 20 };

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Propagate trace ID from frontend if provided; otherwise start a new trace.
  const incomingTraceId = req.headers.get("x-trace-id") ?? undefined;
  const tracer = createTracer("create-portal-session", incomingTraceId);
  const rootSpan = tracer.startSpan("fn.create-portal-session", {
    kind: "SERVER",
    attributes: { "http.method": req.method },
  });

  // Service role client — only this key can access the rate_limits table
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Rate limit by IP before doing any auth or business logic
  const ip = getClientIp(req);
  const rl = await checkRateLimit(supabase, `${ip}:create-portal-session`, RATE_LIMIT);
  if (!rl.allowed) {
    rootSpan.end("ERROR", new Error("rate_limit_exceeded"));
    return rateLimitedResponse(corsHeaders, RATE_LIMIT, rl.resetAt);
  }

  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");

    // The gateway has already verified the JWT. Extract sub from the Authorization header.
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      rootSpan.end("ERROR", new Error("unauthorized"));
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify JWT via Supabase auth — validates the signature server-side
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
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

    // Hash user ID for safe log correlation (not reversible)
    const userHash = await hashId(userId);

    // ── DB: get Stripe customer ID ────────────────────────────────────────
    const dbSelectSpan = tracer.startSpan("db.user_subscriptions.select", {
      parentSpanId: rootSpan.spanId,
      kind: "CLIENT",
      attributes: { "db.table": "user_subscriptions", "db.operation": "select", "user.hash": userHash },
    });
    const { data: userSub } = await supabase
      .from("user_subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();
    dbSelectSpan.end("OK");

    if (!userSub?.stripe_customer_id) {
      rootSpan.end("ERROR", new Error("no_subscription_found"));
      return new Response(JSON.stringify({ error: "No subscription found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use trusted Origin header only — never trust client-provided return_url
    const origin = req.headers.get("origin") || "https://getforgenta.com";

    // ── Stripe: create billing portal session ────────────────────────────
    const stripePortalSpan = tracer.startSpan("stripe.billing_portal.sessions.create", {
      parentSpanId: rootSpan.spanId,
      kind: "CLIENT",
      attributes: {
        "http.method": "POST",
        "http.path": "/v1/billing_portal/sessions",
        "peer.service": "stripe",
      },
    });
    const portalRes = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        customer: userSub.stripe_customer_id,
        return_url: `${origin}/premium`,
      }),
    });
    const portal = await portalRes.json();
    stripePortalSpan.end(
      portalRes.ok ? "OK" : "ERROR",
      portalRes.ok ? undefined : new Error(`stripe_billing_portal_${portalRes.status}`),
    );
    if (!portalRes.ok) throw new Error(`Portal error: ${JSON.stringify(portal)}`);

    rootSpan.end("OK");
    return new Response(JSON.stringify({ url: portal.url }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "x-trace-id": tracer.traceId,
      },
    });
  } catch (error) {
    console.error("Portal error:", error);
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
      }
    );
  }
});
