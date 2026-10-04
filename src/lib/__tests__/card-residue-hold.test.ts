// ceb711fc: the card-residue hold. Every expected value is worked by hand from the bound in
// card-residue-hold.ts: H <= below(t) + residue(cards ranked above t), capped by owed and held.
import { describe, it, expect } from 'vitest';
import { cardResidueHold, type CardResidue, type ReserveLine } from '@/lib/card-residue-hold';

describe('cardResidueHold', () => {
  // 1. No cards owe anything
  it('returns 0 when no card owes', () => {
    const reserve = [{ rank: 1, amount: 100 }];
    const cards: CardResidue[] = [];
    expect(cardResidueHold(reserve, cards)).toBeCloseTo(0, 6);
  });

  // 2. Empty reserve
  it('returns 0 when reserve is empty', () => {
    const reserve: ReserveLine[] = [];
    const cards = [{ rank: 2, residue: 50 }];
    expect(cardResidueHold(reserve, cards)).toBeCloseTo(0, 6);
  });

  // 3. Card rank 2 residue 17.69, loan rank 4 amount 206.82 -> holds 17.69
  it('holds full residue when card is above target rank', () => {
    const reserve = [{ rank: 4, amount: 206.82 }];
    const cards = [{ rank: 2, residue: 17.69 }];
    expect(cardResidueHold(reserve, cards)).toBeCloseTo(17.69, 6);
  });

  // 4. Residue larger than reserve -> capped by reserve total
  it('caps hold by reserve total when residue exceeds reserve', () => {
    const reserve = [{ rank: 3, amount: 100 }];
    const cards = [{ rank: 1, residue: 500 }];
    expect(cardResidueHold(reserve, cards)).toBeCloseTo(100, 6);
  });

  // 5. Goal ranked above card keeps its money
  it('returns 0 when target rank is above card rank', () => {
    const reserve = [{ rank: 1, amount: 300 }];
    const cards = [{ rank: 2, residue: 50 }];
    expect(cardResidueHold(reserve, cards)).toBeCloseTo(0, 6);
  });

  // 6. Goal rank 1 + lower loan rank 4, card rank 2 residue 50 -> hold 40
  it('bounds hold by amount below higher-ranked target', () => {
    const reserve = [
      { rank: 1, amount: 300 },
      { rank: 4, amount: 40 },
    ];
    const cards = [{ rank: 2, residue: 50 }];
    expect(cardResidueHold(reserve, cards)).toBeCloseTo(40, 6);
  });

  // 7. Card rank equals target rank -> 0
  it('returns 0 when card rank equals target rank', () => {
    const reserve = [{ rank: 3, amount: 100 }];
    const cards = [{ rank: 3, residue: 50 }];
    expect(cardResidueHold(reserve, cards)).toBeCloseTo(0, 6);
  });

  // 8. Card with zero residue is ignored
  it('ignores cards with zero residue', () => {
    const reserve = [{ rank: 4, amount: 100 }];
    const cards = [{ rank: 1, residue: 0 }];
    expect(cardResidueHold(reserve, cards)).toBeCloseTo(0, 6);
  });

  // 9. Residues of every card above the target add up
  it('sums the residue of every card ranked above the target', () => {
    const reserve = [{ rank: 5, amount: 100 }];
    const cards = [{ rank: 1, residue: 10 }, { rank: 2, residue: 20 }];
    expect(cardResidueHold(reserve, cards)).toBeCloseTo(30, 6);
  });

  // 10. An unranked target (Infinity) sits below every card, so it gives way to them
  it('holds against an unranked target', () => {
    const reserve = [{ rank: Number.POSITIVE_INFINITY, amount: 80 }];
    const cards = [{ rank: 2.5, residue: 25 }];
    expect(cardResidueHold(reserve, cards)).toBeCloseTo(25, 6);
  });
});
