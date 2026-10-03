import { describe, expect, test } from 'vitest';
import type { PlaidItem } from '@/hooks/usePlaidItems';
import { consentItemForAccount, itemsNeedingConsent } from '../statement-consent';

function mk(overrides: Partial<PlaidItem> = {}): PlaidItem {
  return {
    id: 'conn-1',
    plaid_item_id: 'item-1',
    provider: 'plaid',
    institution_id: 'ins_1',
    institution_name: 'Test Bank',
    last_synced_at: '2026-10-03T13:00:00Z',
    created_at: '2026-09-01T00:00:00Z',
    connection_status: 'active',
    liabilities_consent_required: false,
    ...overrides,
  };
}

describe('consentItemForAccount', () => {
  test('undefined account', () => {
    expect(consentItemForAccount(undefined, [mk({ liabilities_consent_required: true })])).toBeUndefined();
  });
  test('account with no plaid_item_id', () => {
    expect(consentItemForAccount({ plaid_item_id: null }, [mk({ liabilities_consent_required: true })])).toBeUndefined();
    expect(consentItemForAccount({ plaid_item_id: '' }, [mk({ liabilities_consent_required: true })])).toBeUndefined();
  });
  test('no item with that id', () => {
    expect(consentItemForAccount({ plaid_item_id: 'nope' }, [mk({ liabilities_consent_required: true })])).toBeUndefined();
  });
  test('returns the flagged item the account belongs to', () => {
    const other = mk({ id: 'conn-2', plaid_item_id: 'item-2', liabilities_consent_required: true });
    const item = mk({ liabilities_consent_required: true });
    expect(consentItemForAccount({ plaid_item_id: 'item-1' }, [other, item])).toBe(item);
  });
  test('an unflagged item is not returned', () => {
    expect(consentItemForAccount({ plaid_item_id: 'item-1' }, [mk()])).toBeUndefined();
  });
  test('a non-Plaid connection is not returned', () => {
    expect(consentItemForAccount({ plaid_item_id: 'item-1' }, [mk({ provider: 'akoya', liabilities_consent_required: true })])).toBeUndefined();
  });
});

describe('itemsNeedingConsent', () => {
  test('keeps only flagged Plaid items', () => {
    const items = [
      mk({ id: 'a' }),
      mk({ id: 'b', liabilities_consent_required: true }),
      mk({ id: 'c', provider: 'akoya', liabilities_consent_required: true }),
    ];
    expect(itemsNeedingConsent(items).map(i => i.id)).toEqual(['b']);
  });
  test('sorts by bank name, unnamed last', () => {
    const items = [
      mk({ id: 'b', institution_name: 'B', liabilities_consent_required: true }),
      mk({ id: 'n', institution_name: null, liabilities_consent_required: true }),
      mk({ id: 'a', institution_name: 'A', liabilities_consent_required: true }),
    ];
    expect(itemsNeedingConsent(items).map(i => i.id)).toEqual(['a', 'b', 'n']);
  });
  test('empty when nothing is flagged', () => {
    expect(itemsNeedingConsent([mk()])).toEqual([]);
  });
  test('does not reorder the input', () => {
    const items = [
      mk({ id: 'b', institution_name: 'B', liabilities_consent_required: true }),
      mk({ id: 'a', institution_name: 'A', liabilities_consent_required: true }),
    ];
    itemsNeedingConsent(items);
    expect(items.map(i => i.id)).toEqual(['b', 'a']);
  });
});
