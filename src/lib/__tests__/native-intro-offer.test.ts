import { describe, it, expect } from 'vitest';
import { nativeIntroOffer, INTRO_ELIGIBLE, type IntroPriceLike } from '../native-intro-offer';

const intro = (over: Partial<IntroPriceLike> = {}): IntroPriceLike => ({
  price: 1, priceString: '$1.00', cycles: 12, periodUnit: 'MONTH', periodNumberOfUnits: 1, ...over,
});
const monthly = (i: IntroPriceLike | null = intro()) => ({ priceString: '$9.99', introPrice: i });
const yearly = { priceString: '$89.99', introPrice: intro({ price: 10, priceString: '$10.00', cycles: 1, periodUnit: 'YEAR' }) };

describe('nativeIntroOffer', () => {
  it('monthly: $1.00/mo for the first year, then $9.99/mo (Android trusts the store listing)', () => {
    expect(nativeIntroOffer(monthly(), false, 'android', undefined))
      .toEqual({ introPrice: '$1.00/mo', term: 'first year', thenPrice: '$9.99/mo' });
  });

  it('yearly: one $10.00 payment for the first year, then $89.99/yr, on an eligible iPhone', () => {
    expect(nativeIntroOffer(yearly, true, 'ios', INTRO_ELIGIBLE))
      .toEqual({ introPrice: '$10.00', term: 'first year', thenPrice: '$89.99/yr' });
  });

  it.each([undefined, 0, 1, 3])('iOS shows nothing unless eligibility is ELIGIBLE (got %s)', (status) => {
    expect(nativeIntroOffer(yearly, true, 'ios', status)).toBeNull();
  });

  it('no intro price, a free trial, or zero cycles/units read as no offer', () => {
    expect(nativeIntroOffer(monthly(null), false, 'android', undefined)).toBeNull();
    expect(nativeIntroOffer(monthly(intro({ price: 0, priceString: '$0.00' })), false, 'android', undefined)).toBeNull();
    expect(nativeIntroOffer(monthly(intro({ cycles: 0 })), false, 'android', undefined)).toBeNull();
    expect(nativeIntroOffer(monthly(intro({ periodNumberOfUnits: 0 })), false, 'android', undefined)).toBeNull();
  });

  it('names other terms honestly', () => {
    expect(nativeIntroOffer(monthly(intro({ cycles: 3 })), false, 'android', undefined)?.term).toBe('first 3 months');
    expect(nativeIntroOffer(monthly(intro({ cycles: 1 })), false, 'android', undefined)?.term).toBe('first month');
    const weeks = nativeIntroOffer(monthly(intro({ cycles: 1, periodUnit: 'WEEK', periodNumberOfUnits: 2 })), false, 'android', undefined);
    expect(weeks).toEqual({ introPrice: '$1.00', term: 'first 2 weeks', thenPrice: '$9.99/mo' });
  });

  it('an unknown period unit reads as no offer', () => {
    expect(nativeIntroOffer(monthly(intro({ periodUnit: 'FORTNIGHT' })), false, 'android', undefined)).toBeNull();
  });
});
