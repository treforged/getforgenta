/**
 * Which panel the Activity surface opens on. Fourth spelling of the contract in `garage-tab.ts`,
 * `dashboard-tab.ts` and `accounts-tab.ts` — kept identical on purpose, because the moment one of
 * them defaults differently the pages start behaving differently for the same link.
 *
 * ⚠️ THIS IS NOT A NESTED SELECTOR, AND THAT IS THE WHOLE DESIGN (2026-08-18). Tre asked for
 * Transactions and Budget Control to stop being two tabs. `Dashboard` hosted `Accounts` as a second
 * panel, but copying that here would have produced TWO stacked pill rows — an outer Activity|Budget
 * and an inner one — which is MORE chrome than the page had and the opposite of the ask. So Budget
 * Control became a value in the selector that already existed: one row, no second storage key, no
 * `embedded` shell around a nested row.
 *
 * ⚠️ PLANNING AND BANK ACTIVITY ARE ONE PANEL SINCE 2026-08-25 (Tre: *"bank activity and planning
 * should be one tab"*). They were always two halves of one subject — what the money is scheduled to
 * do, and what the bank says it did — and keeping them apart is what let a decision the app was
 * waiting on sit behind a tab nobody opened. The merged panel is `'transactions'`; both retired
 * spellings resolve to it through `ACTIVITY_TAB_ALIASES` below.
 *
 * ⚠️ THE STORAGE KEY IS THE ORIGINAL ONE (`tre:transactions:tab`) AND IT HOLDS LIVE VALUES. Renaming
 * a key silently resets every user's remembered panel to buy nothing — the same reasoning as
 * `tre:vehicles:activeTab` in `Vehicles.tsx`. So the key never moves and the VALUES are what get
 * healed, in the selector, the same way `'networth'` heals to `'balances'` in `Accounts.tsx` and
 * deliberately NOT as a localStorage migration.
 *
 * ⚠️ AN ALIAS IS NOT A FALLBACK, and conflating the two is the failure this file is arranged to
 * avoid. `'planning'` and `'bank'` are values this app itself wrote and whose meaning we know
 * exactly, so they resolve to the panel that absorbed them. A value we do NOT know heals to
 * `ACTIVITY_TAB_FALLBACK`. Sending the two retired spellings down the fallback path would move
 * everyone who was last on either half to Budget Control without a word.
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
export const ACTIVITY_TABS = ['budget', 'transactions'] as const;

export type ActivityTab = (typeof ACTIVITY_TABS)[number];

/**
 * Panel names this app used to write, and where each one lands now.
 *
 * Exported as data so a test can state the whole map, and so the reader and the sign-in writer read
 * one source rather than two lists that can drift.
 */
export const ACTIVITY_TAB_ALIASES: Readonly<Record<string, ActivityTab>> = {
  planning: 'transactions',
  bank: 'transactions',
};

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

/**
 * A panel that exists TODAY. Deliberately false for a retired spelling: an alias is something to
 * resolve, never something to store or render, and a guard that accepted both would let `'bank'`
 * reach a `<PanelBar>` that has no such pill and select nothing.
 */
export function isActivityTab(value: string | null | undefined): value is ActivityTab {
  return typeof value === 'string' && (ACTIVITY_TABS as readonly string[]).includes(value);
}

/** A current panel, a retired spelling of one, or null for anything else. */
function resolveActivityTab(value: string | null | undefined): ActivityTab | null {
  if (isActivityTab(value)) return value;
  if (typeof value === 'string' && value in ACTIVITY_TAB_ALIASES) return ACTIVITY_TAB_ALIASES[value];
  return null;
}

/** The panel a URL asks for, or null when it asks for nothing the page knows. */
export function activityTabFromSearch(search: string | URLSearchParams): ActivityTab | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  return resolveActivityTab(params.get('tab'));
}

/**
 * What to RENDER for a remembered value. Unlike the link reader above this one never returns null:
 * a stored value the page no longer recognises has to resolve to a panel, or the surface renders
 * empty with no error for a user who cannot see why.
 */
export function effectiveActivityTab(stored: string | null | undefined): ActivityTab {
  return resolveActivityTab(stored) ?? ACTIVITY_TAB_FALLBACK;
}
