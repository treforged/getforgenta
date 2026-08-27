/**
 * Every guide in the app, keyed by the panel it explains.
 *
 * ## Why this exists
 *
 * There were 8 `InstructionsModal` call sites, one per PAGE, written when a page was one
 * thing. Pages now host panels, so the guide stopped matching what was on screen: `/debt`
 * had ONE guide covering 5 panels, the Garage ONE covering 3, while `/dashboard` and
 * `/transactions` rendered TWO guide buttons at once because a hosted panel brought its own.
 *
 * Placement drifted for the same reason. The button trailed each page's `<h1>`, so its x
 * was a function of title length — measured at 96 / 118 / 123 / 162 / 271 / 391 px across
 * the six surfaces. That is the "make it symmetrical" complaint in numbers.
 *
 * Both halves are fixed by the same move: the guide is **content addressed by panel** and
 * **placed by `PanelGuide`**, pinned to the right of the panel row on every surface. A page
 * no longer decides either.
 *
 * ## The rules
 *
 * - A key is `surface:panel`. The panel value is the page's OWN state value (`activeTab`),
 *   never a re-spelling of it, so the two cannot drift apart.
 * - `resolveGuide` NEVER returns nothing. An unknown panel falls back to the surface's own
 *   default, because a missing Guide button reads as a bug and a general guide does not.
 * - Copy is lifted VERBATIM from the page guides it replaces wherever a panel maps onto the
 *   old page. This file re-homed the guides; it did not rewrite them.
 */

export interface GuideSection {
  title: string;
  body: string;
  /**
   * Which panel this block is about. Set by {@link resolveSurfaceGuide} when it combines a
   * surface's panels into one guide; the per-panel entries below never carry it, because
   * inside a single panel's guide the answer is "this one".
   */
  group?: string;
}

export interface PageGuide {
  /** Shown in the modal header and the button's tooltip. */
  title: string;
  sections: GuideSection[];
}

/** The surfaces that own a panel row. `garage` is the page still filed as `Vehicles.tsx`. */
export type GuideSurface =
  | 'dashboard'
  | 'accounts'
  | 'transactions'
  | 'debt'
  | 'forecast'
  | 'garage'
  | 'settings';

export type GuideKey = `${GuideSurface}:${string}`;

