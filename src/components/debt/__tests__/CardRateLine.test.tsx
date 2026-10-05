// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import CardRateLine, { CardPromoList } from '../CardRateLine';
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

  // Tre, 2026-10-05 (c3031372): eight promo lines on one card was too much. Several promos
  // collapse to ONE summary line; each plan is still one tap away.
  const account = (tranches: BalanceTranche[]) =>
    ({ apr: 27.74, balance_tranches: tranches }) as unknown as Parameters<typeof CardRateLine>[0]['account'];

  const three = () => account([
    tranche({ id: 'a', label: 'A', balance: 1000, promo_end_date: '2099-03-07' }),
    tranche({ id: 'b', label: 'B', balance: 500, promo_end_date: '2099-01-07' }),
    tranche({ id: 'c', label: 'C', balance: 250, promo_end_date: '2099-06-07' }),
  ]);

  it('collapses several promos to one summary line with the right totals and no control', () => {
    render(<CardRateLine card={makeCard({ id: 'P', balance: 1750, apr: 27.74 })} utilizationNow={10} account={three()} />);
    const summary = screen.getByTestId('promo-summary').textContent ?? '';
    expect(summary).toContain('3 promo balances ($1,750)');
    expect(summary).toContain('from Jan 7, 2099');
    expect(screen.queryAllByText(/clearing it first needs/)).toHaveLength(0);
    // It renders inside the card's header <button>; a nested button is invalid and toggles the card.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('lists each promo in the opened card', () => {
    render(<CardPromoList card={makeCard({ id: 'P', balance: 1750, apr: 27.74 })} account={three()} />);
    expect(screen.getAllByText(/clearing it first needs/)).toHaveLength(3);
  });

  it('keeps the full line for a single promo in the header, and the opened card adds nothing', () => {
    const acct = account([tranche({ id: 'a', label: 'A', balance: 1000, promo_end_date: '2099-03-07' })]);
    const card = makeCard({ id: 'P', balance: 1000, apr: 27.74 });
    render(<><CardRateLine card={card} utilizationNow={10} account={acct} /><CardPromoList card={card} account={acct} /></>);
    expect(screen.getAllByText(/clearing it first needs/)).toHaveLength(1);
    expect(screen.queryByTestId('promo-summary')).toBeNull();
    expect(screen.queryByTestId('promo-each')).toBeNull();
  });
});
