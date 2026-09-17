import {
  GraduationCap,
  Share2,
  Crown,
  HelpCircle,
  Target,
  Landmark,
  Flag,
  CircleCheckBig,
  ListChecks,
  ClipboardCheck,
  UserPlus,
  Users,
  UsersRound,
  UserCheck,
  UserRoundCheck,
  Camera,
  Music2,
  type LucideIcon,
} from 'lucide-react';
import type { AchievementKind } from '@/lib/achievements';

/**
 * WHICH PICTURE EACH BADGE GETS.
 *
 * ⚠️ WHY THIS IS NOT IN `milestone-achievements.ts`. That file says in its own header that it
 * owns *what a badge is called* and nothing else — the rule lives in SQL, the name lives there.
 * An icon is presentation, so putting it beside the name would give that file a second job and a
 * reason to change that has nothing to do with the catalogue.
 *
 * ⚠️ WHY IT IS PER-ID RATHER THAN PER-KIND. Until 2026-09-17 every badge was drawn by its KIND,
 * so all eleven milestones rendered the same target and Tre asked for *"better icon/images"* on
 * the screen he was looking at. Eleven identical icons carry no information at all — the icon
 * column may as well have been blank, which is part of why the boxes read as empty.
 *
 * An id with no entry here falls back to its KIND icon rather than rendering nothing. That is the
 * same rule `resolveAchievement` already applies to an unknown id: a badge somebody earned is
 * still shown when this file has not caught up with it.
 */

export const KIND_ICONS: Record<AchievementKind, LucideIcon> = {
  lesson: GraduationCap,
  social: Share2,
  founder: Crown,
  milestone: Target,
  unknown: HelpCircle,
};

/** Keyed by the FULL stored `achievement_id`, so a lookup needs no string surgery. */
export const ACHIEVEMENT_ICONS: Readonly<Record<string, LucideIcon>> = {
  'milestone:bank_linked': Landmark,
  'milestone:goal_set': Flag,
  'milestone:goal_reached': Target,
  'milestone:debt_free': CircleCheckBig,
  'milestone:reviewed_25': ListChecks,
  'milestone:reviewed_100': ClipboardCheck,
  'milestone:followers_1': UserPlus,
  'milestone:followers_5': Users,
  'milestone:followers_10': UsersRound,
  'milestone:following_1': UserCheck,
  'milestone:following_5': UserRoundCheck,
  // lucide has no Instagram or TikTok glyph, so these are the nearest honest stand-ins rather
  // than a brand mark this repo does not ship.
  follow_instagram: Camera,
  follow_tiktok: Music2,
  og_founder: Crown,
};

export function iconFor(id: string, kind: AchievementKind): LucideIcon {
  return ACHIEVEMENT_ICONS[id] ?? KIND_ICONS[kind];
}
