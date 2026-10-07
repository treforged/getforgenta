// Drafted by local qwen3:14b (Ollama), reviewed by Ada 2026-10-07 (one case added).
import { otherAssetSourceId, assetAccountIdsOf } from '../other-account-cash';
import { describe, it, expect } from 'vitest';

describe('otherAssetSourceId', () => {
  it('returns null when paymentSource is null', () => {
    expect(otherAssetSourceId(null, 'fund123', new Set(['asset456']))).toBeNull();
  });

  it('returns null when fundingAccountId is null', () => {
    expect(otherAssetSourceId('account:asset456', null, new Set(['asset456']))).toBeNull();
  });

  it('returns null when paymentSource equals fundingAccountId', () => {
    expect(otherAssetSourceId('account:asset123', 'asset123', new Set(['asset456', 'asset123']))).toBeNull();
  });

  it('returns null when a bare (unprefixed) paymentSource equals fundingAccountId', () => {
    expect(otherAssetSourceId('asset123', 'asset123', new Set(['asset123']))).toBeNull();
  });

  it('returns null when paymentSource is not in assetAccountIds', () => {
    expect(otherAssetSourceId('account:asset999', 'fund123', new Set(['asset456']))).toBeNull();
  });

  it('returns valid asset ID when paymentSource is in assetAccountIds and differs from fundingAccountId', () => {
    expect(otherAssetSourceId('account:asset456', 'fund123', new Set(['asset456']))).toEqual('asset456');
  });
});

describe('assetAccountIdsOf', () => {
  it('adds account IDs when account_type is not credit_card', () => {
    const accounts = [
      { id: 'asset123', account_type: 'checking' },
      { id: 'asset456', account_type: 'savings' },
    ];
    expect(assetAccountIdsOf(accounts)).toEqual(new Set(['asset123', 'asset456']));
  });

  it('skips accounts without id', () => {
    const accounts = [
      { id: null, account_type: 'checking' },
      { id: undefined, account_type: 'checking' },
    ];
    expect(assetAccountIdsOf(accounts)).toEqual(new Set());
  });

  it('skips credit card accounts', () => {
    const accounts = [
      { id: 'card789', account_type: 'credit_card' },
      { id: 'asset123', account_type: 'credit_card' },
    ];
    expect(assetAccountIdsOf(accounts)).toEqual(new Set());
  });

  it('skips accounts with invalid id types', () => {
    const accounts = [
      { id: 123, account_type: 'checking' },
      { id: true, account_type: 'checking' },
    ];
    // Rows straight from the database are untyped at runtime; the cast models a malformed row.
    expect(assetAccountIdsOf(accounts as unknown as Parameters<typeof assetAccountIdsOf>[0])).toEqual(new Set());
  });
});
