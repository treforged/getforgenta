/**
 * WHICH SCREENS ARE "PUSHED", AND THEREFORE HAVE SOMETHING TO GO BACK FROM.
 *
 * ⚠️ NOTHING IN THE CHROME OFFERED BACK UNTIL 2026-09-06. Item 3 of
 * `docs/navigation-jakobs-law.md`. Android users have the OS gesture; iOS users have an edge swipe
 * the app never signals. Settings, the AI advisor and Premium are all reachable only from the
 * drawer, so a person who opens Settings has no in-app way back to where they were — the bottom
 * bar takes them to a TAB, which is a different place, not the place they came from.
 *
 * ── A TAB ROOT IS NEVER PUSHED, AND THAT IS THE WHOLE DISTINCTION ────────────
 * ⚠️ Offering "back" on a tab root would offer to leave a place there is nothing to go back from.
 * The five tab roots are the bottom bar's own destinations; `MobileNav`'s `PRIMARY` is the one
 * definition and `nav-routes.test.ts` asserts this list still matches it, so the two cannot drift
 * apart silently the day a sixth tab is added.
 */

/** The bottom bar's five destinations. Asserted equal to `MobileNav`'s `PRIMARY` by its test. */
export const TAB_ROOT_PATHS = [
  '/dashboard',
  '/transactions',
  '/debt',
  '/forecast',
  '/vehicles',
] as const;

/**
 * True when this route was navigated TO from somewhere else and a back affordance makes sense.
 *
 * ⚠️ Everything that is not a tab root counts, deliberately — including a route this list has
 * never heard of. A new pushed screen should get the back control automatically; the failure mode
 * of the opposite default is a screen with no way out, which is exactly the bug being fixed.
 */
export function isPushedRoute(pathname: string): boolean {
  // Trailing slashes come from links people paste and from some native shells. `/settings/` is the
  // same screen as `/settings`, and a tab root reached with one must not suddenly grow a back
  // button.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/' || path === '') return false;
  return !(TAB_ROOT_PATHS as readonly string[]).includes(path);
}
