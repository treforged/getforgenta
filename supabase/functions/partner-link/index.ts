/**
 * partner-link — invite / accept / status for partner account linking.
 * See docs/partner-linking-design.md §1. Schema: 20260825_partner_links.sql.
 *
 * Skeleton is create-checkout's: CORS from _shared/cors.ts, an IP rate limit
 * via _shared/rate-limit.ts BEFORE any auth or business logic, the JWT verified
 * with userClient.auth.getUser(), and every write done with the service role.
 * `verify_jwt = true` in config.toml is the outer guard; getUser() is the inner
 * one, and this function trusts nothing but the id and email it returns.
 *
 * Why an Edge Function and not a SECURITY DEFINER RPC: `rate_limit_check` is
 * deliberately service-role-only (20260621_harden_definer_functions_and_storage
 * .sql), invites have to send email, and `partner_links` grants the client no
 * INSERT at all — so both consents can only ever be written here, each from a
 * verified JWT.
 *
 * THE FOUR DISCIPLINES IN THIS FILE, all of which a refactor can break quietly:
 *
 *   1. `invite` NEVER looks up whether the address has a Forgenta account, and
 *      returns a byte-identical success either way. It must not become an
 *      account-existence oracle. There is no branch to get wrong because there
 *      is no lookup.
 *   2. `accept` answers EVERY failure with the same 404 and the same body — no
 *      "expired" vs "wrong code" vs "wrong mailbox" for a caller to probe with.
 *      The reason is written to the function log instead, where the operator
 *      can see it and the caller cannot.
 *   3. The invite code is returned exactly once, to the invited mailbox. It is
 *      never in a response body, never in a log line, and only its SHA-256
 *      reaches the database (see ./invite-code.ts).
 *   4. Nothing reports success it did not achieve. If Resend refuses the send,
 *      the just-created invite row is revoked and the caller is told the send
 *      failed — "sent" that means "maybe sent" is the failure mode this house
 *      has been bitten by.
 *
 * Revoke is deliberately absent: it is a direct, RLS-scoped, column-granted
 * UPDATE from the client, so leaving a link works even if Edge Functions are
 * down (design §1, §5).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";
import {
  checkRateLimit,
  getClientIp,
  rateLimitedResponse,
  type RateLimitConfig,
} from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hashId } from "../_shared/tracer.ts";
import {
  generateInviteCode,
  hashInviteCode,
  isPlausibleInviteCode,
  normalizeEmail,
} from "./invite-code.ts";

const PAYLOAD_SIZE_LIMIT = 2048;

const HOUR_MS = 60 * 60 * 1000;

// Checked before auth, so it covers every action including the ones that never
// reach a user id. Deliberately looser than the per-user limits below: a
// household behind one NAT shares this bucket.
const IP_RATE_LIMIT: RateLimitConfig = { windowMs: HOUR_MS, max: 30 };

// Invites send email; accepts are the brute-force surface. 128-bit codes make
// guessing academic — this is the polite wall, not the load-bearing one.
const INVITE_RATE_LIMIT: RateLimitConfig = { windowMs: HOUR_MS, max: 5 };
const ACCEPT_RATE_LIMIT: RateLimitConfig = { windowMs: HOUR_MS, max: 5 };
// `status` is a read the client could do itself through PostgREST; it only
// needs a ceiling, not a budget.
const STATUS_RATE_LIMIT: RateLimitConfig = { windowMs: HOUR_MS, max: 60 };

const INVITE_FROM = Deno.env.get("PARTNER_INVITE_FROM") ??
  "Forgenta <noreply@treforged.com>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://getforgenta.com";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("invite"),
    email: z.string().email("A valid email address is required").max(320),
  }).strict(),
  // Loose on purpose: the code's real shape check happens inside the accept
  // handler so that a malformed code and a wrong code are indistinguishable to
  // the caller. A schema rejection here would be a 400 and would tell them.
  z.object({ action: z.literal("accept"), code: z.string().max(256) }).strict(),
  z.object({ action: z.literal("status") }).strict(),
]);

function json(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Email ────────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The invite email. Identical copy whether or not the address already has an
 * account — that is discipline #1, and it is why the body tells the reader to
 * sign in *or* sign up with this address rather than assuming either.
 *
 * `inviterName` is caller-controlled text, so it is escaped like every other
 * interpolation here.
 */
