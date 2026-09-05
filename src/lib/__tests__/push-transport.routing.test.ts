/**
 * PUSH DELIVERY — the routing and the failure classification, which a live run cannot reach.
 *
 * A dry-run against the real function proves the gate, the scoping and the run row. It cannot
 * prove these, because they only happen when a real device token is being posted to a real
 * provider. So they are asserted here.
 *
 * ⚠️ THE ONE THAT MATTERS MOST IS THE APNs HOST. Sandbox and production are separate token pools
 * AND separate hosts, and a TestFlight token posted to the production host is **not rejected —
 * it silently vanishes.** No error, no failed count, nothing on the phone. That is the precise
 * failure this app must never make look like success, and it is why `environment` travels on the
 * `device_tokens` row rather than being inferred from a deploy flag.
 *
 * ⚠️ WHAT THIS FILE STILL CANNOT PROVE, and `docs/push-runbook.md` says the same: that a banner
 * appears on a phone. Mocks prove the right request went to the right host with the right shape.
 * A real device is Tre's step and cannot be a CI gate.
 *
 * Would-fail checks: send a sandbox token to the production host and the first case fails;
 * classify a 410 as retryable and the retirement case fails, which is how a dead device gets
 * retried forever while counting as reachable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sendApns, sendFcm, tokenTail, type DeviceRow,
} from '../../../supabase/functions/_shared/push-transport';

/** A P-256 key in PKCS#8, generated for this test. Not a credential — it signs nothing real. */
let TEST_P8 = '';

const device = (over: Partial<DeviceRow> = {}): DeviceRow => ({
  id: 'd1', platform: 'ios', token: 'apns-token-ending-1234', environment: 'sandbox', ...over,
});

const message = { title: 'What a cash floor is', body: '2-minute lesson.', key: 'learn_lesson:x' };

/** Captures the request without performing it. */
function stubFetch(status: number, body = '') {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('oauth2.googleapis.com')) {
      return { ok: true, json: async () => ({ access_token: 'stub-access-token' }) };
    }
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  }));
  return calls;
}

beforeEach(async () => {
  if (!TEST_P8) {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
    );
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    TEST_P8 = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----`;
  }
  vi.stubGlobal('Deno', {
    env: {
      get: (k: string) => ({
        APNS_AUTH_KEY_P8: TEST_P8,
        APNS_KEY_ID: 'KEYID12345',
        APNS_TEAM_ID: 'JAGC2SWGG4',
      } as Record<string, string>)[k],
    },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('APNs host — the silent-vanish failure', () => {
  it('sends a SANDBOX token to the sandbox host', async () => {
    const calls = stubFetch(200);
    await sendApns(device({ environment: 'sandbox' }), message);

    expect(calls[0].url).toContain('api.sandbox.push.apple.com');
    expect(calls[0].url).not.toContain('//api.push.apple.com');
  });

  it('sends a PRODUCTION token to the production host', async () => {
    const calls = stubFetch(200);
    await sendApns(device({ environment: 'production' }), message);

    expect(calls[0].url).toContain('api.push.apple.com');
    expect(calls[0].url).not.toContain('sandbox');
  });

  it('carries the bundle id as apns-topic, which APNs requires', async () => {
    const calls = stubFetch(200);
    await sendApns(device(), message);

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['apns-topic']).toBe('com.treforged.forged');
    expect(headers['apns-push-type']).toBe('alert');
    expect(headers.authorization).toMatch(/^bearer ey/); // a signed JWT, not a raw key
  });

  it('never puts key material in the request beyond the signed JWT', async () => {
    const calls = stubFetch(200);
    await sendApns(device(), message);

    const serialised = JSON.stringify(calls[0]);
    expect(serialised).not.toContain('BEGIN PRIVATE KEY');
    expect(serialised).not.toContain(TEST_P8.replace(/\s/g, '').slice(30, 80));
  });
});

describe('failure classification — retire versus retry', () => {
  it('RETIRES a device APNs says is gone, rather than retrying it forever', async () => {
    stubFetch(410, '{"reason":"Unregistered"}');
    const outcome = await sendApns(device(), message);

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.retire).toBe(true);
  });

  it('RETIRES on BadDeviceToken, which is a 400 rather than a 410', async () => {
    stubFetch(400, '{"reason":"BadDeviceToken"}');
    const outcome = await sendApns(device(), message);
    expect(outcome.ok === false && outcome.retire).toBe(true);
  });

  it('does NOT retire on a server-side wobble — that device is still real', async () => {
    stubFetch(503, 'service unavailable');
    const outcome = await sendApns(device(), message);

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.retire).toBe(false);
  });

  it('names only the LAST FOUR characters of a token in a failure reason', async () => {
    stubFetch(503, 'service unavailable');
    const outcome = await sendApns(device({ token: 'super-secret-device-token-9876' }), message);

    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) {
      expect(outcome.reason).toContain('9876');
      expect(outcome.reason).not.toContain('super-secret-device-token');
    }
  });
});

describe('FCM', () => {
  beforeEach(() => {
    vi.stubGlobal('Deno', {
      env: {
        get: (k: string) => k === 'FCM_SERVICE_ACCOUNT_JSON'
          ? JSON.stringify({ client_email: 'x@y.iam.gserviceaccount.com', private_key: TEST_P8 })
          : undefined,
      },
    });
  });

  it('refuses loudly when the service account is absent, naming the VARIABLE not a value', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } });
    await expect(sendFcm(device({ platform: 'android' }), message))
      .rejects.toThrow('FCM_SERVICE_ACCOUNT_JSON is not set');
  });

  it('refuses loudly on malformed JSON without quoting the document', async () => {
    vi.stubGlobal('Deno', { env: { get: () => 'not json at all' } });
    // The parse error is swallowed on purpose: its message can quote the document, and the
    // document is a private key.
    await expect(sendFcm(device({ platform: 'android' }), message))
      .rejects.toThrow('FCM_SERVICE_ACCOUNT_JSON is not valid JSON');
  });
});

describe('tokenTail', () => {
  it('shows four characters and never more', () => {
    expect(tokenTail('abcdefghijklmnop')).toBe('…mnop');
  });

  it('shows nothing identifiable for a token too short to mask', () => {
    expect(tokenTail('ab')).toBe('****');
  });
});
