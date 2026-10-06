import { describe, it, expect } from 'vitest'
import {
  Plan,
  REGULAR_CENTS,
  INTRO_CENTS,
  INTRO_MONTHS,
  introDiscountCents,
  firstYearCostCents,
  firstYearSavingsCents,
  formatCents,
  IntroHistory,
  isIntroEligible,
  introOfferLine,
} from '../intro-offer'

describe('constants', () => {
  it('REGULAR_CENTS matches spec', () => {
    expect(REGULAR_CENTS).toEqual({ monthly: 999, yearly: 8999 })
  })
  it('INTRO_CENTS matches spec', () => {
    expect(INTRO_CENTS).toEqual({ monthly: 99, yearly: 999 })
  })
  it('INTRO_MONTHS is 12', () => {
    expect(INTRO_MONTHS).toBe(12)
  })
})

describe('introDiscountCents', () => {
  it('monthly discount is 900 cents', () => {
    expect(introDiscountCents('monthly')).toBe(900)
  })
  it('yearly discount is 8000 cents', () => {
    expect(introDiscountCents('yearly')).toBe(8000)
  })
})

describe('firstYearCostCents', () => {
  it('monthly intro cost is 1188 cents', () => {
    expect(firstYearCostCents('monthly', true)).toBe(1188)
  })
  it('monthly regular cost is 11988 cents', () => {
    expect(firstYearCostCents('monthly', false)).toBe(11988)
  })
  it('yearly intro cost is 999 cents', () => {
    expect(firstYearCostCents('yearly', true)).toBe(999)
  })
  it('yearly regular cost is 8999 cents', () => {
    expect(firstYearCostCents('yearly', false)).toBe(8999)
  })
})

describe('firstYearSavingsCents', () => {
  it('monthly savings are 10800 cents', () => {
    expect(firstYearSavingsCents('monthly')).toBe(10800)
  })
  it('yearly savings are 8000 cents', () => {
    expect(firstYearSavingsCents('yearly')).toBe(8000)
  })
})

describe('formatCents', () => {
  it.each([
    [100, '$1.00'],
    [999, '$9.99'],
    [1000, '$10.00'],
    [8999, '$89.99'],
    [107988, '$1,079.88'],
  ])('formats %i as %s', (cents, expected) => {
    expect(formatCents(cents)).toBe(expected)
  })
  it('throws on non-integer input', () => {
    expect(() => formatCents(1.5)).toThrow(RangeError)
  })
  it('throws on negative input', () => {
    expect(() => formatCents(-1)).toThrow(RangeError)
  })
})

describe('isIntroEligible', () => {
  const combos: IntroHistory[] = [
    { everSubscribed: false, currentlyPremium: false, compOrPromo: false },
    { everSubscribed: true, currentlyPremium: false, compOrPromo: false },
    { everSubscribed: false, currentlyPremium: true, compOrPromo: false },
    { everSubscribed: false, currentlyPremium: false, compOrPromo: true },
    { everSubscribed: true, currentlyPremium: true, compOrPromo: false },
    { everSubscribed: true, currentlyPremium: false, compOrPromo: true },
    { everSubscribed: false, currentlyPremium: true, compOrPromo: true },
    { everSubscribed: true, currentlyPremium: true, compOrPromo: true },
  ]
  combos.forEach((history, idx) => {
    it(`combination ${idx + 1}`, () => {
      const expected =
        !history.everSubscribed && !history.currentlyPremium && !history.compOrPromo
      expect(isIntroEligible(history)).toBe(expected)
    })
  })
})

describe('introOfferLine', () => {
  it('monthly plan line is correct', () => {
    expect(introOfferLine('monthly')).toBe('$0.99/mo for your first year, then $9.99/mo')
  })
  it('yearly plan line is correct', () => {
    expect(introOfferLine('yearly')).toBe('$9.99 for your first year, then $89.99/yr')
  })
})