function buildInviteEmailHtml(
  inviterName: string,
  code: string,
  acceptUrl: string,
): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#f4f4f5;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      <div style="background:#0f172a;padding:24px 32px">
        <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-.5px">Forgenta</span>
      </div>
      <div style="padding:32px">
        <h1 style="margin:0 0 12px;font-size:22px;color:#0f172a">${esc(inviterName)} invited you to link accounts</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#475569">Linking lets the two of you view each other's Forgenta budget, read only. Nobody can edit anybody else's money, and either of you can unlink at any time.</p>
        <a href="${esc(acceptUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 28px;border-radius:8px">Accept the invite</a>
        <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#475569">Or enter this code in Forgenta under Settings:</p>
        <p style="margin:8px 0 0;font-size:18px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px;color:#0f172a;word-break:break-all">${esc(code)}</p>
        <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#94a3b8">You have to be signed in to Forgenta with <strong>this email address</strong> to accept — sign in, or create an account with it first. The code expires in 7 days and only works once.</p>
      </div>
      <div style="padding:16px 32px;border-top:1px solid #f1f5f9">
        <p style="margin:0;font-size:12px;color:#94a3b8">If you weren't expecting this, ignore it. Nothing is shared with anyone until you accept, and the invite expires on its own.</p>
      </div>
    </div>
  </body></html>`;
}

async function sendInviteEmail(
  to: string,
  inviterName: string,
  code: string,
): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("partner-link invite: RESEND_API_KEY not configured");
    return false;
  }
  const acceptUrl =
    `${APP_URL}/settings?partner_code=${encodeURIComponent(code)}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: INVITE_FROM,
      to: [to],
      subject: `${inviterName} invited you to link Forgenta accounts`,
      html: buildInviteEmailHtml(inviterName, code, acceptUrl),
    }),
  });
  if (!res.ok) {
    // Status only. The body can echo the recipient address back.
    console.error(`partner-link invite: resend rejected send (${res.status})`);
  }
  return res.ok;
}

// ── Shared reads ─────────────────────────────────────────────────────────────

interface ActiveLinkRow {
  id: string;
  inviter_id: string;
  accepted_by: string | null;
}

/**
 * The caller's active link, if any. Returns `undefined` for "could not tell" —
 * distinct from `null` for "definitely none", because a DB error must never be
 * read as "unlinked" and quietly allowed through.
 */
async function readActiveLink(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
): Promise<ActiveLinkRow | null | undefined> {
  const { data, error } = await supabase
    .from("partner_links")
    .select("id, inviter_id, accepted_by")
    .or(`inviter_id.eq.${userId},accepted_by.eq.${userId}`)
    .not("accepted_at", "is", null)
    .is("revoked_at", null)
    .limit(1);
  if (error) {
    console.error("partner-link: active link lookup failed:", error.message);
    return undefined;
  }
  return (data as ActiveLinkRow[])[0] ?? null;
}

