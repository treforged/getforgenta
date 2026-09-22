import { describe, it, expect } from 'vitest';
import { buildDebtFreeCard, cardLeaksMoney, type ShareCardSpec } from '../share-card';

describe('buildDebtFreeCard', () => {
  const baseToday = new Date(2026, 8, 22); // September 22, 2026 (local)

  it('calculates future date and subline correctly (etaMonth 7)', () => {
    const spec = buildDebtFreeCard(7, baseToday);
    expect(spec).not.toBeNull();
    if (spec) {
      expect(spec.kind).toBe('date');
      expect(spec.headline).toBe('March 2027');
      expect(spec.subline).toBe('6 months to go');
      expect(spec.dateLabel).toBe('March 2027');
    }
  });

  it('handles singular month wording (etaMonth 2)', () => {
    const spec = buildDebtFreeCard(2, baseToday);
    expect(spec).not.toBeNull();
    if (spec) {
      expect(spec.subline).toBe('1 month to go');
    }
  });

  it('handles this-month case (etaMonth 1)', () => {
    const spec = buildDebtFreeCard(1, baseToday);
    expect(spec).not.toBeNull();
    if (spec) {
      expect(spec.headline).toBe('This month.');
      expect(spec.dateLabel).toBe('September 2026');
    }
  });

  it('handles paid-off cases (etaMonth 0 and -3)', () => {
    const specZero = buildDebtFreeCard(0, baseToday);
    const specNeg = buildDebtFreeCard(-3, baseToday);
    [specZero, specNeg].forEach((spec) => {
      expect(spec).not.toBeNull();
      if (spec) {
        expect(spec.kind).toBe('paid');
        expect(spec.dateLabel).toBeNull();
      }
    });
  });

  it('returns null for invalid etaMonth values', () => {
    const invalids: Array<number | null> = [null, NaN, Infinity, 601];
    invalids.forEach((v) => {
      expect(buildDebtFreeCard(v, baseToday)).toBeNull();
    });
  });

  it('handles year rollover correctly', () => {
    const today = new Date(2026, 11, 31); // December 31, 2026
    const spec = buildDebtFreeCard(2, today);
    expect(spec).not.toBeNull();
    if (spec) {
      expect(spec.headline).toBe('January 2027');
      expect(spec.dateLabel).toBe('January 2027');
    }
  });

  // The case above cannot catch day overflow (January has a 31st). This one can: counting from
  // the 31st, "one month on" is Feb 31 = Mar 3, so only a day-1 anchor lands on February.
  it('anchors on day 1 so a short month is not skipped', () => {
    const spec = buildDebtFreeCard(2, new Date(2027, 0, 31));
    expect(spec?.headline).toBe('February 2027');
  });
});

describe('cardLeaksMoney', () => {
  const today = new Date(2026, 8, 22);
  // Verify that all generated specs are clean
  for (let eta = -2; eta <= 60; eta++) {
    const spec = buildDebtFreeCard(eta, today);
    if (spec) {
      it(`spec with etaMonth ${eta} does not leak money`, () => {
        expect(cardLeaksMoney(spec)).toBe(false);
      });
    }
  }

  // Positive control cases
  const positiveControls: ShareCardSpec[] = [
    {
      kind: 'date',
      eyebrow: 'Test',
      headline: 'Test',
      dateLabel: null,
      subline: '$1,200 left',
      footer: 'Planned with Forgenta  ·  getforgenta.com',
    },
    {
      kind: 'date',
      eyebrow: 'Test',
      headline: 'Test',
      dateLabel: null,
      subline: 'APR 24%',
      footer: 'Planned with Forgenta  ·  getforgenta.com',
    },
    {
      kind: 'date',
      eyebrow: 'Test',
      headline: 'Test',
      dateLabel: null,
      subline: '1,250 remaining',
      footer: 'Planned with Forgenta  ·  getforgenta.com',
    },
    {
      kind: 'date',
      eyebrow: 'Test',
      headline: 'Test',
      dateLabel: null,
      subline: 'balance cleared',
      footer: 'Planned with Forgenta  ·  getforgenta.com',
    },
  ];

  positiveControls.forEach((spec, idx) => {
    it(`positive control ${idx + 1} leaks money`, () => {
      expect(cardLeaksMoney(spec)).toBe(true);
    });
  });
});
