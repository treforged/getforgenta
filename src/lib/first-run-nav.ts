import { PRIMARY_NAV } from '@/lib/primary-nav';

/**
 * What each bottom-bar destination is FOR, in the words the onboarding finish screen uses.
 *
 * Keyed by route and joined to `PRIMARY_NAV` so the finish screen's "Where things are" box can no
 * longer name a tab the bar does not have. It used to be hand-written and on 2026-10-09 (growth
 * pass) it still said "five icons ... Garage for vehicles" three days after Plan took Garage's slot
 * (decision c5e29d9e), and never mentioned the `+` quick add shipped that day. It was the LAST
 * thing a new user read before entering the app.
 */
export const NAV_PURPOSE: Readonly<Record<string, string>> = {
  '/dashboard': 'what needs paying next',
  '/transactions': 'what you have spent',
  '/debt': 'payoff',
  '/budget': 'your income and bills',
  '/account': 'everything else, including the Garage',
};

export interface NavSummaryItem { label: string; purpose: string }

/**
 * Every primary destination with its purpose. A destination missing from NAV_PURPOSE renders as
 * its bare label rather than crashing the finish screen; `first-run-nav.test.ts` is what turns
 * that gap red.
 */
export function firstRunNavSummary(): NavSummaryItem[] {
  return PRIMARY_NAV.map((d) => ({ label: d.label, purpose: NAV_PURPOSE[d.to] ?? '' }));
}
