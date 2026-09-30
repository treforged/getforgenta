// "What would cover this" — for a forecast with months ending below their cash floor, rank the
// user's OWN recurring savings moves by how many dollars of that shortfall each one covers.
//
// ⚠️ EVERY FIGURE HERE IS AN ENGINE RE-RUN, NEVER AN ESTIMATE. Each candidate is removed on its
// own and the caller's `run` re-runs the forecast; coveredDollars is the measured drop in the
// total shortfall. The caller decides what `run` is — in the app that is runDebtCashConvergence
// against the provider's existing card projection.
//
// ⚠️ ONLY TWO LEVER KINDS, AND THAT LIMIT IS MEASURED, NOT CAUTIOUS. On Tre's 2026-09-29 capture,
// pausing a goal or a funding-account transfer gave the SAME month-end cash whether the card sim
// was re-rendered or held fixed (every month, to the dollar). Removing a card-charged expense did
// not: held fixed, the engine showed no change at all, because the card sim owns those charges.
// So card-charged expenses are not offered — a lever this helper cannot measure is not a lever.
//
// Deliberately NOT offered (Sam, 2026-09-29): anything touching retirement (a paycheck deduction
// is invisible to the engine, and pausing retirement is never a default suggestion), anything
// that pushes card payoff later (that adds interest), and third-party arrangements such as a
// deposit or a lender — the app cannot know a lease or a contract.
//
// Read-only: builds new input objects and never writes anywhere.

import type { ForecastInputs, ForecastResult } from '@/lib/forecast-engine';
import { ACCOUNT_TYPE_GROUP } from '@/lib/net-worth';

const DEFAULT_HORIZON_MONTHS = 12;
const DEFAULT_MAX_LEVERS = 3;
/** A lever must cover at least this much, so float residue never reads as a suggestion. */
const MIN_COVERED_DOLLARS = 0.5;
const CENT = 0.005;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type BreachLeverKind = 'pause_goal' | 'pause_transfer';

export interface MonthShortfall { month: string; shortfall: number }

export interface BreachLever {
  kind: BreachLeverKind;
  id: string;
  name: string;
  monthlyAmount: number;
  /** Measured drop in the total shortfall across the horizon. */
  coveredDollars: number;
  /** Total shortfall left with this lever applied. */
  shortfallAfter: number;
  /** Months that are short today and are not short with this lever applied. */
  monthsCleared: string[];
  /** For a transfer: the expense rules its destination account pays. Pausing the transfer does
   * not cancel those, so the UI must say so rather than present the transfer as free money. */
  paysRules: string[];
}

export type ExcludedReason =
  | 'retirement' | 'funded_by_rule' | 'not_from_funding_account' | 'no_effect' | 'delays_debt_payoff';

export interface ExcludedLever { name: string; reason: ExcludedReason }

export interface BreachLeverReport {
  months: MonthShortfall[];
  totalShortfall: number;
  levers: BreachLever[];
  excluded: ExcludedLever[];
}

