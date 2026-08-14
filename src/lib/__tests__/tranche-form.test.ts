// Form rows <-> the `balance_tranches` jsonb. The round-trip is the whole point: the owner's real
// Discover row was written by hand in SQL, and the editor must be able to load it, save it back,
// and change nothing — anything else silently rewrites live financial data on the next edit.
import { describe, it, expect } from 'vitest';
import {
  tranchesToRows, rowsToTranches, trancheRowsTotal, trancheOverage, newTrancheRow,
  DEFAULT_TRANCHE_LABEL, type TrancheFormRow,
} from '../tranche-form';

// Shaped exactly like the live row (values are the real ones; nothing here is hardcoded in src).
const STORED = [{
  id: 'discover-bt-2026-06',
  label: 'Prime Visa transfer',
  balance: 5037.73,
  apr: 7.99,
  promo_end_date: '2028-01-04',
}];

const row = (over: Partial<TrancheFormRow> = {}): TrancheFormRow => ({
  id: 'row-1', label: 'Balance transfer', balance: '5000', apr: '8', promo_end_date: '', ...over,
});

describe('tranchesToRows', () => {
  it('turns stored numbers into the string fields the form edits', () => {
    const rows = tranchesToRows(STORED);
    expect(rows).toEqual([{
      id: 'discover-bt-2026-06',
      label: 'Prime Visa transfer',
      balance: '5037.73',
      apr: '7.99',
      promo_end_date: '2028-01-04',
    }]);
  });

  it('an absent promo date becomes an empty box, and null/garbage becomes no rows', () => {
    expect(tranchesToRows([{ id: 'x', label: 'Fixed', balance: 100, apr: 5 }])[0].promo_end_date).toBe('');
    expect(tranchesToRows(null)).toEqual([]);
    expect(tranchesToRows([{ id: 'x', balance: 0, apr: 5 }])).toEqual([]);
  });
});

describe('rowsToTranches', () => {
  it('round-trips the real stored shape byte for byte', () => {
    const { tranches, invalidRows } = rowsToTranches(tranchesToRows(STORED));
    expect(invalidRows).toEqual([]);
    expect(tranches).toEqual(STORED);
  });

  it('omits promo_end_date entirely when the date box is empty — never "" and never null', () => {
    const { tranches } = rowsToTranches([row()]);
    expect(tranches).toHaveLength(1);
    expect('promo_end_date' in tranches![0]).toBe(false);
    expect(JSON.stringify(tranches)).not.toContain('promo_end_date');
  });

  it('zero rows means null — a single-APR card, not an empty array', () => {
    expect(rowsToTranches([]).tranches).toBeNull();
  });

  it('falls back to the shared default label when the label box is blank', () => {
    expect(rowsToTranches([row({ label: '   ' })]).tranches![0].label).toBe(DEFAULT_TRANCHE_LABEL);
  });

  it('reports a rejected row by position instead of dropping it silently', () => {
    const { tranches, invalidRows } = rowsToTranches([
      row({ id: 'a' }),
      row({ id: 'b', balance: '' }),
      row({ id: 'c', balance: '-5' }),
      row({ id: 'd', apr: '' }),
    ]);
    expect(invalidRows).toEqual([2, 3, 4]);
    expect(tranches!.map(t => t.id)).toEqual(['a']);
  });

  it('keeps an explicit 0% tier — a 0% transfer is real, a blank APR is not', () => {
    expect(rowsToTranches([row({ apr: '0' })]).tranches![0].apr).toBe(0);
    expect(rowsToTranches([row({ apr: '' })]).invalidRows).toEqual([1]);
  });
});

describe('trancheRowsTotal / trancheOverage', () => {
  it('sums only the rows carrying a usable balance', () => {
    expect(trancheRowsTotal([row({ balance: '100' }), row({ balance: '' }), row({ balance: '50.5' })]))
      .toBeCloseTo(150.5, 6);
  });

  it('flags tiers summing past the balance, and stays quiet when they fit', () => {
    const rows = [row({ balance: '5037.73' }), row({ id: 'r2', balance: '5279' })];
    expect(trancheOverage(rows, '10000')).toEqual({ total: 10316.73, balance: 10000 });
    expect(trancheOverage(rows, '10400')).toBeNull();
  });

  it('says nothing when there is no balance to compare against — never a false alarm', () => {
    expect(trancheOverage([row({ balance: '100' })], '')).toBeNull();
    expect(trancheOverage([row({ balance: '100' })], 'abc')).toBeNull();
    expect(trancheOverage([row({ balance: '100' })], '0')).toBeNull();
  });
});

describe('newTrancheRow', () => {
  it('is blank apart from a unique id, so a fresh row is never mistaken for filled-in', () => {
    const a = newTrancheRow();
    const b = newTrancheRow();
    expect(a.id).not.toBe(b.id);
    expect(a.id).not.toBe('');
    expect([a.label, a.balance, a.apr, a.promo_end_date]).toEqual(['', '', '', '']);
  });
});
