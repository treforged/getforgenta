/**
 * The actual delivery of a push — APNs HTTP/2 for iOS, FCM HTTP v1 for Android.
 *
 * ⚠️ NOTHING OF EITHER CREDENTIAL MAY EVER LEAVE THIS MODULE. No key material in a log line, an
 * error message, a run row or a response body. A token is only ever identified by its LAST FOUR
 * characters — enough to match a row against a device, useless to anyone who intercepts it.
 *
 * ⚠️ AND THE FAILURE THAT MUST NEVER LOOK LIKE SUCCESS: a missing credential, a malformed key, a
 * 4xx from either provider, or a token the provider has retired. Every one of those returns an
 * explicit failure. A sender that reports "sent" while no device received anything is the exact
 * green check this codebase refuses everywhere else.
 */

/** The bundle id, which APNs requires as `apns-topic`. Same value as capacitor.config.ts. */
const APNS_TOPIC = "com.treforged.forged";

/** Firebase project for FCM v1. `android/app/google-services.json` carries the same id. */
const FCM_PROJECT_ID = "forgenta-1eeba";

/**
 * How long a minted provider token is reused.
 *
 * APNs accepts a JWT for an hour and REFUSES one re-signed more than once every 20 minutes
 * (`TooManyProviderTokenUpdates`), so re-signing per notification is not merely wasteful, it
 * fails. Fifty minutes leaves margin on both sides.
 */
const TOKEN_TTL_MS = 50 * 60 * 1000;

export interface PushMessage {
  title: string;
  body: string;
  /** Carried so a tap can open the thing it is about rather than the home screen. */
  key: string;
}

export interface DeviceRow {
  id: string;
  platform: "ios" | "android";
  token: string;
  environment: "sandbox" | "production";
}

export type SendOutcome =
  | { ok: true }
  /** The provider says this device is gone. Retire the row; do not retry. */
  | { ok: false; retire: true; reason: string }
  | { ok: false; retire: false; reason: string };

/** Last four characters only. Everything that names a token in a log goes through this. */
export function tokenTail(token: string): string {
  return token.length <= 4 ? "****" : `…${token.slice(-4)}`;
}

// ── Key handling ─────────────────────────────────────────────────────────────

/**
 * PEM to the raw DER bytes `crypto.subtle.importKey` wants.
 *
 * Returns an `ArrayBuffer` rather than a `Uint8Array` on purpose: Deno's lib types require a
 * `BufferSource` backed by a plain `ArrayBuffer`, and a `Uint8Array<ArrayBufferLike>` does not
 * satisfy it. Handing back the buffer directly is the honest fix; casting the view would only
 * silence the checker.
 */
function pemToBytes(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const b64urlJson = (value: unknown): string =>
  b64url(new TextEncoder().encode(JSON.stringify(value)));

// ── APNs ─────────────────────────────────────────────────────────────────────

let apnsJwt: { value: string; mintedAt: number } | null = null;

/**
 * The provider JWT APNs wants, ES256 over the .p8.
 *
 * Cached because APNs refuses a JWT re-signed more often than every 20 minutes. The cache lives
 * for the lifetime of the isolate, which is the right scope: a cold start mints a new one and a
 * warm one reuses it, exactly as intended.
 */
async function apnsProviderToken(): Promise<string> {
  const now = Date.now();
  if (apnsJwt && now - apnsJwt.mintedAt < TOKEN_TTL_MS) return apnsJwt.value;

  const p8 = Deno.env.get("APNS_AUTH_KEY_P8");
  const keyId = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  // Named individually so a half-configured deploy says WHICH one is missing. The values
  // themselves are never echoed.
  if (!p8) throw new Error("APNS_AUTH_KEY_P8 is not set");
  if (!keyId) throw new Error("APNS_KEY_ID is not set");
  if (!teamId) throw new Error("APNS_TEAM_ID is not set");

  const key = await crypto.subtle.importKey(
    "pkcs8", pemToBytes(p8),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );

  const header = b64urlJson({ alg: "ES256", kid: keyId });
  const claims = b64urlJson({ iss: teamId, iat: Math.floor(now / 1000) });
  const signingInput = `${header}.${claims}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput),
  ));

  const value = `${signingInput}.${b64url(signature)}`;
  apnsJwt = { value, mintedAt: now };
  return value;
}

/**
 * ⚠️ SANDBOX AND PRODUCTION ARE DIFFERENT HOSTS AND DIFFERENT TOKEN POOLS. A TestFlight token
 * posted to the production host is not rejected loudly — it SILENTLY VANISHES. That is the
 * failure this app must never make look like success, which is why `environment` travels on the
 * row rather than being inferred from a deploy flag.
 */
function apnsHost(environment: DeviceRow["environment"]): string {
  return environment === "sandbox"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
}

export async function sendApns(device: DeviceRow, message: PushMessage): Promise<SendOutcome> {
  const jwt = await apnsProviderToken();
  const res = await fetch(`${apnsHost(device.environment)}/3/device/${device.token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": APNS_TOPIC,
      "apns-push-type": "alert",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps: { alert: { title: message.title, body: message.body }, sound: "default" },
      key: message.key,
    }),
  });

  if (res.ok) return { ok: true };

  const detail = await res.text().catch(() => "");
  // 410 Gone, or a 400 whose reason is BadDeviceToken, means the device is finished with. Retry
  // is pointless and the row should stop being a send target.
  const retire = res.status === 410 || detail.includes("BadDeviceToken")
    || detail.includes("Unregistered");
  return {
    ok: false, retire,
    reason: `APNs ${res.status} for ${tokenTail(device.token)} (${device.environment}): ${detail.slice(0, 200)}`,
  };
}