export const PAGE_GUIDES: Record<GuideKey, PageGuide> = {
  // ── Dashboard ───────────────────────────────────────────────────────────────────────
  'dashboard:overview': {
    title: 'Dashboard Guide',
    sections: [
      { title: 'What is this panel?', body: 'The Command Center gives you a real-time snapshot of your financial health — income, expenses, net worth, savings, debt, and upcoming bills for the current month.' },
      { title: 'The strip at the top', body: 'Net worth, and what it is made of: total assets and total liabilities under the headline, then liquid cash, investments, retirement and credit card debt with your utilization. It sits above the panel switcher, so it stays on screen on Overview, Accounts and Goals alike. Tap Net Worth or Liquid Cash to see exactly which accounts went into it. Until every account has loaded the strip shows placeholders rather than zeros.' },
      { title: 'The headline number', body: 'The top of the page shows the month your credit card debt clears, and how much cash sits above your safety floor. The curve under it is that same plan drawn out: where your balance is today and the shape of it falling to zero. If either number has no reading yet, the page says so rather than showing a zero.' },
      { title: 'Monthly Snapshot', body: 'One donut for the month: what you have already spent, what your bills and reserves still expect, what the cash floor holds back, and what is left to deploy. If the month comes up short, the shortfall gets its own slice instead of hiding. Beside the title sit your next paycheck date, which taps through to Budget Control, and projected month-end cash, which opens the breakdown of how the month gets there. Both figures stay off the card until there is a real reading to show.' },
      { title: 'Net Worth Trend', body: 'Which way net worth is moving: the change since roughly a month ago, above the recorded history line. The totals themselves are in the strip at the top of the page. Snapshots are saved about once a week, so the line fills in over the first few weeks rather than appearing all at once. Until there is history to draw, the card says so instead of drawing a flat line at zero.' },
      { title: 'Cash Flow Chart', body: 'Displays the last 6 months of income vs expenses with net cash flow trend line.' },
      { title: 'Customize Dashboard', body: 'Click the Customize button to show/hide widgets and use the up/down arrows to reorder them. Layout is saved to your account.' },
      { title: 'How edits affect this page', body: 'Changes to Accounts, Budget Control rules, or Debt Payoff recommendations instantly update all dashboard metrics.' },
    ],
  },
  'dashboard:accounts': {
    title: 'Accounts Guide',
    sections: [
      { title: 'What is this panel?', body: 'Accounts is the centralized source of truth for all your financial balances — checking, savings, investments, retirement, credit cards, and loans.' },
      { title: 'How it connects', body: 'Account balances drive net worth, liquid cash calculations, debt payoff recommendations, and payment source availability across the entire app.' },
      { title: 'Where the totals went', body: 'Net worth, assets, liabilities, and the split across cash, investments, retirement and card debt now live in the strip at the top of the page, above the panel switcher, so what these accounts add up to is on screen here too. The history chart is on the Overview panel. This panel is the accounts themselves.' },
      { title: 'Credit Cards', body: 'Credit card accounts automatically appear in the Debt Payoff Planner. Set APR and credit limits here for accurate utilization and interest calculations.' },
      { title: 'Tips', body: 'Mark accounts as inactive to exclude them from calculations without deleting. Use the filter to view assets vs liabilities separately.' },
    ],
  },
  'dashboard:goals': {
    title: 'Savings Goals Guide',
    sections: [
      { title: 'What is this panel?', body: 'Track progress toward your financial goals — emergency fund, vacation, down payment, or retirement. Link goals to real accounts for automatic balance sync.' },
      { title: 'Linked Accounts', body: 'When linked to an account, the goal\'s "current saved" automatically reflects that account balance. "Available after bills" shows the realistic amount after subtracting scheduled outflows.' },
      { title: 'Target Date', body: 'Set a target date to see estimated completion. The chart projects growth based on your monthly contribution.' },
      { title: 'Vehicles', body: 'Tracking a car purchase? Use the Garage tab for down payment goals and full loan amortization.' },
    ],
  },

  // ── Accounts (its own panel row, hosted inside the Dashboard) ───────────────────────
  'accounts:balances': {
    title: 'Balances Guide',
    sections: [
      { title: 'What is this panel?', body: 'Every account you hold, with the balance each one currently reports. This is the source of truth the rest of the app reads — net worth, liquid cash, debt payoff and payment sources all come from here, and the strip at the top of the page is what these balances add up to.' },
      { title: 'Credit Cards', body: 'Credit card accounts automatically appear in the Debt Payoff Planner. Set APR and credit limits here for accurate utilization and interest calculations.' },
      { title: 'Cards you have not opened yet', body: 'A card with a future start date is one you have PLANNED. It stays out of this month\'s payment recommendations, the debt tab count and the liabilities breakdown until that date arrives — but it is still listed here, because an account list is not a claim about what you owe.' },
      { title: 'Tips', body: 'Mark accounts as inactive to exclude them from calculations without deleting. Use the filter to view assets vs liabilities separately.' },
    ],
  },
  'accounts:banks': {
    title: 'Bank Connections Guide',
    sections: [
      { title: 'What is this panel?', body: 'The banks you have connected, when each last synced, and the accounts each connection brought in. Balances and transactions refresh on a daily schedule.' },
      { title: 'Stale connections', body: 'A connection that has not synced on schedule is badged here. Most fix themselves on the next run; one that keeps failing usually needs you to re-authenticate with the bank.' },
      { title: 'A manual edit is never overwritten', body: 'Where you have set a value by hand — an APR, a minimum payment — a sync will not replace it with the bank\'s figure. Your number wins.' },
      { title: 'Disconnecting', body: 'Removing a connection stops future syncs and leaves the accounts and history already imported in place. Nothing you have categorised is deleted.' },
    ],
  },

  // ── Activity ────────────────────────────────────────────────────────────────────────
  'transactions:budget': {
    title: 'Plan Guide',
    sections: [
      { title: 'What is this panel?', body: 'Plan is your hub for managing all recurring financial rules — income, fixed expenses, variable spending, debt payments, and transfers. It feeds the Dashboard, Forecast, and your ledger.' },
      { title: 'Income & Taxes', body: 'Set your gross income, pay frequency, tax rate, and payday at the top. Changes auto-save and automatically sync your income rule to match.' },
      { title: 'Budget Allocation Bar', body: 'Shows how your take-home is distributed across categories for the current month only. Colors: Red=Fixed, Orange=Variable, Blue=Debt, Purple=Transfers, Green=Remaining.' },
      { title: 'Remaining Cash On Hand', body: 'Uses only the selected funding account\'s live balance plus remaining income minus remaining expenses and remaining debt payments for the rest of the current month. All values come from Transactions as the single source of truth — no double counting with Budget Control rules.' },
      { title: 'How rules work', body: 'Rules auto-generate transactions. Weekly rules create 4-5 entries/month, monthly once, yearly once in the due month. Start dates control when rules activate.' },
      { title: 'One-Time Transactions', body: 'One-time manual transactions from Transactions are factored into Remaining Cash and debt recommendations. Future one-time purchases reduce available repayment cash.' },
    ],
  },
  'transactions:planning': {
    title: 'Planning Guide',
    sections: [
      { title: 'What is this panel?', body: 'Your complete ledger: real transactions you enter plus auto-generated ones from your Budget Control recurring rules and debt payoff plan. It shares the Transactions tab with what your bank reported.' },
      { title: 'Generated vs Real', body: 'Entries with badges (recurring, debt payment) are auto-generated from rules. Edit the occurrence to override just that instance, or edit the rule to change all future occurrences.' },
      { title: 'Filters', body: 'Filter by type (income/expense), category, or payment source to find specific entries.' },
      { title: 'How it affects the rest', body: 'Transactions feed the Dashboard monthly totals, Forecast projections, and spending breakdowns.' },
    ],
  },
  'transactions:bank': {
    title: 'Bank Activity Guide',
    sections: [
      { title: 'What is this panel?', body: 'What your bank actually reported, as it came in. Nothing here is a projection — these are real charges, and this is where you tell the app what they were.' },
      { title: 'The count on the tab', body: 'It counts charges the app already has an answer for and is waiting on you to confirm. It is NOT a count of everything uncategorised: most rows never need a decision, and the history imported when you first connected a bank is deliberately left out of it.' },
      { title: 'Sort it one card at a time', body: 'Open the deck and you get one charge per screen — the suggested category ready to accept, the categories you use most as chips, and skip. Teaching it a merchant once re-ranks every future charge from that merchant.' },
      { title: 'A suggestion is a first draft', body: 'The category shown is the app\'s best guess, never a claim. Correcting it is the point — your correction beats the guess for that merchant from then on.' },
      { title: 'Nothing is silent', body: 'Every batch you accept can be undone in one press, and skipping writes nothing at all.' },
    ],
  },

  // ── Debt ────────────────────────────────────────────────────────────────────────────
  'debt:cards': {
    title: 'Credit Card Payoff Guide',
    sections: [
      { title: 'What is this panel?', body: 'The Debt Payoff Planner runs a full 60-month simulation with real monthly interest, minimum payments, and optional payment plan charges. It tells you exactly when each card is paid off and how much interest you will pay.' },
      { title: 'Strategies', body: 'Avalanche pays the highest-APR card first to minimize total interest. Snowball pays the smallest balance first for early momentum. Both always cover every card\'s minimum first, then put the remaining available cash toward the priority card.' },
      { title: 'Statement vs. revolving cards', body: 'Cards set to "pay in full" clear their full balance each month — new purchases are included in the payment. Revolving cards carry a balance month-to-month and accrue interest. The engine handles both correctly and never over-pays a statement card.' },
      { title: 'Payment plans on cards', body: 'Installment plans (Amazon, Apple Pay Later, etc.) linked to a credit card are added as monthly charges to that card — they are not deducted from your cash directly. The engine factors these charges into each card\'s projected balance and interest each month.' },
      { title: 'Due dates', body: 'Each card can have a due date. The engine estimates how much cash you will have by that date — accounting for scheduled income and expenses — so it knows exactly what is safe to pay without dropping below your floor before the next paycheck.' },
      { title: 'Est. Liquid Cash & Safe to Pay', body: 'Liquid Cash = your funding account balance + Transactions income scheduled before the due date. Safe to Pay = Liquid Cash − Safe Minimum − other cards\' autopay amounts. Budget Control income is not separately counted — Transactions is the source of truth to prevent double-counting.' },
      { title: 'Minimum payment priority', body: 'All minimums across every card are covered first. Only after every minimum is met does the engine allocate the extra available amount to the strategy\'s priority card.' },
      { title: 'Recommended Safe Minimum', body: 'The greater of your cash floor setting and estimated next-month bills due before your next paycheck. This prevents your account from going negative between pay periods.' },
      { title: 'Cards you have not opened yet', body: 'A card with a future start date is not asked to be paid, is not counted in the tab badge, and is not in the utilization figure — it does not exist yet. The utilization panel names it underneath, so you can see it was left out on purpose rather than lost.' },
      { title: 'Overrides & reset', body: 'Click any monthly payment cell to manually set an amount. Use "Revert" to restore the engine\'s recommendation for that month. "Reset & Recalculate" clears all manual overrides and recalculates from scratch — only needed after manual adjustments.' },
    ],
  },
  'debt:auto': {
    title: 'Auto Loan Guide',
    sections: [
      { title: 'What is this panel?', body: 'Every auto loan you owe on, with its balance, rate and payoff date from a full amortization — principal and interest split out month by month.' },
      { title: 'It is not in the card payoff date', body: 'The Dashboard\'s "credit cards paid off" date comes from the revolving engine, which never sees a loan. A car loan usually outlives it, and the Dashboard says so rather than implying you are done.' },
      { title: 'Extra payments', body: 'Anything above the scheduled payment goes to principal and pulls the payoff date in. The schedule re-amortizes from the new balance.' },
      { title: 'Connected loans', body: 'When a loan account is linked to a connected bank, the bank\'s balance is the one used and the pair is only counted once. A typed balance is a starting point until then.' },
    ],
  },
  'debt:mortgage': {
    title: 'Mortgage Guide',
    sections: [
      { title: 'What is this panel?', body: 'Your mortgage balance, rate and full amortization to payoff, alongside the rest of what you owe.' },
      { title: 'It is not in the card payoff date', body: 'The Dashboard\'s "credit cards paid off" date covers revolving debt only. A mortgage runs on its own schedule and is deliberately excluded from it.' },
      { title: 'Extra payments', body: 'Extra toward principal shortens the schedule and cuts total interest. The projection re-amortizes so you can see what each extra payment is worth.' },
      { title: 'Escrow', body: 'Enter the principal-and-interest payment. Taxes and insurance collected in escrow belong in Budget Control as their own expense rules, so they are not counted twice.' },
    ],
  },
  'debt:student': {
    title: 'Student Loan Guide',
    sections: [
      { title: 'What is this panel?', body: 'Student loan balances with rate, payment and payoff date. Multiple loans are listed separately, so you can see which one is actually costing you.' },
      { title: 'It is not in the card payoff date', body: 'The Dashboard\'s "credit cards paid off" date covers revolving debt only. Student loans run past it on their own schedule.' },
      { title: 'Rate matters more than balance', body: 'The avalanche logic on the cards panel applies here too: the highest rate costs the most per dollar, whatever the balance next to it says.' },
    ],
  },
  'debt:other': {
    title: 'Other Debt Guide',
    sections: [
      { title: 'What is this panel?', body: 'Anything you owe that is not a card, a car, a house or a degree — personal loans, medical debt, money owed to a person.' },
      { title: 'Why it still belongs here', body: 'A liability left off the books quietly overstates your net worth. Adding it here puts it into net worth, the liabilities breakdown and the forecast.' },
      { title: 'No rate?', body: 'A debt with no interest still has a payment and a payoff date. Leave the rate empty rather than guessing one — a made-up rate produces a made-up interest figure.' },
    ],
  },

  // ── Forecast ────────────────────────────────────────────────────────────────────────
  'forecast:forecast': {
    title: 'Forecast Guide',
    sections: [
      { title: 'What is this panel?', body: 'The Forecast projects your cash, debt, investments, and net worth across 60 months using your live accounts, recurring rules, debt payoff plan, savings goals, vehicle funds, and one-time transactions.' },
      { title: 'Three-stage engine', body: 'Each month runs in three stages. Stage 1 applies income and all baseline expenses. Stage 2 looks ahead to known large expenses — holding back extra debt payments early so a future month never falls below your safe floor. Stage 3 takes any cash still above the floor and automatically redirects it to your highest-priority credit card debt.' },
      { title: 'Automatic surplus routing', body: 'When your projected end cash exceeds the Safe Minimum, that surplus is automatically sent to credit card debt — on top of your regular planned payment. Months where surplus fully routed will show end cash pinned near the floor. The CC badge shows the full payment for the month, not just the planned amount.' },
      { title: 'CC payment badge', body: 'The CC badge (e.g. CC $1,318) shows the total cash that goes to credit cards that month — your regular revolving payment plus any surplus automatically added. It rises above the Debt Payoff plan amount in months where extra cash is available above the floor.' },
      { title: 'Look-ahead protection & save-up months', body: 'When a known large expense is coming (car purchase, one-time cost), the engine stops routing surplus to debt in earlier months and lets cash accumulate instead. Regular minimums are always paid — only the extra surplus is held back. You will see end cash stay above the floor in those months.' },
      { title: 'Payment plans on cards', body: 'Buy-now-pay-later or installment plans linked to a credit card (e.g. Amazon) are charged to that card each month — they do not reduce your cash balance directly. The CC payment covers them. Months with active plans show higher card charges and the engine factors them into the revolving balance projection.' },
      { title: 'Card balance popup', body: 'Tapping a month row shows each card\'s projected balance for that month. Revolving cards (Discover, Prime Visa) show the full balance including that month\'s purchases and payment plan charges. The popup tracks the actual balance — not just the carry-over — so it matches what you would see on your statement.' },
      { title: 'Savings & liquid cash', body: 'End Cash reflects only checking and cash accounts — savings, HYSA, and investments are excluded so the engine does not treat them as available for debt payments. Those balances still grow in the Net Worth projection.' },
      { title: 'Cash safety floor', body: 'End Cash enforces the Safe Minimum = max(your cash floor setting, estimated next-month bills due before your next paycheck). Debt payments automatically decrease to stay above this floor. Minimums are always paid first.' },
      { title: 'Charts & legends', body: 'Click any legend item to toggle that data series on or off. Preferences are saved — no refresh needed.' },
    ],
  },

  // ── Garage ──────────────────────────────────────────────────────────────────────────
  'garage:saving': {
    title: 'Saving For A Car Guide',
    sections: [
      { title: 'What is this panel?', body: 'The saving phase: track your down payment goal and preview what the loan would cost before you commit to it.' },
      { title: 'Planned Purchase Date', body: 'Set the month you plan to buy. In the Forecast, saving contributions stop that month, the down payment is shown as an outflow, and the projected loan payment starts the following month. Estimated values are used until you hit "I bought it."' },
      { title: 'Linked Account', body: 'Link your savings account to auto-pull the current balance as your down payment progress. When linked, "Current Saved" in the form is skipped — the live balance is used instead.' },
      { title: 'Transfer Rule', body: 'Link a recurring transfer rule to auto-sync the monthly contribution amount for the estimated completion date.' },
      { title: 'I bought it', body: 'Hit "I bought it" to enter your real loan amount, APR, start date, first payment date, and interest start date. If you clicked by accident, use the undo button on the loan card.' },
    ],
  },
  'garage:loan': {
    title: 'Car Loan Guide',
    sections: [
      { title: 'What is this panel?', body: 'The loan phase: your real loan terms and full amortization to payoff, month by month.' },
      { title: 'Connected loans', body: 'When the loan is linked to a connected bank account, the bank\'s balance is the one used and the pair is only counted once. A typed balance is a starting point until then.' },
      { title: 'Undo Purchase', body: 'The undo button (↩) on a loan card reverts back to saving phase. Click once to see "Confirm?", click again to revert. Your saving-phase details are preserved.' },
      { title: 'Connects to Forecast', body: 'Active loan payments appear as "Car Loan Payments" in the Forecast drawer. Projected loans for saving-phase vehicles appear as "Est. Car Loan (projected)" starting the month after the planned purchase date.' },
      { title: 'Not in the card payoff date', body: 'The Dashboard\'s "credit cards paid off" date comes from the revolving engine and does not include this loan. The Dashboard says so underneath rather than implying the loan is gone.' },
    ],
  },
  'garage:builds': {
    title: 'Builds Guide',
    sections: [
      { title: 'What is this panel?', body: 'The build thread for a car: every part planned, bought or fitted, with what it cost and what the whole build is up to.' },
      { title: 'Planned vs spent', body: 'A part carries a planned cost until you record what you actually paid. The summary shows both, so an estimate is never mistaken for a receipt.' },
      { title: 'Recording a part from a real charge', body: 'In Bank Activity, a charge can be recorded straight onto a build. The amount comes from the bank, so the build total is receipts rather than memory.' },
      { title: 'Maintenance log', body: 'Servicing is tracked separately from the build — what was done, when, and what it cost, with a 12-month running total.' },
    ],
  },
  // ── Settings ────────────────────────────────────────────────────────────────────────
  // New copy: Settings was a single scrolling column of nine cards and never had a guide.
  // ⚠️ Two of these panels do not exist in demo (there is no account to secure and no plan
  // to manage), which is why `Settings.tsx` builds its panel row rather than hard-coding it.
  'settings:account': {
    title: 'Account Guide',
    sections: [
      { title: 'What is this panel?', body: 'Who you are in the app, the invite link that shares it, where to get help, and — at the very bottom — deleting the account.' },
      { title: 'Display name', body: 'The name the app greets you with. It is not your login: changing it here changes nothing about how you sign in.' },
      { title: 'Invite a friend', body: 'Your personal link. It is safe to share — it opens sign-up and grants no access whatsoever to your data.' },
      { title: 'Deleting your account', body: 'Permanent, and it takes every account, rule, goal and build with it. If a subscription is active the delete flow says what happens to it before you confirm.' },
    ],
  },
  'settings:security': {
    title: 'Security Guide',
    sections: [
      { title: 'What is this panel?', body: 'Everything that controls who can get into this account: the email and password you sign in with, connected sign-in providers, two-factor, and the devices already trusted.' },
      { title: 'Changing your email', body: 'The new address has to be confirmed before it becomes your login, so a typo cannot lock you out — the old address keeps working until the new one is verified.' },
      { title: 'Two-factor authentication', body: 'A second step at sign-in. Worth turning on: a password on its own is one leak away from being someone else’s.' },
      { title: 'Trusted devices and signing out everywhere', body: 'Signing out all devices ends every session but this one. Use it if a phone goes missing — it is the fastest lever on this page.' },
    ],
  },
  'settings:preferences': {
    title: 'Preferences Guide',
    sections: [
      { title: 'What is this panel?', body: 'How the app displays and interprets your numbers, plus the merchant answers it has learned from you.' },
      { title: 'Currency and month start day', body: 'The month start day decides where every monthly total is cut. Move it and the Dashboard, Budget Control and Forecast all re-cut together — nothing is recalculated differently, it is the same money in different boxes.' },
      { title: 'Merchant memory', body: 'When you tell the app what a charge is, it remembers the merchant so it stops asking. This is the one place those answers can be changed or switched off — a decision the app applies everywhere has to be reversible somewhere obvious.' },
      { title: 'Why it may be empty', body: 'The merchant list appears once something has been learned. Nothing there means nothing has been taught yet, not that the feature is off.' },
    ],
  },
  'settings:plan': {
    title: 'Plan Guide',
    sections: [
      { title: 'What is this panel?', body: 'Your subscription: what you are on, when it renews, the payment method, and cancelling or resuming.' },
      { title: 'Cancelling', body: 'A cancellation runs to the end of the period already paid for — you keep everything until then, and the page shows the date. It can be resumed before that date without re-subscribing.' },
      { title: 'Updating a card', body: 'The payment form is handled by Stripe and opens inside the page. Card details never reach this app.' },
    ],
  },
};

