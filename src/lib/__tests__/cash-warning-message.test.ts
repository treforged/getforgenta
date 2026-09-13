import { describe, it, expect } from 'vitest';
import { cashWarningMessage } from '../unconditional-payment';

/**
 * THE WARNING THAT DID NOT FIRE, FOUND IN A BROWSER AND NOT BY ANY TEST.
 *
 * 2026-09-13, demo persona, a genuinely tight month — $2,526 liquid against a $3,223 safe minimum.
 * Turning on "always pay this, no matter what" for Prime Visa moved **Safe to Pay from $0 to
 * $7,991 with no warning of any kind**, on a tile whose label is the word *Safe*.
 *
 * The old predicate could not catch it and never will: `availableCash − minimumsDue` was
 * `7991 − 0`, a large POSITIVE number, because an unconditional card is settled in FULL and is
 * therefore never a minimum left unmet. The figure proving the month does not fit was already on
 * the row underneath, and nothing read it.
 *
 * ⚠️ EVERY GATE AND EVERY SUITE WAS GREEN WHILE THIS WAS TRUE, including the ones written the same
 * night for this exact feature. They asserted the shortfall RENDERS. None asked what the tile
 * beside it was claiming.
 */

describe('cashWarningMessage — the shortfall case, which nothing used to catch', () => {
  it('WARNS when an unconditional payment overdraws the month, minimums fully covered', () => {
    // The measured shape, to the dollar.
    const msg = cashWarningMessage(7991, 0, [7991]);
    expect(msg).not.toBeNull();
    expect(msg).toContain('$7,991');
    // And it does NOT reach for the minimums story, which is untrue here.
    expect(msg).not.toMatch(/less than minimum/i);
  });

  it('says the payment is NOT being reduced — the one thing the user needs to know', () => {
    // Reading "short this month" beside an unchanged figure invites the conclusion that the app
    // quietly paid less. The whole setting exists to promise it did not.
    expect(cashWarningMessage(7991, 0, [7991])).toMatch(/not being reduced/i);
  });

  it('is SILENT when the month covers everything', () => {
    // Without this the banner is permanent furniture and stops being read.
    expect(cashWarningMessage(3000, 500, [0])).toBeNull();
    expect(cashWarningMessage(3000, 500, [undefined])).toBeNull();
    expect(cashWarningMessage(3000, 500, [])).toBeNull();
  });

  it('still WARNS the old way when minimums genuinely cannot be met', () => {
    // The original case has not been traded away for the new one.
    const msg = cashWarningMessage(100, 400, []);
    expect(msg).toMatch(/less than minimum payments due/i);
    expect(msg).toContain('$400');
  });

  it('THE SHORTFALL WINS when both are true, because it is the larger claim', () => {
    // Both sentences would be accurate; showing the minimums one would describe the smaller
    // problem and leave the user believing a smaller number is at stake.
    expect(cashWarningMessage(50, 400, [7991])).toMatch(/always pay in full/i);
  });

  it('sums several shortfalls rather than reporting only the first', () => {
    expect(cashWarningMessage(900, 0, [400, 500])).toContain('$900');
  });

  it('ignores zero and absent shortfalls when summing', () => {
    expect(cashWarningMessage(400, 0, [0, undefined, 400])).toContain('$400');
  });

  it('a shortfall of exactly zero is NOT a warning — absent and zero differ', () => {
    expect(cashWarningMessage(3000, 100, [0])).toBeNull();
  });
});
