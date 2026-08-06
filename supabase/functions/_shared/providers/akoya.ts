/**
 * AkoyaProvider — fallback aggregator for institutions Plaid cannot reach.
 *
 * Akoya is a direct OAuth 2.0 / OIDC integration; there is no drop-in widget
 * like Plaid Link. Endpoints below are transcribed from docs.akoya.com:
 *
 *   authorize  GET  {idp}/auth
 *   token      POST {idp}/token         (Basic auth on exchange, body creds on refresh)
 *   revoke     POST {idp}/revoke
 *   accounts   GET  {products}/accounts/v3/{providerId}
 *
 * Two Akoya-specific hazards this module is built around:
 *
 *  1. The id_token IS the bearer token. There is no `access_token` field in the
 *     token response — a detail Akoya calls out because generic OAuth clients
 *     get it wrong.
 *  2. Every refresh returns a NEW refresh token and invalidates the old one.
 *     Losing the new value bricks the connection permanently, so refreshes
 *     return RotatedCredentials that the caller is contractually required to
 *     persist. The caller also holds a row lock — see financial-sync.
 *
 * Required secrets:
 *   AKOYA_CLIENT_ID, AKOYA_CLIENT_SECRET, AKOYA_REDIRECT_URI
 *   AKOYA_ENV  (sandbox | production)  defaults to sandbox
 *   TOKEN_ENC_KEY  (see _shared/token-crypto.ts)
 */

import { decryptToken, encryptToken } from "../token-crypto.ts";
import { normalizeAkoyaAccounts } from "./akoya-normalize.ts";
import {
  type FinancialConnection,
  type FinancialProvider,
  type ProviderContext,
  type ProviderSyncResult,
  ReauthRequiredError,
  type RotatedCredentials,
} from "./types.ts";

/** Akoya's expired-id_token error. Docs: "Any data request with an expired token". */
const EXPIRED_ID_TOKEN_CODE = 602;

/** Docs advise assuming a 15-minute id_token life regardless of what's returned. */
const ASSUMED_ID_TOKEN_TTL_MS = 15 * 60 * 1000;

/** Refresh a little early so a sync can't start with a token that dies mid-flight. */
const REFRESH_SKEW_MS = 60 * 1000;

export interface AkoyaTokenSet {
  idToken: string;
  refreshToken: string;
  expiresAt: string;
}

function isProduction(): boolean {
  return (Deno.env.get("AKOYA_ENV") || "sandbox") === "production";
}

export function akoyaIdpBase(): string {
  return isProduction()
    ? "https://idp.ddp.akoya.com"
    : "https://sandbox-idp.ddp.akoya.com";
}

export function akoyaProductsBase(): string {
  return isProduction()
    ? "https://products.ddp.akoya.com"
    : "https://sandbox-products.ddp.akoya.com";
}

export function akoyaCredentials(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientId = Deno.env.get("AKOYA_CLIENT_ID");
  const clientSecret = Deno.env.get("AKOYA_CLIENT_SECRET");
  const redirectUri = Deno.env.get("AKOYA_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Akoya not configured");
  }
  return { clientId, clientSecret, redirectUri };
}

function expiryFromNow(): string {
  return new Date(Date.now() + ASSUMED_ID_TOKEN_TTL_MS).toISOString();
}

// ── Token endpoint ─────────────────────────────────────────────────────────

/**
 * Exchanges an authorization code for the initial token pair.
 *
 * Security note from the docs: the INITIAL exchange authenticates with HTTP
 * Basic (client_id:client_secret), while refresh puts the credentials in the
 * body. They are not interchangeable.
 *
 * The authorization code expires 5 minutes after issue.
 */
export async function exchangeAuthorizationCode(code: string): Promise<AkoyaTokenSet> {
  const { clientId, clientSecret, redirectUri } = akoyaCredentials();

  const res = await fetch(`${akoyaIdpBase()}/token`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Akoya token exchange failed:", JSON.stringify(body));
    throw new Error(body?.error_description ?? body?.error ?? "Akoya token exchange failed");
  }
  if (!body.id_token || !body.refresh_token) {
    throw new Error("Akoya token response missing id_token or refresh_token");
  }

  return {
    idToken: body.id_token,
    refreshToken: body.refresh_token,
    expiresAt: expiryFromNow(),
  };
}

/**
 * Trades a refresh token for a fresh pair.
 *
 * The returned refresh token REPLACES the one passed in — Akoya invalidates the
 * old value immediately. On `invalid_request` the grant is dead and the user has
 * to reconsent; the docs are explicit that retrying here just fills the logs.
 */
