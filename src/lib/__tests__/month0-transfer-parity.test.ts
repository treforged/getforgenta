// @vitest-environment jsdom
//
// DASHBOARD AND FORECAST MUST MOVE TRANSFER MONEY THE SAME WAY (ask "transfer parity", the follow-up
// of b80124a0 / 5810a568).
//
// Two gaps between useCardProjection and forecast-engine.ts:
//   1. MONTH 0: a transfer from savings INTO the funding checking account is cash in. The engine adds
//      what the source really gave (`nonCashIntoFunding`, step 4b-ii); the hook's month-0 chain
//      added nothing, so the Dashboard ended month 0 below the Forecast by the transfer.
//   2. MONTHS 1+: the sim's walk charged EVERY transfer rule to checking, including one whose money
//      leaves a second checking account. The engine charges checking only when checking sends it.
//
// SYNTHETIC DATA ONLY: the committed demo persona, plus (case b) one synthetic savings account.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { runDemoCardProjection, demoForecastInputs } from './fixtures/demo-forecast-harness';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import type { ForecastInputs } from '@/lib/forecast-engine';
import type { CardProjectionResult } from '@/hooks/useCardProjection';
import { month0DrawerChainLines } from '@/lib/month0-drawer-lines';
import { buildMonth0Snapshot, foldSnapshotRows } from '@/lib/month0-budget-snapshot';
import { demoAccounts, demoProfile, demoRecurringRules } from '../demo-data';

const NOW = new Date('2026-09-10T12:00:00');
/** A $400 monthly transfer, due the 20th: after the 2026-09-10 sync date, so it is still to come. */
const XFER = 400;
/** The dry savings account's synced balance: it can give only this much of the $400. */
const DRY_BALANCE = 100;

const rule = (over: Record<string, unknown>) => ({
  user_id: 'demo', due_month: null, start_date: '2026-01-01', end_date: null, deposit_account: null,
  active: true, notes: '', created_at: '', updated_at: '', ...over,
});
const transfer = (id: string, from: string, to: string, startDate: string) => rule({
  id, name: id, amount: XFER, rule_type: 'transfer', frequency: 'monthly', due_day: 20,
  category: 'Transfer', payment_source: from, deposit_account: to, start_date: startDate,
});
const drySavings = {
  id: 'drysav', user_id: 'demo', name: 'Dry Savings', account_type: 'savings', institution: 'Synthetic',
  balance: DRY_BALANCE, credit_limit: null, apr: null, active: true, notes: '', created_at: '', updated_at: '',
};

function setup(extraRules: Record<string, unknown>[], extraAccounts: Record<string, unknown>[] = []) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const accounts = [...demoAccounts, ...extraAccounts];
  const rules = [...demoRecurringRules, ...extraRules];
  const cp = runDemoCardProjection(NOW, { profile: demoProfile, rules, accounts });
  const base = demoForecastInputs({ now: NOW, cardProjection: cp, rules: rules as never });
  const inputs = { ...base, accounts } as unknown as ForecastInputs;
  return { cp, inputs };
}

function converge(extraRules: Record<string, unknown>[], extraAccounts: Record<string, unknown>[] = []) {
  const { cp, inputs } = setup(extraRules, extraAccounts);
  const out = runDebtCashConvergence(cp as unknown as CardProjectionResult, inputs);
  vi.useRealTimers();
  return out;
}

/** Fold the drawer's lines the way a reader does, top to bottom, and return every '=' checkpoint. */
function foldDrawer(m0: NonNullable<CardProjectionResult['month0']>, monthEndCash: number) {
  const lines = month0DrawerChainLines(m0, monthEndCash);
  let run = 0;
  const checkpoints: { label: string; folded: number; shown: number }[] = [];
  for (const l of lines) {
    if (l.op === undefined) run = l.amount;
    else if (l.op === '+') run += l.amount;
    else if (l.op === '−') run -= l.amount;
    else checkpoints.push({ label: l.label, folded: run, shown: l.amount });
  }
  return { lines, checkpoints };
}

