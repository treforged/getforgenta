/**
 * The Learn catalogue.
 *
 * CONTENT IS CODE, NOT ROWS. There is no author but us and no CMS, so a lessons table would be a
 * public read surface to get the grants wrong on for no benefit. What is per-user — when a lesson
 * was read, and therefore which badge is earned — lives in `learn_progress` (see
 * `20260902_notification_prefs_and_learn.sql`).
 *
 * Rules these lessons follow, because a finance lesson that breaks them is worse than none:
 *   - every lesson names a number the reader can check against their own screen;
 *   - the takeaway is something doable TODAY, in this app, not a life plan;
 *   - no product recommendations, no ticker symbols, no "you should invest in";
 *   - nothing that reads as personalized advice about the reader's own portfolio.
 *
 * Order is the teaching order: Foundations first, because a reader who skips to Investing without
 * a floor is being taught to gamble.
 */

export type LearnTrack = 'Foundations' | 'Debt' | 'Saving' | 'Investing';

export interface LearnLesson {
  id: string;
  title: string;
  track: LearnTrack;
  /** Reading time, honest to within a minute — it is on the card, and a lie there is cheap to catch. */
  minutes: number;
  summary: string;
  /** Paragraphs. Kept short deliberately: this is a two-minute read on a phone, not an article. */
  body: readonly string[];
  takeaway: string;
  /** The badge earned by finishing it. One lesson, one badge, no compound achievements. */
  achievement: { name: string; description: string };
}

