// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import CardRateLine from '../CardRateLine';
import type { CardData } from '@/lib/credit-card-engine';
import type { BalanceTranche } from '@/lib/balance-tranches';

// The card header keeps its flat APR forever (REDESIGN-PLAN decision 4) and gains the marginal
// rate only where the two differ — so a single-rate card must render exactly what it rendered
// before this slice.

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

describe('CardRateLine', () => {
  it('renders the flat APR line unchanged on a single-rate card, with no badge', () => {
    const { container } = render(
      <CardRateLine card={makeCard({ id: 'A', balance: 2000, apr: 22.99, dueDay: 12 })} utilizationNow={20} account={undefined} />,
    );
    expect((container.textContent ?? '').replace(/\s+/g, ' ').trim())
      .toBe('22.99% APR · Limit $10,000 · Utilization 20.0% · Due 12th');
    expect(screen.queryByText(/attacking/)).toBeNull();
  });

  it('adds the marginal-rate badge — beside the flat APR, never instead of it', () => {
    const card = makeCard({ id: 'D', balance: 5037.73, apr: 16.6,
      tranches: [tranche({ id: 'promo', balance: 5037.73, apr: 7.99, promo_end_date: '2028-01-04' })] });
    const { container } = render(<CardRateLine card={card} utilizationNow={50.4} account={undefined} />);
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('16.6% APR');
    expect(text).toContain('attacking 7.99% tranche');
  });

  it('styles the badge as information, not as an action (no gold)', () => {
    const card = makeCard({ id: 'D', balance: 5037.73, apr: 16.6,
      tranches: [tranche({ id: 'promo', balance: 5037.73, apr: 7.99, promo_end_date: '2028-01-04' })] });
    render(<CardRateLine card={card} utilizationNow={50.4} account={undefined} />);
    const badge = screen.getByText(/attacking 7.99% tranche/);
    expect(badge.className).toContain('text-muted-foreground');
    expect(badge.className).not.toContain('text-gold');
    expect(badge.className).not.toContain('text-primary');
  });
});
