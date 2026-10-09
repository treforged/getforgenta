/**
 * The email door into quick add (proposal D, 2026-10-09): `/dashboard?quickadd=1` opens the `+`
 * sheet on arrival. no-save-nudge and the weekly email link here instead of to the setup wizard.
 *
 * ⚠️ THE ONE GATE IT PASSES. A person who has not finished setup is normally bounced to
 * /onboarding, which drops the query, so for exactly the people the nudge is written to the link
 * would have opened the full wizard again. With this param, /dashboard lets them through: the
 * Dashboard already has a not-onboarded state (OnboardingChecklist), nothing is written on their
 * behalf, and the next plain visit still goes to the wizard. To undo, make `passesOnboardingGate`
 * return false; the sheet then opens after setup instead.
 */
export const QUICK_ADD_LINK_PARAM = 'quickadd';

export function wantsQuickAdd(search: string): boolean {
  return new URLSearchParams(search).get(QUICK_ADD_LINK_PARAM) === '1';
}

/** The same query without the param, so a reload or Back does not reopen the sheet. */
export function withoutQuickAdd(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(QUICK_ADD_LINK_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/** Only Home, and only with the param: every other route keeps the onboarding gate. */
export function passesOnboardingGate(pathname: string, search: string): boolean {
  return pathname.replace(/\/+$/, '') === '/dashboard' && wantsQuickAdd(search);
}
