// PLAID WEBHOOK - signature, freshness, body binding, and a transactions-only pull.
// The key pair is generated here, so every signature case is a real ES256 verification, and each
// refusal case is paired with the valid one it differs from by exactly one thing.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  verifyPlaidWebhook, plaidKeyId, handlePlaidWebhookEvent, shouldPullTransactions, type Jwk,
} from '../../../supabase/functions/_shared/plaid-webhook';

const b64url = (bytes: Uint8Array | string) =>
  Buffer.from(typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes)
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function keyPair() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as Jwk;
  return { privateKey: kp.privateKey, jwk };
}

async function sign(privateKey: CryptoKey, body: string, iat: number, alg = 'ES256') {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const hash = Buffer.from(digest).toString('hex');
  const head = b64url(JSON.stringify({ alg, kid: 'k1', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iat, request_body_sha256: hash }));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64url(new Uint8Array(sig))}`;
}

const BODY = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'item-1' });
const NOW = 1_800_000_000;

describe('verifyPlaidWebhook', () => {
  it('accepts a correctly signed, fresh token bound to this body', async () => {
    const { privateKey, jwk } = await keyPair();
    const jwt = await sign(privateKey, BODY, NOW - 10);
    expect(plaidKeyId(jwt)).toBe('k1');
    expect(await verifyPlaidWebhook(BODY, jwt, jwk, NOW)).toEqual({ ok: true });
  });

  it('refuses a body changed after signing', async () => {
    const { privateKey, jwk } = await keyPair();
    const jwt = await sign(privateKey, BODY, NOW - 10);
    expect(await verifyPlaidWebhook(BODY.replace('item-1', 'item-2'), jwt, jwk, NOW)).toEqual({ ok: false, reason: 'body hash mismatch' });
  });

  it('refuses a token older than five minutes', async () => {
    const { privateKey, jwk } = await keyPair();
    const jwt = await sign(privateKey, BODY, NOW - 301);
    expect(await verifyPlaidWebhook(BODY, jwt, jwk, NOW)).toEqual({ ok: false, reason: 'token too old' });
  });

  it('refuses a signature from a different key', async () => {
    const a = await keyPair();
    const b = await keyPair();
    const jwt = await sign(a.privateKey, BODY, NOW - 10);
    expect(await verifyPlaidWebhook(BODY, jwt, b.jwk, NOW)).toEqual({ ok: false, reason: 'bad signature' });
  });

  it('refuses a missing header, a missing key, an expired key, and a non-ES256 alg', async () => {
    const { privateKey, jwk } = await keyPair();
    const jwt = await sign(privateKey, BODY, NOW - 10);
    expect((await verifyPlaidWebhook(BODY, null, jwk, NOW)).ok).toBe(false);
    expect((await verifyPlaidWebhook(BODY, jwt, null, NOW)).ok).toBe(false);
    expect((await verifyPlaidWebhook(BODY, jwt, { ...jwk, expired_at: NOW - 1 }, NOW)).ok).toBe(false);
    const hs = await sign(privateKey, BODY, NOW - 10, 'HS256');
    expect(plaidKeyId(hs)).toBeNull();
    expect((await verifyPlaidWebhook(BODY, hs, jwk, NOW)).ok).toBe(false);
  });
});

describe('handlePlaidWebhookEvent - transactions only', () => {
  function deps(found: boolean) {
    const balanceCalls = vi.fn();
    return {
      balanceCalls,
      d: {
        findConnectionByItemId: vi.fn(async (id: string) => (found ? { id, provider: 'plaid' } : null)),
        syncTransactionsOnly: vi.fn(async () => 7),
      },
    };
  }

  it('SYNC_UPDATES_AVAILABLE pulls transactions once, for that item', async () => {
    const { d, balanceCalls } = deps(true);
    const r = await handlePlaidWebhookEvent(JSON.parse(BODY), d);
    expect(r).toEqual({ action: 'synced', written: 7 });
    expect(d.findConnectionByItemId).toHaveBeenCalledWith('item-1');
    expect(d.syncTransactionsOnly).toHaveBeenCalledTimes(1);
    expect(balanceCalls).not.toHaveBeenCalled();
  });

  it('paired: any other webhook is acknowledged and pulls nothing', async () => {
    for (const p of [
      { webhook_type: 'TRANSACTIONS', webhook_code: 'DEFAULT_UPDATE', item_id: 'item-1' },
      { webhook_type: 'ITEM', webhook_code: 'ERROR', item_id: 'item-1' },
      { webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE' },
    ]) {
      const { d } = deps(true);
      expect(shouldPullTransactions(p)).toBe(false);
      expect((await handlePlaidWebhookEvent(p, d)).action).toBe('ignored');
      expect(d.syncTransactionsOnly).not.toHaveBeenCalled();
    }
  });

  it('an unknown item pulls nothing', async () => {
    const { d } = deps(false);
    expect((await handlePlaidWebhookEvent(JSON.parse(BODY), d)).action).toBe('unknown-item');
    expect(d.syncTransactionsOnly).not.toHaveBeenCalled();
  });
});

describe('the deployed function cannot reach the balance path (source PROXY)', () => {
  const fn = join(__dirname, '..', '..', '..', 'supabase', 'functions', 'plaid-webhook', 'index.ts');
  it('plaid-webhook/index.ts never names a balance or full-sync entry point', () => {
    expect(existsSync(fn)).toBe(true);
    const src = readFileSync(fn, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const banned of ['fetchAccounts', 'syncConnection', 'balance/get', 'handleSync', 'liabilities']) {
      expect(src.includes(banned), banned).toBe(false);
    }
    expect(src).toContain('syncTransactionsOnly');
  });
});
