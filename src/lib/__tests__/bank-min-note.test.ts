import { describe, it, expect } from 'vitest';
import { bankMinNote } from '@/lib/bank-min-note';

describe('bankMinNote', () => {
  it('shows the bank figure beside a stale manual minimum (Tre\'s Discover)', () => {
    expect(bankMinNote(150.40, true, 198.17)).toBe("Bank's minimum: $198.17");
  });
  it('says nothing when the minimum is not manual', () => {
    expect(bankMinNote(150.40, false, 198.17)).toBeNull();
  });
  it('says nothing when the two agree to the cent', () => {
    expect(bankMinNote(773.05, true, 773.05)).toBeNull();
  });
  it('never shows a bank 0, which means nothing is still due, not a $0 minimum', () => {
    expect(bankMinNote(150.40, true, 0)).toBeNull();
    expect(bankMinNote(150.40, true, null)).toBeNull();
  });
});