export const LEARN_LESSONS: readonly LearnLesson[] = [
  {
    id: 'what-a-cash-floor-is',
    title: 'What a cash floor is',
    track: 'Foundations',
    minutes: 2,
    summary: 'The number under which your checking account should never go, and why it is not zero.',
    body: [
      'A cash floor is the balance you treat as the bottom of the tank. Not the balance you have — the one you refuse to spend past.',
      'Zero is the wrong floor. Every account has payments in flight that have not cleared yet: a card autopay, a subscription, a check nobody has cashed. Land on zero and those become overdraft fees, which is the most expensive money there is.',
      'A workable first floor is one to two weeks of ordinary spending. Enough that a bill arriving three days early is an inconvenience rather than an incident.',
      'Forgenta compares every projected month against this number. That is the whole reason it warns you before a bill instead of after.',
    ],
    takeaway: 'Open Settings and set your cash floor to about two weeks of spending.',
    achievement: { name: 'Floor Set', description: 'Learned what a cash floor is and why zero is not one.' },
  },
  {
    id: 'fixed-versus-variable',
    title: 'Fixed vs variable spending',
    track: 'Foundations',
    minutes: 2,
    summary: 'Only one of these can be cut this month, and it is not the one people try first.',
    body: [
      'Fixed costs are the ones that arrive whether you act or not: rent, insurance, the car payment, subscriptions you forgot. Variable costs are decided each time: food out, fuel, groceries.',
      'People try to fix a tight month by cutting variable spending, because it feels like the part they control. It is also the smallest and the most exhausting to hold.',
      'Fixed costs are cut once and stay cut. Canceling one $15 subscription is worth more over a year than two weeks of skipped coffees, and you only have to decide it a single time.',
      'The trap is that fixed costs are invisible. They do not feel like a decision, so they never get re-decided.',
    ],
    takeaway: 'List your recurring charges and cancel the first one you cannot justify out loud.',
    achievement: { name: 'Fixed Cost Hunter', description: 'Learned why fixed costs are the ones worth cutting.' },
  },
  {
    id: 'pay-yourself-first',
    title: 'Pay yourself first',
    track: 'Saving',
    minutes: 2,
    summary: 'Saving what is left over does not work, for a reason that has nothing to do with discipline.',
    body: [
      'Saving whatever survives the month is a plan that puts your savings last in a queue that always finds another claimant. Most months nothing survives, and it feels like a personal failure rather than a design one.',
      'Moving the money on payday inverts the queue. The month then adapts to what is left, which it does surprisingly well, because spending expands to fill whatever is visible.',
      'Start with an amount small enough that you would not fight it — 5% of a paycheck is a real start. An amount you cancel in month two is worth less than a smaller one you keep for a year.',
      'Automate it. A transfer that requires you to remember is a transfer that competes with the rest of your life every single month.',
    ],
    takeaway: 'Set up one automatic transfer on payday, even if it is small.',
    achievement: { name: 'First in Line', description: 'Learned to move savings before spending, not after.' },
  },
  {
    id: 'emergency-fund-size',
    title: 'How big an emergency fund',
    track: 'Saving',
    minutes: 3,
    summary: 'Three to six months is the usual answer. What decides where you land is your income, not your spending.',
    body: [
      'An emergency fund is measured in months of essential spending — housing, food, transport, minimum debt payments — not months of your whole budget.',
      'Three months suits a stable salary, two earners, or a field where you would be re-hired quickly. Six or more suits variable income, self-employment, a single earner, or a specialized job with few local employers.',
      'Build it in stages or you will never start. One month of essentials is the first real milestone, and it already covers most of what actually goes wrong: a car, a water heater, a deductible.',
      'Keep it somewhere boring and instant. An emergency fund in something that can fall 20% is not an emergency fund, because emergencies and market drops arrive together more often than chance would suggest.',
    ],
    takeaway: 'Work out one month of essential spending and make that your first savings goal.',
    achievement: { name: 'Buffer Built', description: 'Learned how to size an emergency fund to your own income.' },
  },
  {
    id: 'minimum-payments-trap',
    title: 'The minimum payment trap',
    track: 'Debt',
    minutes: 3,
    summary: 'A minimum payment is designed to be affordable, which is exactly what makes it expensive.',
    body: [
      'A card minimum is typically 1–3% of the balance, set so the payment is comfortable. Comfortable means slow, and slow on a 22% APR means most of what you pay is interest.',
      'The arithmetic is worth doing once. $3,000 at 22%, paying only a 2% minimum, takes over twenty years and costs more in interest than the original balance. The same $3,000 at a flat $150 a month clears in about two years.',
      'The lever is not the rate, it is the fixed payment. A minimum shrinks as the balance shrinks, so the finish line moves away from you as you approach it. A fixed amount does not.',
      'This is why paying $20 more than the minimum, every month, changes the outcome far more than it looks like it should.',
    ],
    takeaway: 'Pick one card and set a fixed monthly payment above its minimum.',
    achievement: { name: 'Minimum Breaker', description: 'Learned why a shrinking minimum payment never finishes.' },
  },
  {
    id: 'avalanche-vs-snowball',
    title: 'Avalanche vs snowball',
    track: 'Debt',
    minutes: 2,
    summary: 'One method is cheaper. The other is the one more people finish.',
    body: [
      'Avalanche: pay minimums everywhere, and put every spare dollar at the HIGHEST interest rate. It costs the least in total interest. It is mathematically correct.',
      'Snowball: pay minimums everywhere, and put every spare dollar at the SMALLEST balance. It costs a little more, and it clears whole accounts early.',
      'The gap between them is usually smaller than people expect — often a few percent of total interest. The gap between a method you finish and one you abandon is the entire balance.',
      'If you have three debts and no momentum, snowball. If you have one very expensive debt, avalanche and do not overthink it.',
    ],
    takeaway: 'Open Debt Payoff and order your debts by the method you will actually keep to.',
    achievement: { name: 'Method Chosen', description: 'Learned the real trade-off between avalanche and snowball.' },
  },
  {
    id: 'credit-utilisation',
    title: 'Why 30% utilisation matters',
    track: 'Debt',
    minutes: 2,
    summary: 'Your score reacts to the balance reported on the statement date, not the one you end up paying.',
    body: [
      'Utilisation is your reported balance divided by your limit. It is a large part of a credit score and, unlike payment history, it resets every month — good and bad.',
      'The number that gets reported is usually the statement balance, not what you owe after you pay it. So someone who spends $900 on a $1,000 card and clears it in full still reports 90% utilisation.',
      'Under about 30% is the usual guidance, and under 10% is where the scoring stops arguing with you. Two ways to get there: pay before the statement date, or ask for a higher limit and do not use it.',
      'Closing an old card raises utilisation, because the limit disappears and the balances do not. That is why the advice is to keep old cards open and idle.',
    ],
    takeaway: 'Check one card\'s statement date and make a payment before it, not after.',
    achievement: { name: 'Utilisation Aware', description: 'Learned which balance a credit score actually sees.' },
  },
  {
    id: 'sinking-funds',
    title: 'Sinking funds',
    track: 'Saving',
    minutes: 2,
    summary: 'Most "emergencies" are annual bills you have known about for eleven months.',
    body: [
      'Car insurance, vehicle registration, the holidays, the service, the renewal. None of these are surprises. They only feel like surprises because they are large and arrive on one day.',
      'A sinking fund converts a known lump into a monthly line. $600 of insurance is $50 a month you were going to spend anyway; the only change is when you notice it.',
      'It also protects the emergency fund, which is the point. Spending your buffer on a bill you could see coming leaves nothing for the thing you could not.',
      'Add up the annual ones once, divide by twelve, and treat that as a fixed cost.',
    ],
    takeaway: 'Add one annual bill as a savings goal with its real due date.',
    achievement: { name: 'No More Surprises', description: 'Learned to turn annual bills into monthly ones.' },
  },
  {
    id: 'lifestyle-creep',
    title: 'Lifestyle creep',
    track: 'Foundations',
    minutes: 2,
    summary: 'A raise that raises spending by the same amount leaves you exactly where you were, with more to lose.',
    body: [
      'Spending rises to meet income almost automatically, and it does it through decisions that are each individually reasonable. That is what makes it hard to see.',
      'The cost is not the nicer apartment. It is that your required income went up, so the same job loss now hurts more and your emergency fund covers fewer months than it did before.',
      'The standard defence is to split a raise: half to life, half to the gap between what you earn and what you spend. You feel the raise, and your floor rises with it.',
      'The moment to decide is the month the raise lands. After three months the new spending is just normal.',
    ],
    takeaway: 'Next time your income rises, move half of the increase before you see it.',
    achievement: { name: 'Creep Resistant', description: 'Learned to split a raise before it becomes normal.' },
  },
  {
    id: 'compounding-basics',
    title: 'What compounding actually does',
    track: 'Investing',
    minutes: 3,
    summary: 'The interesting part of compounding happens late, which is why starting early beats saving more.',
    body: [
      'Compounding means returns earn returns. At 7% a year, money roughly doubles every ten years — the useful rule is 72 divided by the rate.',
      'That rule is what makes time the dominant variable. $200 a month from age 25 to 65 finishes far ahead of $400 a month from 45 to 65, despite the second person contributing more of their own money.',
      'It also explains why the early years feel like nothing is happening. Almost all of the growth arrives in the final third, so the discouraging stretch is the one that has to be survived.',
      'The same math runs in reverse on debt. A 22% card compounds against you at the same relentlessness, which is why clearing it beats investing while it exists.',
    ],
    takeaway: 'Work out one doubling for your own savings rate using the rule of 72.',
    achievement: { name: 'Compounding Clicked', description: 'Learned why time beats contribution size.' },
  },
  {
    id: 'employer-match',
    title: 'The employer match',
    track: 'Investing',
    minutes: 2,
    summary: 'A 401(k) match is an immediate return no market can offer, and it is the one people skip.',
    body: [
      'If an employer matches your 401(k) contributions up to some percentage, that match is part of your pay. Contributing less than the match means declining salary you have already earned.',
      'A 100% match is a 100% return on the day it lands, before any investment growth at all. Nothing else in personal finance pays that.',
      'The contribution also comes out before tax in most plans, so the take-home cost of putting in $100 is meaningfully less than $100.',
      'One caveat worth checking: vesting. Some matches only become yours after a period of service, which is worth knowing before a job move rather than after.',
    ],
    takeaway: 'Check your 401(k) contribution rate and confirm it reaches the full match.',
    achievement: { name: 'Match Secured', description: 'Learned that an unclaimed match is declined pay.' },
  },
  {
    id: 'reading-your-own-numbers',
    title: 'Reading your own numbers',
    track: 'Foundations',
    minutes: 2,
    summary: 'Three figures tell you almost everything. Checking them weekly beats a perfect budget monthly.',
    body: [
      'Net worth: everything you own minus everything you owe. It is the only figure that cannot be flattered by a good month, and its direction matters far more than its size.',
      'Cash flow: money in minus money out this month. Positive and dull is the target. A single bad month is noise; three in a row is a trend.',
      'Runway: how long your cash lasts at current spending if income stopped. This is the one that turns an abstract balance into a number of weeks.',
      'A weekly look at three numbers you understand beats a detailed budget you review twice a year. Consistency is the whole mechanism — the tracking is what changes behaviour, not the spreadsheet.',
    ],
    takeaway: 'Look at your net worth and cash flow now, and again next week.',
    achievement: { name: 'Numbers Read', description: 'Learned the three figures worth checking every week.' },
  },
];

export const LESSON_COUNT = LEARN_LESSONS.length;

export function lessonById(id: string): LearnLesson | undefined {
  return LEARN_LESSONS.find(lesson => lesson.id === id);
}

/**
 * The next lesson to offer: the first unread one in teaching order.
 *
 * Order matters more than novelty here — a reader dropped into Investing before Foundations has
 * been taught the fun part without the part that keeps them solvent. Returns null when every
 * lesson has been read, and the UI says so rather than inventing a thirteenth.
 */
export function nextUnreadLesson(readIds: readonly string[]): LearnLesson | null {
  const read = new Set(readIds);
  return LEARN_LESSONS.find(lesson => !read.has(lesson.id)) ?? null;
}
