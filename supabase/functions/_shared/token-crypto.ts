/**
 * Authenticated encryption for aggregator tokens at rest.
 *
 * Akoya refresh tokens are long-lived bearer credentials for a consumer's
 * financial data, so they never touch the database in plaintext. AES-256-GCM
 * gives us confidentiality plus tamper detection in one primitive, and
 * WebCrypto ships with Deno so there's no dependency to audit.
 *
 * Required secret (Supabase dashboard → Edge Functions → Secrets):
 *   TOKEN_ENC_KEY — 32 raw bytes, base64-encoded. Generate with:
 *     openssl rand -base64 32
 *
 * Stored format:  v1.<base64(iv)>.<base64(ciphertext+tag)>
 * The version prefix exists so the key can be rotated later without having to
 * guess how any given row was written.
 */

const VERSION = "v1";
const IV_BYTES = 12; // 96 bits — the size GCM is specified for

let cachedKey: CryptoKey | null = null;

function base64Encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64Decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const raw = Deno.env.get("TOKEN_ENC_KEY");
  if (!raw) {
    throw new Error("TOKEN_ENC_KEY is not configured");
  }

  const keyBytes = base64Decode(raw);
  if (keyBytes.length !== 32) {
    throw new Error(
      `TOKEN_ENC_KEY must decode to 32 bytes, got ${keyBytes.length}`,
    );
  }

  cachedKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return cachedKey;
}

/** Encrypts a token for storage. Returns the versioned, self-describing string. */
export async function encryptToken(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );

  return [
    VERSION,
    base64Encode(iv),
    base64Encode(new Uint8Array(ciphertext)),
  ].join(".");
}

/**
 * Reverses encryptToken. Throws if the payload was tampered with, if the key is
 * wrong, or if the format version isn't recognised — all of which should be
 * treated as "this connection needs re-authorisation", never retried silently.
 */
export async function decryptToken(stored: string): Promise<string> {
  const parts = stored.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted token");
  }

  const [version, ivPart, ciphertextPart] = parts;
  if (version !== VERSION) {
    throw new Error(`Unsupported token encryption version: ${version}`);
  }

  const key = await getKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Decode(ivPart) },
    key,
    base64Decode(ciphertextPart),
  );

  return new TextDecoder().decode(plaintext);
}

/** True when TOKEN_ENC_KEY is present and usable. Used for config preflight. */
export async function tokenCryptoAvailable(): Promise<boolean> {
  try {
    await getKey();
    return true;
  } catch {
    return false;
  }
}
