/**
 * THE BADGES YOU EARN BY USING FORGENTA — names only. The RULE lives in SQL.
 *
 * ⚠️ WHY THIS FILE HOLDS NO THRESHOLDS AND NO CONDITIONS. Tre, 2026-09-17: *"There should be an
 * achievement for multiple things ... I want to make an achievement for milestones of
 * followers/following."* Measured that night: the achievements plumbing was never broken — 5 live
 * rows across 4 accounts, written end to end by the client — there was simply almost nothing to
 * earn. A lesson badge, a social-link TAP, and `og_founder`. Nothing earned by managing money.
 *
 * `public.claim_milestone_achievements()` decides what has been earned, because a milestone is a
 * claim the database can CHECK. That is the opposite of the two social badges, which are
 * self-asserted by necessity (no platform lets a consumer app verify a follow) and which are
 * therefore allowed to unlock nothing. Letting a client assert "you reached 10 followers" would
 * be inventing a claim the server could have verified — the same family as the `og_founder`
 * description that told three real people they had paid when they had not.
 *
 * So: SQL owns *has this been earned*, this file owns *what is it called*, and the THRESHOLD is
 * returned by the function rather than restated here — the progress a person sees is the number
 * the server actually compared against, and the two cannot drift.
 *
 * ⚠️ EVERY DESCRIPTION CLAIMS ONLY WHAT THE COUNTED ROW PROVES. "Linked" does not promise the
 * connection still syncs; "cleared" requires an account to have HELD a debt, or somebody who
 * never entered one would be congratulated for clearing it.
 */

export const MILESTONE_PREFIX = 'milestone:';

export interface MilestoneDefinition {
  name: string;
  description: string;
}

/** Keyed by the full stored `achievement_id`, so a lookup needs no string surgery. */
export const MILESTONES: Readonly<Record<string, MilestoneDefinition>> = {
  'milestone:bank_linked': {
    name: 'Connected',
    description: 'You linked your first account to Forgenta.',
  },
  'milestone:goal_set': {
    name: 'Something to aim at',
    description: 'You set your first savings goal.',
  },
  'milestone:goal_reached': {
    name: 'Goal reached',
    description: 'A savings goal hit the target you set for it.',
  },
  'milestone:debt_free': {
    name: 'Clear',
    description: 'Every debt you have tracked here is down to a zero balance.',
  },
  'milestone:reviewed_25': {
    name: '25 reviewed',
    description: 'You reviewed 25 synced transactions.',
  },
  'milestone:reviewed_100': {
    name: '100 reviewed',
    description: 'You reviewed 100 synced transactions.',
  },
  'milestone:followers_1': {
    name: 'First follower',
    description: 'Somebody followed you.',
  },
  'milestone:followers_5': {
    name: '5 followers',
    description: 'Five people follow you.',
  },
  'milestone:followers_10': {
    name: '10 followers',
    description: 'Ten people follow you.',
  },
  'milestone:following_1': {
    name: 'Following',
    description: 'You followed somebody.',
  },
  'milestone:following_5': {
    name: 'Following 5',
    description: 'You follow five people.',
  },
};

/**
 * A milestone the server returned but this catalogue has never heard of.
 *
 * Deliberately NOT hidden and NOT given an invented name — the same rule the resolver already
 * applies to any unknown id. A badge somebody earned belongs to them even when this file is out
 * of date, and a label nobody chose presented as if somebody had is worse than an ugly one.
 */
export function lookupMilestone(id: string): MilestoneDefinition | undefined {
  return MILESTONES[id];
}
