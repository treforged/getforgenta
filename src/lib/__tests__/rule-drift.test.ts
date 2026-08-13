// §1B Stage 7B — rule drift. Synthetic values only (AGENT.md: nothing derived from real data).
//
// The two shapes these are built around are the REAL failures, restated with invented numbers:
// a rent-sized bill drifting a few percent above a stale rule, and a utility that has doubled.
import { describe, it, expect } from 'vitest';
import { detectRuleDrift, detectAllRuleDrift, describeDrift, type DriftRule, type DriftCharge } from '../rule-drift';

const ACCT = 'acct-1';

const rule = (over: Partial<DriftRule> = {}): DriftRule => ({
  id: 'r1', name: 'Housing', amount: 1000, frequency: 'monthly', rule_type: 'expense',
  payment_source: ACCT, active: true, ...over,
});

/** One charge per entry: `['2026-03-04', 1100]`. */
const charges = (
  merchant: string,
  entries: readonly [string, number][],
  over: Partial<DriftCharge> = {},
): DriftCharge[] => entries.map(([date, amount], i) => ({
  id: `${merchant}-${i}`, merchant_name: merchant, name: merchant,
  account_id: ACCT, date, amount, ...over,
}));

const STEADY: [string, number][] = [
  ['2026-03-02', 1100], ['2026-04-02', 1120], ['2026-05-04', 1110],
  ['2026-06-02', 1130], ['2026-07-02', 1105], ['2026-08-03', 1115],
];

