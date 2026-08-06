/**
 * akoya-auth-url
 *
 * Builds the Akoya authorization URL for a supported institution and records a
 * single-use CSRF state server-side. The browser never sees the client secret,
 * and the state it later echoes back is only trusted if it matches a row here.
 *
 * The Akoya `connector` for each institution is read from an environment
 * variable rather than hardcoded — the real values only exist inside the Data
 * Recipient Hub, and they differ between sandbox and production:
 *
 *   AKOYA_CONNECTOR_FIDELITY=<connector id from the Hub>
 *
 * Adding another fallback institution means adding one env var and one entry in
 * SUPPORTED_INSTITUTIONS. No code changes anywhere else.
 *
 * Required secrets: AKOYA_CLIENT_ID, AKOYA_CLIENT_SECRET, AKOYA_REDIRECT_URI,
 * AKOYA_ENV, TOKEN_ENC_KEY.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, getClientIp, rateLimitedResponse } from "../_shared/rate-limit.ts";
import { akoyaCredentials, akoyaIdpBase } from "../_shared/providers/akoya.ts";

const MAX_LINKED = 10;
const RATE_LIMIT = { windowMs: 60_000, max: 10 };

/**
 * Institutions we offer as a Plaid fallback, keyed by a stable slug the client
 * sends. Fidelity is the only one for now, per the rollout plan.
 */
const SUPPORTED_INSTITUTIONS: Record<string, { displayName: string; envVar: string }> = {
  fidelity: { displayName: "Fidelity", envVar: "AKOYA_CONNECTOR_FIDELITY" },
};

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** URL-safe, unpadded base64 of 32 random bytes. */
function generateState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const ip = getClientIp(req);
  const rl = await checkRateLimit(db, `${ip}:akoya-auth-url`, RATE_LIMIT);
  if (!rl.allowed) return rateLimitedResponse(cors, RATE_LIMIT, rl.resetAt);

  try {
    let clientId: string;
    let redirectUri: string;
    try {
      ({ clientId, redirectUri } = akoyaCredentials());
    } catch {
      return json({ error: "Akoya not configured" }, 503, cors);
    }

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

    const { data: sub } = await db
      .from("user_subscriptions")
      .select("plan, subscription_status")
      .eq("user_id", userId)
      .maybeSingle();
    const isActive = sub?.plan === "premium" &&
      ["active", "trialing"].includes(sub?.subscription_status ?? "");
    if (!isActive) return json({ error: "Premium subscription required" }, 403, cors);

    const { count } = await db
      .from("financial_connections")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((count ?? 0) >= MAX_LINKED) {
      return json({ error: `Maximum ${MAX_LINKED} linked institutions allowed` }, 422, cors);
    }

    const body = await req.json().catch(() => ({}));
    const institutionKey = typeof body?.institution === "string" ? body.institution : "";

    // Server-side allowlist. The UI only offers supported institutions, but the
    // check has to live here too — the client is not the authority.
    const institution = SUPPORTED_INSTITUTIONS[institutionKey];
    if (!institution) {
      return json({ error: "Institution not supported by Akoya fallback" }, 400, cors);
    }

    const connector = Deno.env.get(institution.envVar);
    if (!connector) {
      console.error(`${institution.envVar} is not set; cannot build Akoya auth URL`);
      return json(
        { error: `${institution.displayName} is not available right now.` },
        503,
        cors,
      );
    }

    const state = generateState();
    const { error: stateErr } = await db.from("oauth_states").insert({
      state,
      user_id: userId,
      provider: "akoya",
      connector,
      redirect_uri: redirectUri,
    });
    if (stateErr) {
      console.error("Failed to persist oauth state:", stateErr.message);
      return json({ error: "Could not start the connection" }, 500, cors);
    }

    const authUrl = new URL(`${akoyaIdpBase()}/auth`);
    authUrl.searchParams.set("connector", connector);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid profile offline_access");
    authUrl.searchParams.set("state", state);

    return json(
      {
        auth_url: authUrl.toString(),
        institution_name: institution.displayName,
      },
      200,
      cors,
    );
  } catch (err) {
    console.error("akoya-auth-url:", err);
    return json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
      cors,
    );
  }
});
