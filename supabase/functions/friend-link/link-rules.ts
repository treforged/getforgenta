/**
 * The friend-link decisions that are pure, split out of index.ts so vitest can
 * exercise them — the same bridge invite-code.ts uses, and the reason the cap
 * and the supersede rule are testable at all (the function body needs Deno).
 *
 * Nothing here does I/O, reads a clock of its own, or touches `Deno`. Every
 * caller passes the rows it already read and the `now` it already has, so a
 * test can pin a week without pinning the system clock.
 *
 * THE ONE CONTRACT that matters: `rows` is always the caller's LIVE links —
 * every row where the caller is a member and `revoked_at is null`. A revoked
 * row must never reach here, because every predicate below would then count a
 * friendship the database has already severed.
 */

/**
 * Plan §4 "Gating": friends ship free, capped, because the invite email is the
 * acquisition loop. Premium is `Infinity` — see `capFor`. Flipping either needs
 * no schema and no UI change.
 */
export const FREE_TIER_FRIEND_CAP = 5;

/** The columns index.ts reads. `invite_code_hash` is deliberately not among them. */
export interface LiveLinkRow {
  id: string;
  inviter_id: string;
  invitee_email: string;
  accepted_at: string | null;
  accepted_by: string | null;
  expires_at: string;
}

export interface InviteSlots {
  /** Accepted, unrevoked friendships — from either direction. */
  activeFriends: number;
  /** This caller's own unexpired invites still waiting to be accepted. */
  outstandingInvites: number;
  /** What the cap is measured against. */
  used: number;
  /**
   * This caller's own pending rows for this mailbox, which `invite` revokes
   * before inserting. `friend_links_one_pending` is a UNIQUE index, so an
   * expired-but-unrevoked row would otherwise hold the slot forever.
   */
  supersedeIds: string[];
  /**
   * An accepted, unrevoked link this caller created for this mailbox. Refusing
   * here rather than at accept time is deliberate: the canonical-pair index
   * would stop the second friendship either way, but the person who would see
   * that failure is the invitee, as an unexplained 404.
   */
  alreadyFriends: boolean;
}

/** Trim + lowercase, matching invite-code.ts's normalizeEmail. */
function lower(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Everything `invite` needs to decide, from one read.
 *
 * A row being superseded does NOT count towards `used`: re-inviting an address
 * you already invited replaces one invite with one invite, and charging a
 * second slot for it would push a user over the cap for standing still.
 *
 * An EXPIRED pending invite counts towards neither `used` nor the friendship
 * total — it is not a friend and it is not a live invite — but it is still in
 * `supersedeIds`, because it does still occupy the unique pending slot.
 */
export function summarizeInviteSlots(
  rows: readonly LiveLinkRow[],
  userId: string,
  inviteeEmail: string,
  nowMs: number,
): InviteSlots {
  const target = lower(inviteeEmail);
  let activeFriends = 0;
  let outstandingInvites = 0;
  let alreadyFriends = false;
  const supersedeIds: string[] = [];

  for (const row of rows) {
    const isMine = row.inviter_id === userId;
    const forTarget = isMine && lower(row.invitee_email) === target;

    if (row.accepted_at !== null) {
      activeFriends++;
      if (forTarget) alreadyFriends = true;
      continue;
    }
    if (!isMine) continue; // an invite somebody else sent is not this caller's slot
    if (forTarget) {
      supersedeIds.push(row.id);
      continue; // superseded, so not counted below
    }
    if (Date.parse(row.expires_at) > nowMs) outstandingInvites++;
  }

  return {
    activeFriends,
    outstandingInvites,
    used: activeFriends + outstandingInvites,
    supersedeIds,
    alreadyFriends,
  };
}

/** The free cap, or no cap at all for premium. */
export function capFor(isPremium: boolean): number {
  return isPremium ? Infinity : FREE_TIER_FRIEND_CAP;
}

/**
 * Is there already an active friendship between the caller and `otherUserId`?
 * `accept` checks this before writing consent: the canonical-pair unique index
 * would reject the write anyway, and a constraint violation is a worse answer
 * than a logged denial.
 */
export function isFriendOf(
  rows: readonly LiveLinkRow[],
  userId: string,
  otherUserId: string,
): boolean {
  return rows.some((row) =>
    row.accepted_at !== null &&
    ((row.inviter_id === userId && row.accepted_by === otherUserId) ||
      (row.accepted_by === userId && row.inviter_id === otherUserId))
  );
}

/**
 * The display fallback for a friend with no `profiles.display_name` (plan §2).
 * First and last character of the local part only — enough for the owner to
 * recognise an address they typed themselves, not enough to be an address.
 *
 * ⚠️ Only ever called with an address THIS CALLER supplied (a row where they are
 * the inviter). For the other direction the row's `invitee_email` is the
 * caller's own mailbox, so masking it would label the friend with the viewer's
 * address; index.ts falls back to the generic name there instead.
 */
export function maskEmailLocal(email: string): string {
  const local = lower(email).split("@")[0] ?? "";
  if (local.length === 0) return "***";
  if (local.length <= 2) return `${local[0]}***`;
  return `${local[0]}***${local[local.length - 1]}`;
}