/** Where an unrecognised panel lands. One entry per surface, and every one exists above. */
const SURFACE_FALLBACK: Record<GuideSurface, GuideKey> = {
  dashboard: 'dashboard:overview',
  accounts: 'accounts:balances',
  transactions: 'transactions:planning',
  debt: 'debt:cards',
  forecast: 'forecast:forecast',
  garage: 'garage:saving',
  settings: 'settings:account',
};

/**
 * The guide for a panel. Never returns nothing: an unrecognised panel falls back to the
 * surface's own default, because a page that suddenly has no Guide button reads as a bug
 * and a slightly-too-general guide does not.
 */
export function resolveGuide(surface: GuideSurface, panel: string): PageGuide {
  return PAGE_GUIDES[`${surface}:${panel}`] ?? PAGE_GUIDES[SURFACE_FALLBACK[surface]];
}

/**
 * The label each panel goes under inside a combined guide, and — because the object is
 * ordered — the order the panels appear in. Reads as the panel row does, left to right.
 *
 * ⚠️ A panel with a guide but no label here would be silently dropped from its surface's
 * guide, so `resolveSurfaceGuide` asserts over THIS map rather than over `PAGE_GUIDES`.
 */
const SURFACE_PANELS: Record<GuideSurface, { key: GuideKey; label: string }[]> = {
  // WARNING: Home's guide reaches ACROSS surfaces on purpose. The Accounts page is hosted
  // here as a panel and brings its own two sub-panels with it, so a reader who opens Home's
  // guide gets the whole page — including the parts that are another module's code. Goals is
  // listed after them so the Accounts group stays contiguous; the order here is the guide's
  // table of contents, not the pill row.
  dashboard: [
    { key: 'dashboard:overview', label: 'Overview' },
    { key: 'dashboard:accounts', label: 'Accounts' },
    { key: 'accounts:balances', label: 'Accounts · Balances' },
    { key: 'accounts:banks', label: 'Accounts · Bank connections' },
    { key: 'dashboard:goals', label: 'Goals' },
  ],
  accounts: [
    { key: 'accounts:balances', label: 'Balances' },
    { key: 'accounts:banks', label: 'Bank connections' },
  ],
  // ⚠️ THE KEYS OUTLIVE THE TABS. Planning and Bank Activity became one tab on 2026-08-25, and the
  // two guides did NOT merge with them: they explain two different halves of that tab, and folding
  // them into one entry would either drop copy or bury it. Only the LABELS move, so a reader sees
  // the table of contents the page now reads as. Renaming the keys would orphan
  // `SURFACE_FALLBACK.transactions` and every panel-scoped `resolveGuide` call for no gain.
  transactions: [
    { key: 'transactions:budget', label: 'Plan' },
    { key: 'transactions:planning', label: 'Transactions · Your ledger' },
    { key: 'transactions:bank', label: 'Transactions · From your bank' },
  ],
  debt: [
    { key: 'debt:cards', label: 'Credit cards' },
    { key: 'debt:auto', label: 'Auto loans' },
    { key: 'debt:mortgage', label: 'Mortgage' },
    { key: 'debt:student', label: 'Student loans' },
    { key: 'debt:other', label: 'Other debt' },
  ],
  forecast: [
    { key: 'forecast:forecast', label: 'Forecast' },
  ],
  garage: [
    { key: 'garage:saving', label: 'Saving for a car' },
    { key: 'garage:loan', label: 'Car loans' },
    { key: 'garage:builds', label: 'Builds' },
  ],
  // ⚠️ Security and Plan are listed here even though `Settings.tsx` hides those panels in demo.
  // This map is the GUIDE's table of contents, not the panel row: a reader in demo is better
  // served by a guide that explains the whole page than by one that quietly omits half of it.
  settings: [
    { key: 'settings:account', label: 'Account' },
    { key: 'settings:security', label: 'Security' },
    { key: 'settings:preferences', label: 'Preferences' },
    { key: 'settings:plan', label: 'Plan' },
  ],
};

