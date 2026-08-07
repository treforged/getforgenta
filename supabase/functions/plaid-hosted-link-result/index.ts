/**
 * plaid-hosted-link-result
 *
 * Closes the loop on Hosted Link. The native client opens Plaid's hosted page in
 * an SFSafariViewController / Custom Tab, so it never receives a public_token the
 * way the in-webview widget's onSuccess does. Instead the client comes back with
 * the link_token it started with, and this function asks Plaid what happened.
 *
 * /link/token/get needs the Plaid secret, which is why this cannot live in the
 * client. The public_token it returns is then handed to the existing
 * plaid-exchange-token → plaid-sync path, so linking behaves identically on both
 * surfaces and there is exactly one implementation of "an item was added".
 *
 * Plaid keeps session results for six hours after completion.
 *
 * Required env vars:
 *   PLAID_CLIENT_ID
 *   PLAID_SECRET
 *   PLAID_ENV  (sandbox | production)  defaults to sandbox
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, getClientIp, rateLimitedResponse } from "../_shared/rate-limit.ts";

// The client polls this while the sheet is open, so the ceiling is higher than
// the one-shot link-token endpoint's.
const RATE_LIMIT = { windowMs: 60_000, max: 60 };

interface ItemAddResult {
  public_token?: string;
  institution_id?: string | null;
  institution_name?: string | null;
}

interface LinkSession {
  results?: { item_add_results?: ItemAddResult[] };
  on_success?: {
    public_token?: string;
    institution_id?: string | null;
    institution_name?: string | null;
  };
  on_exit?: { error?: { error_code?: string } | null };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (payload: unknown, status: number) =>
    new Response(JSON.stringify(payload), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const ip = getClientIp(req);
  const rl = await checkRateLimit(supabase, `${ip}:plaid-hosted-result`, RATE_LIMIT);
  if (!rl.allowed) return rateLimitedResponse(corsHeaders, RATE_LIMIT, rl.resetAt);

  try {
    const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
    const PLAID_SECRET    = Deno.env.get("PLAID_SECRET");
    if (!PLAID_CLIENT_ID || !PLAID_SECRET) return json({ error: "Plaid not configured" }, 503);

    const plaidEnv  = Deno.env.get("PLAID_ENV") || "sandbox";
    const plaidBase = `https://${plaidEnv}.plaid.com`;

    // Verify JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: jwtErr } = await userClient.auth.getUser();
    if (jwtErr || !user) return json({ error: "Unauthorized" }, 401);
    const userId = user.id;

    let bodyJson: Record<string, unknown> = {};
    try { bodyJson = await req.json(); } catch { /* no body */ }
    const linkToken = typeof bodyJson.link_token === "string" ? bodyJson.link_token : undefined;
    if (!linkToken) return json({ error: "link_token required" }, 400);

    // The link_token must be one WE minted for THIS user. Without this check a
    // leaked hosted_link_url would let any authenticated caller claim the
    // resulting Item. Not consumed here — the client polls, so the row has to
    // survive until the session actually finishes.
    const { data: state } = await supabase
      .from("oauth_states")
      .select("user_id, expires_at, consumed_at")
      .eq("state", linkToken)
      .eq("provider", "plaid")
      .maybeSingle();

    if (!state || state.user_id !== userId) return json({ error: "Unknown link session" }, 404);
    if (state.consumed_at) return json({ error: "Link session already used" }, 409);
    if (new Date(state.expires_at).getTime() < Date.now()) {
      return json({ error: "Link session expired" }, 410);
    }

    const res = await fetch(`${plaidBase}/link/token/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret:    PLAID_SECRET,
        link_token: linkToken,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      console.error("Plaid link/token/get error:", JSON.stringify(body));
      return json({ error: body.error_message ?? "Plaid error" }, 502);
    }

    const sessions: LinkSession[] = Array.isArray(body.link_sessions) ? body.link_sessions : [];

    // Plaid documents `results` as the field to prefer, but keeps `on_success`
    // populated too. Read newest-first: a user who backs out and retries inside
    // one hosted session produces more than one entry.
    for (const session of [...sessions].reverse()) {
      const added = session.results?.item_add_results?.find((r) => r.public_token);
      const hit   = added ?? (session.on_success?.public_token ? session.on_success : null);
      if (!hit?.public_token) continue;

      // Burn the state now that it has yielded a token, so the same session
      // cannot be redeemed twice.
      await supabase
        .from("oauth_states")
        .update({ consumed_at: new Date().toISOString() })
        .eq("state", linkToken);

      return json({
        status: "completed",
        public_token:     hit.public_token,
        institution_id:   hit.institution_id   ?? null,
        institution_name: hit.institution_name ?? null,
      }, 200);
    }

    // No public_token yet. Either the user is still in the flow, or they left
    // without linking. Both are normal; the client decides which by whether the
    // browser sheet is still open.
    const exited = sessions.some((s) => s.on_exit);
    return json({ status: exited ? "exited" : "pending" }, 200);
  } catch (err) {
    console.error("plaid-hosted-link-result:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
