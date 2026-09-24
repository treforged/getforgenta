/**
 * Plaid webhook: verify it, and route SYNC_UPDATES_AVAILABLE to a TRANSACTIONS-ONLY pull.
 *
 * WHY THIS EXISTS (Tre, 2026-09-23: "since plaid runs in the morning ... missing transactions ...
 * when people get paychecks"). Measured: the only pull was the 9 AM ET cron, and 12 of 26 recent
 * deposits over $200 landed two days after their posted date. A webhook pulls when Plaid HAS the
 * data instead of waiting for the next morning. The 9 AM cron stays as the backstop.
 *
 * ⚠️ THIS PATH NEVER CALLS /accounts/balance/get. Plaid bills Balance per call, so a webhook that
 * ran the full sync would turn every Plaid notification into a charge. `handlePlaidWebhookEvent`
 * is given ONLY a transactions sync to call; it has no way to reach the balance path. Sam's
 * condition, 2026-09-23.
 *
 * Pure module - no URL imports - so vitest can load it. The edge function injects the I/O.
 */

export type PlaidWebhookPayload = {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  [k: string]: unknown;
};

export type Jwk = { kty: string; crv: string; x: string; y: string; alg?: string; expired_at?: number | null };

/** Plaid's documented limit: reject a webhook whose token was issued more than 5 minutes ago. */
export const MAX_AGE_SECONDS = 5 * 60;

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(s: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The `kid` a verification header names, or null if the header is not an ES256 JWT. */
export function plaidKeyId(jwt: string | null): string | null {
  if (!jwt) return null;
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = b64urlJson(parts[0]);
    return header.alg === 'ES256' && typeof header.kid === 'string' ? header.kid : null;
  } catch {
    return null;
  }
}

/**
 * Verify a Plaid-Verification JWT against the raw body. Returns the reason on failure so the
 * function can log WHY it refused - a silent 401 is undiagnosable.
 */
export async function verifyPlaidWebhook(
  rawBody: string,
  jwt: string | null,
  key: Jwk | null,
  nowSeconds: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!jwt) return { ok: false, reason: 'no Plaid-Verification header' };
  const parts = jwt.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };
  if (!key) return { ok: false, reason: 'no verification key for this kid' };
  if (key.expired_at) return { ok: false, reason: 'verification key has expired' };

  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    return { ok: false, reason: 'token is not valid base64url JSON' };
  }
  if (header.alg !== 'ES256') return { ok: false, reason: `alg ${String(header.alg)} is not ES256` };

  const pub = await crypto.subtle.importKey(
    'jwk',
    { kty: key.kty, crv: key.crv, x: key.x, y: key.y },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlToBytes(parts[2]), signed);
  if (!valid) return { ok: false, reason: 'bad signature' };

  const iat = typeof claims.iat === 'number' ? claims.iat : NaN;
  if (!Number.isFinite(iat) || nowSeconds - iat > MAX_AGE_SECONDS) return { ok: false, reason: 'token too old' };

  const want = typeof claims.request_body_sha256 === 'string' ? claims.request_body_sha256 : '';
  if (!constantTimeEqual(await sha256Hex(rawBody), want)) return { ok: false, reason: 'body hash mismatch' };
  return { ok: true };
}

/** Which events trigger a pull. Everything else is acknowledged and ignored. */
export function shouldPullTransactions(p: PlaidWebhookPayload): boolean {
  return p.webhook_type === 'TRANSACTIONS' && p.webhook_code === 'SYNC_UPDATES_AVAILABLE' && typeof p.item_id === 'string' && p.item_id.length > 0;
}

export type WebhookDeps<C> = {
  /** Look up the connection by Plaid item id. Null when unknown - never guess. */
  findConnectionByItemId: (itemId: string) => Promise<C | null>;
  /** The transactions-only pull (/transactions/sync). The ONLY provider work this path may do. */
  syncTransactionsOnly: (connection: C) => Promise<number>;
};

export async function handlePlaidWebhookEvent<C>(
  payload: PlaidWebhookPayload,
  deps: WebhookDeps<C>,
): Promise<{ action: 'ignored' | 'unknown-item' | 'synced'; written?: number }> {
  if (!shouldPullTransactions(payload)) return { action: 'ignored' };
  const connection = await deps.findConnectionByItemId(payload.item_id as string);
  if (!connection) return { action: 'unknown-item' };
  const written = await deps.syncTransactionsOnly(connection);
  return { action: 'synced', written };
}
