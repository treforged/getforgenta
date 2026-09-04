// @vitest-environment jsdom
//
// TWELVE FILMABLE LINES, ALL OF THEM COMPUTED BY THE ENGINE FROM THE COMMITTED FIXTURE.
//
// Ruby's spec (`tre-forged-marketing/docs/DEMO-FIXTURE-SPEC.md`) asks for twelve distinct lines
// across at least four insight types, because one line is one post and the weekly loop films one
// product moment a week. `demo-marketing-lines.test.ts` guards the first type (promo repricing) and
// the fixture properties behind it. This file adds the other three and asserts the whole set.
//
// WHAT MAKES THIS DIFFERENT FROM A LIST OF SENTENCES. Every figure below is READ OUT OF the engine
// run — `runDemoForecastWithCards` renders the app's own card simulation and feeds it to the app's
// own forecast — so a fixture edit that moves a number moves the line, and a fixture edit that
// makes the app's strongest claim unreachable makes this file go red. That is the failure this
// exists to catch: an App Store image whose claim the product no longer computes, with nothing
// anywhere going red. The published asset is the thing that would be wrong, and it would be wrong
// silently and forever.
//
// ⚠️ THE FIXTURE IS NEVER TUNED TO PRODUCE A LINE. If a line stops computing, the LINE is dropped —
// the persona is not adjusted until the sentence comes back. See demo-data.ts's `demoProfile`.
//
// ON THE CLOCK. Every run is pinned to 2026-09-03. A filmed figure that moves with the wall clock
// is a figure nobody can reproduce next week, and the dates in these lines are the whole point.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { runDemoForecastWithCards, runDemoCardProjection } from './fixtures/demo-forecast-harness';
import { projectCard, calcMinPayment, type CardData } from '../credit-card-engine';
import { promoExpiryWarnings } from '../balance-tranches';
import { demoAccounts, demoRecurringRules, demoProfile } from '../demo-data';
import { formatCurrency } from '../calculations';

const NOW = new Date('2026-09-03T12:00:00');

/** scroll_stop.NUMBER, character for character. A count of months is deliberately NOT a figure
 *  under it — only money and rates are — which is why "8 months" rides free in a beat. */