describe('transfer parity: Dashboard == Forecast for money moved between accounts', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('(a) month 0: savings -> funding checking is cash in on both surfaces, to the cent', () => {
    const out = converge([transfer('sav-to-chk', 'd3', 'd1', '2026-09-01')]);
    const row = out.projections.data[0];
    // Positive control: the engine really credits checking with the transfer in month 0.
    expect(row.nonCashIntoFunding).toBeCloseTo(XFER, 2);
    const m0 = out.cardProjection.month0!;
    expect(m0.chain.nonCashIntoFunding).toBeCloseTo(XFER, 2);
    expect(
      Math.abs(m0.endCash - row.rawEndingCash),
      `Dashboard $${m0.endCash.toFixed(2)} vs Forecast $${row.rawEndingCash.toFixed(2)}`,
    ).toBeLessThanOrEqual(0.01);
    // The drawer names the inflow and its walk reconciles to the cent at every checkpoint.
    const { lines, checkpoints } = foldDrawer(m0, m0.endCash);
    expect(lines.find(l => l.key === 'nonCashIntoFunding')?.amount).toBeCloseTo(XFER, 2);
    expect(lines.find(l => l.key === 'unfundedAccountOutflow')).toBeUndefined();
    expect(checkpoints.map(c => c.label)).toEqual(['Cash before debt payments', 'Projected Month-End Cash']);
    for (const c of checkpoints) expect(Math.abs(c.folded - c.shown), c.label).toBeLessThanOrEqual(0.005);
    expect(checkpoints[0].shown).toBeCloseTo(m0.chain.cashPreDebt, 2);
    // The Budget snapshot reads the same chain, and its column must fold too.
    const snap = buildMonth0Snapshot(m0);
    expect(snap.rows.find(r => r.key === 'nonCashIntoFunding')?.value).toBeCloseTo(XFER, 2);
    for (const cp of foldSnapshotRows(snap.rows).checkpoints) {
      expect(Math.abs(cp.expected - cp.actual), cp.key).toBeLessThanOrEqual(0.005);
    }
  }, 120_000);

  it('(b) month 0: a dry savings source gives only what it holds, on both surfaces', () => {
    const out = converge([transfer('dry-to-chk', 'drysav', 'd1', '2026-09-01')], [drySavings]);
    const row = out.projections.data[0];
    expect(row.nonCashIntoFunding).toBeCloseTo(DRY_BALANCE, 2);
    const m0 = out.cardProjection.month0!;
    expect(m0.chain.nonCashIntoFunding).toBeCloseTo(DRY_BALANCE, 2);
    expect(
      Math.abs(m0.endCash - row.rawEndingCash),
      `Dashboard $${m0.endCash.toFixed(2)} vs Forecast $${row.rawEndingCash.toFixed(2)}`,
    ).toBeLessThanOrEqual(0.01);
    const { checkpoints } = foldDrawer(m0, m0.endCash);
    for (const c of checkpoints) expect(Math.abs(c.folded - c.shown), c.label).toBeLessThanOrEqual(0.005);
  }, 120_000);

  it('(c) months 1+: a transfer out of a second checking account is not charged to checking', () => {
    // Harborline Checking (d2) -> Ridgeway Savings (d3), $400 a month from October: month 0 has none.
    const xfer = [transfer('chk2-to-sav', 'd2', 'd3', '2026-10-01')];
    // The bare sim, before any convergence: its card payments must not move, because checking
    // does not send this money.
    const { cp: simWithout } = setup([]);
    vi.useRealTimers();
    const { cp: simWith } = setup(xfer);
    vi.useRealTimers();
    expect(simWith.debtPaymentTotals.length).toBeGreaterThan(12);
    expect(simWith.debtPaymentTotals).toEqual(simWithout.debtPaymentTotals);

    const without = converge([]);
    const withX = converge(xfer);
    // Positive control: the engine lists the transfer as leaving d2 in month 1, so the rule is live.
    expect(withX.projections.data[1].nonCashTransferItems.filter(t => t.fromAcctId === 'd2').map(t => t.amount))
      .toEqual([XFER]);
    // The funding account's cash, every month, is unchanged by it.
    const cashWith = withX.projections.data.map(r => Math.round(r.rawEndingCash * 100));
    const cashWithout = without.projections.data.map(r => Math.round(r.rawEndingCash * 100));
    expect(cashWith).toEqual(cashWithout);
    expect(withX.cardProjection.simRevolvingPayoffMonth).toBe(without.cardProjection.simRevolvingPayoffMonth);
  }, 240_000);

  it('drawer: an unfunded other-account bill is its own line and the walk still reconciles', () => {
    // An empty second checking account paying $300 of bills on the 15th: checking pays all $300.
    const ops = { ...drySavings, id: 'ops', name: 'Operations', account_type: 'checking', balance: 0 };
    const out = converge([rule({
      id: 'ops-bills', name: 'Ops Bills', amount: 300, rule_type: 'expense', frequency: 'monthly', due_day: 15,
      category: 'Software', payment_source: 'account:ops', start_date: '2026-09-01',
    })], [ops]);
    const m0 = out.cardProjection.month0!;
    const { lines, checkpoints } = foldDrawer(m0, m0.endCash);
    expect(lines.find(l => l.key === 'unfundedAccountOutflow')?.amount).toBeCloseTo(300, 2);
    expect(lines.find(l => l.key === 'nonCashIntoFunding')).toBeUndefined();
    for (const c of checkpoints) expect(Math.abs(c.folded - c.shown), c.label).toBeLessThanOrEqual(0.005);
  }, 120_000);
});