// ── FCM ──────────────────────────────────────────────────────────────────────

let fcmToken: { value: string; mintedAt: number } | null = null;

/** An OAuth access token for FCM, from the service account. RS256, exchanged at Google. */
async function fcmAccessToken(): Promise<string> {
  const now = Date.now();
  if (fcmToken && now - fcmToken.mintedAt < TOKEN_TTL_MS) return fcmToken.value;

  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("FCM_SERVICE_ACCOUNT_JSON is not set");

  let account: { client_email?: string; private_key?: string };
  try {
    account = JSON.parse(raw);
  } catch {
    // The parse error is swallowed rather than reported: its message can quote the document,
    // and the document is a private key.
    throw new Error("FCM_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  if (!account.client_email || !account.private_key) {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON is missing client_email or private_key");
  }

  const key = await crypto.subtle.importKey(
    "pkcs8", pemToBytes(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );

  const iat = Math.floor(now / 1000);
  const header = b64urlJson({ alg: "RS256", typ: "JWT" });
  const claims = b64urlJson({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat, exp: iat + 3600,
  });
  const signingInput = `${header}.${claims}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput),
  ));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${b64url(signature)}`,
    }),
  });
  if (!res.ok) throw new Error(`FCM token exchange failed: ${res.status}`);

  const body = await res.json();
  if (!body.access_token) throw new Error("FCM token exchange returned no access_token");

  fcmToken = { value: body.access_token as string, mintedAt: now };
  return fcmToken.value;
}

/**
 * Send, or CHECK WITHOUT SENDING.
 *
 * ⚠️ `validateOnly` IS THE ONLY EVIDENCE AVAILABLE WHEN NOBODY IS WATCHING A PHONE. FCM's v1 API
 * accepts `validate_only` at the top level: it authenticates, resolves the project, validates the
 * device token and the payload, and delivers NOTHING. That exercises the entire chain this
 * codebase could not otherwise prove — that `FCM_SERVICE_ACCOUNT_JSON` parses, that its private
 * key imports and signs an RS256 JWT, that Google mints an access token from it, and that a
 * stored device token is one FCM still recognises.
 *
 * It is not a substitute for a delivered notification and must never be reported as one. A
 * validated request proves the notification COULD be sent; only a banner on a device proves it
 * arrived, and this transport's own header records that it can report success and vanish.
 */
export async function sendFcm(
  device: DeviceRow,
  message: PushMessage,
  opts: { validateOnly?: boolean } = {},
): Promise<SendOutcome> {
  const access = await fcmAccessToken();
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
      body: JSON.stringify({
        validate_only: opts.validateOnly === true,
        message: {
          token: device.token,
          notification: { title: message.title, body: message.body },
          data: { key: message.key },
        },
      }),
    },
  );

  if (res.ok) return { ok: true };

  const detail = await res.text().catch(() => "");
  // UNREGISTERED, or a 404, means the app was uninstalled or the token rotated away.
  const retire = res.status === 404 || detail.includes("UNREGISTERED")
    || detail.includes("registration-token-not-registered");
  return {
    ok: false, retire,
    reason: `FCM ${res.status} for ${tokenTail(device.token)}: ${detail.slice(0, 200)}`,
  };
}

/** One device, whichever provider it belongs to. */
export function sendToDevice(device: DeviceRow, message: PushMessage): Promise<SendOutcome> {
  return device.platform === "ios" ? sendApns(device, message) : sendFcm(device, message);
}

/**
 * Exercise the credentials against a real device row WITHOUT delivering anything.
 *
 * ⚠️ ANDROID ONLY, AND THAT ASYMMETRY IS THE POINT. FCM has `validate_only`; APNs has no
 * equivalent, so the only way to test an APNs credential is to send a real push to a real token.
 * With zero iOS tokens on the system there is nothing to send to, which means **the APNs key
 * remains completely unproven and no green result here may be read as covering it.** Saying which
 * link is untested matters more than the links that pass.
 */
export function checkDevice(device: DeviceRow, message: PushMessage): Promise<SendOutcome> {
  if (device.platform === "ios") {
    return Promise.resolve({
      ok: false,
      retire: false,
      reason: "APNs has no validate-only mode; a real send to a real device is the only test.",
    });
  }
  return sendFcm(device, message, { validateOnly: true });
}