const NUMBER = /\$[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?%/g;
const figures = (s: string) => s.match(NUMBER) ?? [];
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

const MAX_HOOK_WORDS = 12;
const MAX_HOOK_CHARS = 70;

/** One filmable line: the BEAT is what goes on screen, the FULL line is what the voiceover says. */
interface Line {
  type: string;
  beat: string;
  full: string;
}

const money = (n: number) => formatCurrency(n, false);
const money2 = (n: number) => formatCurrency(n, true);

/** A card from the fixture, as the standalone projector wants it. Minimum comes from the app's own
 *  `calcMinPayment` — the 2%/$25 formula — because the counterfactual being priced is "pay the
 *  minimum", not "pay whatever the converged plan decided". */
function minOnlyCard(a: Record<string, unknown>): CardData {
  const balance = Number(a.balance);
  const apr = Number(a.apr);
  return {
    id: String(a.id), name: String(a.name), balance, apr,
    creditLimit: Number(a.credit_limit),
    minPayment: calcMinPayment(balance, apr),
    targetPayment: calcMinPayment(balance, apr),
    monthlyNewPurchases: 0, monthlyRepayments: 0, color: '#000',
    paymentPreference: null, autopayFullBalance: false,
    dueDay: Number(a.payment_due_day) || null,
    statementBalancePhase: false, statementBalance: null,
    tranches: (a.balance_tranches as never) ?? undefined,
  };
}

const demoCards = () =>
  demoAccounts.filter(a => a.account_type === 'credit_card') as unknown as Record<string, unknown>[];

/** Every line, built from one engine run. Nothing here is a literal figure. */
function buildLines(): Line[] {
  const out: Line[] = [];
  const forecast = runDemoForecastWithCards(NOW);
  const rows = forecast.data as unknown as Record<string, unknown>[];

  // ── TYPE 1 · PROMO REPRICING ───────────────────────────────────────────────
  for (const card of demoCards()) {
    const tranches = (card.balance_tranches ?? []) as never[];
    for (const w of promoExpiryWarnings(tranches, Number(card.apr), '2026-09-03')) {
      const when = new Date(w.promoEndDate + 'T00:00:00')
        .toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      const shortWhen = when.replace(/, \d{4}$/, '');

      out.push({
        type: 'repricing',
        beat: `${money(w.balance)} reprices to ${w.standardApr}% on ${shortWhen}`,
        full: `${money(w.balance)} at ${w.promoApr}% reprices to ${w.standardApr}% on ${when}`
          + ` (+${money2(w.extraMonthlyInterest)}/mo) — clearing it first needs`
          + ` ${money(w.requiredMonthlyPaydown)}/mo for ${w.monthsRemaining} months`,
      });
      out.push({
        type: 'repricing',
        beat: `${money(w.balance)} has ${w.monthsRemaining} months of ${w.promoApr}% left`,
        full: `${money(w.balance)} has ${w.monthsRemaining} months of ${w.promoApr}% left. On ${when}`
          + ` it starts costing ${money2(w.extraMonthlyInterest)} a month in interest it does not cost today`,
      });
      out.push({
        type: 'repricing',
        beat: `${money(w.requiredMonthlyPaydown)}/mo beats the ${w.promoApr}% deadline`,
        full: `${money(w.requiredMonthlyPaydown)} a month clears the ${w.promoApr}% balance before`
          + ` ${when}. A dollar less and the remainder reprices to ${w.standardApr}%`,
      });
    }
  }

  // ── TYPE 2 · INTEREST LEAKAGE ON MINIMUMS ──────────────────────────────────
  // What the SAME balances cost if nothing changes. The counterfactual is the honest one: not
  // "you will save", which is banned outright, but "this is what minimums cost".
  const minOnly = demoCards().map(card => {
    const c = minOnlyCard(card);
    const p = projectCard(c, 360);
    return { name: c.name, balance: c.balance, apr: c.apr, min: c.minPayment, months: p.payoffMonth, interest: p.totalInterest };
  });
  for (const c of minOnly) {
    out.push({
      type: 'leakage',
      beat: `${money(c.min)}/mo minimums on a ${c.apr}% card`,
      full: `Paying the ${money(c.min)} minimum on ${money(c.balance)} at ${c.apr}% runs ${c.months} months`
        + ` and ${money(c.interest)} of interest`,
    });
  }
  const totalBalance = minOnly.reduce((s, c) => s + c.balance, 0);
  const totalInterest = minOnly.reduce((s, c) => s + c.interest, 0);
  out.push({
    type: 'leakage',
    // The beat deliberately spends only ONE figure, so scene 2 has the total interest to punch.
    beat: `${money(totalBalance)} of cards, on minimum payments`,
    full: `${money(totalBalance)} across two cards costs ${money(totalInterest)} in interest on minimum`
      + ` payments alone — more than the balance itself`,
  });

  // ── TYPE 3 · PAYOFF ACCELERATION ───────────────────────────────────────────
  // The milestone the engine itself publishes, against the minimum-only counterfactual above.
  const debtFree = forecast.milestones.find(m => m.event.includes('CC Debt Free'));
  const worst = minOnly.reduce((a, b) => (Number(b.months ?? 0) > Number(a.months ?? 0) ? b : a));
  const month0 = runDemoCardProjection(NOW) as unknown as { month0?: { safeToPayTotal: number; endCash: number } };

  if (debtFree) {
    out.push({
      type: 'acceleration',
      beat: `${money(totalBalance)} of cards, clear by ${debtFree.month.replace(/ \d{4}$/, '')}`,
      full: `${money(totalBalance)} of card debt clears in ${debtFree.month} on this plan — against`
        + ` ${worst.months} months of minimum payments on the ${worst.apr}% card alone`,
    });
    out.push({
      type: 'acceleration',
      beat: `${money(worst.interest)} of interest, or ${money(0)}`,
      full: `Minimums on the ${worst.apr}% card cost ${money(worst.interest)} in interest. The plan`
        + ` that clears both cards by ${debtFree.month} is the same money, aimed differently`,
    });
  }
  if (month0.month0) {
    out.push({
      type: 'acceleration',
      beat: `${money(month0.month0.safeToPayTotal)} to cards, floor still ${money(demoProfile.cash_floor)}`,
      full: `${money(month0.month0.safeToPayTotal)} goes to the cards this month and checking still`
        + ` ends at ${money(month0.month0.endCash)} — every dollar above the ${money(demoProfile.cash_floor)} floor, and not one below it`,
    });
  }

  // ── TYPE 4 · CASH FLOOR AND THE LUMPY MONTH ────────────────────────────────
  const headroom = rows.slice(0, 24).map((r, i) => ({
    i,
    month: String(r.month),
    head: Number(r.endingCash) - Number(r.monthMinSafe),
    floorItems: (r.floorItems ?? []) as { name: string; amount: number }[],
  }));
  const tightest = headroom.reduce((a, b) => (b.head < a.head ? b : a));
  out.push({
    type: 'cash-floor',
    beat: `${tightest.month.replace(/ \d{4}$/, '')} ends ${money2(tightest.head)} above your floor`,
    full: `${tightest.month} is the tightest month on this plan: it ends ${money2(tightest.head)} above the`
      + ` ${money(demoProfile.cash_floor)} floor, because everything above the floor already went to the cards`,
  });

  // The semiannual premium — the lump a month-by-month budget hides.
  const premium = demoRecurringRules.find(r => r.name.startsWith('Car Insurance'));
  const premiumRules = demoRecurringRules.filter(r => r.name.startsWith('Car Insurance'));
  const premiumMonths = premiumRules
    .map(r => new Date(`${r.start_date}T00:00:00`).toLocaleDateString('en-US', { month: 'long' }));
  const premiumYear = premiumRules.reduce((sum, r) => sum + Number(r.amount), 0);
  if (premium) {
    out.push({
      type: 'cash-floor',
      beat: `${money(premium.amount)} insurance, twice a year`,
      full: `The ${money(premium.amount)} insurance premium lands in ${premiumMonths.join(' and ')} — ${money(premiumYear)}`
        + ` a year, arriving in two months rather than twelve`,
    });
  }
  const rentFloor = headroom.find(h => h.floorItems.length > 0);
  if (rentFloor) {
    const item = rentFloor.floorItems[0];
    out.push({
      type: 'cash-floor',
      beat: `${money(item.amount)} of ${item.name} lands before the next paycheck`,
      full: `${money(item.amount)} of ${item.name} falls due before ${rentFloor.month}'s first paycheck, which is`
        + ` why the floor that month is ${money(Number(rows[rentFloor.i].monthMinSafe))} and not the ${money(demoProfile.cash_floor)} setting`,
    });
  }

  return out;
}

describe('the demo fixture produces a season of filmable lines', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('produces at least TWELVE distinct lines — a quarter of weekly filming', () => {
    const lines = buildLines();
    expect(lines.length).toBeGreaterThanOrEqual(12);
    expect(new Set(lines.map(l => l.full)).size).toBe(lines.length);
  });

  it('spans at least FOUR insight types, so the app is not seen doing one thing', () => {
    const types = new Set(buildLines().map(l => l.type));
    expect(types.size).toBeGreaterThanOrEqual(4);
    // Named rather than counted: a set of four that quietly became four repricing variants would
    // pass a count and fail the spec.
    for (const t of ['repricing', 'leakage', 'acceleration', 'cash-floor']) {
      expect(types).toContain(t);
    }
  });

  it('F1 — every beat carries one or two figures, never a third', () => {
    for (const l of buildLines()) {
      const n = figures(l.beat).length;
      expect(n, `beat has ${n} figures: ${l.beat}`).toBeGreaterThanOrEqual(1);
      expect(n, `beat has ${n} figures: ${l.beat}`).toBeLessThanOrEqual(2);
    }
  });

  it('F5 — every beat fits the frame: 12 words, 70 characters', () => {
    for (const l of buildLines()) {
      expect(words(l.beat).length, l.beat).toBeLessThanOrEqual(MAX_HOOK_WORDS);
      expect(l.beat.length, l.beat).toBeLessThanOrEqual(MAX_HOOK_CHARS);
    }
  });

  it('F6 — every full line leaves a figure the beat has not spent', () => {
    for (const l of buildLines()) {
      const spent = new Set(figures(l.beat));
      const fresh = figures(l.full).filter(f => !spent.has(f));
      expect(fresh.length, `nothing fresh for scene 2 in: ${l.full}`).toBeGreaterThan(0);
    }
  });

  it('F2 — the reprice line and the cash-floor line each carry a figure AND a date', () => {
    // Sam's condition, 2026-09-03, and the two types it names are the two that would be worth
    // publishing and worthless without a date on them.
    const lines = buildLines();
    for (const type of ['repricing', 'cash-floor']) {
      const line = lines.find(l => l.type === type)!;
      expect(line, `no ${type} line at all`).toBeTruthy();
      expect(figures(line.full).length, line.full).toBeGreaterThan(0);
      expect(
        /[A-Z][a-z]{2,8} \d{1,2}, \d{4}|[A-Z][a-z]{2} \d{4}|January|February|March|April|May|June|July|August|September|October|November|December/.test(line.full),
        `no date in: ${line.full}`,
      ).toBe(true);
    }
  });

  it('BANNED — no line promises anything', () => {
    const banned = ['guaranteed', 'risk-free', 'risk free', 'you will save', "you'll save",
      'double your money', 'get rich', 'beat the market', 'financial advice'];
    for (const l of buildLines()) {
      for (const b of banned) {
        expect(l.full.toLowerCase(), l.full).not.toContain(b);
      }
    }
  });

  it('the ENGINE still says the things the lines quote — the fixture has not gone weak', () => {
    const forecast = runDemoForecastWithCards(NOW);
    // 1. The cards are actually retired inside the horizon. A fixture whose debt grows forever
    //    makes every acceleration line unfilmable and says the product does not work.
    expect(forecast.milestones.some(m => m.event.includes('CC Debt Free'))).toBe(true);
    // 2. No projected month breaches its floor. The floor holding is the claim; a breach here is
    //    a persona the app cannot help, not a better demo.
    const rows = forecast.data as unknown as Record<string, unknown>[];
    expect(rows.slice(0, 24).every(r => r.belowSafeMinimum !== true)).toBe(true);
    // 3. There is still a promo to reprice. This is the one that silently disappeared before
    //    2026-09-03, when the fixture had no tranches at all.
    const warnings = demoCards().flatMap(c =>
      promoExpiryWarnings((c.balance_tranches ?? []) as never[], Number(c.apr), '2026-09-03'));
    expect(warnings.length).toBeGreaterThan(0);
    // 4. Minimum payments are genuinely ruinous on this fixture — the leakage lines depend on it.
    const worst = demoCards()
      .map(c => projectCard(minOnlyCard(c), 360))
      .reduce((a, b) => (b.totalInterest > a.totalInterest ? b : a));
    expect(worst.totalInterest).toBeGreaterThan(1000);
  });

  it('the persona is still someone the app is FOR — thin surplus, real debt', () => {
    // The 2026-09-03 rebuild replaced a persona saving ~$2,800/mo while revolving $6,482 at 24.74%.
    // These two bounds are what stop that drifting back: a demo whose owner is rich has no problem
    // to solve on camera, and one who is insolvent cannot be helped on camera either.
    const netMonthly = demoProfile.weekly_gross_income * 4.33 * (1 - demoProfile.tax_rate / 100);
    expect(netMonthly).toBeGreaterThan(2500);
    expect(netMonthly).toBeLessThan(4500);
    const cardDebt = demoCards().reduce((s, c) => s + Number(c.balance), 0);
    expect(cardDebt).toBeGreaterThan(3000);
  });
});
