// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AvalancheOrderList from '../AvalancheOrderList';
import { getStrategyPayoffOrder } from '@/lib/debt-payoff-order';
import type { CardData } from '@/lib/credit-card-engine';
import type { BalanceTranche } from '@/lib/balance-tranches';

// Renders the build list from the SELECTOR's output (not a hand-written array), so this also
// proves the wiring: what reaches the screen as #1 is what the engine's ordering rule picked.

afterEach(cleanup);

const CARD_BASE = {
  creditLimit: 10000, monthlyRepayments: 0, color: '#000',
  autopayFullBalance: false, statementBalancePhase: false, statementBalance: null,
  steadyMonthlyPurchases: 0, monthlyNewPurchases: 0, paymentPreference: null,
} as const;

function makeCard(overrides: Partial<CardData> & Pick<CardData, 'id'>): CardData {
  return {
    ...CARD_BASE, name: overrides.id, balance: 0, apr: 0,
    minPayment: 25, targetPayment: 25, dueDay: 15,
    ...overrides,
  } as CardData;
}

function tranche(overrides: Partial<BalanceTranche>): BalanceTranche {
  return { id: 't', label: 'Promo balance', balance: 0, apr: 0, promo_end_date: null, ...overrides };
}

const cards: CardData[] = [
  makeCard({ id: 'Y', name: 'Plain card', balance: 3000, apr: 20 }),
  makeCard({ id: 'X', name: 'Tranche card', balance: 5000, apr: 10,
    tranches: [tranche({ id: 'hi', label: 'Cash advance', balance: 5000, apr: 29.99 })] }),
];

function rowText(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.space-y-1 > div')).map(
    el => (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

describe('AvalancheOrderList', () => {
  it('numbers the cards in the engine\'s paying order, tranche card first', () => {
    const { container } = render(
      <AvalancheOrderList entries={getStrategyPayoffOrder(cards, 'avalanche', '2026-08-14')} strategy="avalanche" />,
    );
    expect(rowText(container)).toEqual([
      '#1Tranche card10% APR · attacking 29.99% tranche$5,000',
      '#2Plain card20% APR$3,000',
    ]);
  });

  it('keeps the flat APR on the tranche card — the marginal rate is additional', () => {
    render(<AvalancheOrderList entries={getStrategyPayoffOrder(cards, 'avalanche', '2026-08-14')} strategy="avalanche" />);
    expect(screen.getByText(/10% APR/)).toBeTruthy();
  });

  it('reorders and relabels for snowball', () => {
    const { container } = render(
      <AvalancheOrderList entries={getStrategyPayoffOrder(cards, 'snowball', '2026-08-14')} strategy="snowball" />,
    );
    expect(screen.getByText('Snowball order')).toBeTruthy();
    expect(rowText(container)[0]).toContain('#1Plain card');
  });

  it('renders nothing at all when no card is being paid off — no empty shell, no zero', () => {
    const { container } = render(<AvalancheOrderList entries={[]} strategy="avalanche" />);
    expect(container.innerHTML).toBe('');
  });
});
