// Drafted by local qwen3:14b (Ollama), reviewed by Ada 2026-10-07.
import { toScheduledObligations } from '../upcoming-obligations';
import { describe, it, expect } from 'vitest';

describe('toScheduledObligations', () => {
  it('drops income rows', () => {
    const input = [{ date: '2023-01-01', type: 'income', amount: 100 }];
    const output = toScheduledObligations(input, 'test-source');
    expect(output).toEqual([]);
  });

  it('drops rows with empty date', () => {
    const input = [{ date: '', type: 'expense', amount: 100 }];
    const output = toScheduledObligations(input, 'test-source');
    expect(output).toEqual([]);
  });

  it('drops zero, negative, and NaN amounts', () => {
    const input = [
      { date: '2023-01-01', type: 'expense', amount: 0 },
      { date: '2023-01-01', type: 'expense', amount: -5 },
      { date: '2023-01-01', type: 'expense', amount: NaN },
    ];
    const output = toScheduledObligations(input, 'test-source');
    expect(output).toEqual([]);
  });

  it('names fall back to note -> category -> source', () => {
    const input = [
      { date: '2023-01-01', type: 'expense', amount: 100, note: 'rent' },
      { date: '2023-01-01', type: 'expense', amount: 100, category: 'utilities' },
      { date: '2023-01-01', type: 'expense', amount: 100 },
    ];
    const output = toScheduledObligations(input, 'test-source');
    expect(output).toEqual([
      { date: '2023-01-01', name: 'rent', amount: 100, type: 'expense', source: 'test-source' },
      { date: '2023-01-01', name: 'utilities', amount: 100, type: 'expense', source: 'test-source' },
      { date: '2023-01-01', name: 'test-source', amount: 100, type: 'expense', source: 'test-source' },
    ]);
  });

  it('drops rows with excluded payment sources', () => {
    const input = [
      { date: '2023-01-01', type: 'expense', amount: 100, payment_source: 'account:card-1' },
      { date: '2023-01-01', type: 'expense', amount: 100, payment_source: 'card-1' },
      { date: '2023-01-01', type: 'expense', amount: 100, payment_source: null },
    ];
    const output = toScheduledObligations(
      input,
      'test-source',
      new Set(['card-1']),
    );
    expect(output).toEqual([{ date: '2023-01-01', name: 'test-source', amount: 100, type: 'expense', source: 'test-source' }]);
  });

  it('ensures all outputs have type expense and given source', () => {
    const input = [{ date: '2023-01-01', type: 'expense', amount: 100 }];
    const output = toScheduledObligations(input, 'test-source');
    expect(output).toEqual([
      { date: '2023-01-01', name: 'test-source', amount: 100, type: 'expense', source: 'test-source' },
    ]);
  });
});
