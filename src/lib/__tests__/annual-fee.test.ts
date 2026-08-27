import { describe, it, expect } from 'vitest';
import { annualFeeAmount, annualFeeMonthIndexes, nextAnnualFeeLabel } from '@/lib/annual-fee';

const NOW = new Date(2026, 7, 27); // Aug 2026, the month Tre asked for this

describe('annualFeeAmount', () => {
  it('is 0 for every way of not having a fee', () => {
    expect(annualFeeAmount({})).toBe(0);
    expect(annualFeeAmount({ annual_fee: null })).toBe(0);
    expect(annualFeeAmount({ annual_fee: 0 })).toBe(0);
    // A negative fee is a typo, not a credit. Charging it would ADD money to the plan.
    expect(annualFeeAmount({ annual_fee: -395 })).toBe(0);
    expect(annualFeeAmount({ annual_fee: Number.NaN })).toBe(0);
  });

  it('is the fee when there is one', () => {
    expect(annualFeeAmount({ annual_fee: 395 })).toBe(395);
  });
});

describe('annualFeeMonthIndexes', () => {
  it('charges the fee in its month and every anniversary after it', () => {
    // Tre's Venture X: $395 first charged Jun 2027, which is month 10 from Aug 2026.
    const months = annualFeeMonthIndexes(
      { annual_fee: 395, annual_fee_date: '2027-06-01', card_start_date: '2027-06-01' },
      NOW, 60,
    );
    expect(months).toEqual([10, 22, 34, 46, 58]);
  });

  it('returns nothing when there is no fee or no date', () => {
    expect(annualFeeMonthIndexes({ annual_fee: 0, annual_fee_date: '2027-06-01' }, NOW, 60)).toEqual([]);
    expect(annualFeeMonthIndexes({ annual_fee: 395 }, NOW, 60)).toEqual([]);
    expect(annualFeeMonthIndexes({ annual_fee: 395, annual_fee_date: 'nonsense' }, NOW, 60)).toEqual([]);
  });

  it('walks a PAST first-charge date forward to its next anniversary', () => {
    // A user entering the date the card was opened must not get a silent no-op: the fee is still
    // charged every year, it just already happened this many times.
    const months = annualFeeMonthIndexes({ annual_fee: 95, annual_fee_date: '2021-03-15' }, NOW, 60);
    expect(months[0]).toBe(7); // Mar 2027
    expect(months).toEqual([7, 19, 31, 43, 55]);
  });

  it('charges a fee dated THIS month in month 0', () => {
    expect(annualFeeMonthIndexes({ annual_fee: 95, annual_fee_date: '2026-08-04' }, NOW, 60)[0]).toBe(0);
  });

  it('never bills a card before it opens, whatever the fee date says', () => {
    // The two fields are entered separately and nothing stops them disagreeing.
    const months = annualFeeMonthIndexes(
      { annual_fee: 395, annual_fee_date: '2026-09-01', card_start_date: '2027-06-01' },
      NOW, 60,
    );
    expect(months).toEqual([13, 25, 37, 49]); // Sep 2027 on, not Sep 2026
  });

  it('returns nothing when the first charge is past the end of the window', () => {
    expect(annualFeeMonthIndexes({ annual_fee: 395, annual_fee_date: '2032-01-01' }, NOW, 60)).toEqual([]);
  });
});

describe('nextAnnualFeeLabel', () => {
  it('names the month the next charge lands in', () => {
    expect(nextAnnualFeeLabel({ annual_fee: 395, annual_fee_date: '2027-06-01' }, NOW)).toBe('Jun 2027');
  });

  it('is null when nothing is ever charged', () => {
    expect(nextAnnualFeeLabel({ annual_fee: 0, annual_fee_date: '2027-06-01' }, NOW)).toBeNull();
  });
});
