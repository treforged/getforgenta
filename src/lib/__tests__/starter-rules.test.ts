import { describe, it, expect } from 'vitest';
import { DEFAULT_STARTER_RULES, isUneditedSampleRule } from '../starter-rules';

describe('isUneditedSampleRule', () => {
  it('marks a row still at a sample name AND amount, including an amount read back as a string', () => {
    expect(isUneditedSampleRule({ name: 'Rent', amount: 1400 })).toBe(true);
    expect(isUneditedSampleRule({ name: 'Weekly Paycheck', amount: '1875' })).toBe(true);
  });
  it('does NOT mark an edited amount or a renamed row', () => {
    expect(isUneditedSampleRule({ name: 'Rent', amount: 1915 })).toBe(false);
    expect(isUneditedSampleRule({ name: 'Rent (new place)', amount: 1400 })).toBe(false);
    expect(isUneditedSampleRule({ name: 'Rent', amount: null })).toBe(false);
  });
  it('covers every sample in the list (positive control)', () => {
    expect(DEFAULT_STARTER_RULES).toHaveLength(9);
    for (const s of DEFAULT_STARTER_RULES) expect(isUneditedSampleRule(s)).toBe(true);
  });
});