export async function refreshTokens(refreshToken: string): Promise<AkoyaTokenSet> {
  const { clientId, clientSecret } = akoyaCredentials();

  const res = await fetch(`${akoyaIdpBase()}/token`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body?.error === "invalid_request") {
      throw new ReauthRequiredError("akoya", "Akoya refresh token has expired");
    }
    console.error("Akoya token refresh failed:", JSON.stringify(body));
    throw new Error(body?.error_description ?? body?.error ?? "Akoya token refresh failed");
  }
  if (!body.id_token || !body.refresh_token) {
    throw new Error("Akoya refresh response missing id_token or refresh_token");
  }

  return {
    idToken: body.id_token,
    refreshToken: body.refresh_token,
    expiresAt: expiryFromNow(),
  };
}

/** Encrypts a token set for storage in financial_connections. */
export async function encryptTokenSet(tokens: AkoyaTokenSet): Promise<RotatedCredentials> {
  return {
    idTokenEncrypted: await encryptToken(tokens.idToken),
    refreshTokenEncrypted: await encryptToken(tokens.refreshToken),
    tokenExpiresAt: tokens.expiresAt,
  };
}

// ── Provider ───────────────────────────────────────────────────────────────

async function ensureFreshTokens(
  connection: FinancialConnection,
): Promise<{ idToken: string; rotated?: RotatedCredentials }> {
  if (!connection.refresh_token_encrypted) {
    throw new ReauthRequiredError("akoya", "Akoya connection has no refresh token");
  }

  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : 0;
  const stillFresh = expiresAt - REFRESH_SKEW_MS > Date.now();

  if (stillFresh && connection.id_token_encrypted) {
    return { idToken: await decryptToken(connection.id_token_encrypted) };
  }

  const tokens = await refreshTokens(await decryptToken(connection.refresh_token_encrypted));
  return { idToken: tokens.idToken, rotated: await encryptTokenSet(tokens) };
}

export const akoyaProvider: FinancialProvider = {
  id: "akoya",

  async fetchAccounts(
    connection: FinancialConnection,
    ctx: ProviderContext,
  ): Promise<ProviderSyncResult> {
    const providerId = connection.institution_id;
    if (!providerId) {
      throw new Error("Akoya connection is missing its provider id");
    }

    let { idToken, rotated } = await ensureFreshTokens(connection);

    const call = (bearer: string) =>
      fetch(`${akoyaProductsBase()}/accounts/v3/${encodeURIComponent(providerId)}`, {
        method: "GET",
        headers: {
          "accept": "application/json",
          "authorization": `Bearer ${bearer}`,
          "x-akoya-interaction-type": ctx.interaction,
          "x-akoya-last-access": ctx.lastAccessAt,
          // We do not subscribe to Payments, so this is always nonpayments.
          "x-akoya-intent-type": "nonpayments",
        },
      });

    let res = await call(idToken);

    // A 602 means the id_token died early — providers often expire it well
    // before the nominal 24h. Refresh once and retry; never loop.
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (Number(body?.code) === EXPIRED_ID_TOKEN_CODE) {
        const tokens = await refreshTokens(
          await decryptToken(connection.refresh_token_encrypted!),
        );
        idToken = tokens.idToken;
        rotated = await encryptTokenSet(tokens);
        res = await call(idToken);
      } else {
        console.error(
          `Akoya accounts fetch failed for ${connection.provider_item_id}:`,
          JSON.stringify(body),
        );
        if (res.status === 401) {
          throw new ReauthRequiredError("akoya", "Akoya rejected the id token");
        }
        throw new Error(body?.message ?? `Akoya accounts fetch failed (${res.status})`);
      }
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error("Akoya accounts retry failed:", JSON.stringify(body));
      throw new Error(body?.message ?? `Akoya accounts fetch failed (${res.status})`);
    }

    // 206 Partial Content is a documented success: some accounts resolved and
    // some returned errors. Take what came back rather than failing the sync.
    if (res.status === 206) {
      console.warn(`Akoya returned partial account data for ${connection.provider_item_id}`);
    }

    return {
      accounts: normalizeAkoyaAccounts(await res.json()),
      rotatedCredentials: rotated,
    };
  },

  async disconnect(connection: FinancialConnection): Promise<void> {
    if (!connection.refresh_token_encrypted) return;
    const { clientId, clientSecret } = akoyaCredentials();

    const res = await fetch(`${akoyaIdpBase()}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token: await decryptToken(connection.refresh_token_encrypted),
        token_type_hint: "refresh_token",
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("Akoya /revoke non-OK:", res.status, body);
    }
  },
};