// deno-lint-ignore no-explicit-any
async function readDisplayName(supabase: any, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("partner-link: display name lookup failed:", error.message);
    return null;
  }
  return (data as { display_name: string | null } | null)?.display_name ?? null;
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function handleInvite(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  userEmail: string,
  rawInviteeEmail: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  // Premium gate, server-side. Same predicate as SubscriptionContext:
  // plan = 'premium' AND subscription_status in ('active','trialing').
  const { data: sub, error: subError } = await supabase
    .from("user_subscriptions")
    .select("plan, subscription_status")
    .eq("user_id", userId)
    .maybeSingle();
  if (subError) {
    // Fail closed, but say so. A subscription read that fell over must not be
    // reported to the customer as "you are not premium".
    console.error("partner-link invite: subscription read failed:", subError.message);
    return json(
      { error: "Could not check your subscription. Please try again." },
      500,
      corsHeaders,
    );
  }
  const row = sub as { plan: string | null; subscription_status: string | null } | null;
  const isPremium = row?.plan === "premium" &&
    ["active", "trialing"].includes(row?.subscription_status ?? "");
  if (!isPremium) {
    return json(
      { error: "Partner linking is a premium feature." },
      403,
      corsHeaders,
    );
  }

  const inviteeEmail = normalizeEmail(rawInviteeEmail);
  if (inviteeEmail === normalizeEmail(userEmail)) {
    return json({ error: "You can't invite yourself." }, 400, corsHeaders);
  }

  // Refusing here rather than letting the invitee hit the partial unique index
  // at accept time: the DB would stop it either way, but the person who would
  // see that failure is the invitee, as an unexplained 404.
  const active = await readActiveLink(supabase, userId);
  if (active === undefined) {
    return json({ error: "Something went wrong. Please try again." }, 500, corsHeaders);
  }
  if (active) {
    return json(
      { error: "You already have a linked partner. Unlink first." },
      409,
      corsHeaders,
    );
  }

  // One outstanding invite per inviter (partner_links_one_pending). Inviting
  // again REPLACES the previous invite rather than being rejected by the index
  // — including an expired one, which otherwise occupies the slot forever. The
  // old code stops working, which is the correct reading of "invite again".
  const { error: supersedeError } = await supabase
    .from("partner_links")
    .update({ revoked_at: new Date().toISOString(), revoked_by: userId })
    .eq("inviter_id", userId)
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (supersedeError) {
    console.error("partner-link invite: supersede failed:", supersedeError.message);
    return json({ error: "Something went wrong. Please try again." }, 500, corsHeaders);
  }

  const code = generateInviteCode();
  const inviteCodeHash = await hashInviteCode(code);

  // NOTE: no lookup of `inviteeEmail` happens anywhere in this function. The
  // row is written, the mail is sent, and the response is the same whether or
  // not that address has ever seen Forgenta.
  const { data: inserted, error: insertError } = await supabase
    .from("partner_links")
    .insert({
      inviter_id: userId,
      invitee_email: inviteeEmail,
      invite_code_hash: inviteCodeHash,
    })
    .select("id, expires_at")
    .single();
  if (insertError || !inserted) {
    console.error(
      "partner-link invite: insert failed:",
      insertError?.message ?? "no row returned",
    );
    return json({ error: "Could not create the invite. Please try again." }, 500, corsHeaders);
  }
  const invite = inserted as { id: string; expires_at: string };

  const inviterName = (await readDisplayName(supabase, userId)) ?? "A Forgenta member";
  const sent = await sendInviteEmail(inviteeEmail, inviterName, code);
  if (!sent) {
    // Nothing reaches the mailbox, so nothing may keep the pending slot. Revoke
    // rather than delete: the client has no DELETE grant either way, and an
    // audit trail of a failed invite is worth more than a tidy table.
    const { error: rollbackError } = await supabase
      .from("partner_links")
      .update({ revoked_at: new Date().toISOString(), revoked_by: userId })
      .eq("id", invite.id);
    if (rollbackError) {
      console.error(
        "partner-link invite: rollback of unsent invite failed:",
        rollbackError.message,
      );
    }
    return json(
      { error: "Could not send the invite email. Please try again." },
      502,
      corsHeaders,
    );
  }

  // The generic success. Identical for an address with an account and one
  // without — and it deliberately does not say "we found them".
  return json(
    {
      ok: true,
      message: "Invite sent. It expires in 7 days.",
      expires_at: invite.expires_at,
    },
    200,
    corsHeaders,
  );
}

