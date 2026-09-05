// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import AvalancheOrderList from '../AvalancheOrderList';
import { getStrategyPayoffOrder, getUnratedPayoffCards } from '@/lib/debt-payoff-order';
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
      <AvalancheOrderList entries={getStrategyPayoffOrder(cards, 'avalanche', '2026-08-14')} strategy="avalanche" unrated={[]} onSetApr={() => {}} />,
    );
    expect(rowText(container)).toEqual([
      '#1Tranche card10% APR · attacking 29.99% tranche$5,000',
      '#2Plain card20% APR$3,000',
    ]);
  });

  it('keeps the flat APR on the tranche card — the marginal rate is additional', () => {
    render(<AvalancheOrderList entries={getStrategyPayoffOrder(cards, 'avalanche', '2026-08-14')} strategy="avalanche" unrated={[]} onSetApr={() => {}} />);
    expect(screen.getByText(/10% APR/)).toBeTruthy();
  });

  it('reorders and relabels for snowball', () => {
    const { container } = render(
      <AvalancheOrderList entries={getStrategyPayoffOrder(cards, 'snowball', '2026-08-14')} strategy="snowball" unrated={[]} onSetApr={() => {}} />,
    );
    expect(screen.getByText('Snowball order')).toBeTruthy();
    expect(rowText(container)[0]).toContain('#1Plain card');
  });

  it('renders nothing at all when no card is being paid off — no empty shell, no zero', () => {
    const { container } = render(<AvalancheOrderList entries={[]} strategy="avalanche" unrated={[]} onSetApr={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});

/**
 * The "needs your rate" half. These tests PRESS the control rather than reading its label: the
 * whole point of the row is that one tap, where the problem is visible, supplies the missing rate.
 * A test that only asserted the text was on screen would pass against a Save button that throws.
 */
const unratedCards: CardData[] = [
  makeCard({ id: 'K', name: 'Known card', balance: 2000, apr: 22 }),
  makeCard({ id: 'U', name: 'Unrated card', balance: 900, apr: 0, aprIsUnknown: true }),
];

function renderWithUnrated(onSetApr: (cardId: string, apr: number) => void) {
  return render(
    <AvalancheOrderList
      entries={getStrategyPayoffOrder(unratedCards, 'avalanche', '2026-08-14')}
      strategy="avalanche"
      unrated={getUnratedPayoffCards(unratedCards, 'avalanche', '2026-08-14')}
      onSetApr={onSetApr}
    />,
  );
}

describe('AvalancheOrderList — needs your rate', () => {
  it('lists the unrated card under its own heading and never in the numbered order', () => {
    renderWithUnrated(() => {});
    expect(screen.getByText('Needs your rate')).toBeTruthy();
    expect(screen.getByText('Unrated card')).toBeTruthy();
    // #1 is the only numbered row, and it is the card that has a rate.
    expect(screen.getByText('#1')).toBeTruthy();
    expect(screen.queryByText('#2')).toBeNull();
  });

  it('says so in words, not only in colour — the label is readable without seeing the styling', () => {
    renderWithUnrated(() => {});
    expect(screen.getByText(/not ranked/i).textContent).toContain('minimum is still paid');
  });

  it('SAVES the rate when the input is filled and the button is PRESSED', () => {
    const saved: Array<[string, number]> = [];
    renderWithUnrated((cardId, apr) => { saved.push([cardId, apr]); });
    const input = screen.getByLabelText('APR for Unrated card') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '19.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saved).toEqual([['U', 19.99]]);
  });

  it('saves on Enter too, so the phone keyboard\'s own key works', () => {
    const saved: Array<[string, number]> = [];
    renderWithUnrated((cardId, apr) => { saved.push([cardId, apr]); });
    const input = screen.getByLabelText('APR for Unrated card');
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(saved).toEqual([['U', 7]]);
  });

  it('refuses an impossible rate rather than storing it — 250% saves NOTHING', () => {
    const saved: Array<[string, number]> = [];
    renderWithUnrated((cardId, apr) => { saved.push([cardId, apr]); });
    const input = screen.getByLabelText('APR for Unrated card');
    fireEvent.change(input, { target: { value: '250' } });
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(saved).toEqual([]);
  });

  it('accepts a genuine 0% typed by hand — 0 is a rate, and it must be storable', () => {
    const saved: Array<[string, number]> = [];
    renderWithUnrated((cardId, apr) => { saved.push([cardId, apr]); });
    fireEvent.change(screen.getByLabelText('APR for Unrated card'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saved).toEqual([['U', 0]]);
  });

  it('starts with Save disabled — an empty box must not write a rate', () => {
    renderWithUnrated(() => {});
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
