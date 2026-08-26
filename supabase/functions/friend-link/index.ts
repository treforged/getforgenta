/**
 * friend-link — invite / accept / status for friend links.
 * See docs/friends-leaderboard-plan.md §2, §4 Phase 1. Schema:
 * 20260826_friend_links.sql.
 *
 * A clone of partner-link/index.ts, and deliberately so: the disciplines below
 * are the ones that file paid for, and a friend invite is the same shape of
 * security surface as a partner invite. THE ONE THING FRIENDS NEVER GET IS A
 * VIEWING LENS — there is no `active_friend_ids()` path to a table that holds
 * money, and nothing here or in the client hook touches ViewedProfileContext.
 * A friend can see one coarse weekly bucket about you, if and only if you
 * opted that metric in (plan §2), and that read happens through RLS, not here.
 *
 * THE FOUR DISCIPLINES IN THIS FILE, all of which a refactor can break quietly:
 *
 *   1. `invite` NEVER looks up whether the address has a Forgenta account, and
 *      returns a byte-identical success either way. It must not become an
 *      account-existence oracle. Every read it does is of THIS CALLER'S OWN
 *      rows, filtered in memory — there is no query keyed by the invited
 *      address anywhere in the file.
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
 * AND THE GATE (plan §4): friends ship FREE with a cap of
 * FREE_TIER_FRIEND_CAP, premium uncapped. The subscription is only read when
 * the caller is actually at the cap, so an ordinary free invite never fails
 * because the subscription table hiccuped.
 *
 * Revoke is deliberately absent: it is a direct, RLS-scoped, column-granted
 * UPDATE from the client, so leaving a friendship works even if Edge Functions
 * are down (plan §2).
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
import {
  capFor,
  FREE_TIER_FRIEND_CAP,
  isFriendOf,
  type LiveLinkRow,
  maskEmailLocal,
  summarizeInviteSlots,
} from "./link-rules.ts";

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
// `status` is a read the client could mostly do itself through PostgREST; it
// only needs a ceiling, not a budget.
const STATUS_RATE_LIMIT: RateLimitConfig = { windowMs: HOUR_MS, max: 60 };

// Same secrets as partner-link, on purpose: one verified sender and one app URL
// for every transactional invite this project sends. A second FROM name would
// be a second DNS record to keep verified and a second way for mail to start
// bouncing silently.
const INVITE_FROM = Deno.env.get("PARTNER_INVITE_FROM") ??
  "Forgenta <noreply@treforged.com>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://getforgenta.com";

/** What a friend is called when there is no display name and no address we may show. */
const GENERIC_FRIEND_NAME = "A Forgenta member";

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
 * The copy is also the honest description of what a friend link IS: coarse
 * progress, never money, and no access to anybody's budget.
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
        <h1 style="margin:0 0 12px;font-size:22px;color:#0f172a">${esc(inviterName)} invited you to be friends on Forgenta</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#475569">Friends can cheer each other on. You choose which progress to share, and it is only ever a rounded percentage or a streak — never a dollar amount, never your accounts, never your transactions. Neither of you can see the other's budget, and either of you can unfriend at any time.</p>
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
    console.error("friend-link invite: RESEND_API_KEY not configured");
    return false;
  }
  const acceptUrl =
    `${APP_URL}/settings?friend_code=${encodeURIComponent(code)}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: INVITE_FROM,
      to: [to],
      subject: `${inviterName} invited you to be friends on Forgenta`,
      html: buildInviteEmailHtml(inviterName, code, acceptUrl),
    }),
  });
  if (!res.ok) {
    // Status only. The body can echo the recipient address back.
    console.error(`friend-link invite: resend rejected send (${res.status})`);
  }
  return res.ok;
}

// ── Shared reads ─────────────────────────────────────────────────────────────

/**
 * Every link row the caller is a member of that has not been revoked — the one
 * read `invite`, `accept` and `status` all decide from. Returns `undefined` for
 * "could not tell", distinct from an empty array for "definitely none", because
 * a DB error must never be read as "no friends, no invites" and quietly allowed
 * through the cap.
 *
 * Explicit column list, and `invite_code_hash` is not in it: the service role
 * could read the hash, and there is no reason for it to travel.
 */
async function readLiveLinks(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
): Promise<LiveLinkRow[] | undefined> {
  const { data, error } = await supabase
    .from("friend_links")
    .select("id, inviter_id, invitee_email, accepted_at, accepted_by, expires_at")
    .or(`inviter_id.eq.${userId},accepted_by.eq.${userId}`)
    .is("revoked_at", null);
  if (error) {
    console.error("friend-link: live link lookup failed:", error.message);
    return undefined;
  }
  return data as LiveLinkRow[];
}

// deno-lint-ignore no-explicit-any
async function readDisplayName(supabase: any, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("friend-link: display name lookup failed:", error.message);
    return null;
  }
  return (data as { display_name: string | null } | null)?.display_name ?? null;
}

/**
 * Display names for several users at once — `status` resolves every friend from
 * one round trip rather than one per friend. A failed read is logged and comes
 * back EMPTY, which degrades each name to its fallback rather than inventing
 * one; the caller must not render a name it could not read.
 */
async function readDisplayNames(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name")
    .in("user_id", userIds);
  if (error) {
    console.error("friend-link status: display name lookup failed:", error.message);
    return names;
  }
  for (const row of data as { user_id: string; display_name: string | null }[]) {
    if (row.display_name) names.set(row.user_id, row.display_name);
  }
  return names;
}

/**
 * Premium, by the same predicate as SubscriptionContext:
 * plan = 'premium' AND subscription_status in ('active','trialing').
 * `undefined` means the read failed — which is NOT "not premium".
 */
// deno-lint-ignore no-explicit-any
async function readIsPremium(supabase: any, userId: string): Promise<boolean | undefined> {
  const { data, error } = await supabase
    .from("user_subscriptions")
    .select("plan, subscription_status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("friend-link: subscription read failed:", error.message);
    return undefined;
  }
  const row = data as { plan: string | null; subscription_status: string | null } | null;
  return row?.plan === "premium" &&
    ["active", "trialing"].includes(row?.subscription_status ?? "");
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
  const inviteeEmail = normalizeEmail(rawInviteeEmail);
  if (inviteeEmail === normalizeEmail(userEmail)) {
    return json({ error: "You can't invite yourself." }, 400, corsHeaders);
  }

  const live = await readLiveLinks(supabase, userId);
  if (live === undefined) {
    return json({ error: "Something went wrong. Please try again." }, 500, corsHeaders);
  }
  const slots = summarizeInviteSlots(live, userId, inviteeEmail, Date.now());

  // Refusing here rather than letting the invitee hit the canonical-pair unique
  // index at accept time: the DB would stop it either way, but the person who
  // would see that failure is the invitee, as an unexplained 404.
  if (slots.alreadyFriends) {
    return json(
      { error: "You're already friends with them." },
      409,
      corsHeaders,
    );
  }

  // The cap (plan §4). The subscription is read ONLY at the cap, so the common
  // free invite never fails because user_subscriptions was unreachable — and
  // when it is unreachable at the cap, the caller is told that, not told they
  // are not premium.
  if (slots.used >= FREE_TIER_FRIEND_CAP) {
    const isPremium = await readIsPremium(supabase, userId);
    if (isPremium === undefined) {
      return json(
        { error: "Could not check your subscription. Please try again." },
        500,
        corsHeaders,
      );
    }
    if (slots.used >= capFor(isPremium)) {
      return json(
        {
          error:
            `Free accounts can have ${FREE_TIER_FRIEND_CAP} friends, including invites you have sent. Remove one, or upgrade to Premium.`,
        },
        403,
        corsHeaders,
      );
    }
  }

  // One OUTSTANDING invite per (inviter, mailbox) — friend_links_one_pending.
  // Inviting the same address again REPLACES the previous invite rather than
  // being rejected by the index, including an expired one, which otherwise
  // occupies the slot forever. The old code stops working, which is the correct
  // reading of "invite again". Only this caller's own rows for this one
  // mailbox are superseded; every other pending invite they hold is untouched.
  if (slots.supersedeIds.length > 0) {
    const { error: supersedeError } = await supabase
      .from("friend_links")
      .update({ revoked_at: new Date().toISOString(), revoked_by: userId })
      .in("id", slots.supersedeIds);
    if (supersedeError) {
      console.error("friend-link invite: supersede failed:", supersedeError.message);
      return json({ error: "Something went wrong. Please try again." }, 500, corsHeaders);
    }
  }

  const code = generateInviteCode();
  const inviteCodeHash = await hashInviteCode(code);

  // NOTE: no lookup of `inviteeEmail` happens anywhere in this function — the
  // slot summary above is computed from THIS CALLER'S OWN rows, in memory. The
  // row is written, the mail is sent, and the response is the same whether or
  // not that address has ever seen Forgenta.
  const { data: inserted, error: insertError } = await supabase
    .from("friend_links")
    .insert({
      inviter_id: userId,
      invitee_email: inviteeEmail,
      invite_code_hash: inviteCodeHash,
    })
    .select("id, expires_at")
    .single();
  if (insertError || !inserted) {
    console.error(
      "friend-link invite: insert failed:",
      insertError?.message ?? "no row returned",
    );
    return json({ error: "Could not create the invite. Please try again." }, 500, corsHeaders);
  }
  const invite = inserted as { id: string; expires_at: string };

  const inviterName = (await readDisplayName(supabase, userId)) ?? GENERIC_FRIEND_NAME;
  const sent = await sendInviteEmail(inviteeEmail, inviterName, code);
  if (!sent) {
    // Nothing reaches the mailbox, so nothing may keep the pending slot. Revoke
    // rather than delete: the client has no DELETE grant either way, and an
    // audit trail of a failed invite is worth more than a tidy table.
    const { error: rollbackError } = await supabase
      .from("friend_links")
      .update({ revoked_at: new Date().toISOString(), revoked_by: userId })
      .eq("id", invite.id);
    if (rollbackError) {
      console.error(
        "friend-link invite: rollback of unsent invite failed:",
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
    console.warn(`friend-link accept denied [${reason}] user=${userTag}`);
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
    .from("friend_links")
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

  // Already friends by another row — the canonical-pair index would reject the
  // write anyway, and a constraint violation is a worse answer than this.
  const live = await readLiveLinks(supabase, userId);
  if (live === undefined) return deny("live_link_lookup_failed");
  if (isFriendOf(live, userId, link.inviter_id)) return deny("already_friends");

  // Re-assert "still pending" in the UPDATE itself: the checks above ran
  // against a row read a moment ago, and two accepts of one code must not both
  // win. A zero-row result means somebody else got there first.
  const { data: accepted, error: acceptError } = await supabase
    .from("friend_links")
    .update({ accepted_by: userId, accepted_at: new Date().toISOString() })
    .eq("id", link.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id, accepted_at")
    .maybeSingle();
  if (acceptError) return deny(`accept_write_failed:${acceptError.code ?? "unknown"}`);
  if (!accepted) return deny("accept_race_lost");

  const friendName = await readDisplayName(supabase, link.inviter_id);
  return json(
    {
      ok: true,
      link_id: link.id,
      friend: { user_id: link.inviter_id, display_name: friendName },
    },
    200,
    corsHeaders,
  );
}

interface FriendSummary {
  link_id: string;
  user_id: string;
  display_name: string;
}

async function handleStatus(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const live = await readLiveLinks(supabase, userId);
  if (live === undefined) {
    return json({ error: "Something went wrong. Please try again." }, 500, corsHeaders);
  }

  // The friends, with the name the client cannot read for itself: `profiles`
  // has no friend-facing grant and never will (plan §2), so the service role
  // resolves it here or nobody does.
  const accepted = live.filter((row) => row.accepted_at !== null);
  const friendIdOf = (row: LiveLinkRow): string | null =>
    row.inviter_id === userId ? row.accepted_by : row.inviter_id;
  // The accept-pair CHECK makes a null unreachable here; it is filtered rather
  // than assumed away.
  const names = await readDisplayNames(
    supabase,
    accepted.map(friendIdOf).filter((id): id is string => id !== null),
  );

  const friends: FriendSummary[] = [];
  for (const row of accepted) {
    const friendId = friendIdOf(row);
    if (!friendId) continue;
    const iInvited = row.inviter_id === userId;
    friends.push({
      link_id: row.id,
      user_id: friendId,
      // The fallback is the masked local part of the address — but ONLY when
      // this caller is the one who typed that address. In the other direction
      // `invitee_email` is the CALLER'S own mailbox, and masking it would label
      // the friend with the viewer's address.
      display_name: names.get(friendId) ??
        (iInvited ? maskEmailLocal(row.invitee_email) : GENERIC_FRIEND_NAME),
    });
  }

  // Outgoing invites only. An invite addressed TO this caller is deliberately
  // invisible here — telling somebody "you have been invited" without the code
  // would hand out exactly the fact the code is supposed to carry, and the RLS
  // select policy cannot see that row either.
  const now = Date.now();
  const pending = live
    .filter((row) =>
      row.accepted_at === null &&
      row.inviter_id === userId &&
      Date.parse(row.expires_at) > now
    )
    // Echoes back only what this caller typed. Says nothing about whether that
    // address has an account, and carries no part of the code.
    .map((row) => ({
      link_id: row.id,
      invitee_email: row.invitee_email,
      expires_at: row.expires_at,
    }));

  return json({ friends, pending }, 200, corsHeaders);
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
  // only role with INSERT on friend_links.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Rate limit by IP BEFORE any auth or business logic.
  const ip = getClientIp(req);
  const ipLimit = await checkRateLimit(supabase, `${ip}:friend-link`, IP_RATE_LIMIT);
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
    // readLiveLinks. It comes from a verified JWT and is always a uuid — this
    // asserts that rather than assuming it, because the day it is not a uuid is
    // the day that filter string means something else.
    if (!UUID_RE.test(userId)) {
      console.error("friend-link: JWT subject is not a uuid");
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
      `${userId}:friend-link:${body.action}`,
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
    console.error("friend-link error:", error);
    return json({ error: "Something went wrong. Please try again." }, 500, corsHeaders);
  }
});
