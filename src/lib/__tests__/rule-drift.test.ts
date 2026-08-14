// Â§1B Stage 7B â€” rule drift. Synthetic values only (AGENT.md: nothing derived from real data).
//
// The two shapes these are built around are the REAL failures, restated with invented numbers:
// a rent-sized bill drifting a few percent above a stale rule, and a utility that has doubled.
import { describe, it, expect } from 'vitest';
import { detectRuleDrift, detectAllRuleDrift, describeDrift, bundleExplainsBetter, linkedRulesByMerchant, type DriftRule, type DriftCharge } from '../rule-drift';
import { normalizeMerchant } from '../merchant-memory';

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
    // The recommendation is the LAST THREE, not the whole run â€” see `observedAmount`.
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

  it('excludes a bill far BELOW the rule â€” that is a different bill, not drift', () => {
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

// Bundle guard. Synthetic, but the SHAPE is the real failure (Tre, 2026-08-13): a landlord bills
// base rent, internet, water and a smart-home system as ONE debit, and the user models it as four
// rules that already sum to about what the bank charges. Reported per-rule that reads as "the big
// one is low", and accepting it leaves the other three in place and overstates the total.
describe('bundleExplainsBetter â€” several rules, one charge', () => {
  const BUNDLE: DriftRule[] = [
    rule({ id: 'r1', name: 'Housing', amount: 1000, due_day: 1 }),
    rule({ id: 'r2', name: 'Net', amount: 50, due_day: 1 }),
    rule({ id: 'r3', name: 'Water', amount: 30, due_day: 1 }),
    rule({ id: 'r4', name: 'Home', amount: 20, due_day: 1 }),
  ];

  it('says nothing about one member when the bundle explains the charge better', () => {
    // Bundle totals 1100 against a 1116.67 recent average â€” off by 16.67. The Housing rule alone is
    // off by 116.67, which is what the panel would have offered to "correct".
    expect(detectRuleDrift(BUNDLE[0], charges('Landlord Co', STEADY), BUNDLE)).toBeNull();
  });

  it('still reports it when the siblings are not passed â€” the guard needs them', () => {
    expect(detectRuleDrift(BUNDLE[0], charges('Landlord Co', STEADY))).not.toBeNull();
  });

  it('identifies the bundle and its total', () => {
    const b = bundleExplainsBetter(BUNDLE[0], BUNDLE, 1116.67);
    expect(b).not.toBeNull();
    expect(b!.total).toBe(1100);
    expect(b!.ruleNames).toEqual(['Housing', 'Net', 'Water', 'Home']);
  });

  it('does NOT suppress a genuinely separate bill billed on the same day', () => {
    // The one that must survive: a utility on the same account and day, whose own rule explains its
    // charge far better than the housing bundle does.
    const power = rule({ id: 'p1', name: 'Power', amount: 100, due_day: 1 });
    const POWER: [string, number][] = [
      ['2026-06-04', 165], ['2026-07-05', 170], ['2026-08-06', 175],
    ];
    const drift = detectRuleDrift(power, charges('Power Co', POWER), [...BUNDLE, power]);
    expect(drift).not.toBeNull();
    expect(drift!.observedAmount).toBe(170);
    expect(drift!.delta).toBe(70);
  });

  it('does not bundle rules due on different days', () => {
    const apart = BUNDLE.map((r, i) => ({ ...r, due_day: i + 1 }));
    expect(bundleExplainsBetter(apart[0], apart, 1116.67)).toBeNull();
  });

  it('does not bundle an income rule with an expense rule', () => {
    const income = rule({ id: 'i1', name: 'Paycheck', amount: 100, due_day: 1, rule_type: 'income', deposit_account: ACCT });
    expect(bundleExplainsBetter(BUNDLE[0], [...BUNDLE.slice(0, 1), income], 1116.67)).toBeNull();
  });

  it('a bundle of one is just the rule, and never suppresses it', () => {
    expect(bundleExplainsBetter(BUNDLE[0], [BUNDLE[0]], 1116.67)).toBeNull();
  });
});


// The mirror ambiguity, and the rule types that have no merchant. Both seen live 2026-08-13:
// one power company was claimed by five different rules, three of which were an investment
// contribution, a brokerage contribution and an owner draw.
describe('one merchant, several rules', () => {
  it('says nothing when two rules both claim the same merchant', () => {
    const a = rule({ id: 'a', name: 'Power', amount: 100, due_day: 1 });
    const b = rule({ id: 'b', name: 'Internet', amount: 100, due_day: 1 });
    const bills = charges('Power Co', [['2026-06-04', 165], ['2026-07-05', 170], ['2026-08-06', 175]]);
    // Each is a confident single-merchant match on its own...
    expect(detectRuleDrift(a, bills)).not.toBeNull();
    expect(detectRuleDrift(b, bills)).not.toBeNull();
    // ...and together they are a coin flip, so neither is reported.
    expect(detectAllRuleDrift([a, b], bills)).toEqual([]);
  });

  it('still reports when only one rule claims the merchant', () => {
    const only = rule({ id: 'a', name: 'Power', amount: 100, due_day: 1 });
    const bills = charges('Power Co', [['2026-06-04', 165], ['2026-07-05', 170], ['2026-08-06', 175]]);
    expect(detectAllRuleDrift([only], bills)).toHaveLength(1);
  });

  it('ignores investment and transfer rules — no merchant bills you for those', () => {
    const bills = charges('Power Co', [['2026-06-04', 165], ['2026-07-05', 170], ['2026-08-06', 175]]);
    for (const kind of ['investment', 'transfer'] as const) {
      expect(detectRuleDrift(rule({ id: kind, name: 'Contribution', amount: 100, rule_type: kind }), bills)).toBeNull();
    }
  });
});

// The tiebreak. A contested merchant is silence UNLESS the user has already said, on Bank Activity,
// which rule that merchant settles — that is a recorded decision, not a guess about a name.
describe('linked-rule tiebreak', () => {
  const bills = charges('Power Co', [['2026-06-04', 165], ['2026-07-05', 170], ['2026-08-06', 175]]);
  const a = rule({ id: 'power', name: 'Power', amount: 100, due_day: 1 });
  const b = rule({ id: 'net', name: 'Internet', amount: 100, due_day: 15 });
  const link = (id: string, ruleId: string) => ({ synced_transaction_id: id, status: 'linked_rule', rule_id: ruleId });

  it('names the linked rule and drops its rivals', () => {
    const got = detectAllRuleDrift([a, b], bills, [link('Power Co-0', 'power')]);
    expect(got).toHaveLength(1);
    expect(got[0].ruleId).toBe('power');
  });

  it('stays silent when BOTH rivals are linked — still a coin flip', () => {
    expect(detectAllRuleDrift([a, b], bills, [link('Power Co-0', 'power'), link('Power Co-1', 'net')])).toEqual([]);
  });

  it('ignores links that are not linked_rule', () => {
    const ignored = { synced_transaction_id: 'Power Co-0', status: 'ignored', rule_id: 'power' };
    expect(detectAllRuleDrift([a, b], bills, [ignored])).toEqual([]);
  });

  it('maps a link to its merchant, not just its charge', () => {
    const map = linkedRulesByMerchant(bills, [link('Power Co-2', 'power')]);
    expect([...(map.get(normalizeMerchant('Power Co')!) ?? [])]).toEqual(['power']);
  });
  it('a merchant linked to one rule can never evidence a different rule, even uncontested', () => {
    // The live case, third layer of the same bug: once Electricity was corrected it stopped
    // drifting, leaving Internet the SOLE claimant of Duke Energy - "unambiguous" and wrong. The
    // link is an exclusion, not just a tiebreak.
    const power = rule({ id: 'power', name: 'Power', amount: 170, due_day: 1 });   // correct now
    const net = rule({ id: 'net', name: 'Internet', amount: 100, due_day: 15 });   // wrong claimant
    const bills = charges('Power Co', [['2026-06-04', 165], ['2026-07-05', 170], ['2026-08-06', 175]]);
    const links = [{ synced_transaction_id: 'Power Co-0', status: 'linked_rule', rule_id: 'power' }];
    expect(detectAllRuleDrift([power, net], bills, links)).toEqual([]);
  });
});