describe('detectRuleDrift', () => {
  it('reports a bill that has been steadily above the rule', () => {
    const drift = detectRuleDrift(rule(), charges('Landlord Co', STEADY));
    expect(drift).not.toBeNull();
    expect(drift!.merchantLabel).toBe('Landlord Co');
    expect(drift!.months).toHaveLength(6);
    expect(drift!.averageAmount).toBe(1113.33);
    // The recommendation is the LAST THREE, not the whole run — see `observedAmount`.
    expect(drift!.observedAmount).toBe(1116.67);
    expect(drift!.delta).toBe(116.67);
  });

  it('recommends the recent average when the bill is trending, not the flat average', () => {
    const rising: [string, number][] = [
      ['2026-03-02', 100], ['2026-04-02', 110], ['2026-05-02', 120],
      ['2026-06-02', 140], ['2026-07-02', 170], ['2026-08-02', 190],
    ];
    const drift = detectRuleDrift(rule({ amount: 100 }), charges('Power Co', rising));
    expect(drift!.averageAmount).toBe(138.33);
    expect(drift!.observedAmount).toBe(166.67);
    expect(describeDrift(drift!)).toContain('the last 3 average $166.67');
  });

  it('says nothing until three consecutive months', () => {
    expect(detectRuleDrift(rule(), charges('Landlord Co', STEADY.slice(0, 2)))).toBeNull();
    expect(detectRuleDrift(rule(), charges('Landlord Co', STEADY.slice(0, 3)))).not.toBeNull();
  });

  it('needs the months to be CONSECUTIVE and to reach the present', () => {
    // A gap resets the run: only the two months after it count, which is below the floor.
    const gapped: [string, number][] = [
      ['2026-01-02', 1100], ['2026-02-02', 1120], ['2026-03-02', 1110],
      ['2026-07-02', 1130], ['2026-08-02', 1105],
    ];
    expect(detectRuleDrift(rule(), charges('Landlord Co', gapped))).toBeNull();
  });

  it('IS SILENT when two merchants both qualify', () => {
    // The live shape this exists for: a second recurring bill on the same account, inside the band.
    const both = [
      ...charges('Landlord Co', STEADY),
      ...charges('Rival Co', STEADY.map(([d, a]) => [d, a - 20] as [string, number])),
    ];
    expect(detectRuleDrift(rule(), both)).toBeNull();
  });

  it('excludes a merchant that bills more than once in most months', () => {
    // A shop with several charges a month is not a recurring bill, however close the amounts sit.
    // Every month here has two, so no month is an observation and there is no run at all.
    const busy: [string, number][] = STEADY.flatMap(([d, a]) =>
      [[d, a], [d.replace(/-\d\d$/, '-20'), a - 3]] as [string, number][]);
    expect(detectRuleDrift(rule(), charges('Everyday Shop', busy))).toBeNull();
  });

  it('DROPS only the double-billed month and keeps the rest of the run', () => {
    // A genuine bill with one extra charge in August is still a bill: August stops being an
    // observation, and the March-July run stands on its own.
    const extra: [string, number][] = [...STEADY, ['2026-08-20', 1108]];
    const drift = detectRuleDrift(rule(), charges('Landlord Co', extra));
    expect(drift!.months.map(m => m.month)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07']);
  });

  it('says nothing about a bill that stopped months ago', () => {
    // The run is long and consistent, but the bank has reported six more months since it ended.
    const ended: [string, number][] = STEADY.slice(0, 3);
    const cs = [
      ...charges('Landlord Co', ended),
      ...charges('Something Else', [['2026-08-11', 999999]]),
    ];
    expect(detectRuleDrift(rule(), cs)).toBeNull();
  });

  it('excludes a charge on another account, and a charge in the wrong direction', () => {
    expect(detectRuleDrift(rule(), charges('Landlord Co', STEADY, { account_id: 'other' }))).toBeNull();
    const refunds = charges('Landlord Co', STEADY).map(c => ({ ...c, amount: -Number(c.amount) }));
    expect(detectRuleDrift(rule(), refunds)).toBeNull();
  });

  it('excludes a bill far BELOW the rule — that is a different bill, not drift', () => {
    const small = STEADY.map(([d, a]) => [d, a / 4] as [string, number]);
    expect(detectRuleDrift(rule(), charges('Small Co', small))).toBeNull();
  });

  it('stays quiet for a difference too small to act on', () => {
    const close = STEADY.map(([d]) => [d, 1002] as [string, number]);
    expect(detectRuleDrift(rule(), charges('Landlord Co', close))).toBeNull();
  });

  it('needs an account, a positive amount, an active rule and a monthly frequency', () => {
    const cs = charges('Landlord Co', STEADY);
    expect(detectRuleDrift(rule({ payment_source: null }), cs)).toBeNull();
    expect(detectRuleDrift(rule({ amount: 0 }), cs)).toBeNull();
    expect(detectRuleDrift(rule({ active: false }), cs)).toBeNull();
    expect(detectRuleDrift(rule({ frequency: 'biweekly' }), cs)).toBeNull();
  });

  it('reads an income rule off its deposit account, like the matcher does', () => {
    const paid = charges('Employer Co', STEADY).map(c => ({ ...c, amount: -Number(c.amount) }));
    const drift = detectRuleDrift(
      rule({ rule_type: 'income', payment_source: null, deposit_account: ACCT }),
      paid,
    );
    expect(drift).not.toBeNull();
    expect(drift!.delta).toBe(116.67);
  });

  it('folds a reference number so one merchant is one run', () => {
    const varied = STEADY.map(([d, a], i) =>
      [d, a] as [string, number]).map(([d, a], i) => ({ d, a, i }));
    const cs = varied.map(({ d, a, i }) => ({
      id: `v${i}`, merchant_name: `Landlord Co ${1000000000 + i}`, name: 'x',
      account_id: ACCT, date: d, amount: a,
    }));
    expect(detectRuleDrift(rule(), cs)?.months).toHaveLength(6);
  });
});

describe('detectAllRuleDrift', () => {
  it('orders by the monthly dollars the budget cannot see, not by percentage', () => {
    const big = rule({ id: 'big', name: 'Housing', amount: 1000 });
    const small = rule({ id: 'small', name: 'Streaming', amount: 20, payment_source: 'acct-2' });
    const cs = [
      ...charges('Landlord Co', STEADY),
      // 100% out proportionally, but only $20 a month in absolute terms.
      ...charges('Stream Co', STEADY.map(([d]) => [d, 40] as [string, number]), { account_id: 'acct-2' }),
    ];
    const drifts = detectAllRuleDrift([small, big], cs);
    expect(drifts.map(d => d.ruleId)).toEqual(['big', 'small']);
  });

  it('returns nothing when no rule is out of step', () => {
    const onTarget = STEADY.map(([d]) => [d, 1000] as [string, number]);
    expect(detectAllRuleDrift([rule()], charges('Landlord Co', onTarget))).toEqual([]);
  });
});
