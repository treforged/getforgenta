/**
 * Which panel the Activity surface opens on. Fourth spelling of the contract in `garage-tab.ts`,
 * `dashboard-tab.ts` and `accounts-tab.ts` — kept identical on purpose, because the moment one of
 * them defaults differently the pages start behaving differently for the same link.
 *
 * ⚠️ THIS IS NOT A NESTED SELECTOR, AND THAT IS THE WHOLE DESIGN (2026-08-18). Tre asked for
 * Transactions and Budget Control to stop being two tabs. `Dashboard` hosted `Accounts` as a second
 * panel, but copying that here would have produced TWO stacked pill rows — an outer Activity|Budget
 * and the inner Planning|Bank Activity this page has owned since §1B — which is MORE chrome than
 * the page has today and the opposite of the ask. So Budget Control became a THIRD value in the
 * selector that already existed: one row, three panels, no second storage key, no `embedded` shell
 * around a nested row.
 *
 * ⚠️ THE STORAGE KEY IS THE OLD ONE (`tre:transactions:tab`) AND IT ALREADY HOLDS LIVE VALUES.
 * Every user who has used this page has `'planning'` or `'bank'` written there; both stay valid, so
 * there is nothing to migrate. What DOES need handling is the reverse — a value we do not know (a
 * future rename, a hand-edited key) must heal to `'planning'` rather than render no panel at all.
 * `effectiveActivityTab` is that heal, done in the selector the same way `'networth'` heals to
 * `'balances'` in `Accounts.tsx`, deliberately NOT as a localStorage migration.
 *
 * ⚠️ AN UNKNOWN OR ABSENT `?tab=` RETURNS null, NOT A DEFAULT — "the link said nothing" and "the
 * link said something we do not recognise" must both leave the user's own remembered panel alone.
 */

/**
 * ⚠️ THIS ARRAY IS THE RENDER ORDER, AND IT IS NOT THE DEFAULT. Budget Control leads the row (Tre,
 * 2026-08-18: "move budget control as the first tab of transactions") because the rules are what
 * every other number on the surface derives from. A user with nothing stored still LANDS on
 * `ACTIVITY_TAB_FALLBACK` — see below; the two are separate on purpose, so changing which pill is
 * first never silently changes which panel opens.
 */
export const ACTIVITY_TABS = ['budget', 'planning', 'bank'] as const;

export type ActivityTab = (typeof ACTIVITY_TABS)[number];

/**
 * Where a fresh sign-in lands, where a user with nothing stored lands, and where an unrecognised
 * value heals to. Tre, 2026-08-18: *"for the activity, it should land in whatever page the user
 * looked at last, on sign in it should be budget control though."*
 */
export const ACTIVITY_TAB_FALLBACK: ActivityTab = 'budget';

/** The one spelling of the key. Exported so the sign-in reset cannot drift from the reader. */
export const ACTIVITY_TAB_STORAGE_KEY = 'tre:transactions:tab';

/**
 * Put the Activity surface back on Budget Control for a NEW SIGN-IN — not for a navigation, not
 * for a token refresh, not for a restored session. "Land where you left off" and "start on the
 * rules" are both true and they answer different questions: the persisted panel is the memory of a
 * session, and signing in begins a new one.
 *
 * ⚠️ Writes JSON because `usePersistedState` reads JSON; a bare string would fail its parse and be
 * discarded, which would look like the reset silently not happening.
 */
export function resetActivityTabForSignIn(storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(ACTIVITY_TAB_STORAGE_KEY, JSON.stringify(ACTIVITY_TAB_FALLBACK));
  } catch {
    // A full or blocked localStorage must never break a sign-in. The user simply lands on
    // whatever panel they last used, which is the next-best answer rather than a broken one.
  }
}

export function isActivityTab(value: string | null | undefined): value is ActivityTab {
  return typeof value === 'string' && (ACTIVITY_TABS as readonly string[]).includes(value);
}

/** The panel a URL asks for, or null when it asks for nothing the page knows. */
export function activityTabFromSearch(search: string | URLSearchParams): ActivityTab | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const asked = params.get('tab');
  return isActivityTab(asked) ? asked : null;
}

/**
 * What to RENDER for a remembered value. Unlike the link reader above this one never returns null:
 * a stored value the page no longer recognises has to resolve to a panel, or the surface renders
 * empty with no error for a user who cannot see why.
 */
export function effectiveActivityTab(stored: string | null | undefined): ActivityTab {
  return isActivityTab(stored) ? stored : ACTIVITY_TAB_FALLBACK;
}
