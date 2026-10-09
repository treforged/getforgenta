/**
 * One-click unsubscribe for the email Forgenta sends to its own users (proposal C, 2026-10-09).
 *
 * A link carries the user id and an HMAC of it, keyed by EMAIL_UNSUBSCRIBE_SECRET. Nothing is
 * stored per send, and the link never expires: CAN-SPAM needs an unsubscribe to keep working for at
 * least 30 days after the email, and a dead unsubscribe link is the one that turns into a spam
 * report. The worst a leaked link can do is unsubscribe its own owner from email, which is the
 * safe way for this credential to be wrong.
 *
 * The rules live here as pure functions so they are asserted in tests rather than reasoned about,
 * the same split as og-consent-token.ts. The handler (email-unsubscribe/index.ts) fetches nothing
 * but the one row it updates.
 */

/** Bumping this kills every link already sent, so only bump it when that is the point. */
const TOKEN_PURPOSE = "forgenta-email-unsubscribe-v1";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** HMAC-SHA256(secret, purpose + user id), hex. Throws on an empty secret: an unkeyed token is forgeable. */
export async function signUnsubscribe(userId: string, secret: string): Promise<string> {
  if (!secret) throw new Error("EMAIL_UNSUBSCRIBE_SECRET is not set");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${TOKEN_PURPOSE}:${userId.toLowerCase()}`),
  );
  return hex(mac);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Is this link genuine? Returns the user id to unsubscribe, or null. A missing secret never
 * authorises (same rule as cronSecretMatches), and a malformed id is refused before any hashing.
 */
export async function verifyUnsubscribe(
  userId: string | null,
  token: string | null,
  secret: string | undefined,
): Promise<string | null> {
  if (!secret || !userId || !token) return null;
  if (!UUID_RE.test(userId) || !/^[0-9a-f]{64}$/i.test(token)) return null;
  const expected = await signUnsubscribe(userId, secret);
  return constantTimeEqual(expected, token.toLowerCase()) ? userId.toLowerCase() : null;
}

/** The https link that goes in the footer and in the List-Unsubscribe header. */
export async function unsubscribeUrl(functionsBase: string, userId: string, secret: string): Promise<string> {
  const t = await signUnsubscribe(userId, secret);
  const base = functionsBase.replace(/\/+$/, "");
  return `${base}/email-unsubscribe?u=${encodeURIComponent(userId)}&t=${t}`;
}

/**
 * RFC 8058 one-click headers. Gmail and Apple Mail show their own Unsubscribe button from these and
 * POST `List-Unsubscribe=One-Click` to the https URL, so the person never has to open a page.
 * The mailto stays as a second option for clients that only speak mailto.
 */
export function listUnsubscribeHeaders(httpsUrl: string, mailto: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${httpsUrl}>, <mailto:${mailto}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/** What the request asks for. A GET never changes anything: mail scanners follow links. */
export type UnsubscribeAction = "confirm_page" | "unsubscribe" | "not_allowed";

export function unsubscribeActionFor(method: string): UnsubscribeAction {
  if (method === "GET" || method === "HEAD") return "confirm_page";
  if (method === "POST") return "unsubscribe";
  return "not_allowed";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title></head>
<body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a">${esc(title)}</h1>${body}</div></body></html>`;
}

/** GET: one button, which POSTs back to the same URL. */
export function confirmPageHtml(actionUrl: string): string {
  return page(
    "Stop Forgenta emails?",
    `<p style="font-size:15px;line-height:1.6;color:#475569">Press the button and we will stop sending you the weekly email and reminder emails. Your account and your data stay as they are.</p>
<form method="post" action="${esc(actionUrl)}"><button type="submit" style="min-height:44px;padding:10px 20px;border:0;border-radius:8px;background:#0f172a;color:#fff;font-size:15px;font-weight:600">Unsubscribe</button></form>`,
  );
}

export function doneHtml(contact: string): string {
  return page(
    "You are unsubscribed",
    `<p style="font-size:15px;line-height:1.6;color:#475569">We will not send you the weekly email or reminder emails again. Account emails you ask for (like a password reset) still arrive.</p>
<p style="font-size:13px;color:#94a3b8">Changed your mind? Write to <a href="mailto:${esc(contact)}">${esc(contact)}</a>.</p>`,
  );
}

/** Never says whether the id existed or the token was close: both read the same. */
export function invalidLinkHtml(contact: string): string {
  return page(
    "This link did not work",
    `<p style="font-size:15px;line-height:1.6;color:#475569">To stop Forgenta emails, write to <a href="mailto:${esc(contact)}?subject=unsubscribe">${esc(contact)}</a> with the word "unsubscribe" and a person will do it.</p>`,
  );
}
