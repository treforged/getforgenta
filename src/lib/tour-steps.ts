import { AI_ADVISOR_ENABLED } from '@/lib/feature-flags';

export interface TourStep {
  title: string;
  body: string;
  emoji: string;
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
    body: 'Home leads with the month your credit cards clear, and draws the run getting there. Everything else on the page supports that one number.',
  },
  {
    emoji: '\u{2699}\u{FE0F}',
    title: 'Start in Plan',
    body: 'Transactions \u2192 Plan. Add your income and the bills that repeat. Every projection in the app is built from these, so this is the one screen worth doing first.',
  },
  {
    emoji: '\u{1F3E6}',
    title: 'Connect your bank',
    body: 'Home \u2192 Accounts. Link a bank once and balances keep themselves up to date. You can also add any account by hand \u2014 cash, investments, a loan from a friend.',
  },
  {
    emoji: '\u{1F0CF}',
    title: 'Sort spending one card at a time',
    body: 'Activity \u2192 Bank Activity gives you one charge per screen with a category ready to accept. Teach it a shop once and it remembers. Skip anything you are unsure about \u2014 skipping saves nothing.',
  },
  {
    emoji: '\u{1F4B3}',
    title: 'Debt, in order',
    body: 'Debt ranks your cards by what each one actually costs you, and tells you the amount to send each one this month \u2014 after every minimum is covered, never before.',
  },
  {
    emoji: '\u{1F4C8}',
    title: 'Five years out',
    body: 'Forecast projects cash, debt and net worth 60 months ahead, and leads with your next milestone. Goals lives here too, so what you are saving for sits against the same timeline.',
  },
  {
    emoji: '\u{1F697}',
    title: 'The Garage',
    body: 'Saving for a car, paying one off, or building one \u2014 Garage tracks all three, and a real charge from your bank can be recorded straight onto a build.',
  },
  {
    emoji: '\u{1F4D6}',
    title: 'Every screen explains itself',
    body: 'The Guide button sits at the top right of every panel and explains what that panel is doing, including how each number is worked out. Nothing here is a black box.',
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
    body: 'Get a financial health score, spending analysis, and ask any money question. Open the menu at the top left.',
  }] : []),
  {
    emoji: '🏦',
    title: 'Bank auto-sync',
    body: 'Home \u2192 Accounts, then connect a bank. Balances update automatically \u2014 no more manual entry.',
  },
  {
    emoji: '📄',
    title: 'PDF export',
    body: 'Download your 60-month forecast as a print-ready PDF from the Forecast tab. Put it on the wall. Watch it happen.',
  },
  {
    emoji: '🏷️',
    title: 'Custom categories',
    body: 'In Activity \u2192 Budget Control, you can now type any category name for your recurring rules instead of using preset options.',
  },
];
