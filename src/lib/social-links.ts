/**
 * Where "follow us" actually sends people, and the badge earned by going.
 *
 * ⚠️ THE BADGE IS A CLAIM, NOT A VERIFIED FACT, AND THAT IS DELIBERATE.
 *
 * Neither Instagram nor TikTok offers a consumer app any supported way to ask
 * "does user X follow account Y". So there is no version of this feature where the
 * app knows. The RLS policy on `achievements` reflects that honestly: a signed-in
 * client is allowed to write `follow_instagram` and `follow_tiktok` itself, which
 * also means anyone can mint both by hand without following anything.
 *
 * TWO RULES FOLLOW FROM THAT, and a future session should not "fix" this by
 * wiring it to something real — there is nothing real to wire it to:
 *
 *   1. A CLAIMED FOLLOW MUST NEVER UNLOCK ANYTHING OF VALUE. Cosmetic only. It may
 *      sit on a badge wall. It must not gate a feature, a discount, or anything
 *      touching the OG reward — which is exactly why `og_founder` is NOT on the
 *      client-writable list while these two are.
 *   2. THE WORDING IS AN INTENT, NOT AN ASSERTION. The app can honestly say the
 *      user tapped through to Instagram, because that is the event it observed.
 *      It cannot say they followed. Printing a fact you did not measure is the
 *      same error as drawing a gauge value you never read.
 *
 * See docs/og-cohort.md, "Achievements the app cannot verify".
 */

export interface SocialLink {
  /** The achievement id — must be one the `achievements` INSERT policy allows. */
  id: 'follow_instagram' | 'follow_tiktok';
  network: string;
  handle: string;
  url: string;
  /** What the badge says once earned. Describes the TAP, never the follow. */
  earnedLabel: string;
}

/**
 * BOTH HANDLES ARE CONFIRMED AGAINST A SOURCE, not inferred from the brand name.
 *   - TikTok: `tre-forged-marketing/TIKTOK.md` names @treforged.
 *   - Instagram: confirmed 2026-09-03 from Instagram's own thread header
 *     (rendered as "TRE Forged" / "treforged"), read in-session by Sam.
 *
 * WHY THAT DISTINCTION IS WORTH A COMMENT: a wrong handle does not fail. It
 * SUCCEEDS at sending users to a stranger's profile — no error, no log line,
 * nothing to notice. Same family as a gauge drawing a zero it never read, and
 * exactly the case where "probably right" is not good enough. If either handle
 * changes, re-confirm it against the platform rather than against this file.
 */
export const SOCIAL_LINKS: readonly SocialLink[] = [
  {
    id: 'follow_instagram',
    network: 'Instagram',
    handle: '@treforged',
    url: 'https://www.instagram.com/treforged/',
    earnedLabel: 'Tapped through to Instagram',
  },
  {
    id: 'follow_tiktok',
    network: 'TikTok',
    handle: '@treforged',
    url: 'https://www.tiktok.com/@treforged',
    earnedLabel: 'Tapped through to TikTok',
  },
];

export type SocialAchievementId = SocialLink['id'];