/** The name a combined guide goes by — the page, not any one of its panels. */
const SURFACE_TITLE: Record<GuideSurface, string> = {
  dashboard: 'Home Guide',
  accounts: 'Accounts Guide',
  transactions: 'Activity Guide',
  debt: 'Debt Guide',
  forecast: 'Forecast Guide',
  garage: 'Garage Guide',
  settings: 'Settings Guide',
};

/**
 * ONE guide for a whole page, carrying every panel's sections under its own heading.
 *
 * Tre, 2026-08-18: *"put the guide for both sections in the same guide"*. A page's panels
 * are two views of one subject, and a reader who opens the guide from Overview usually
 * wants to know what the Accounts panel does too — the per-panel split meant the answer
 * was only reachable by switching panel first.
 *
 * ⚠️ This does NOT replace {@link resolveGuide}. The per-panel entries stay the source of
 * truth and are still what a panel-scoped caller reads; this only composes them, so the
 * copy cannot fork between the two readings.
 */
export function resolveSurfaceGuide(surface: GuideSurface): PageGuide {
  const sections = SURFACE_PANELS[surface].flatMap(({ key, label }) => {
    const guide = PAGE_GUIDES[key];
    // A panel listed with no guide registered is a gap, not a crash: skip it rather than
    // render a heading over nothing.
    if (!guide) return [];
    return guide.sections.map(section => ({ ...section, group: label }));
  });
  return { title: SURFACE_TITLE[surface], sections };
}