interface AcceptCandidate {
  id: string;
  inviter_id: string;
  invitee_email: string;
  expires_at: string;
}

async function handleAccept(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  userEmail: string,
  emailConfirmed: boolean,
  rawCode: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const userTag = await hashId(userId);

  // Discipline #2. One body, one status, for every reason. The reason goes to
  // the log, tagged with a non-reversible user hash — never the email, never
  // the code, never its hash.
  const deny = (reason: string): Response => {
    console.warn(`partner-link accept denied [${reason}] user=${userTag}`);
    return json({ error: "That invite code isn't valid." }, 404, corsHeaders);
  };

  const code = rawCode.trim();
  if (!isPlausibleInviteCode(code)) return deny("malformed_code");
  if (!userEmail) return deny("caller_has_no_email");
  // The second wall is "you control the invited mailbox". An address that has
  // never been confirmed is an address somebody typed, so a leaked code plus a
  // fresh unconfirmed signup would otherwise be enough on its own.
  if (!emailConfirmed) return deny("caller_email_unconfirmed");

  const inviteCodeHash = await hashInviteCode(code);
  const { data: found, error: lookupError } = await supabase
    .from("partner_links")
    .select("id, inviter_id, invitee_email, expires_at")
    .eq("invite_code_hash", inviteCodeHash)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .maybeSingle();
  if (lookupError) return deny(`lookup_error:${lookupError.code ?? "unknown"}`);
  const link = found as AcceptCandidate | null;
  if (!link) return deny("no_matching_invite");
  if (Date.parse(link.expires_at) <= Date.now()) return deny("expired");
  if (normalizeEmail(userEmail) !== link.invitee_email) return deny("email_mismatch");
  if (link.inviter_id === userId) return deny("self_accept");

  const active = await readActiveLink(supabase, userId);
  if (active === undefined) return deny("active_link_lookup_failed");
  if (active) return deny("caller_already_linked");

  // Re-assert "still pending" in the UPDATE itself: the checks above ran
  // against a row read a moment ago, and two accepts of one code must not both
  // win. A zero-row result means somebody else got there first.
  const { data: accepted, error: acceptError } = await supabase
    .from("partner_links")
    .update({ accepted_by: userId, accepted_at: new Date().toISOString() })
    .eq("id", link.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id, accepted_at")
    .maybeSingle();
  if (acceptError) return deny(`accept_write_failed:${acceptError.code ?? "unknown"}`);
  if (!accepted) return deny("accept_race_lost");

  const partnerName = await readDisplayName(supabase, link.inviter_id);
  return json(
    {
      ok: true,
      link_id: link.id,
      partner: { user_id: link.inviter_id, display_name: partnerName },
    },
    200,
    corsHeaders,
  );
}

async function handleStatus(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const active = await readActiveLink(supabase, userId);
  if (active === undefined) {
    return json({ error: "Something went wrong. Please try again." }, 500, corsHeaders);
  }
  if (active) {
    const partnerId = active.inviter_id === userId
      ? active.accepted_by
      : active.inviter_id;
    const displayName = partnerId ? await readDisplayName(supabase, partnerId) : null;
    return json(
      {
        state: "active",
        link_id: active.id,
        partner: { user_id: partnerId, display_name: displayName },
      },
      200,
      corsHeaders,
    );
  }

  // Outgoing invites only. An invite addressed TO this caller is deliberately
  // invisible here — telling somebody "you have been invited" without the code
  // would hand out exactly the fact the code is supposed to carry, and the RLS
  // select policy cannot see that row either.
  const { data: pendingRows, error: pendingError } = await supabase
    .from("partner_links")
    .select("id, invitee_email, expires_at")
    .eq("inviter_id", userId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .limit(1);
  if (pendingError) {
    console.error("partner-link status: pending lookup failed:", pendingError.message);
    return json({ error: "Something went wrong. Please try again." }, 500, corsHeaders);
  }
  const pending =
    (pendingRows as { id: string; invitee_email: string; expires_at: string }[])[0];
  if (pending && Date.parse(pending.expires_at) > Date.now()) {
    // Echoes back only what this caller typed. Says nothing about whether that
    // address has an account, and carries no part of the code.
    return json(
      {
        state: "pending",
        link_id: pending.id,
        invitee_email: pending.invitee_email,
        expires_at: pending.expires_at,
      },
      200,
      corsHeaders,
    );
  }

  return json({ state: "none" }, 200, corsHeaders);
}

// ── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, corsHeaders);
  }

  // Service role client — only this key can reach rate_limits, and it is the
  // only role with INSERT on partner_links.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Rate limit by IP BEFORE any auth or business logic.
  const ip = getClientIp(req);
  const ipLimit = await checkRateLimit(supabase, `${ip}:partner-link`, IP_RATE_LIMIT);
  if (!ipLimit.allowed) {
    return rateLimitedResponse(corsHeaders, IP_RATE_LIMIT, ipLimit.resetAt);
  }

  try {
    const authHeader = req.headers.get("Authorization") ??
      req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401, corsHeaders);
    }

    // Verify the JWT server-side. Everything downstream uses only what this
    // returns — never an id or email from the request body.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user: authUser }, error: jwtError } = await userClient.auth
      .getUser();
    if (jwtError || !authUser) {
      return json({ error: "Unauthorized" }, 401, corsHeaders);
    }
    const userId = authUser.id;
    const userEmail = authUser.email ?? "";
    const emailConfirmed = Boolean(authUser.email_confirmed_at);

    // `userId` is interpolated into a PostgREST `.or()` filter in
    // readActiveLink. It comes from a verified JWT and is always a uuid — this
    // asserts that rather than assuming it, because the day it is not a uuid is
    // the day that filter string means something else.
    if (!UUID_RE.test(userId)) {
      console.error("partner-link: JWT subject is not a uuid");
      return json({ error: "Unauthorized" }, 401, corsHeaders);
    }

    const rawBody = await req.text();
    if (rawBody.length > PAYLOAD_SIZE_LIMIT) {
      return json({ error: "Payload too large" }, 413, corsHeaders);
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return json({ error: "Invalid JSON" }, 400, corsHeaders);
    }
    const result = bodySchema.safeParse(parsedJson);
    if (!result.success) {
      return json({ error: result.error.issues[0].message }, 400, corsHeaders);
    }
    const body = result.data;

    // Per-user limit, on top of the per-IP one already spent above.
    const perUser: RateLimitConfig = body.action === "invite"
      ? INVITE_RATE_LIMIT
      : body.action === "accept"
      ? ACCEPT_RATE_LIMIT
      : STATUS_RATE_LIMIT;
    const userLimit = await checkRateLimit(
      supabase,
      `${userId}:partner-link:${body.action}`,
      perUser,
    );
    if (!userLimit.allowed) {
      return rateLimitedResponse(corsHeaders, perUser, userLimit.resetAt);
    }

    if (body.action === "invite") {
      return await handleInvite(supabase, userId, userEmail, body.email, corsHeaders);
    }
    if (body.action === "accept") {
      return await handleAccept(
        supabase,
        userId,
        userEmail,
        emailConfirmed,
        body.code,
        corsHeaders,
      );
    }
    return await handleStatus(supabase, userId, corsHeaders);
  } catch (error) {
    // Unlike create-checkout, the message is NOT echoed to the caller: a
    // Postgres error here can name a constraint, and a thrown error can carry
    // an email address. The operator gets the detail; the caller gets a wall.
    console.error("partner-link error:", error);
    return json({ error: "Something went wrong. Please try again." }, 500, corsHeaders);
  }
});
