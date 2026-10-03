// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PlaidItem } from '@/hooks/usePlaidItems';

const state: { items: PlaidItem[]; invalidate: ReturnType<typeof vi.fn> } = { items: [], invalidate: vi.fn() };
vi.mock('@/hooks/usePlaidItems', () => ({ usePlaidItems: () => state }));
vi.mock('@/components/shared/PlaidLinkButton', () => ({
  default: ({ label, relinkItemId, onSuccess }: { label: string; relinkItemId: string; onSuccess: () => void }) => (
    <button data-relink={relinkItemId} onClick={() => onSuccess()}>{label}</button>
  ),
}));

import StatementConsentBanner from '../StatementConsentBanner';

function mk(o: Partial<PlaidItem>): PlaidItem {
  return {
    id: 'c1', plaid_item_id: 'item-1', provider: 'plaid', institution_id: null, institution_name: 'Chase',
    last_synced_at: null, created_at: '2026-09-01T00:00:00Z', connection_status: 'active',
    liabilities_consent_required: false, ...o,
  } as PlaidItem;
}

beforeEach(() => { state.items = []; state.invalidate = vi.fn(); });

describe('StatementConsentBanner', () => {
  test('renders nothing and reports hidden when no bank is flagged', () => {
    state.items = [mk({})];
    const onVis = vi.fn();
    const { container } = render(<StatementConsentBanner onVisibleChange={onVis} />);
    expect(container.firstChild).toBeNull();
    expect(onVis).toHaveBeenLastCalledWith(false);
  });

  test('one flagged bank: names it and relinks that item', () => {
    state.items = [mk({}), mk({ id: 'c2', plaid_item_id: 'item-2', institution_name: 'Discover', liabilities_consent_required: true })];
    const onVis = vi.fn();
    render(<StatementConsentBanner onVisibleChange={onVis} />);
    expect(screen.getByText('Discover needs your OK to share statements')).toBeTruthy();
    const btn = screen.getByRole('button', { name: 'Allow statement data' });
    expect(btn.getAttribute('data-relink')).toBe('item-2');
    expect(onVis).toHaveBeenLastCalledWith(true);
    fireEvent.click(btn);
    expect(state.invalidate).toHaveBeenCalledTimes(1);
  });

  test('two flagged banks: one button per bank', () => {
    state.items = [
      mk({ id: 'a', plaid_item_id: 'i-a', institution_name: 'USAA', liabilities_consent_required: true }),
      mk({ id: 'b', plaid_item_id: 'i-b', institution_name: 'Amex', liabilities_consent_required: true }),
    ];
    render(<StatementConsentBanner />);
    expect(screen.getByText('2 banks need your OK to share statements')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Allow Amex' }).getAttribute('data-relink')).toBe('i-b');
    expect(screen.getByRole('button', { name: 'Allow USAA' }).getAttribute('data-relink')).toBe('i-a');
  });

  test('Dismiss hides it and reports hidden', () => {
    state.items = [mk({ liabilities_consent_required: true })];
    const onVis = vi.fn();
    render(<StatementConsentBanner onVisibleChange={onVis} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('statement-consent-banner')).toBeNull();
    expect(onVis).toHaveBeenLastCalledWith(false);
  });
});
