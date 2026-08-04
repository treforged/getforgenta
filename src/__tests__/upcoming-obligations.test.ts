import { describe, it, expect } from 'vitest';
import { toScheduledObligations, type ObligationTransaction } from '@/lib/upcoming-obligations';

const txn = (over: Partial<ObligationTransaction> = {}): ObligationTransaction => ({
  date: '2026-08-07',
  type: 'expense',
  amount: 100,
  note: 'Something',
  ...over,
});

describe('toScheduledObligations', () => {
  it('maps expense rows to scheduled events tagged with the source', () => {
    const events = toScheduledObligations(
      [txn({ note: 'Prime Visa Payment', amount: 1007.95 })],
      'Card payment',
    );
    expect(events).toEqual([
      {
        date: '2026-08-07',
        name: 'Prime Visa Payment',
        amount: 1007.95,
        type: 'expense',
        source: 'Card payment',
      },
    ]);
  });

  it('keeps income, zero-amount and undated rows out of the bills total', () => {
    const events = toScheduledObligations(
      [
        txn({ type: 'income' }),
        txn({ amount: 0 }),
        txn({ amount: -50 }),
        txn({ date: '' }),
        txn({ note: 'Chevrolet Payment', amount: 423 }),
      ],
      'Vehicle',
    );
    expect(events.map(e => e.name)).toEqual(['Chevrolet Payment']);
  });

  it('falls back to category then source when a row has no note', () => {
    const events = toScheduledObligations(
      [txn({ note: null, category: 'Insurance' }), txn({ note: null, category: null })],
      'Vehicle',
    );
    expect(events.map(e => e.name)).toEqual(['Insurance', 'Vehicle']);
  });

  it('drops rows charged to an excluded payment source, with or without the account: prefix', () => {
    const excluded = new Set(['card-1']);
    const events = toScheduledObligations(
      [
        txn({ note: 'On card', payment_source: 'account:card-1' }),
        txn({ note: 'Also on card', payment_source: 'card-1' }),
        txn({ note: 'From checking', payment_source: 'account:bank-1' }),
        txn({ note: 'No source' }),
      ],
      'Payment plan',
      excluded,
    );
    expect(events.map(e => e.name)).toEqual(['From checking', 'No source']);
  });
});