type Row = Record<string, unknown>;
type Candidate = Omit<BreachLever, 'coveredDollars' | 'shortfallAfter' | 'monthsCleared'> & {
  apply: (inputs: ForecastInputs) => ForecastInputs;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const sumShortfall = (ms: MonthShortfall[]) => round2(ms.reduce((s, m) => s + m.shortfall, 0));

/** Months 1..horizonMonths (month 0 is the live month and is skipped) ending below their floor. */
export function shortfallByMonth(result: ForecastResult, horizonMonths: number): MonthShortfall[] {
  const last = Math.min(horizonMonths, result.data.length - 1);
  const out: MonthShortfall[] = [];
  // e3566eab: an account-paid expense its own account cannot cover is paid from checking, and that
  // cash stays spent, so the unfunded dollars are charged to their month AND every month after it.
  let unfundedSoFar = result.data[0]?.unfundedAccountOutflow ?? 0;
  for (let i = 1; i <= last; i++) {
    const row = result.data[i];
    unfundedSoFar += row.unfundedAccountOutflow ?? 0;
    const shortfall = row.monthMinSafe - (row.endingCash - unfundedSoFar);
    if (shortfall > CENT) out.push({ month: row.month, shortfall: round2(shortfall) });
  }
  return out;
}

/** 'Sep 2029' -> a sortable month number; NaN for anything else. */
function monthIndex(label: string | undefined): number {
  const [mon, year] = String(label ?? '').split(' ');
  const m = MONTHS.indexOf(mon);
  const y = Number(year);
  return m < 0 || !Number.isFinite(y) ? NaN : y * 12 + m;
}

function payoffMonth(result: ForecastResult): string | undefined {
  return result.milestones?.find(m => m.event.startsWith('CC Debt Free'))?.month;
}

/** True when `after` pays the cards off later than `base`, or no longer pays them off at all. */
function delaysPayoff(base: ForecastResult, after: ForecastResult): boolean {
  const b = monthIndex(payoffMonth(base));
  if (Number.isNaN(b)) return false;
  const a = monthIndex(payoffMonth(after));
  return Number.isNaN(a) || a > b;
}

function buildCandidates(inputs: ForecastInputs): { candidates: Candidate[]; excluded: ExcludedLever[] } {
  const accounts = (inputs.accounts ?? []) as unknown as Row[];
  const typeOf = new Map(accounts.map(a => [String(a.id), String(a.account_type ?? '')]));
  const isRetirement = (accountId: unknown) =>
    accountId != null && ACCOUNT_TYPE_GROUP[typeOf.get(String(accountId)) ?? ''] === 'Retirement';

  const candidates: Candidate[] = [];
  const excluded: ExcludedLever[] = [];

  for (const g of (inputs.goals ?? []) as Row[]) {
    const monthly = Number(g.monthly_contribution ?? 0);
    if (!(monthly > 0) && g.auto_extra !== true) continue;
    const name = String(g.name ?? '');
    if (isRetirement(g.linked_account) || String(g.goal_type ?? '').toLowerCase().includes('retire')) {
      excluded.push({ name, reason: 'retirement' });
      continue;
    }
    if (Array.isArray(g.linked_rule_ids) && g.linked_rule_ids.length > 0) {
      excluded.push({ name, reason: 'funded_by_rule' });
      continue;
    }
    const id = String(g.id);
    candidates.push({
      kind: 'pause_goal', id, name, monthlyAmount: round2(monthly), paysRules: [],
      apply: inp => ({
        ...inp,
        goals: inp.goals.map(x => (String(x.id) === id ? { ...x, monthly_contribution: 0, auto_extra: false } : x)),
      }),
    });
  }

  const rules = (inputs.rules ?? []) as unknown as Row[];
  for (const r of rules) {
    if (r.active === false || (r.rule_type !== 'transfer' && r.rule_type !== 'investment')) continue;
    const name = String(r.name ?? '');
    if (isRetirement(r.deposit_account)) {
      excluded.push({ name, reason: 'retirement' });
      continue;
    }
    if (!inputs.forecastFundingAccountId || r.payment_source !== inputs.forecastFundingAccountId) {
      excluded.push({ name, reason: 'not_from_funding_account' });
      continue;
    }
    const id = String(r.id);
    const paysRules = rules
      .filter(x => x.active !== false && x.rule_type === 'expense'
        && r.deposit_account != null && x.payment_source === r.deposit_account)
      .map(x => String(x.name ?? ''));
    candidates.push({
      kind: 'pause_transfer', id, name, monthlyAmount: round2(Number(r.amount ?? 0)), paysRules,
      apply: inp => ({ ...inp, rules: inp.rules.filter(x => String(x.id) !== id) }),
    });
  }

  return { candidates, excluded };
}

/**
 * Rank the user's own savings goals and funding-account transfers by the dollars of floor
 * shortfall each would cover if paused, each measured by a real re-run through `run`.
 * Returns an empty report without building any candidate when nothing is short.
 */
export function rankBreachLevers(
  inputs: ForecastInputs,
  run: (inputs: ForecastInputs) => ForecastResult,
  opts: { horizonMonths?: number; maxLevers?: number } = {},
): BreachLeverReport {
  const horizon = opts.horizonMonths ?? DEFAULT_HORIZON_MONTHS;
  const maxLevers = opts.maxLevers ?? DEFAULT_MAX_LEVERS;

  const base = run(inputs);
  const months = shortfallByMonth(base, horizon);
  const totalShortfall = sumShortfall(months);
  if (totalShortfall === 0) return { months: [], totalShortfall: 0, levers: [], excluded: [] };

  const { candidates, excluded } = buildCandidates(inputs);
  const levers: BreachLever[] = [];

  for (const { apply, ...c } of candidates) {
    const after = run(apply(inputs));
    if (delaysPayoff(base, after)) {
      excluded.push({ name: c.name, reason: 'delays_debt_payoff' });
      continue;
    }
    const afterMonths = shortfallByMonth(after, horizon);
    const shortfallAfter = sumShortfall(afterMonths);
    const coveredDollars = round2(totalShortfall - shortfallAfter);
    if (coveredDollars < MIN_COVERED_DOLLARS) {
      excluded.push({ name: c.name, reason: 'no_effect' });
      continue;
    }
    const stillShort = new Set(afterMonths.map(m => m.month));
    levers.push({
      ...c, coveredDollars, shortfallAfter,
      monthsCleared: months.filter(m => !stillShort.has(m.month)).map(m => m.month),
    });
  }

  levers.sort((a, b) => b.coveredDollars - a.coveredDollars || a.name.localeCompare(b.name));
  return { months, totalShortfall, levers: levers.slice(0, maxLevers), excluded };
}
