/**
 * SETTINGS INFORMATION ARCHITECTURE — the declared map, and the principle behind it.
 *
 * Tre, 2026-09-12: "we need to reorganize the settings sections. For example, danger zone should
 * be in security. friends should be in account, same as partner linking should be in account.
 * Some of this stuff is just very misplaced, and it doesn't make sense."
 *
 * ⚠️ THE REAL ASK IS THE PRINCIPLE, NOT THE THREE MOVES. "It doesn't make sense" is the same
 * shape as the notched toggles: it recurs until something DECIDES where a thing belongs. A
 * section defined only by what it already contains accumulates orphans — which is exactly how
 * partner linking ended up filed under Account Security, as though linking a partner were a
 * security control rather than a relationship.
 *
 * So each panel below is defined by what belongs in it AND, more usefully, what does NOT.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *  account      WHO YOU ARE, AND WHO YOU ARE CONNECTED TO.
 *               Profile, display name, the invite link, partner linking, friends, and how to
 *               reach support about any of it.
 *               NOT: how you prove it is you, and nothing irreversible.
 *
 *  security     HOW YOU PROVE IT IS YOU, AND IRREVERSIBLE ACTIONS ON THE ACCOUNT.
 *               Email and password changes, 2FA, app lock, trusted devices, linked sign-in
 *               providers, and deleting the account.
 *               NOT: relationships with other people. Sharing WHAT a partner may see is a
 *               permission and stays here; WHO you are linked to is Account.
 *
 *  preferences  HOW THE APP LOOKS AND BEHAVES ON THIS DEVICE.
 *               Display, formatting, notifications, merchant rules.
 *               NOT: anything about identity, money owed, or the account itself.
 *
 *  plan         WHAT YOU PAY AND WHAT IT BUYS.
 *               NOT: features themselves, only the entitlement to them.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * WHY "Danger Zone" IS NOT ITS OWN PANEL: a destructive action is not a CATEGORY, it is a
 * property of the thing being acted on. Deleting the account is an irreversible action on the
 * account, so it lives in the panel that governs the account's integrity. Keeping it top-level
 * made it a peer of Display, which is how it read as misplaced.
 *
 * WHY "Support" STAYS UNDER Account rather than earning a panel: it is one card, and it is
 * reached WHILE thinking about your account. A fifth tab holding a single card costs a tap on
 * every visit to buy tidiness on one.
 *
 * ⚠️ ONE KNOWN IMPERFECTION, NAMED RATHER THAN HIDDEN: `Developer` sits under `plan` because
 * that is where the native build tools happen to render, not because it belongs there. It is
 * gated to a single email so nobody else can see it. Left alone deliberately — moving it is
 * cosmetic and would touch native-only code this slice does not otherwise open.
 */
export type SettingsPanelKey = 'account' | 'security' | 'preferences' | 'plan';

/**
 * Every section heading and mounted settings component, mapped to the panel it must appear
 * under. `src/lib/__tests__/settings-ia.gate.test.ts` asserts the rendered source agrees, so a
 * setting added to the wrong panel fails a check instead of waiting for someone to notice.
 */
export const SETTINGS_IA: Readonly<Record<SettingsPanelKey, readonly string[]>> = {
  account: [
    'Profile',
    'Invite a Friend',
    'Connections',
    'Support',
  ],
  security: [
    'Account Security',
    'Change Email',
    'Change Password',
    'Trusted Devices',
    'LinkedAccounts',
    'TwoFactorAuth',
    'AppLockSettings',
    'Danger Zone',
  ],
  preferences: [
    'Display',
    'NotificationSettings',
    'MerchantRulesSettings',
  ],
  plan: [
    'Subscription',
    'Developer',
  ],
};

/**
 * SECTIONS THAT LIVE ON `/account` AND NOWHERE ELSE — the second half of the same declaration.
 *
 * ⚠️ THIS IS A RE-STATEMENT OF THE IA, NOT A RELAXATION OF IT. `PartnerLink` and `FriendLink`
 * were declared under the Settings `account` panel above until 2026-09-15, when they were found
 * rendering on BOTH `src/pages/Settings.tsx` and `src/pages/Account.tsx` — duplicated rather than
 * moved, the same shape `FriendsLeaderboard` shipped with and `a0328857` fixed. Two live copies of
 * an invite form is not a tidiness problem: each keeps its own pending-invite state, so cancelling
 * an invite on one screen leaves the other still showing it.
 *
 * Deleting the two entries above would have satisfied the gate and declared nothing. They are
 * declared HERE instead, so the gate can assert the stronger pair: each of these renders on the
 * Account PAGE exactly once, and ZERO times in Settings. Re-adding one to Settings fails a check
 * rather than waiting for somebody to notice two invite forms.
 *
 * Settings keeps a POINTER card (heading `Connections`, declared under `account` above) plus a
 * redirect, because `/settings?friend_code=…` is in already-sent invite emails that cannot be
 * edited, and invites last 7 days.
 */
export const ACCOUNT_PAGE_ONLY: readonly string[] = [
  'PartnerLink',
  // ⚠️ `FriendLink` WAS HERE AND IS DELIBERATELY UNMOUNTED (Tre, 2026-09-17: "add a friend isn't
  // [needed] anymore either that's the same thing as find someone we're only using usernames now
  // instead of email"). It is no longer mounted ANYWHERE, so listing it here - where the gate
  // means "mounted on /account exactly once" - would assert the opposite of the intent.
  // `useFriendLink.test.tsx` holds the replacement assertion: zero mounts app-wide, AND the
  // component still present and tested, so a deliberate unmount stays distinguishable from a
  // file that quietly vanished.
];

/** The settings components the gate tracks by name (they render no heading of their own). */
export const TRACKED_COMPONENTS: readonly string[] = [
  'PartnerLink',
  'FriendLink',
  'LinkedAccounts',
  'TwoFactorAuth',
  'AppLockSettings',
  'NotificationSettings',
  'MerchantRulesSettings',
  'LeaderboardShareToggles',
  'PhoneAuth',
];

/** The panel a given section or component is declared to live under, or null if undeclared. */
export function declaredPanelFor(item: string): SettingsPanelKey | null {
  for (const panel of Object.keys(SETTINGS_IA) as SettingsPanelKey[]) {
    if (SETTINGS_IA[panel].includes(item)) return panel;
  }
  return null;
}
