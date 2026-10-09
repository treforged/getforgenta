import { AI_ADVISOR_ENABLED } from '@/lib/feature-flags';

export interface TourStep {
  title: string;
  body: string;
  emoji: string;
  /** Shown only when the capability is live for this account (see `AppTour`). */
  requires?: 'quickAdd';
}

/**
 * The first-run tour.
 *
 * WARNING: every step names a place the user can actually GO, in the words the navigation
 * uses today. That is the whole maintenance burden of this file: the previous version sent
 * people to a "Budget Control" tab, a "Savings Goals" tab and a "More menu" that the
 * redesign folded away, so the tour was giving directions to rooms that no longer exist.
 * When a tab moves, this list moves with it.
 *
 * One idea per step, in the order a new account actually fills up: what the app is for,
 * then the one thing to set up first, then how data gets in, then what it tells you.
 */
export const NEW_USER_STEPS: TourStep[] = [
  {
    emoji: '\u{1F3E0}',
    title: 'One number, up front',
    body: 'Home leads with the month your credit cards clear. Every panel has a Guide button at the top that explains how its numbers are worked out, so nothing here is a black box.',
  },
  {
    emoji: '\u{2699}\u{FE0F}',
    title: 'Start in Plan',
    body: 'Plan, in the bottom bar. Add your income and the bills that repeat. Every projection in the app is built from these, so this is the one screen worth doing first.',
  },
  // Quick add shipped 2026-10-09 (ask 661548f5) with no first-run pointer at all: the tour, the
  // finish screen and the checklist never named it. `requires: 'quickAdd'` drops this step where
  // the `+` is a Premium door instead (a free account in the native app), so the tour never
  // describes a press that lands on a paywall.
  {
    emoji: '\u{2795}',
    title: 'Log a purchase in seconds',
    body: 'The gold + in the middle of the bottom bar is quick add: type the amount, tap a category, done. Home\u2019s Add button opens the same thing.',
    requires: 'quickAdd',
  },
  {
    emoji: '\u{1F3E6}',
    title: 'Connect your bank',
    body: 'Home \u2192 Accounts. Link a bank once and balances keep themselves up to date. You can also add any account by hand \u2014 cash, investments, a loan from a friend.',
  },
  {
    emoji: '\u{1F0CF}',
    title: 'Sort spending one card at a time',
    body: 'Transactions gives you one bank charge per screen with a category ready to accept. Teach it a shop once and it remembers. Skip anything you are unsure about \u2014 skipping saves nothing.',
  },
  {
    emoji: '\u{1F4B3}',
    title: 'Debt, in order',
    body: 'Debt ranks your cards by what each one actually costs you, and tells you the amount to send each one this month \u2014 after every minimum is covered, never before.',
  },
  {
    emoji: '\u{1F4C8}',
    title: 'Five years out',
    body: 'Transactions \u2192 Forecast projects cash, debt and net worth 60 months ahead. Your savings goals sit on Home \u2192 Goals, against the same timeline.',
  },
  {
    emoji: '\u{1F697}',
    title: 'Everything else is in Account',
    body: 'Account holds the Garage (saving for a car, paying one off, or building one), Learn, Achievements and your profile.',
  },
];

export const PREMIUM_STEPS: TourStep[] = [
  {
    emoji: '✨',
    title: 'Premium unlocked',
    body: 'You now have access to every feature in Forgenta. Here\'s what\'s new for you.',
  },
  // Skipped while the feature is off — the step points at a nav entry that is not rendered.
  ...(AI_ADVISOR_ENABLED ? [{
    emoji: '🤖',
    title: 'AI Advisor',
    body: 'Get a financial health score, spending analysis, and ask any money question. Find it in Account \u2192 Forgenta AI.',
  }] : []),
  {
    emoji: '🏦',
    title: 'Bank auto-sync',
    body: 'Home \u2192 Accounts, then connect a bank. Balances update automatically \u2014 no more manual entry.',
  },
  {
    emoji: '📄',
    title: 'PDF export',
    body: 'Download your 60-month forecast as a print-ready PDF from Transactions \u2192 Forecast. Put it on the wall. Watch it happen.',
  },
  {
    emoji: '🏷️',
    title: 'Custom categories',
    body: 'In Plan, you can now type any category name for your recurring rules instead of using preset options.',
  },
];

/** Drops steps whose capability is not live for this account, e.g. quick add on a free native account. */
export function stepsFor(steps: TourStep[], live: { quickAdd: boolean }): TourStep[] {
  return steps.filter((s) => !s.requires || live[s.requires]);
}
