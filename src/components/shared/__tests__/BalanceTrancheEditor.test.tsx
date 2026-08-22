// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import BalanceTrancheEditor from '../BalanceTrancheEditor';
import { tranchesToRows, type TrancheFormRow } from '@/lib/tranche-form';

// DateScrollPicker animates its columns with scrollTo, which jsdom does not implement.
beforeAll(() => {
  Element.prototype.scrollTo = () => {};
});

afterEach(cleanup);

const STORED = [{
  id: 'discover-bt-2026-06',
  label: 'Prime Visa transfer',
  balance: 5037.73,
  apr: 7.99,
  promo_end_date: '2028-01-04',
}];

function inputsOf(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll('input'));
}

describe('BalanceTrancheEditor', () => {
  it('renders a stored tranche back into its boxes', () => {
    const { container } = render(
      <BalanceTrancheEditor rows={tranchesToRows(STORED)} onChange={() => {}} accountBalance="10316.73" />,
    );
    expect(inputsOf(container).map(i => i.value)).toEqual(['Prime Visa transfer', '5037.73', '7.99', '']);
    expect(screen.getByText('Tier 1')).toBeTruthy();
  });

  it('adds a blank row and removes an existing one', () => {
    const onChange = vi.fn<(rows: TrancheFormRow[]) => void>();
    const rows = tranchesToRows(STORED);
    const { rerender } = render(
      <BalanceTrancheEditor rows={rows} onChange={onChange} accountBalance="10316.73" />,
    );

    fireEvent.click(screen.getByText('Add Rate Tier'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const added = onChange.mock.calls[0][0];
    expect(added).toHaveLength(2);
    expect(added[1].balance).toBe('');

    rerender(<BalanceTrancheEditor rows={added} onChange={onChange} accountBalance="10316.73" />);
    fireEvent.click(screen.getByLabelText('Remove tier 1'));
    expect(onChange.mock.calls[1][0]).toEqual([added[1]]);
  });

  it('edits one row without touching its neighbour', () => {
    const onChange = vi.fn<(rows: TrancheFormRow[]) => void>();
    const rows: TrancheFormRow[] = [
      { id: 'a', label: 'BT', balance: '100', apr: '0', promo_end_date: '', min_payment: '' },
      { id: 'b', label: 'Purchases', balance: '200', apr: '16.6', promo_end_date: '', min_payment: '' },
    ];
    const { container } = render(
      <BalanceTrancheEditor rows={rows} onChange={onChange} accountBalance="300" />,
    );
    // Row 2's balance box: [label, balance, apr, min_payment] per row.
    fireEvent.change(inputsOf(container)[5], { target: { value: '250' } });
    expect(onChange.mock.calls[0][0]).toEqual([
      rows[0], { ...rows[1], balance: '250' },
    ]);
  });

  it('shows the soft note ONLY when the tiers outrun the balance, and never blocks', () => {
    const rows = tranchesToRows(STORED);
    const { rerender } = render(
      <BalanceTrancheEditor rows={rows} onChange={() => {}} accountBalance="10316.73" />,
    );
    expect(screen.queryByTestId('tranche-overage-note')).toBeNull();

    rerender(<BalanceTrancheEditor rows={rows} onChange={() => {}} accountBalance="5000" />);
    const note = screen.getByTestId('tranche-overage-note');
    expect(note.textContent).toContain('$5,037.73');
    expect(note.textContent).toContain('$5,000.00');
    // A note, not a barrier: nothing here is disabled and the rows stay editable.
    expect(note.querySelectorAll('button')).toHaveLength(0);
  });

  it('a blank balance box raises no false alarm', () => {
    render(<BalanceTrancheEditor rows={tranchesToRows(STORED)} onChange={() => {}} accountBalance="" />);
    expect(screen.queryByTestId('tranche-overage-note')).toBeNull();
  });
});
