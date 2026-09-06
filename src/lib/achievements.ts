import { LEARN_LESSONS } from '@/lib/learn-lessons';
import { SOCIAL_LINKS } from '@/lib/social-links';

/**
 * WHAT A STORED `achievement_id` MEANS TO A PERSON.
 *
 * ⚠️ THERE WAS NOWHERE TO SEE A BADGE UNTIL 2026-09-06. Tre: *"where is the achievements
 * section?"* — he had earned `lesson:what-a-cash-floor-is` that evening and had held
 * `follow_instagram` since 09-03, and the app rendered a checkmark on one lesson row and nothing
 * else. No count, no list, no route. **A reward you cannot go and look at is not much of a
 * reward**, and this is the same shape as a lesson telling somebody the wrong tab: the thing
 * exists and the app never takes them to it.
 *
 * ── THREE FAMILIES, AND THE THIRD WAS NOT IN EITHER SOURCE FILE ─────────────
 * ⚠️ Found by asking the DATABASE what ids actually exist rather than by reading the two modules
 * that mint them: `select achievement_id, count(*) from achievements group by 1` returned
 * `og_founder` (3 holders), `follow_instagram` (1) and `lesson:what-a-cash-floor-is` (1).
 * **`og_founder` is granted server-side only** — it is deliberately absent from the client INSERT
 * policy — so nothing in `src/` mints it and a catalogue built from the minting code would have
 * silently omitted a badge three people hold.
 *
 * ── AN UNKNOWN ID IS SHOWN, NOT HIDDEN AND NOT RENAMED ──────────────────────
 * ⚠️ A badge this file does not recognise still belongs to the person who earned it. Dropping it
 * would make their trophy case quietly wrong, and inventing a friendly name for it would be worse
 * — a label nobody chose, presented as if somebody had. So it renders with its raw id and is
 * marked `known: false`, which is ugly on purpose: it is a prompt to add the definition, not a
 * finished state.
 */

export interface AchievementRow {
  achievement_id: string;
  earned_at: string;
}

export type AchievementKind = 'lesson' | 'social' | 'founder' | 'unknown';

export interface ResolvedAchievement {
  id: string;
  name: string;
  description: string;
  kind: AchievementKind;
  earnedAt: string;
  /** False when no definition exists for this id — see the header. */
  known: boolean;
}

const LESSON_PREFIX = 'lesson:';

/** The one place a stored id becomes something a person can read. */
export function resolveAchievement(row: AchievementRow): ResolvedAchievement {
  const id = row.achievement_id;
  const base = { id, earnedAt: row.earned_at };

  if (id.startsWith(LESSON_PREFIX)) {
    const lessonId = id.slice(LESSON_PREFIX.length);
    const lesson = LEARN_LESSONS.find(l => l.id === lessonId);
    // A lesson that has been retired from the catalogue still leaves a badge behind. Naming it
    // after its own id is honest; pretending it never happened is not.
    return lesson
      ? { ...base, name: lesson.achievement.name, description: lesson.achievement.description, kind: 'lesson', known: true }
      : { ...base, name: lessonId, description: 'A lesson that is no longer in the library.', kind: 'lesson', known: false };
  }

  const social = SOCIAL_LINKS.find(s => s.id === id);
  if (social) {
    return {
      ...base,
      name: social.network,
      // The label describes the TAP, never the follow — this app cannot know whether somebody
      // actually followed, and a badge claiming they did would be a thing it made up.
      description: social.earnedLabel,
      kind: 'social',
      known: true,
    };
  }

  if (id === 'og_founder') {
    return {
      ...base,
      name: 'Founder',
      // ⚠️ THIS DESCRIPTION USED TO SAY "One of the first hundred people to PAY for Forgenta",
      // AND THAT WAS FALSE FOR EVERY PERSON HOLDING IT. Measured 2026-09-06: three live accounts
      // hold `og_founder`, all three minted in the same instant on 2026-09-03 20:24:25 — a
      // backfill, not three organic events — and **none of them has a non-comp subscription**.
      // `og_members`, the cohort table the badge is supposed to mirror, holds **0 rows**: the
      // 2026-09-05 "OG place requires real money" tightening emptied it correctly, because a
      // 100%-off subscription is not a purchase. The badges were left behind.
      //
      // So the app was telling three real people something about their own history that its own
      // database contradicts, on a screen whose entire job is to report that history. The wording
      // now says only what is actually true of everyone who holds it — the badge was granted to
      // the founding cohort — and claims nothing about payment.
      //
      // ✅ DECIDED BY TRE, 2026-09-06 (relayed through Sam): **KEEP THE BADGE. DO NOT REVOKE IT
      // AND DO NOT BACKFILL `og_members`.** The false claim was the wording and it is gone; the
      // three holders keep what they were given. **This is settled — do not re-open it** on the
      // strength of `og_members` reading 0, which is correct and is not evidence against the
      // badge. Revoking a visible badge from a real person is a promise broken, and it would buy
      // nothing now that the description claims nothing about payment.
      description: "Granted to Forgenta's founding cohort.",
      kind: 'founder',
      known: true,
    };
  }

  return { ...base, name: id, description: 'Earned before this badge had a description.', kind: 'unknown', known: false };
}

/** Newest first — a trophy case reads as a history, and the last thing earned is the interesting one. */
export function resolveAchievements(rows: readonly AchievementRow[]): ResolvedAchievement[] {
  return rows
    .map(resolveAchievement)
    .sort((a, b) => (a.earnedAt < b.earnedAt ? 1 : a.earnedAt > b.earnedAt ? -1 : 0));
}

/**
 * How many lesson badges exist to be earned.
 *
 * Only lessons are countable: social badges are a fixed pair, and `og_founder` is a cohort nobody
 * can decide to join. A progress figure over the others would invent a denominator.
 */
export const TOTAL_LESSON_BADGES = LEARN_LESSONS.length;
